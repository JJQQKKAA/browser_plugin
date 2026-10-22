const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const core = require('../reader-core.js')

function event() {
  const listeners = []
  return { addListener: fn => listeners.push(fn), emit: value => listeners.forEach(fn => fn(value)) }
}

function setup(fetcher, config = {}) {
  const onConnect = event()
  const sent = []
  const requests = []
  let optionsOpened = 0
  const model = { id: 'm1', name: '测试模型', apiUrl: 'https://api.modelscope.cn/v1/chat/completions', apiKey: 'secret-key', modelCode: 'test' }
  const stored = { webReaderConfig: { models: [model], prompts: [] }, lastUsedModelId: 'm1', ...config }
  const port = { name: 'web-reader-selection', sender: { id: 'extension', tab: { id: 1 }, url: 'https://example.com/article' }, onMessage: event(), onDisconnect: event(), postMessage: value => sent.push(value), disconnect: () => port.onDisconnect.emit() }
  const context = vm.createContext({
    ReaderCore: core, URL, AbortController, DOMException, setTimeout, clearTimeout,
    fetch: async (url, options) => { requests.push({ url, ...options }); return fetcher(url, options) },
    chrome: { runtime: { getURL: path => `chrome-extension://extension/${path}`, id: 'extension', onConnect, openOptionsPage: async () => { optionsOpened++ } }, storage: { local: { get: async () => stored, set: async values => Object.assign(stored, values) } } }
  })
  vm.runInContext(fs.readFileSync(require.resolve('../selection-background.js'), 'utf8'), context)
  onConnect.emit(port)
  return { port, sent, requests, stored, optionsOpened: () => optionsOpened }
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('等待划词消息超时')
}

function response(parts) {
  return new Response(parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n')
}

const start = (port, id = 1, text = 'Hello $& world') => port.onMessage.emit({ type: 'run', id, text, modelId: 'm1', promptId: 'task_translate', apiUrl: 'https://untrusted.test', apiKey: 'untrusted' })

test('划词仅在点击请求后发送，复用模型参数且只回传模型名称和译文', async () => {
  const app = setup(() => response([{ choices: [{ delta: { content: '你好' } }] }, { choices: [], usage: { total_tokens: 20 } }]))
  app.port.onMessage.emit({ type: 'init' })
  await until(() => app.sent.some(message => message.type === 'config'))
  assert.equal(app.requests.length, 0)
  assert.equal(app.sent[0].selectedModelId, 'm1')
  assert.deepEqual(JSON.parse(JSON.stringify(app.sent[0].models)), [{ id: 'm1', name: '测试模型' }])
  start(app.port)
  await until(() => app.sent.some(message => message.type === 'done'))
  assert.equal(app.requests[0].url, app.stored.webReaderConfig.models[0].apiUrl)
  assert.equal(app.requests[0].headers.Authorization, 'Bearer secret-key')
  const body = JSON.parse(app.requests[0].body)
  assert.equal(body.enable_thinking, false)
  assert.equal(body.stream_options.include_usage, true)
  assert.match(body.messages[1].content, /Hello \$& world/)
  assert.equal(body.messages.length, 2)
  assert.equal(app.sent.find(message => message.type === 'delta').text, '你好')
  assert.doesNotMatch(JSON.stringify(app.sent), /secret-key|untrusted/)
  assert.equal(app.stored.summaryState, undefined)
})

test('无模型、超长选区和不合法端点不发起网络请求，并可打开设置', async () => {
  const app = setup(() => assert.fail('不应发送请求'), { webReaderConfig: { models: [] } })
  start(app.port)
  await until(() => app.sent.some(message => message.type === 'error'))
  app.sent.length = 0
  start(app.port, 2, 'x'.repeat(12001))
  await until(() => app.sent.some(message => message.type === 'error'))
  assert.match(app.sent[0].message, /12000/)
  app.port.onMessage.emit({ type: 'options' })
  await until(() => app.optionsOpened() === 1)
  app.stored.webReaderConfig.models = [{ id: 'm1', apiUrl: 'file:///tmp/private', modelCode: 'x' }]
  app.sent.length = 0
  start(app.port, 3)
  await until(() => app.sent.some(message => message.type === 'error'))
  assert.match(app.sent[0].message, /HTTP/)
  assert.equal(app.requests.length, 0)
})

test('HTTP 和无正文错误可见，原始错误响应不泄露到网页', async () => {
  const failed = setup(() => new Response('proxy leaked secret-key', { status: 401 }))
  start(failed.port)
  await until(() => failed.sent.some(message => message.type === 'error'))
  assert.match(failed.sent.at(-1).message, /401/)
  assert.doesNotMatch(JSON.stringify(failed.sent), /secret-key/)
  const empty = setup(() => response([{ choices: [], usage: { total_tokens: 0 } }]))
  start(empty.port)
  await until(() => empty.sent.some(message => message.type === 'error'))
  assert.match(empty.sent.at(-1).message, /没有返回正文/)
})

test('停止保留已发译文，断开连接取消请求', async () => {
  const app = setup((url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分译文"}}]}\n\n'))
      options.signal.addEventListener('abort', () => controller.error(new DOMException('停止', 'AbortError')))
    }
  })))
  start(app.port)
  await until(() => app.sent.some(message => message.type === 'delta'))
  app.port.onMessage.emit({ type: 'stop', id: 1 })
  await until(() => app.sent.some(message => message.type === 'stopped'))
  assert.equal(app.requests[0].signal.aborted, true)
  assert.equal(app.sent.find(message => message.type === 'delta').text, '部分译文')
  start(app.port, 2)
  await until(() => app.sent.some(message => message.type === 'delta' && message.id === 2))
  app.port.disconnect()
  assert.equal(app.requests[1].signal.aborted, true)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(app.sent.some(message => message.type === 'stopped' && message.id === 2), false)
})

test('切换模型或重试取消旧任务，不回传旧任务终态', async () => {
  const app = setup((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('停止', 'AbortError')))
    if (app.requests.length === 2) resolve(response([{ choices: [{ delta: { content: '新译文' } }] }]))
  }))
  start(app.port, 1)
  await until(() => app.requests.length === 1)
  start(app.port, 2)
  await until(() => app.sent.some(message => message.type === 'done'))
  assert.equal(app.requests[0].signal.aborted, true)
  assert.equal(app.sent.some(message => ['done', 'stopped', 'error', 'delta'].includes(message.type) && message.id === 1), false)
  assert.equal(app.sent.find(message => message.type === 'delta').text, '新译文')
})

test('拒绝来自非网页或其他扩展的连接', () => {
  // 使用独立上下文重新触发连接，验证 sender 检查早于消息绑定
  let connect
  vm.runInNewContext(fs.readFileSync(require.resolve('../selection-background.js'), 'utf8'), {
    ReaderCore: core, chrome: { runtime: { getURL: path => `chrome-extension://extension/${path}`, id: 'extension', onConnect: { addListener: fn => { connect = fn } } } }
  })
  for (const sender of [{ id: 'other', tab: {}, url: 'https://example.com' }, { id: 'extension', tab: {}, url: 'chrome://settings' }, { id: 'extension', url: 'https://example.com' }]) {
    let disconnected = false
    connect({ name: 'web-reader-selection', sender, disconnect: () => { disconnected = true } })
    assert.equal(disconnected, true)
  }
})


test('复用已保存的隐藏任务、全部占位符和 System Prompt，独立记住划词任务', async () => {
  const app = setup(() => response([{ choices: [{ delta: { content: '总结' } }] }]), {
    webReaderConfig: { models: [{ id: 'm1', name: '模型', apiUrl: 'https://example.com/chat', modelCode: 'x' }], prompts: [
      { id: 'summary', shortName: '自定义总结', systemPrompt: '仅用中文', userPrompt: '总结 {{content}}；核对 {{content}}', showAsTask: false }
    ] }, lastUsedPromptId: 'summary'
  })
  app.port.onMessage.emit({ type: 'init' })
  await until(() => app.sent.some(message => message.type === 'config'))
  assert.equal(app.sent[0].tasks[0].name, '自定义总结')
  assert.equal(app.sent[0].selectedTaskId, 'summary')
  assert.equal(app.requests.length, 0)
  app.port.onMessage.emit({ type: 'run', id: 1, text: 'Hello $&', modelId: 'm1', promptId: 'summary' })
  await until(() => app.sent.some(message => message.type === 'done'))
  const messages = JSON.parse(app.requests[0].body).messages
  assert.equal(messages[0].content, '仅用中文')
  assert.equal(messages[1].content, '总结 Hello $&；核对 Hello $&')
  assert.equal(app.stored.lastUsedSelectionPromptId, 'summary')
  assert.equal(app.stored.lastUsedPromptId, 'summary')
  app.stored.lastUsedPromptId = 'other'
  app.sent.length = 0
  app.port.onMessage.emit({ type: 'init' })
  await until(() => app.sent.some(message => message.type === 'config'))
  assert.equal(app.sent[0].selectedTaskId, 'summary')
})

test('无占位符的任务附带选区，任务被删除时明确报错而不执行其他任务', async () => {
  const app = setup(() => response([{ choices: [{ delta: { content: '摘要' } }] }]))
  app.stored.webReaderConfig.prompts = [{ id: 'custom', shortName: '摘要', userPrompt: '用一句话总结' }]
  app.port.onMessage.emit({ type: 'run', id: 1, text: '原文', modelId: 'm1', promptId: 'custom' })
  await until(() => app.sent.some(message => message.type === 'done'))
  assert.equal(JSON.parse(app.requests[0].body).messages[1].content, '用一句话总结\n\n原文')
  app.sent.length = 0
  start(app.port, 2)
  await until(() => app.sent.some(message => message.type === 'error'))
  assert.match(app.sent[0].message, /任务已删除/)
  assert.equal(app.requests.length, 1)
})


test('默认操作缺省只开面板，指定任务优先于上次任务且不自动发送后台请求', async () => {
  const app = setup(() => assert.fail('初始化不得直接请求模型'))
  app.port.onMessage.emit({ type: 'init' })
  await until(() => app.sent.some(message => message.type === 'config'))
  assert.equal(app.sent[0].defaultAction.mode, 'panel')
  app.stored.selectionDefaultAction = { mode: 'task', promptId: 'task_translate' }
  app.stored.lastUsedSelectionPromptId = 'task_quick'
  app.sent.length = 0
  app.port.onMessage.emit({ type: 'init' })
  await until(() => app.sent.some(message => message.type === 'config'))
  assert.equal(app.sent[0].defaultAction.mode, 'task')
  assert.equal(app.sent[0].selectedTaskId, 'task_translate')
  assert.equal(app.requests.length, 0)
})

test('指定的默认任务被删除时只开面板，不自动执行回退任务', async () => {
  const app = setup(() => assert.fail('删除任务后不得自动请求模型'), { selectionDefaultAction: { mode: 'task', promptId: 'deleted' } })
  app.port.onMessage.emit({ type: 'init' })
  await until(() => app.sent.some(message => message.type === 'config'))
  assert.equal(app.sent[0].defaultAction.mode, 'panel')
  assert.equal(app.sent[0].actionUnavailable, true)
  assert.equal(app.requests.length, 0)
})


test('只允许本扩展 PDF 阅读器复用划词通道，其他扩展页面仍拒绝', async () => {
  let connect
  const sent = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../selection-background.js'), 'utf8'), {
    ReaderCore: core, chrome: {
      runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onConnect: { addListener: fn => { connect = fn } } },
      storage: { local: { get: async () => ({}) } }
    }
  })
  const pdfPort = { name: 'web-reader-selection', sender: { id: 'extension', url: 'chrome-extension://extension/pdf-reader.html?file=test#page=1' }, onMessage: event(), onDisconnect: event(), postMessage: message => sent.push(message), disconnect: () => assert.fail('PDF 阅读器不应被拒绝') }
  connect(pdfPort)
  pdfPort.onMessage.emit({ type: 'init' })
  await until(() => sent.length > 0)
  assert.equal(sent[0].type, 'config')
  for (const url of ['chrome-extension://extension/options.html', 'chrome-extension://other/pdf-reader.html', 'chrome-extension://extension/pdf-reader.html-fake']) {
    let disconnected = false
    connect({ name: 'web-reader-selection', sender: { id: 'extension', url }, disconnect: () => { disconnected = true } })
    assert.equal(disconnected, true)
  }
})
