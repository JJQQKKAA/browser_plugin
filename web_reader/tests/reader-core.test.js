const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readSSE, buildRequest, prepareConfig } = require('../reader-core.js')

test('移除旧组合而不覆盖、添加或删除已有任务', () => {
  const config = { readingTasksVersion: 1, models: [{ id: 'm1' }], prompts: [{ id: 'task_quick', shortName: '自定义', userPrompt: '原始内容 {{content}}', showAsTask: false }], combinations: [{ isDefault: true }] }
  const before = structuredClone(config.prompts)
  assert.equal(prepareConfig(config), true)
  assert.deepEqual(config.prompts, before)
  assert.equal(config.readingTasksVersion, 2)
  assert.equal('combinations' in config, false)
  assert.equal(prepareConfig(config), false)
  config.prompts = []
  assert.equal(prepareConfig(config), false)
  assert.equal(config.prompts.length, 0)
})

function stream(chunks) {
  return new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close() } })
}

test('SSE 在任意字节断开时保留中文、CRLF、usage 和最后无换行事件', async () => {
  const source = 'data: {"choices":[{"delta":{"content":"你好🌍"}}]}\r\n\r\ndata: {"usage":{"prompt_tokens":7}}\n\ndata: {"choices":[{"delta":{"content":"完成"}}]}'
  const bytes = new TextEncoder().encode(source)
  for (let index = 1; index < bytes.length; index++) {
    const events = []
    await readSSE(stream([bytes.slice(0, index), bytes.slice(index)]), data => events.push(data))
    assert.equal(events.map(event => event.choices?.[0]?.delta.content || '').join(''), '你好🌍完成')
    assert.equal(events[1].usage.prompt_tokens, 7)
  }
  const events = []
  await readSSE(stream(Array.from(bytes, byte => Uint8Array.of(byte))), data => events.push(data))
  assert.equal(events.length, 3)
})

test('SSE 支持多行 data、注释、DONE 并停止读取', async () => {
  const source = ': keepalive\r\rdata: {"choices":\rdata: [{"delta":{"content":"OK"}}]}\r\rdata:[DONE]\r\rdata: invalid\n\n'
  const events = []
  await readSSE(stream([new TextEncoder().encode(source)]), data => events.push(data))
  assert.equal(events.length, 1)
  assert.equal(events[0].choices[0].delta.content, 'OK')
})

test('SSE 数据损坏不会静默吞掉', async () => {
  await assert.rejects(readSSE(stream([new TextEncoder().encode('data: broken\n\n')]), () => {}), SyntaxError)
})

test('ModelScope 默认关闭 thinking，其他端点自动模式不发送参数', () => {
  const model = { modelCode: 'Qwen/Qwen3-32B', apiUrl: 'https://api-inference.modelscope.cn/v1/chat/completions' }
  assert.equal(buildRequest(model, []).enable_thinking, false)
  assert.equal(buildRequest({ ...model, thinkingMode: 'on' }, []).enable_thinking, true)
  assert.equal('enable_thinking' in buildRequest({ ...model, thinkingMode: 'default' }, []), false)
  const other = { ...model, apiUrl: 'https://api.example.com/v1/chat/completions' }
  assert.equal('enable_thinking' in buildRequest(other, []), false)
  assert.equal(buildRequest({ ...other, thinkingMode: 'off' }, []).enable_thinking, false)
})

test('没有迁移标记的已有配置和导入配置不补充内置模板', () => {
  const config = { prompts: [{ id: 'my_prompt', userPrompt: '保留' }] }
  assert.equal(prepareConfig(config), true)
  assert.equal(config.prompts.length, 1)
  assert.equal(config.prompts[0].userPrompt, '保留')
  assert.equal(prepareConfig(config), false)
})

const { mergeUsage, finalizeUsage, addUsage, formatUsage } = require('../reader-core.js')

test('默认请求流式 usage，可单独为不兼容接口关闭', () => {
  const model = { modelCode: 'test', apiUrl: 'https://example.com' }
  assert.deepEqual(buildRequest(model, []).stream_options, { include_usage: true })
  assert.equal('stream_options' in buildRequest({ ...model, includeUsage: false }, []), false)
})

test('OpenAI / ModelScope / 百炼 / Kimi 标准 usage，缓存和思考不重复相加', () => {
  const usage = mergeUsage({}, { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens_details: { reasoning_tokens: 200 } })
  const result = finalizeUsage(usage, 'x', 'x')
  assert.equal(result.input, 1000)
  assert.equal(result.output, 300)
  assert.equal(result.total, 1300)
  assert.equal(result.estimated, false)
  assert.match(formatUsage(result).text, /输入 1,000 · 输出 300 · 合计 1,300 Token/)
  assert.match(formatUsage(result).title, /缓存命中：800/)
  assert.match(formatUsage(result).title, /思考：200/)
})

test('DeepSeek 缓存命中别名与累计快照覆盖，不累加每个 chunk', () => {
  let usage = mergeUsage({}, { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11, prompt_cache_hit_tokens: 8 })
  usage = mergeUsage(usage, null)
  usage = mergeUsage(usage, { completion_tokens: 20, total_tokens: 30 })
  usage = mergeUsage(usage, { prompt_tokens: null, completion_tokens: -1, total_tokens: '30' })
  assert.deepEqual(usage, { input: 10, output: 20, total: 30, cached: 8 })
})

test('兼容 input_tokens/output_tokens 字段，保留真实的 0', () => {
  const result = finalizeUsage(mergeUsage({}, { input_tokens: 0, output_tokens: 0, total_tokens: 0 }), '很长的输入', '很长的输出')
  assert.equal(result.input, 0)
  assert.equal(result.output, 0)
  assert.equal(result.total, 0)
  assert.equal(result.estimated, false)
  assert.doesNotMatch(formatUsage(result).text, /≈/)
})

test('缺失字段分别估算，已知 API 总数时推导另一项', () => {
  const partial = finalizeUsage(mergeUsage({}, { prompt_tokens: 12 }), '不应估算输入', '1234567890')
  assert.equal(partial.input, 12)
  assert.equal(partial.output, 4)
  assert.equal(partial.inputEstimated, false)
  assert.equal(partial.outputEstimated, true)
  assert.equal(partial.totalEstimated, true)
  assert.match(formatUsage(partial).text, /输入 12 · 输出 ≈4 · 合计 ≈16/)
  const derived = finalizeUsage(mergeUsage({}, { completion_tokens: 10, total_tokens: 30 }), '', '')
  assert.equal(derived.input, 20)
  assert.equal(derived.estimated, false)
  const totalOnly = finalizeUsage(mergeUsage({}, { total_tokens: 99 }), '12345', '12345')
  assert.equal(totalOnly.total, 99)
  assert.equal(totalOnly.totalEstimated, false)
})

test('停止或断流仍累计已收到的内容，累计保留估算及不完整标记', () => {
  const actual = finalizeUsage({ input: 20, output: 10 }, '', '')
  const stopped = finalizeUsage({}, '1234567890', '12345', true)
  let total = addUsage({ input: 0, output: 0 }, actual)
  total = addUsage(total, stopped)
  assert.equal(total.input, 24)
  assert.equal(total.output, 12)
  assert.equal(total.total, 36)
  assert.equal(total.totalEstimated, true)
  assert.equal(total.incomplete, true)
  assert.match(formatUsage(stopped).title, /不代表最终账单/)
  assert.match(formatUsage(total).text, /≈/)
})

test('旧消息估算标记与历史累计兼容，不冒充 API 用量', () => {
  assert.match(formatUsage({ input: 10, output: 5, estimated: true }).text, /输入 ≈10/)
  assert.doesNotMatch(formatUsage({ input: 10, output: 5, estimated: false }).text, /≈/)
  assert.match(formatUsage({ input: 10, output: 5 }).title, /历史累计/)
})
