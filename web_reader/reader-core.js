// 弹窗与设置页共用的阅读任务和请求逻辑
const ReaderCore = (() => {
  const defaultTasks = [
    { id: 'task_quick', shortName: '快速摘要', systemPrompt: '你是专业的阅读助手，忠于原文，用简洁清晰的中文回答。', userPrompt: '请用简短、直白的中文说清楚：这篇内容主要讲什么，最重要的结论是什么。\n\n只保留理解主旨所必需的信息，不逐段或逐章总结，不复述论证过程、案例和次要细节。关键依据或限制只有在省略后会造成误解时才保留。\n\n忠于原文，不添加推断。直接输出摘要，不写开场白，不重复结论。原文长，不代表摘要也要长。\n\n{{content}}' },
    { id: 'task_detail', shortName: '详细解读', systemPrompt: '你是专业的阅读助手，区分原文事实和你的分析，不编造信息。', userPrompt: '请详细解读以下内容，按主题概述、关键观点与依据、重要细节、术语解释、启发与局限组织回答。用中文输出。\n\n{{content}}' },
    { id: 'task_translate', shortName: '翻译', systemPrompt: '你是专业译者，忠实准确地翻译，保留原文的标题、段落、列表及代码格式。', userPrompt: '请将以下内容翻译为简体中文；如果原文已经是中文，则翻译为英文。直接输出译文，不附加总结。\n\n{{content}}' }
  ].map(task => ({ ...task, showAsTask: true }))

  function prepareConfig(config) {
    // 新版只迁移结构，不追加模板或覆盖用户已保存的任务
    let changed = config.readingTasksVersion !== 2
    if (Object.prototype.hasOwnProperty.call(config, 'combinations')) {
      delete config.combinations
      changed = true
    }
    config.readingTasksVersion = 2
    return changed
  }

  function thinkingPolicy(model) {
    // 没有新设置时保留旧版显式开启/关闭；自动模式采用首轮关、追问开
    return {
      first: model.thinkingFirst ?? (model.thinkingMode === 'on'),
      followup: model.thinkingFollowup ?? (model.thinkingMode !== 'off')
    }
  }

  function buildRequest(model, messages) {
    const body = { model: model.modelCode, messages, stream: true, temperature: model.temperature ?? 0.3 }
    if (model.includeUsage !== false) body.stream_options = { include_usage: true }
    let isModelScope = false
    try {
      const hostname = new URL(model.apiUrl).hostname
      isModelScope = hostname === 'modelscope.cn' || hostname.endsWith('.modelscope.cn')
    } catch (error) {
      // 地址校验由 fetch 的错误处理负责
    }
    const mode = model.thinkingMode || 'auto'
    if (['custom', 'on', 'off'].includes(mode) || (mode === 'auto' && isModelScope)) {
      // 直接 fetch 时参数放在 JSON 顶层；extra_body 是 Python SDK 的参数
      const policy = thinkingPolicy(model)
      const followup = messages.filter(message => message.role === 'user').length > 1
      body.enable_thinking = followup ? policy.followup : policy.first
    }
    return body
  }

  function tokenCount(...values) {
    return values.find(value => Number.isSafeInteger(value) && value >= 0)
  }

  function mergeUsage(previous = {}, usage) {
    if (!usage || typeof usage !== 'object') return previous
    const next = { ...previous }
    const fields = {
      input: tokenCount(usage.prompt_tokens, usage.input_tokens),
      output: tokenCount(usage.completion_tokens, usage.output_tokens),
      total: tokenCount(usage.total_tokens),
      cached: tokenCount(usage.prompt_tokens_details?.cached_tokens, usage.input_tokens_details?.cached_tokens, usage.prompt_cache_hit_tokens),
      reasoning: tokenCount(usage.completion_tokens_details?.reasoning_tokens, usage.output_tokens_details?.reasoning_tokens, usage.reasoning_tokens)
    }
    // 每个 usage 都是本轮累计快照，覆盖字段而非累加，null 不覆盖已知数据
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) next[key] = value
    }
    return next
  }

  function finalizeUsage(usage, inputText, outputText, incomplete = false) {
    let input = tokenCount(usage.input)
    let output = tokenCount(usage.output)
    const reportedTotal = tokenCount(usage.total)
    // 仅在平台总数和另一项已知时推导；0 是有效统计值
    if (input === undefined && output !== undefined && reportedTotal >= output) input = reportedTotal - output
    if (output === undefined && input !== undefined && reportedTotal >= input) output = reportedTotal - input
    const inputEstimated = input === undefined
    const outputEstimated = output === undefined
    input ??= Math.ceil(inputText.length / 2.5)
    output ??= Math.ceil(outputText.length / 2.5)
    return {
      ...usage, input, output, total: reportedTotal ?? input + output,
      inputEstimated, outputEstimated,
      totalEstimated: reportedTotal === undefined && (inputEstimated || outputEstimated),
      estimated: inputEstimated || outputEstimated,
      incomplete
    }
  }

  function addUsage(total, usage) {
    // 老版本累计没有估算来源，保守标为来源不明，避免误称 API 实测
    const legacy = total.totalEstimated === undefined && (total.input > 0 || total.output > 0)
    return {
      input: total.input + usage.input,
      output: total.output + usage.output,
      total: (total.total ?? total.input + total.output) + usage.total,
      inputEstimated: Boolean(total.inputEstimated || legacy || usage.inputEstimated),
      outputEstimated: Boolean(total.outputEstimated || legacy || usage.outputEstimated),
      totalEstimated: Boolean(total.totalEstimated || legacy || usage.totalEstimated),
      incomplete: Boolean(total.incomplete || usage.incomplete)
    }
  }

  function formatUsage(usage) {
    const legacy = usage.inputEstimated === undefined && usage.estimated === undefined
    const inputEstimated = usage.inputEstimated ?? Boolean(usage.estimated || legacy)
    const outputEstimated = usage.outputEstimated ?? Boolean(usage.estimated || legacy)
    const totalEstimated = usage.totalEstimated ?? Boolean(usage.estimated || legacy)
    const value = (count, estimated) => `${estimated ? '≈' : ''}${count.toLocaleString('en-US')}`
    const total = usage.total ?? usage.input + usage.output
    const lines = [
      `输入 ${value(usage.input, inputEstimated)}（${inputEstimated ? '本地估算' : 'API 返回或由 API 总数推导'}）`,
      `输出 ${value(usage.output, outputEstimated)}（${outputEstimated ? '本地估算' : 'API 返回或由 API 总数推导'}）`,
      `合计 ${value(total, totalEstimated)} Token`
    ]
    if (total !== usage.input + usage.output) lines.push('API 合计与分项之和不同，合计保留平台返回值，缺失分项单独估算')
    if (legacy) lines.push('历史累计未记录统计来源，保守按估算显示')
    if (usage.cached !== undefined) lines.push(`输入中缓存命中：${usage.cached}（已包含在输入中）`)
    if (usage.reasoning !== undefined) lines.push(`输出中思考：${usage.reasoning}（已包含在输出中）`)
    if (usage.incomplete) lines.push('生成中断，API 统计可能不完整；估算仅覆盖已收到的内容，不代表最终账单')
    return {
      text: `输入 ${value(usage.input, inputEstimated)} · 输出 ${value(usage.output, outputEstimated)} · 合计 ${value(total, totalEstimated)} Token`,
      total: value(total, totalEstimated),
      title: lines.join('\n')
    }
  }

  async function readSSE(body, onEvent) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let dataLines = []
    let ended = false
    function dispatch() {
      if (!dataLines.length) return
      const data = dataLines.join('\n')
      dataLines = []
      if (data.trim() === '[DONE]') {
        ended = true
        return
      }
      // 数据损坏时明确报错，避免静默丢失正文
      onEvent(JSON.parse(data))
    }
    function consume(final = false) {
      // 保留跨网络分块的半行，也兼容 CRLF / CR 行分隔
      let match
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!final && match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        if (line === '') dispatch()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
        if (ended) return
      }
      if (final) {
        if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).replace(/^ /, ''))
        buffer = ''
        dispatch()
      }
    }
    try {
      while (!ended) {
        const { done, value } = await reader.read()
        if (done) {
          buffer += decoder.decode()
          consume(true)
          break
        }
        buffer += decoder.decode(value, { stream: true })
        consume()
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  return { defaultTasks, prepareConfig, thinkingPolicy, buildRequest, mergeUsage, finalizeUsage, addUsage, formatUsage, readSSE }
})()

if (typeof module !== 'undefined') module.exports = ReaderCore
