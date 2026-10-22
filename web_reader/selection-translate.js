// 普通网页划词入口；Shadow DOM 隔离样式，动态文本只用 textContent 渲染
(() => {
  if (globalThis.webReaderSelectionInstalled) return
  globalThis.webReaderSelectionInstalled = true
  let host
  let elements
  let selectionText = ''
  let selectionRect
  let pointerSelecting = false
  let selectionTimer
  let port = null
  let requestId = 0
  let heartbeat
  let output = ''
  let paintFrame
  let copying = false
  let returnFocus = null

  function ensureUI() {
    if (host?.isConnected) return
    host = document.createElement('web-reader-selection')
    // 页面样式不能改变覆盖层的位置，也不拦截覆盖层外的网页交互
    host.style.cssText = 'all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:light dark!important;'
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `
      <style>
        :host { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif !important; color: #202b3a !important; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        button, select { font: inherit; }
        button { cursor: pointer; border: 1px solid #dce2eb; background: #fff; color: inherit; border-radius: 8px; padding: 5px 10px; }
        button:hover { background: #eef3fc; }
        button:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline: 2px solid #5277df; outline-offset: 2px; }
        button:disabled { cursor: default; opacity: .45; }
        #trigger { position: fixed; pointer-events: auto; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid #dce3f0; border-radius: 9px; background: #fff; color: #4667bc; box-shadow: 0 2px 5px #24365214, 0 5px 16px #24365212; transition: background .15s, box-shadow .15s; }
        #trigger svg { display: block; width: 17px; height: 17px; pointer-events: none; }
        #trigger:hover { background: #f0f4ff; box-shadow: 0 3px 12px #315bd62b; }
        #card { position: fixed; pointer-events: auto; width: min(420px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); display: flex; flex-direction: column; background: #fff; border: 1px solid #dce2eb; border-radius: 12px; box-shadow: 0 12px 44px #172c5430; overflow: hidden; }
        header { display: flex; align-items: center; gap: 3px; padding: 6px 8px; border-bottom: 1px solid #edf0f5; flex-shrink: 0; }
        #task { flex: 1; min-width: 50px; max-width: 100%; padding: 4px 20px 4px 7px; border: 0; background: transparent; color: inherit; font-size: 12px; font-weight: 600; text-overflow: ellipsis; }
        .tool { display: grid; place-items: center; width: 28px; height: 28px; padding: 5px; border: 0; background: transparent; color: #65748a; flex-shrink: 0; border-radius: 7px; }
        .tool svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
        #retry { color: #4169ce; background: #f0f4ff; }
        #stop { color: #b42e38; background: #fff0f1; }
        #copy[data-copied] { color: #298051; }
        #controls { position: absolute; z-index: 2; top: 44px; left: 8px; right: 8px; padding: 12px; max-height: calc(100% - 52px); overflow: auto; background: #fff; border: 1px solid #dce2eb; border-radius: 10px; box-shadow: 0 8px 24px #172c5420; }
        .model-row { display: flex; align-items: center; gap: 8px; }
        label { color: #69758a; font-size: 12px; }
        #model { min-width: 0; flex: 1; border: 1px solid #dce2eb; border-radius: 7px; background: #f7f9fc; color: inherit; padding: 4px 7px; font-size: 12px; }
        details { margin-top: 10px; color: #69758a; font-size: 12px; }
        summary { cursor: pointer; }
        #source { margin-top: 6px; max-height: 90px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
        #settings { border: 0; padding: 3px 0; margin-top: 8px; background: transparent; color: #526387; font-size: 12px; }
        #result { padding: 14px 16px; min-height: 140px; max-height: min(460px, calc(100dvh - 110px)); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
        #result:empty::before { content: '选择任务后，点击右上角的运行按钮'; color: #8993a3; font-size: 12px; }
        #status { color: #69758a; padding: 0 16px 10px; font-size: 11px; overflow-wrap: anywhere; }
        #status.quiet { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); }
        #status.error { color: #b42e38; }
        @media (prefers-color-scheme: dark) {
          :host { color: #e2e7f0 !important; }
          #card, #controls, button { background: #202630; border-color: #414b5d; }
          button:hover, .tool:hover { background: #303d55; }
          #trigger { background: #252f40; border-color: #465573; color: #b9caff; }
          #trigger:hover { background: #33425b; }
          header { border-color: #343e4e; }
          #model { background: #171e28; border-color: #414b5d; }
          .tool, label, details, #status { color: #a7b2c4; }
          #retry { color: #b9caff; background: #2c3953; }
          #stop { color: #ff9ca4; background: #482d36; }
          #settings { color: #b0c4f2; }
          #status.error { color: #ff9ca4; }
        }
      </style>
      <button id="trigger" type="button" title="Web Reader · 处理选中文字" aria-label="打开划词助手" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7.5c-2.4-1.6-5.2-1.9-8-1v13c2.8-.9 5.6-.6 8 1 2.4-1.6 5.2-1.9 8-1V11M12 7.5v13M7 10.5l2 .4M7 14l2 .4M18 2.5v5M15.5 5h5"/></svg></button>
      <section id="card" role="dialog" aria-label="Web Reader 划词助手" hidden>
        <header>
          <select id="task" aria-label="阅读任务" title="切换阅读任务"></select>
          <button id="retry" class="tool" type="button" title="开始生成" aria-label="开始生成"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg></button>
          <button id="stop" class="tool" type="button" title="停止生成" aria-label="停止生成" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>
          <button id="copy" class="tool" type="button" title="复制结果" aria-label="复制结果" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/></svg></button>
          <button id="toggle" class="tool" type="button" title="模型、原文与设置" aria-label="模型、原文与设置" aria-expanded="false" aria-controls="controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg></button>
          <button id="close" class="tool" type="button" title="关闭" aria-label="关闭划词助手"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </header>
        <div id="controls" hidden>
          <div class="model-row"><label for="model">模型</label><select id="model" aria-label="使用模型"></select></div>
          <details id="original"><summary>查看选中原文</summary><div id="source" aria-label="选中原文"></div></details>
          <button id="settings" type="button">打开扩展设置</button>
        </div>
        <div id="result" tabindex="0" aria-label="生成结果"></div>
        <div id="status" role="status" aria-live="polite"></div>
      </section>`
    elements = Object.fromEntries(['trigger', 'card', 'toggle', 'controls', 'original', 'close', 'model', 'task', 'source', 'result', 'status', 'settings', 'stop', 'retry', 'copy'].map(id => [id, root.getElementById(id)]))
    // 防止点击触发按钮时浏览器先清空原始选区
    elements.trigger.addEventListener('pointerdown', event => event.preventDefault())
    // 页面可以派发合成 DOM 事件；只有真实用户操作才允许触发付费请求
    elements.trigger.addEventListener('click', event => { if (event.isTrusted) openCard() })
    elements.toggle.addEventListener('click', () => setControlsOpen(elements.controls.hidden))
    elements.close.addEventListener('click', () => closeUI(true))
    elements.stop.addEventListener('click', () => {
      elements.stop.disabled = true
      send({ type: 'stop', id: requestId })
      setStatus('正在停止…')
    })
    elements.retry.addEventListener('click', event => { if (event.isTrusted) runTask() })
    elements.model.addEventListener('change', event => { if (event.isTrusted) resetTask() })
    elements.task.addEventListener('change', event => { if (event.isTrusted) resetTask() })
    elements.settings.addEventListener('click', event => { if (event.isTrusted) send({ type: 'options' }) })
    elements.copy.addEventListener('click', copyResult)
    document.documentElement.appendChild(host)
  }

  function setControlsOpen(open) {
    elements.controls.hidden = !open
    elements.toggle.setAttribute('aria-expanded', String(open))
  }

  function setRunLabel(text) {
    elements.retry.title = text
    elements.retry.setAttribute('aria-label', text)
  }

  function setStatus(text, error = false) {
    elements.status.textContent = text
    elements.status.classList.toggle('error', error)
    elements.status.classList.toggle('quiet', text === '已完成')
  }

  function setBusy(busy) {
    elements.stop.hidden = !busy
    elements.retry.hidden = busy
    elements.stop.disabled = false
    elements.retry.disabled = busy || !elements.model.value || !elements.task.value
    clearInterval(heartbeat)
    if (busy) heartbeat = setInterval(() => send({ type: 'ping' }), 20000)
  }

  function disconnect() {
    clearInterval(heartbeat)
    const oldPort = port
    port = null
    oldPort?.disconnect()
  }

  function closeUI(restoreFocus = false) {
    disconnect()
    cancelAnimationFrame(paintFrame)
    if (!elements) return
    elements.card.hidden = true
    elements.trigger.hidden = true
    if (restoreFocus && host.shadowRoot.activeElement && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  }

  function position(element, rect) {
    const margin = 8
    const width = element.offsetWidth
    const height = element.offsetHeight
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
    let top = rect.bottom + margin
    if (top + height > window.innerHeight - margin) top = rect.top - height - margin
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin))
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }

  function isEditable(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
    return element?.isContentEditable || Boolean(element?.closest('input, textarea, select, [role="textbox"]'))
  }

  function getSelectionRect(selection) {
    const visible = rect => rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right >= 0 && rect.left < window.innerWidth
    // focus 是用户拖拽的活动端点；反向选择时不能固定使用范围最后一行
    const caret = document.createRange()
    caret.setStart(selection.focusNode, selection.focusOffset)
    caret.collapse(true)
    const endpoint = Array.from(caret.getClientRects()).find(visible)
    if (endpoint) return endpoint
    // PDF 文字层可能包含整页占位元素；回退到可见文本行，避开整页矩形
    return Array.from(selection.getRangeAt(0).getClientRects()).reverse().find(rect => visible(rect) && rect.height < window.innerHeight && rect.width > 0)
  }

  function inspectSelection() {
    if (copying || pointerSelecting || (elements && !elements.card.hidden)) return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!text || !selection.rangeCount || selection.isCollapsed || isEditable(selection.anchorNode) || isEditable(selection.focusNode) || host?.contains(selection.anchorNode)) {
      if (elements) elements.trigger.hidden = true
      return
    }
    const rect = getSelectionRect(selection)
    if (!rect) {
      if (elements) elements.trigger.hidden = true
      return
    }
    ensureUI()
    selectionText = text
    selectionRect = { left: rect.left, top: rect.top, bottom: rect.bottom }
    elements.trigger.hidden = false
    position(elements.trigger, selectionRect)
  }

  function scheduleSelection() {
    clearTimeout(selectionTimer)
    // 拖选期间完全让浏览器处理，释放后再读取文字和布局、显示入口
    if (pointerSelecting || copying) return
    selectionTimer = setTimeout(inspectSelection, 80)
  }

  function send(message) {
    try {
      if (!port) throw new Error('通道已断开')
      port.postMessage(message)
      return true
    } catch {
      setBusy(false)
      setStatus('扩展连接已失效，请刷新网页后重试', true)
      return false
    }
  }

  function flushOutput() {
    const nearBottom = elements.result.scrollHeight - elements.result.scrollTop - elements.result.clientHeight < 32
    elements.result.textContent = output
    elements.copy.disabled = !output
    if (nearBottom) elements.result.scrollTop = elements.result.scrollHeight
    position(elements.card, selectionRect)
    paintFrame = null
  }

  function resetTask() {
    send({ type: 'stop', id: requestId })
    requestId += 1
    cancelAnimationFrame(paintFrame)
    output = ''
    elements.result.textContent = ''
    elements.copy.disabled = true
    setRunLabel('开始生成')
    setBusy(false)
    setStatus('点击「开始生成」处理选中文字')
  }

  function runTask() {
    if (!elements.model.value || !elements.task.value) return
    setControlsOpen(false)
    output = ''
    cancelAnimationFrame(paintFrame)
    elements.result.textContent = ''
    elements.copy.disabled = true
    elements.copy.removeAttribute('data-copied')
    elements.copy.title = '复制结果'
    elements.copy.setAttribute('aria-label', '复制结果')
    requestId += 1
    setRunLabel('重新生成')
    setBusy(true)
    setStatus('正在连接模型…')
    send({ type: 'run', id: requestId, modelId: elements.model.value, promptId: elements.task.value, text: selectionText })
  }

  function openCard() {
    returnFocus = document.activeElement
    output = ''
    cancelAnimationFrame(paintFrame)
    elements.trigger.hidden = true
    elements.card.hidden = false
    setControlsOpen(false)
    elements.original.open = false
    elements.source.textContent = selectionText
    elements.result.textContent = ''
    elements.model.replaceChildren()
    elements.task.replaceChildren()
    setRunLabel('开始生成')
    elements.copy.disabled = true
    elements.retry.disabled = true
    setBusy(false)
    setStatus('正在读取配置…')
    position(elements.card, selectionRect)
    elements.close.focus({ preventScroll: true })
    disconnect()
    try {
      const connection = chrome.runtime.connect({ name: 'web-reader-selection' })
      port = connection
      connection.onMessage.addListener(message => {
        if (port !== connection) return
        if (message.type === 'config') {
          elements.model.replaceChildren()
          for (const model of message.models) {
            const option = document.createElement('option')
            option.value = model.id
            option.textContent = model.name
            elements.model.appendChild(option)
          }
          elements.model.value = message.selectedModelId || ''
          elements.task.replaceChildren()
          for (const task of message.tasks) {
            const option = document.createElement('option')
            option.value = task.id
            option.textContent = task.name
            elements.task.appendChild(option)
          }
          elements.task.value = message.selectedTaskId || ''
          setBusy(false)
          if (elements.model.value && message.defaultAction?.mode === 'task') runTask()
          else if (elements.model.value) setStatus(message.actionUnavailable ? '默认任务已删除，请选择其他任务后运行' : '选择任务后点击运行')
          else setStatus('尚未配置模型，请从右上角设置菜单添加 API 信息', true)
          return
        }
        if (message.id !== undefined && message.id !== requestId) return
        if (message.type === 'started') setStatus('正在生成…')
        else if (message.type === 'delta') {
          output += message.text
          if (!paintFrame) paintFrame = requestAnimationFrame(flushOutput)
        } else if (['done', 'stopped', 'error'].includes(message.type)) {
          cancelAnimationFrame(paintFrame)
          flushOutput()
          setBusy(false)
          setStatus(message.type === 'error' ? message.message : (message.type === 'stopped' ? '已停止，保留已生成内容' : '已完成'), message.type === 'error')
          position(elements.card, selectionRect)
        }
      })
      connection.onDisconnect.addListener(() => {
        // 读取 lastError，避免扩展重新加载时出现未处理的连接错误
        const error = chrome.runtime.lastError
        if (port !== connection) return
        port = null
        cancelAnimationFrame(paintFrame)
        flushOutput()
        setBusy(false)
        setStatus(error ? '扩展连接已失效，请刷新网页后重试' : '生成连接已断开，请重新打开卡片', true)
      })
      send({ type: 'init' })
    } catch {
      setStatus('扩展连接已失效，请刷新网页后重试', true)
    }
  }

  async function copyResult() {
    copying = true
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(output)
      else {
        const input = document.createElement('textarea')
        input.value = output
        input.style.cssText = 'position:fixed;opacity:0;left:0;top:0;'
        host.shadowRoot.appendChild(input)
        try {
          input.select()
          if (!document.execCommand('copy')) throw new Error('复制失败')
        } finally { input.remove() }
      }
      elements.copy.setAttribute('data-copied', '')
      elements.copy.title = '已复制'
      elements.copy.setAttribute('aria-label', '已复制')
    } catch { setStatus('复制失败，请选中结果手动复制', true) }
    finally { copying = false }
  }

  document.addEventListener('pointerdown', event => {
    if (event.composedPath().includes(host)) return
    if (event.button !== 0 || event.isPrimary === false) return
    clearTimeout(selectionTimer)
    closeUI()
    pointerSelecting = true
  }, true)
  window.addEventListener('pointerup', event => {
    pointerSelecting = false
    if (!event.composedPath().includes(host)) scheduleSelection()
  }, true)
  const cancelSelectionGesture = () => {
    pointerSelecting = false
    clearTimeout(selectionTimer)
    if (elements) elements.trigger.hidden = true
  }
  window.addEventListener('pointercancel', cancelSelectionGesture, true)
  window.addEventListener('blur', cancelSelectionGesture)
  document.addEventListener('selectionchange', scheduleSelection)
  document.addEventListener('keyup', event => { if (event.key !== 'Escape') scheduleSelection() })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      clearTimeout(selectionTimer)
      closeUI(true)
    }
  }, true)
  // 滚动只隐藏入口，不打断正在阅读的任务卡片
  window.addEventListener('scroll', () => { if (elements) elements.trigger.hidden = true }, { capture: true, passive: true })
  window.addEventListener('resize', () => {
    if (elements && !elements.card.hidden) position(elements.card, selectionRect)
    else if (elements) elements.trigger.hidden = true
  })
  window.addEventListener('pagehide', () => closeUI())
})()
