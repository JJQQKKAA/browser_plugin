// 使用本地 Playwright 检查界面与请求流程，无需真实 API Key
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = path.resolve(__dirname, '..')

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 440, height: 590 } })
    await context.route('http://reader.test/**', async route => {
      const file = new URL(route.request().url()).pathname.slice(1) || 'popup.html'
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
      await route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: types[path.extname(file)] })
    })
    await context.addInitScript(({ defaultTasks }) => {
      const config = { models: [{ id: 'm1', name: 'ModelScope · Qwen3', apiUrl: 'https://api-inference.modelscope.cn/v1/chat/completions', apiKey: 'test', modelCode: 'Qwen/Qwen3-32B' }], prompts: [{ id: 'p1', shortName: '我的提示词', userPrompt: '{{content}}' }, ...defaultTasks], combinations: [{ id: 'c1', modelId: 'm1', promptId: 'p1', isDefault: true }] }
      window.__store = JSON.parse(localStorage.getItem('testStore') || 'null') || (localStorage.getItem('emptyStart') ? {} : { webReaderConfig: config })
      window.__requests = []
      window.__responseMode = 'success'
      window.__usageMode = 'standard'
      window.chrome = {
        storage: { local: {
          get: async key => key ? { [key]: window.__store[key] } : window.__store,
          set: async values => { Object.assign(window.__store, structuredClone(values)); localStorage.setItem('testStore', JSON.stringify(window.__store)) },
          remove: async key => { delete window.__store[key] }
        } },
        tabs: { query: async () => [{ id: 1, title: '读懂复杂世界：关于长期学习与深入思考', url: 'https://example.com/article' }] },
        scripting: { executeScript: async () => [{ result: { content: '这是一篇足够长的测试文章，用于验证阅读摘要、停止、重试以及多轮对话功能。'.repeat(8), isSelection: false } }] },
        runtime: {
          sendMessage: async message => {
            if (message.type === 'SAVE_SUMMARY_STATE') window.__store.summaryState = structuredClone(message)
            if (message.type === 'CLEAR_SUMMARY_STATE') delete window.__store.summaryState
            localStorage.setItem('testStore', JSON.stringify(window.__store))
            return { state: window.__store.summaryState }
          },
          openOptionsPage: () => {}, getURL: file => `http://reader.test/${file}`
        }, windows: { create: async () => {} }
      }
      window.fetch = async (url, options) => {
        window.__requests.push(JSON.parse(options.body))
        if (window.__responseMode === 'error') return new Response('测试服务暂时不可用', { status: 503 })
        const text = '# 把阅读变成理解\n\n这是一份测试摘要，保留关键事实和核心观点。\n\n## 核心要点\n\n1. 抓住文章主旨\n2. 理解关键论据\n   - 结合上下文\n   - 区分事实与观点\n3. 将知识用于行动\n\n> 阅读的价值，在于建立联系。\n\n| 任务 | 目标 |\n| --- | --- |\n| 快速摘要 | 抓住重点 |\n| 详细解读 | 深入理解 |\n\n```js\nconst reading = "better"\n```\n'
        const parts = window.__responseMode === 'slow' ? Array(30).fill('正在生成内容。') : [text]
        const usageByMode = {
          standard: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, prompt_tokens_details: { cached_tokens: 60 }, completion_tokens_details: { reasoning_tokens: 20 } },
          partial: { prompt_tokens: 120 },
          zero: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          alias: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
          missing: null
        }
        const usage = usageByMode[window.__usageMode]
        const bytes = new TextEncoder().encode(parts.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }], usage: null })}\r\n\r\n`).join('') + `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`)

        let offset = 0
        let timer
        return new Response(new ReadableStream({
          start(controller) {
            options.signal.addEventListener('abort', () => { clearInterval(timer); controller.error(new DOMException('Stopped', 'AbortError')) })
            if (options.signal.aborted) return controller.error(new DOMException('Stopped', 'AbortError'))
            timer = setInterval(() => {
              if (offset >= bytes.length) { clearInterval(timer); controller.close(); return }
              controller.enqueue(bytes.slice(offset, offset + 67))
              offset += 67
            }, window.__responseMode === 'slow' ? 50 : 1)
          }, cancel() { clearInterval(timer) }
        }))
      }
    }, { defaultTasks: require('../reader-core.js').defaultTasks })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.goto('http://reader.test/popup.html')
    await page.locator('.task-button').last().waitFor()
    assert.equal(await page.locator('.task-button').count(), 3)
    await page.screenshot({ animations: 'disabled', path: '/tmp/web-reader-empty.png' })
    await page.getByRole('button', { name: '快速摘要', exact: true }).click()
    await page.getByText('已完成 · 可继续提问', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__requests[0].enable_thinking), false)
    assert.equal(await page.evaluate(() => window.__requests[0].stream_options.include_usage), true)
    assert.equal(await page.locator('.chat-message.assistant').count(), 1)
    assert.equal(await page.locator('.token-stats-row').count(), 1)
    assert.equal(await page.locator('.token-stats').innerText(), '输入 120 · 输出 80 · 合计 200 Token')
    assert.match(await page.locator('.token-stats').getAttribute('title'), /缓存命中：60/)
    const readingBox = await page.locator('#chatMessages').boundingBox()
    assert.ok(readingBox.height >= 590 * 0.7, `正文高度不足：${readingBox.height}`)
    assert.equal(await page.locator('#readingControls').isVisible(), false)
    assert.equal(await page.locator('#chatMessages').evaluate(element => element.scrollTop), 0)
    await page.screenshot({ animations: 'disabled', path: '/tmp/web-reader-result.png' })
    await page.locator('#toggleConfigBtn').click()
    assert.equal(await page.locator('#readingControls').isVisible(), true)
    const expandedBox = await page.locator('#chatMessages').boundingBox()
    assert.equal(expandedBox.height, readingBox.height)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#readingControls').isVisible(), false)
    // 验证实际渲染入口和浏览器 DOM，避免无效 HTML 被浏览器悄悄纠正后掩盖问题
    const summarySample = await fs.readFile(path.join(root, 'tests/fixtures/summary.md'), 'utf8')
    const originalHTML = await page.locator('.chat-message-content').first().innerHTML()
    await page.evaluate(source => {
      document.querySelector('.chat-message-content').innerHTML = renderMarkdown(source)
    }, summarySample)
    const content = page.locator('.chat-message-content').first()
    assert.equal(await content.locator(':scope > ol > li').count(), 4)
    assert.equal(await content.locator('ol p').filter({ hasText: '结论：' }).count(), 0)
    const firstParagraph = await content.locator(':scope > p').first().boundingBox()
    const conclusion = await content.locator(':scope > p').filter({ hasText: '结论：' }).boundingBox()
    assert.equal(conclusion.x, firstParagraph.x)
    const item = await content.locator(':scope > ol > li').first().boundingBox()
    assert.ok(item.x > conclusion.x)
    await page.locator('#chatMessages').evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.screenshot({ animations: 'disabled', path: '/tmp/web-reader-markdown-fixed.png' })
    const nestedSample = '1. 父项\n   - 子项\n\n   > 引用\n\n2. 下一项\n\n结论。'
    await page.evaluate(source => {
      document.querySelector('.chat-message-content').innerHTML = renderMarkdown(source)
    }, nestedSample)
    assert.equal(await content.locator(':scope > ol').count(), 1)
    assert.equal(await content.locator(':scope > ol > li').count(), 2)
    assert.equal(await content.locator(':scope > ol > li:first-child > ul').count(), 1)
    assert.equal(await content.locator(':scope > ol > li:first-child > blockquote').count(), 1)
    assert.equal(await content.locator(':scope > p').innerText(), '结论。')
    const codeSample = '```markdown\n1. literal\n\n> quote\n  \\*escaped\\*\n```'
    await page.evaluate(source => {
      document.querySelector('.chat-message-content').innerHTML = renderMarkdown(source)
    }, codeSample)
    assert.equal(await content.locator('pre code').innerText(), '1. literal\n\n> quote\n  \\*escaped\\*\n')
    assert.equal(await content.locator('ol, blockquote').count(), 0)
    await content.evaluate((element, html) => { element.innerHTML = html }, originalHTML)
    await page.locator('#chatInput').fill('有哪些行动建议？')
    await page.locator('#sendBtn').click()
    await page.getByText('已完成 · 可继续提问', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__requests.at(-1).enable_thinking), true)
    const beforeRetry = await page.evaluate(() => window.__requests.at(-1).messages)
    await page.locator('#retryBtn').click()
    await page.getByText('已完成 · 可继续提问', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.__requests.at(-1).messages), beforeRetry)
    assert.equal(await page.evaluate(() => window.__requests.at(-1).enable_thinking), true)
    assert.equal(await page.locator('.chat-message.user').count(), 1)
    assert.equal(await page.locator('.chat-message.assistant').count(), 2)
    assert.equal(await page.locator('.token-stats-total-inline').last().innerText(), '累计 600')
    await page.evaluate(() => { window.__responseMode = 'slow' })
    await page.locator('#readingContext').click()
    await page.getByRole('button', { name: '详细解读', exact: true }).click()
    await page.locator('.chat-message.assistant .chat-message-content').filter({ hasText: '正在生成' }).waitFor()
    assert.equal(await page.evaluate(() => window.__requests.at(-1).enable_thinking), false)
    await page.locator('#stopBtn').click()
    await page.getByText('已停止 · 已保留生成内容', { exact: true }).waitFor()
    assert.match(await page.locator('.chat-message.assistant').innerText(), /正在生成/)
    assert.match(await page.locator('.token-stats').innerText(), /≈/)
    assert.match(await page.locator('.token-stats').getAttribute('title'), /生成中断/)
    await page.evaluate(() => { window.__responseMode = 'error' })
    await page.locator('#retryBtn').click()
    await page.locator('#error').filter({ hasText: '503' }).waitFor()
    await page.evaluate(() => { window.__responseMode = 'success' })
    await page.locator('#retryBtn').click()
    await page.getByText('已完成 · 可继续提问', { exact: true }).waitFor()
    // 同一页面重新初始化，验证持久化快照可以恢复并重试
    await page.reload()
    await page.locator('#retryBtn').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#readingControls').isVisible(), false)
    await page.locator('#retryBtn').click()
    await page.getByText('已完成 · 可继续提问', { exact: true }).waitFor()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ animations: 'disabled', path: '/tmp/web-reader-dark.png' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const sendBox = await page.locator('#sendBtn').boundingBox()
    assert.ok(sendBox.y + sendBox.height <= 590)
    for (const mode of ['partial', 'missing', 'zero', 'alias']) {
      await page.evaluate(mode => { window.__usageMode = mode }, mode)
      await page.locator('#retryBtn').click()
      await page.getByText('已完成 · 可继续提问', { exact: true }).waitFor()
      const stats = await page.locator('.token-stats').last().innerText()
      if (mode === 'partial') assert.match(stats, /^输入 120 · 输出 ≈/)
      if (mode === 'missing') assert.match(stats, /^输入 ≈/)
      if (mode === 'zero') assert.equal(stats, '输入 0 · 输出 0 · 合计 0 Token')
      if (mode === 'alias') assert.equal(stats, '输入 120 · 输出 80 · 合计 200 Token')
    }
    await page.locator('#clearChatBtn').click()
    await page.locator('#emptyState').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#retryBtn').isVisible(), false)
    assert.equal(await page.locator('#readingControls').isVisible(), true)

    await page.goto('http://reader.test/options.html')
    await page.locator('#modelList .item-card').waitFor()
    await page.locator('[data-tab="prompts"]').click()
    assert.equal(await page.locator('.toggle-task:checked').count(), 3)
    await page.locator('#addPromptBtn').click()
    await page.locator('#promptShortName').fill('行动清单')
    await page.locator('#promptUserPrompt').fill('提取行动清单 {{content}}')
    await page.locator('#savePromptBtn').click()
    assert.equal(await page.locator('.toggle-task:checked').count(), 4)
    const card = page.locator('.item-card').filter({ hasText: '行动清单' })
    await card.locator('.drag-handle').focus()
    await page.keyboard.press('ArrowUp')
    await card.locator('.edit-prompt').click()
    await page.locator('#promptShowAsTask').uncheck()
    await page.locator('#savePromptBtn').click()
    assert.equal(await page.locator('.toggle-task:checked').count(), 3)
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ animations: 'disabled', fullPage: true, path: '/tmp/web-reader-settings-dark.png' })
    await page.locator('[data-tab="models"]').click()
    await page.locator('.edit-model').click()
    assert.equal(await page.locator('#modelThinkingMode').inputValue(), 'auto')
    assert.equal(await page.locator('#modelThinkingFirst').isChecked(), false)
    assert.equal(await page.locator('#modelThinkingFollowup').isChecked(), true)
    await page.locator('#modelThinkingMode').selectOption('default')
    assert.equal(await page.locator('#modelThinkingFollowup').isDisabled(), true)
    await page.locator('#modelThinkingMode').selectOption('custom')
    await page.locator('#modelThinkingFirst').check()
    await page.locator('#modelThinkingFollowup').uncheck()
    assert.equal(await page.locator('#modelIncludeUsage').isChecked(), true)
    await page.locator('#modelIncludeUsage').uncheck()
    await page.locator('#saveModelBtn').click()
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.models[0].thinkingMode), 'custom')
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.models[0].thinkingFirst), true)
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.models[0].thinkingFollowup), false)
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.models[0].includeUsage), false)
    // 新配置体验：隐藏开关、模板副本、删除撤销、真实拖拽、导入与记忆
    assert.equal(await page.locator('.default-badge, .item-card.default').count(), 0)
    assert.equal(await page.evaluate(() => 'combinations' in window.__store.webReaderConfig), false)
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.locator('[data-tab="prompts"]').click()
    const quick = page.locator('[data-prompt-id="task_quick"]')
    const originalPrompt = await page.evaluate(() => window.__store.webReaderConfig.prompts.find(item => item.id === 'task_quick').userPrompt)
    await quick.locator('.toggle-task').uncheck()
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.prompts.find(item => item.id === 'task_quick').showAsTask), false)
    await quick.locator('.toggle-task').check()
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.prompts.find(item => item.id === 'task_quick').userPrompt), originalPrompt)
    const taskCount = await page.locator('.task-card').count()
    await page.locator('#addTemplateBtn').click()
    await page.locator('[data-template="1"]').click()
    assert.equal(await page.locator('#promptShortName').inputValue(), '详细解读 副本')
    assert.equal(await page.locator('#promptAdvanced').getAttribute('open'), null)
    assert.equal(await page.locator('#promptSystemPrompt').isVisible(), false)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.task-card').count(), taskCount)
    await page.locator('#addTemplateBtn').click()
    await page.locator('[data-template="1"]').click()
    await page.locator('#savePromptBtn').click()
    assert.equal(await page.locator('.task-card').count(), taskCount + 1)
    const templateCard = page.locator('.task-card').filter({ has: page.locator('.item-title', { hasText: '详细解读 副本' }) })
    await templateCard.locator('summary').click()
    await templateCard.locator('.copy-prompt').click()
    assert.equal(await page.locator('.task-card').count(), taskCount + 2)
    const lastId = await page.locator('.task-card').last().getAttribute('data-prompt-id')
    const lastCard = page.locator('[data-prompt-id="' + lastId + '"]')
    const savedItem = await page.evaluate(id => window.__store.webReaderConfig.prompts.find(item => item.id === id), lastId)
    await lastCard.locator('summary').click()
    await lastCard.locator('.delete-prompt').click()
    assert.equal(await page.locator('.task-card').count(), taskCount + 1)
    await page.locator('#undoBtn').click()
    assert.deepEqual(await page.evaluate(id => window.__store.webReaderConfig.prompts.find(item => item.id === id), lastId), savedItem)
    assert.equal(await page.locator('.task-card').count(), taskCount + 2)
    await quick.locator('.drag-handle').dragTo(page.locator('[data-prompt-id="task_translate"]'))
    await page.getByText('任务顺序已保存', { exact: true }).waitFor()
    const order = await page.evaluate(() => window.__store.webReaderConfig.prompts.map(item => item.id))
    assert.ok(order.indexOf('task_quick') > order.indexOf('task_translate'))
    await page.reload()
    await page.locator('.task-card').last().waitFor()
    assert.deepEqual(await page.evaluate(() => window.__store.webReaderConfig.prompts.map(item => item.id)), order)
    await page.screenshot({ animations: 'disabled', fullPage: true, path: '/tmp/web-reader-tasks-new.png' })
    await page.locator('[data-tab="models"]').click()
    await page.locator('#modelList summary').click()
    await page.locator('.delete-model').click()
    assert.equal(await page.locator('#modelList .item-card').count(), 0)
    await page.locator('#undoBtn').click()
    assert.equal(await page.locator('#modelList .item-card').count(), 1)
    const exported = await page.evaluate(() => getExportData())
    assert.equal(exported.version, '2.0')
    assert.equal('combinations' in exported, false)
    const imported = { ...exported, prompts: [{ id: 'only', shortName: '仅此任务', systemPrompt: '原样保留', userPrompt: '我的指令 {{content}}', showAsTask: true }], combinations: [{ isDefault: true }] }
    await page.evaluate(() => chrome.storage.local.set({ lastUsedModelId: 'm1', lastUsedPromptId: 'only' }))
    await page.locator('#importJsonBtn').click()
    await page.locator('#jsonImportTextarea').fill(JSON.stringify(imported))
    await page.locator('#confirmJsonImportBtn').click()
    await page.locator('#jsonImportModal').waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.prompts.length), 1)
    assert.equal(await page.evaluate(() => window.__store.lastUsedPromptId), 'only')
    await page.locator('#importFileInput').setInputFiles({ name: 'old-config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) })
    await page.getByText('配置已导入', { exact: true }).waitFor()
    await page.goto('http://reader.test/popup.html')
    await page.locator('.task-button').last().waitFor()
    assert.equal(await page.locator('.task-button').count(), 1)
    assert.equal(await page.locator('#promptSelect').inputValue(), 'only')
    assert.equal(await page.locator('#modelSelect').inputValue(), 'm1')
    assert.equal(await page.evaluate(() => window.__store.webReaderConfig.prompts[0].systemPrompt), '原样保留')
    await page.evaluate(() => {
      window.__store.summaryState = { tabId: 1, url: 'https://example.com/article', modelId: 'deleted-model', promptId: 'deleted-task', chatHistory: [{ role: 'system', content: '' }, { role: 'user', content: '原文' }, { role: 'assistant', content: '旧结果' }] }
      localStorage.setItem('testStore', JSON.stringify(window.__store))
    })
    await page.reload()
    await page.locator('#retryBtn').waitFor({ state: 'hidden' })
    await page.locator('#readingContext').waitFor()
    assert.equal(await page.locator('#promptSelect').inputValue(), 'only')
    assert.equal(await page.locator('#modelSelect').inputValue(), 'm1')
    await page.goto('http://reader.test/options.html#prompts')
    await page.locator('.task-card').waitFor()
    await page.setViewportSize({ width: 440, height: 590 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    // 新用户首次初始化三个任务，清空后不复活
    await page.evaluate(() => { localStorage.removeItem('testStore'); localStorage.setItem('emptyStart', '1') })
    await page.reload()
    await page.locator('.task-card').nth(2).waitFor()
    assert.equal(await page.locator('.task-card').count(), 3)
    assert.equal(await page.evaluate(() => 'combinations' in window.__store.webReaderConfig), false)
    assert.deepEqual(errors, [])
    console.log('通过：正文至少占 70%、任务浮层不挤占正文、自动折叠与 Escape 收起、首轮从开头阅读、3 个默认任务、摘要、多轮对话、重试不重复输入、停止保留内容、失败恢复、状态恢复、清空、任务增改排序、模板独立新增、删除撤销、真实拖拽、旧版导入与记忆、首轮与追问 Thinking 开关及重试轮次、Markdown 结论顶格、嵌套列表/引用 DOM、代码缩进、流式用量开关、输入输出合计、真实零值、别名与逐项估算、深色布局与输入区可见性')
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
