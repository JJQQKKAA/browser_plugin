// 用临时 Chrome 配置真正加载扩展，验证 PDF.js、MIME 接管和真实 runtime Port
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const createPdf = require('./pdf-fixture.cjs')
const root = path.resolve(__dirname, '..')

async function until(fn, description) {
  for (let i = 0; i < 100; i++) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`等待超时：${description}`)
}

async function main() {
  const fixture = createPdf()
  const requests = []
  const hits = {}
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    hits[pathname] = (hits[pathname] || 0) + 1
    if (pathname === '/model') {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"阅读支持深入思考。"}}]}\n\ndata: [DONE]\n\n')
      return
    }
    if (pathname === '/ticket' && hits[pathname] > 1) { response.writeHead(410); response.end('链接已使用'); return }
    if (pathname === '/broken.pdf') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('not a PDF'); return }
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': fixture.length })
    response.end(fixture)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const profile = await fs.mkdtemp('/tmp/web-reader-pdf-profile-')
  let context
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: true, viewport: { width: 1100, height: 850 },
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
    })
    const session = await context.browser().newBrowserCDPSession()
    const { id } = await session.send('Extensions.loadUnpacked', { path: root })
    const extension = `chrome-extension://${id}`
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${extension}/pdf-reader.html`)
    await page.waitForFunction(() => Boolean(globalThis.pdfjsLib))
    assert.equal(await page.evaluate(() => Boolean(chrome.mimeHandler)), true)
    const modelConfig = { models: [{ id: 'pdf-model', name: '本地模拟模型', apiUrl: `${origin}/model`, apiKey: 'test-only', modelCode: 'pdf-test' }], prompts: [{ id: 'pdf-task', shortName: '选区翻译', systemPrompt: '忠于选中原文', userPrompt: '翻译：{{content}}', showAsTask: true }], readingTasksVersion: 2 }
    await page.evaluate(webReaderConfig => chrome.storage.local.set({ webReaderConfig, selectionDefaultAction: { mode: 'task', promptId: 'pdf-task' } }), modelConfig)

    // 文件选择不需要 file:// 权限或自动接管开关
    await page.locator('#fileInput').setInputFiles({ name: 'reading.pdf', mimeType: 'application/pdf', buffer: fixture })
    await page.locator('.textLayer span').filter({ hasText: 'Reading supports' }).waitFor()
    assert.equal(await page.locator('#pageCount').innerText(), '/ 2')
    assert.equal(requests.length, 0)
    const selected = page.locator('.textLayer span').filter({ hasText: 'Reading supports' }).first()
    await selected.evaluate(span => {
      const range = document.createRange()
      range.selectNodeContents(span)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
    const ui = page.locator('web-reader-selection')
    await ui.locator('#trigger').waitFor({ state: 'visible' })
    await ui.locator('#trigger').click()
    await ui.locator('#status').filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(await ui.locator('#result').innerText(), '阅读支持深入思考。')
    assert.equal(requests.length, 1)
    assert.match(requests[0].messages[1].content, /Reading supports careful thinking\./)
    assert.doesNotMatch(JSON.stringify(requests), /second page|%PDF|base64/)
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('summaryState')).summaryState), undefined)
    await page.screenshot({ path: '/tmp/web-reader-pdf-selection.png' })
    await ui.locator('#close').click()
    const originalWidth = (await page.locator('.page').first().boundingBox()).width
    await page.locator('#zoom').selectOption('1.5')
    await page.waitForFunction(width => document.querySelector('.page').getBoundingClientRect().width > width, originalWidth)
    await page.locator('#nextPage').click()
    assert.equal(await page.locator('#pageNumber').inputValue(), '2')
    await page.locator('#previousPage').click()
    await page.locator('#toggleFind').click()
    await page.locator('#findInput').fill('careful')
    await page.locator('#findStatus').filter({ hasText: '1 / 1' }).waitFor()
    await page.locator('#closeFind').click()

    // 在线手动打开；内容类型为 PDF 的无后缀地址也可使用
    await page.goto(`${extension}/pdf-reader.html?file=${encodeURIComponent(`${origin}/document`)}`)
    await page.locator('.textLayer span').filter({ hasText: 'Reading supports' }).waitFor()
    assert.equal(hits['/document'], 1)
    await page.goto(`${extension}/options.html#pdf`)
    await until(() => page.locator('#pdfAutoOpen').isEnabled(), '读取 PDF 设置')
    assert.equal(await page.locator('#pdfAutoOpen').isChecked(), false)
    await page.locator('#pdfAutoOpen').check()
    await until(() => page.evaluate(async () => (await chrome.mimeHandler.getMimeHandlerOptions('application/pdf')).enabled === true), '开启原生接管')
    await page.reload()
    await until(() => page.locator('#pdfAutoOpen').isEnabled(), '刷新后读取 PDF 设置')
    assert.equal(await page.locator('#pdfAutoOpen').isChecked(), true)

    // 原生 MIME 保留浏览器原地址，单次链接只下载一次
    const nativePage = await context.newPage()
    await nativePage.goto(`${origin}/ticket`)
    const mimeFrame = await until(() => nativePage.frames().find(frame => frame.url().startsWith(`${extension}/pdf-reader.html`)), 'PDF MIME 阅读器 frame')
    await mimeFrame.locator('.textLayer span').filter({ hasText: 'Reading supports' }).waitFor()
    assert.equal(nativePage.url(), `${origin}/ticket`)
    assert.equal(hits['/ticket'], 1)
    await nativePage.screenshot({ path: '/tmp/web-reader-pdf-auto.png' })
    await mimeFrame.locator('.textLayer span').filter({ hasText: 'Reading supports' }).first().evaluate(span => {
      const range = document.createRange()
      range.selectNodeContents(span)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
    })
    const mimeUI = mimeFrame.locator('web-reader-selection')
    await mimeUI.locator('#trigger').waitFor({ state: 'visible' })
    await mimeUI.locator('#trigger').click()
    await mimeUI.locator('#status').filter({ hasText: '已完成' }).waitFor({ state: 'attached' })
    assert.equal(requests.length, 2)
    assert.equal(hits['/ticket'], 1)
    // 浏览器原生回退可能重新请求文件；对可重复 GET 的地址验证该功能
    await nativePage.goto(`${origin}/fallback.pdf`)
    const fallbackFrame = await until(() => nativePage.frames().find(frame => frame.url().startsWith(`${extension}/pdf-reader.html`)), '回退测试阅读器')
    await fallbackFrame.locator('.textLayer span').filter({ hasText: 'Reading supports' }).waitFor()
    await fallbackFrame.locator('#nativeViewer').click()
    await until(() => !nativePage.frames().some(frame => frame.url().startsWith(`${extension}/pdf-reader.html`)), '交回浏览器查看')

    // 本地 file:// 自动接管也不需要开启文件访问权限
    const localPath = path.join(profile, 'reading.pdf')
    await fs.writeFile(localPath, fixture)
    const localPage = await context.newPage()
    await localPage.goto(pathToFileURL(localPath).href)
    const localFrame = await until(() => localPage.frames().find(frame => frame.url().startsWith(`${extension}/pdf-reader.html`)), '本地 PDF MIME 阅读器 frame')
    await localFrame.locator('.textLayer span').filter({ hasText: 'Reading supports' }).waitFor()
    assert.equal(localPage.url(), pathToFileURL(localPath).href)

    // 关闭后不再接管，手动阅读仍可使用；无效文档有明确错误
    await page.locator('#pdfAutoOpen').uncheck()
    await until(() => page.evaluate(async () => (await chrome.mimeHandler.getMimeHandlerOptions('application/pdf')).enabled === false), '关闭原生接管')
    const disabledPage = await context.newPage()
    await disabledPage.goto(`${origin}/disabled.pdf`)
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(disabledPage.frames().some(frame => frame.url().startsWith(`${extension}/pdf-reader.html`)), false)
    await page.goto(`${extension}/pdf-reader.html?file=${encodeURIComponent(`${origin}/broken.pdf`)}`)
    await page.locator('#notice.error').filter({ hasText: '有效的 PDF' }).waitFor()
    await page.locator('#fileInput').setInputFiles({ name: 'recovered.pdf', mimeType: 'application/pdf', buffer: fixture })
    await page.locator('.textLayer span').filter({ hasText: 'Reading supports' }).waitFor()
    assert.equal(requests.length, 2)
    assert.deepEqual(errors, [])
    console.log('PDF 真扩展回归通过：本地文件选择、在线无后缀 PDF、真实划词 Port、只发送选区、缩放/页码/搜索、自动接管保存及关闭、单次链接不重取、本地 file:// 无额外权限、浏览器回退、错误恢复')
  } finally {
    await context?.close()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
