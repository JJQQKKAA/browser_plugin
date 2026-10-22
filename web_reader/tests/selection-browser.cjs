// 页面运行真实划词脚本，消息桥接真实 background 处理器，仅模拟 Chrome API 和模型服务
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = path.resolve(__dirname, '..')
const core = require('../reader-core.js')

function event() {
  const listeners = []
  return { addListener: listener => listeners.push(listener), emit: value => listeners.forEach(listener => listener(value)) }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 720 } })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://reader.test' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let mode = 'success'
    const requests = []
    const ports = new Map()
    const onConnect = event()
    let settingsOpened = 0
    const stored = {
      lastUsedModelId: 'm2',
      lastUsedPromptId: 'task_quick',
      webReaderConfig: { models: [
        { id: 'm1', name: '模型一', apiUrl: 'https://api.modelscope.cn/chat', modelCode: 'one', apiKey: 'secret' },
        { id: 'm2', name: '模型二', apiUrl: 'https://api.example.com/chat', modelCode: 'two', apiKey: 'secret' }
      ], prompts: [...core.defaultTasks, { id: 'custom', shortName: '提取论点', systemPrompt: '只列论点', userPrompt: '提取论点：{{content}}', showAsTask: false }] }
    }
    vm.runInNewContext(fs.readFileSync(path.join(root, 'selection-background.js'), 'utf8'), {
      ReaderCore: core, URL, AbortController, DOMException, setTimeout, clearTimeout,
      chrome: { runtime: { getURL: path => `chrome-extension://test/${path}`, id: 'test', onConnect, openOptionsPage: async () => { settingsOpened++ } }, storage: { local: { get: async () => stored, set: async values => Object.assign(stored, values) } } },
      fetch: async (url, options) => {
        requests.push({ body: JSON.parse(options.body), signal: options.signal })
        if (mode === 'error') return new Response('模拟失败', { status: 503 })
        const slow = mode === 'slow'
        const text = mode === 'long' ? '阅读帮助我们理解复杂的世界，也让不同的观点产生联系。\n\n'.repeat(50) : mode === 'literal' ? '<img src=x onerror=alert(1)>' : '阅读让我们理解世界。'
        let timer
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 4) } }] })}\n\n`))
            timer = setTimeout(() => {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(4) } }] })}\n\ndata: [DONE]\n\n`))
              controller.close()
            }, slow ? 10000 : 180)
            options.signal.addEventListener('abort', () => { clearTimeout(timer); controller.error(new DOMException('Stopped', 'AbortError')) })
          }, cancel() { clearTimeout(timer) }
        }))
      }
    })
    await page.exposeBinding('__selectionMessage', async (_, id, message) => {
      let port = ports.get(id)
      if (!port) {
        let delivery = Promise.resolve()
        port = {
          name: 'web-reader-selection', sender: { id: 'test', tab: { id: 1 }, url: 'https://reader.test/article' }, onMessage: event(), onDisconnect: event(),
          postMessage: data => { delivery = delivery.then(() => page.evaluate(({ id, data }) => window.__ports[id]?.receive(data), { id, data })) },
          disconnect: () => port.onDisconnect.emit()
        }
        ports.set(id, port)
        onConnect.emit(port)
      }
      port.onMessage.emit(message)
    })
    await page.exposeBinding('__selectionDisconnect', (_, id) => ports.get(id)?.onDisconnect.emit())
    await page.route('https://reader.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:20px/1.8 Georgia;padding:30px;min-height:1500px"><h1>Reading with Web Reader</h1><p id="text">Reading helps us understand the world.</p><p id="short">Hello</p><textarea id="input">Private draft text</textarea><div id="editor" contenteditable="true">Editable text</div><p id="edge" style="position:fixed;right:4px;bottom:4px">Edge selection</p></body></html>` }))
    await page.addInitScript(() => {
      window.__ports = {}
      let nextId = 0
      window.chrome = { runtime: {
        connect: () => {
          const id = ++nextId
          const messages = []
          const disconnects = []
          const port = {
            onMessage: { addListener: fn => messages.push(fn) },
            onDisconnect: { addListener: fn => disconnects.push(fn) },
            postMessage: message => { void window.__selectionMessage(id, message) },
            disconnect: () => { delete window.__ports[id]; void window.__selectionDisconnect(id); disconnects.forEach(fn => fn()) },
            receive: message => messages.forEach(fn => fn(message))
          }
          window.__ports[id] = port
          return port
        }
      } }
    })
    await page.goto('https://reader.test/article')
    await page.addScriptTag({ path: path.join(root, 'selection-translate.js') })
    const ui = page.locator('web-reader-selection')
    const trigger = ui.locator('#trigger')
    const card = ui.locator('#card')
    const status = ui.locator('#status')
    const result = ui.locator('#result')
    const select = async id => {
      await page.evaluate(id => {
        const range = document.createRange()
        range.selectNodeContents(document.getElementById(id))
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      }, id)
      await trigger.waitFor({ state: 'visible' })
    }
    await select('text')
    assert.equal(requests.length, 0)
    const iconBox = await trigger.boundingBox()
    assert.equal(iconBox.width, 28)
    assert.equal(iconBox.height, 28)
    await page.screenshot({ path: '/tmp/web-reader-selection-icon.png' })
    await trigger.evaluate(button => button.click())
    assert.equal(await card.isVisible(), false)
    await trigger.click()
    await ui.locator('#retry').waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('web-reader-selection').shadowRoot.getElementById('retry').disabled)
    assert.equal(requests.length, 0)
    assert.equal(await ui.locator('#task').inputValue(), 'task_quick')
    await ui.locator('#retry').click()
    await page.waitForFunction(() => document.querySelector('web-reader-selection').shadowRoot.getElementById('result').textContent.length > 0)
    assert.equal(await ui.locator('#model').inputValue(), 'm2')
    await status.filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(await result.innerText(), '阅读让我们理解世界。')
    assert.match(requests[0].body.messages[1].content, /Reading helps us understand the world\./)
    assert.equal(stored.summaryState, undefined)
    assert.doesNotMatch(await ui.innerHTML(), /secret/)
    await page.screenshot({ path: '/tmp/web-reader-selection-light.png' })
    await ui.locator('#copy').click()
    await page.waitForFunction(() => document.querySelector('web-reader-selection').shadowRoot.getElementById('copy').title === '已复制')
    // selectOption 派发合成 change，不能触发付费请求；真实点击重新翻译后使用新模型
    await ui.locator('#toggle').click()
    await ui.locator('#model').selectOption('m1')
    assert.equal(requests.length, 1)
    await ui.locator('#retry').click()
    await status.filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(requests.at(-1).body.model, 'one')
    assert.equal(requests.at(-1).body.enable_thinking, false)
    assert.equal(stored.lastUsedModelId, 'm2')

    await ui.locator('#task').selectOption('custom')
    await ui.locator('#retry').click()
    await status.filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(requests.at(-1).body.messages[0].content, '只列论点')
    assert.match(requests.at(-1).body.messages[1].content, /^提取论点：Reading/)
    assert.equal(stored.lastUsedSelectionPromptId, 'custom')
    assert.equal(stored.lastUsedPromptId, 'task_quick')
    mode = 'slow'
    await ui.locator('#retry').click()
    await page.waitForFunction(() => document.querySelector('web-reader-selection').shadowRoot.getElementById('result').textContent.length > 0)
    await ui.locator('#stop').click()
    await status.filter({ hasText: '已停止' }).waitFor()
    assert.equal(await result.innerText(), '阅读让我')
    assert.equal(requests.at(-1).signal.aborted, true)
    mode = 'error'
    await ui.locator('#retry').click()
    await status.filter({ hasText: '503' }).waitFor()
    mode = 'literal'
    await ui.locator('#retry').click()
    await status.filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(await result.innerText(), '<img src=x onerror=alert(1)>')
    assert.equal(await result.locator('img').count(), 0)
    await ui.locator('#toggle').click()
    await ui.locator('#settings').click()
    assert.equal(settingsOpened, 1)

    await page.keyboard.press('Escape')
    await card.waitFor({ state: 'hidden' })
    // 输入控件与可编辑区域不显示划词入口
    await page.locator('#input').focus()
    await page.locator('#input').evaluate(input => input.select())
    await page.waitForTimeout(140)
    assert.equal(await trigger.isVisible(), false)
    await page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('editor'))
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
    })
    await page.waitForTimeout(140)
    assert.equal(await trigger.isVisible(), false)
    await page.locator('#input').blur()
    mode = 'slow'
    await select('short')
    await trigger.click()
    await page.waitForFunction(() => !document.querySelector('web-reader-selection').shadowRoot.getElementById('retry').disabled)
    assert.equal(await ui.locator('#task').inputValue(), 'custom')
    await ui.locator('#retry').click()
    await page.waitForFunction(() => document.querySelector('web-reader-selection').shadowRoot.getElementById('result').textContent.length > 0)
    await ui.locator('#close').click()
    await card.waitFor({ state: 'hidden' })
    await page.waitForTimeout(50)
    assert.equal(requests.at(-1).signal.aborted, true)

    // 默认事件从设置读取：自动执行指定任务、仅打开和任务已删除回退
    stored.selectionDefaultAction = { mode: 'task', promptId: 'task_translate' }
    mode = 'long'
    const beforeAuto = requests.length
    await select('text')
    await trigger.click()
    await status.filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(requests.length, beforeAuto + 1)
    assert.equal(await ui.locator('#task').inputValue(), 'task_translate')
    assert.match(requests.at(-1).body.messages[1].content, /翻译/)
    const contentBox = await result.boundingBox()
    const longCard = await card.boundingBox()
    assert.ok(contentBox.height / longCard.height >= 0.85, `正文占比不足：${contentBox.height / longCard.height}`)
    assert.equal(await ui.locator('#controls').isVisible(), false)
    assert.equal(await ui.locator('footer').count(), 0)
    await page.screenshot({ path: '/tmp/web-reader-selection-compact.png' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 360, height: 560 })
    await page.waitForFunction(() => {
      const rect = document.querySelector('web-reader-selection').shadowRoot.getElementById('card').getBoundingClientRect()
      return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
    })
    const narrowCard = await card.boundingBox()
    assert.ok(narrowCard.x >= 0 && narrowCard.y >= 0 && narrowCard.x + narrowCard.width <= 360 && narrowCard.y + narrowCard.height <= 560)
    await page.screenshot({ path: '/tmp/web-reader-selection-compact-dark.png' })
    await ui.locator('#close').click()
    stored.selectionDefaultAction = { mode: 'panel' }
    await select('edge')
    await trigger.click()
    await page.waitForFunction(() => !document.querySelector('web-reader-selection').shadowRoot.getElementById('retry').disabled)
    assert.equal(requests.length, beforeAuto + 1)
    await ui.locator('#close').click()
    stored.selectionDefaultAction = { mode: 'task', promptId: 'deleted-task' }
    await select('edge')
    await trigger.click()
    await status.filter({ hasText: '默认任务已删除' }).waitFor()
    assert.equal(requests.length, beforeAuto + 1)
    await ui.locator('#close').click()
    // 空配置仍可打开设置；靠近屏幕右下角和窄屏时不超出视口
    stored.webReaderConfig.models = []
    await page.setViewportSize({ width: 360, height: 560 })
    await select('edge')
    await trigger.click()
    await status.filter({ hasText: '尚未配置模型' }).waitFor()
    let box = await card.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 360 && box.y + box.height <= 560)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: '/tmp/web-reader-selection-dark.png' })
    await ui.locator('#toggle').click()
    await ui.locator('#settings').click()
    assert.equal(settingsOpened, 2)
    await page.locator('h1').click()
    await card.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log('划词浏览器回归通过：28px 图标、精简工具栏与正文占比、可配置默认事件及删除回退、自定义 Prompt、独立任务记忆、流式、模型切换、停止、重试、错误、复制、关闭取消、可编辑区域、窄屏、深色主题')
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
