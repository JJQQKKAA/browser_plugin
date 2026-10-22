// 划词请求使用独立通道，不改写 popup 的会话、任务选择和 Token 累计
(() => {
  const MAX_SELECTION_LENGTH = 12000
  const REQUEST_TIMEOUT_MS = 120000
  const core = globalThis.ReaderCore

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'web-reader-selection') return
    // 普通网页与本扩展 PDF 阅读器共用通道；不开放给其他扩展页面
    const isPdfReader = (port.sender?.url || '').split(/[?#]/)[0] === chrome.runtime.getURL('pdf-reader.html')
    const isWebPage = port.sender?.tab && /^https?:\/\//.test(port.sender.url || '')
    if (port.sender?.id !== chrome.runtime.id || (!isWebPage && !isPdfReader)) {
      port.disconnect()
      return
    }
    let active = null
    let connected = true
    const post = message => {
      if (!connected) return
      try { port.postMessage(message) } catch { connected = false; active?.controller.abort() }
    }

    async function runTask(message) {
      active?.controller.abort()
      const job = { id: message.id, controller: new AbortController(), timedOut: false }
      active = job
      const postJob = data => { if (active === job) post({ ...data, id: job.id }) }
      let timeout
      try {
        if (!Number.isSafeInteger(job.id) || typeof message.text !== 'string' || !message.text.trim()) throw new Error('请先选择需要处理的文字')
        if (message.text.length > MAX_SELECTION_LENGTH) throw new Error('选中文字过长，请缩小到 12000 字符以内')
        const { webReaderConfig } = await chrome.storage.local.get('webReaderConfig')
        if (job.controller.signal.aborted) throw new DOMException('已停止', 'AbortError')
        // 端点、Key 与模型参数仅从本地配置读取，不接受网页传来的地址或请求体
        const model = webReaderConfig?.models?.find(item => item.id === message.modelId)
        if (!model?.apiUrl || !model?.modelCode) throw new Error('请先在扩展设置中配置模型的 API 地址和模型代码')
        let url
        try { url = new URL(model.apiUrl) } catch { throw new Error('模型 API 地址无效，请在设置中检查') }
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('模型 API 地址必须使用 HTTP 或 HTTPS')
        // 有已保存任务时完整复用，包括未在首页显示的任务；空列表仅提供临时内置模板
        const tasks = webReaderConfig?.prompts?.length ? webReaderConfig.prompts : core.defaultTasks
        const task = tasks.find(item => item.id === message.promptId)
        if (!task || typeof task.userPrompt !== 'string' || !task.userPrompt.trim()) throw new Error('所选任务已删除或指令为空，请重新打开卡片选择任务')
        const text = message.text.trim()
        // 未写占位符的指令也必须附带选区；替换不解释用户文本中的 $ 等字符
        const userPrompt = task.userPrompt.includes('{{content}}') ? task.userPrompt.split('{{content}}').join(text) : `${task.userPrompt}\n\n${text}`
        chrome.storage.local.set({ lastUsedSelectionPromptId: task.id }).catch(() => {})
        const messages = [
          { role: 'system', content: task.systemPrompt || '你是专业的阅读助手，忠于原文，按用户要求处理选中的内容。' },
          { role: 'user', content: userPrompt }
        ]
        postJob({ type: 'started', modelName: model.name })
        timeout = setTimeout(() => { job.timedOut = true; job.controller.abort() }, REQUEST_TIMEOUT_MS)
        const response = await fetch(model.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey || ''}` },
          body: JSON.stringify(core.buildRequest(model, messages)),
          signal: job.controller.signal
        })
        // 不回传原始响应体，避免代理错误页包含敏感配置或请求头
        if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}），请检查模型设置或稍后重试`)
        if (!response.body) throw new Error('API 没有返回可读取的响应')
        let hasContent = false
        await core.readSSE(response.body, data => {
          if (job.controller.signal.aborted) throw new DOMException('已停止', 'AbortError')
          if (data.error) throw new Error('模型服务返回错误，请检查模型设置或稍后重试')
          const text = data.choices?.[0]?.delta?.content
          if (typeof text === 'string' && text) {
            hasContent = true
            postJob({ type: 'delta', text })
          }
        })
        if (!hasContent) throw new Error('模型没有返回正文，请检查模型设置后重试')
        postJob({ type: 'done' })
      } catch (error) {
        if (job.timedOut) postJob({ type: 'error', message: '生成超时，已保留收到的内容，请重试' })
        else if (job.controller.signal.aborted) postJob({ type: 'stopped' })
        else postJob({ type: 'error', message: error instanceof SyntaxError ? '模型响应格式有误，请确认 API 支持 OpenAI 兼容流式输出' : (error instanceof TypeError ? '无法连接模型服务，请检查网络和 API 地址' : error.message) })
      } finally {
        clearTimeout(timeout)
        if (active === job) active = null
      }
    }

    port.onMessage.addListener(message => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'init') {
        chrome.storage.local.get(['webReaderConfig', 'lastUsedModelId', 'lastUsedPromptId', 'lastUsedSelectionPromptId', 'selectionDefaultAction']).then(result => {
          const models = (result.webReaderConfig?.models || []).map(({ id, name }) => ({ id, name }))
          const selectedModelId = models.some(model => model.id === result.lastUsedModelId) ? result.lastUsedModelId : models[0]?.id
          const prompts = result.webReaderConfig?.prompts?.length ? result.webReaderConfig.prompts : core.defaultTasks
          const tasks = prompts.map(({ id, shortName }) => ({ id, name: shortName }))
          const action = result.selectionDefaultAction
          const autoRun = action?.mode === 'task' && tasks.some(task => task.id === action.promptId)
          const defaultAction = autoRun ? { mode: 'task', promptId: action.promptId } : { mode: 'panel' }
          const selectedTaskId = [autoRun ? action.promptId : null, result.lastUsedSelectionPromptId, result.lastUsedPromptId].find(id => tasks.some(task => task.id === id)) || tasks[0]?.id
          post({ type: 'config', models, selectedModelId, tasks, selectedTaskId, defaultAction, actionUnavailable: action?.mode === 'task' && !autoRun })
        }).catch(() => post({ type: 'error', message: '读取模型配置失败，请重试' }))
      } else if (message.type === 'run') {
        void runTask(message)
      } else if (message.type === 'stop' && active?.id === message.id) {
        active.controller.abort()
      } else if (message.type === 'options') {
        chrome.runtime.openOptionsPage().catch(() => post({ type: 'error', message: '无法打开设置，请右键扩展图标打开选项' }))
      }
      // 生成期间内容脚本定时发送 ping，避免等待首块输出时通道闲置
    })
    port.onDisconnect.addListener(() => {
      connected = false
      active?.controller.abort()
    })
  })
})()
