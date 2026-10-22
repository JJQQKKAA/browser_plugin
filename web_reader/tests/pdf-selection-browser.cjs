// 真实鼠标拖选回归；不通过 Range.addRange 人为制造选区
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const createPdf = require('./pdf-fixture.cjs')

async function main() {
  const profile = await fs.mkdtemp('/tmp/web-reader-pdf-drag-')
  let context
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: true, viewport: { width: 1100, height: 850 }, deviceScaleFactor: 2,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
    })
    const session = await context.browser().newBrowserCDPSession()
    const { id } = await session.send('Extensions.loadUnpacked', { path: path.resolve(__dirname, '..') })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`chrome-extension://${id}/pdf-reader.html`)
    const lines = ['First line is ready for selection.', 'Second line continues the paragraph.', 'Third line closes this selection.']
    const fixture = createPdf([[...lines, ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} remains selectable.`)], ['Next page can also be selected.']])
    await page.locator('#fileInput').setInputFiles({ name: 'selection.pdf', mimeType: 'application/pdf', buffer: fixture })
    const first = page.locator('.textLayer span').filter({ hasText: lines[0] }).first()
    const second = page.locator('.textLayer span').filter({ hasText: lines[1] }).first()
    const third = page.locator('.textLayer span').filter({ hasText: lines[2] }).first()
    await third.waitFor()
    const ui = page.locator('web-reader-selection')
    const readSelection = () => page.evaluate(() => window.getSelection().toString())
    const point = async (locator, end = false) => {
      const box = await locator.boundingBox()
      return { x: end ? box.x + box.width - 1 : box.x + 1, y: box.y + box.height * .5 }
    }
    async function drag(start, end, verify) {
      await page.keyboard.press('Escape')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      try {
        await page.mouse.move(end.x, end.y, { steps: 25 })
        // 按住时选区已存在，但划词入口尚不出现，不阻挡正在进行的拖拽
        await page.waitForTimeout(120)
        const selectedText = await readSelection()
        await verify(selectedText)
        if (await ui.count()) assert.equal(await ui.locator('#trigger').isVisible(), false)
        const feedback = await first.evaluate(span => ({
          custom: span.closest('.textLayer').classList.contains('selectionRendering'),
          background: getComputedStyle(span, '::selection').backgroundColor
        }))
        assert.equal(feedback.custom, false, '应使用浏览器原生选中反馈，避免依赖额外高亮绘制')
        assert.notEqual(feedback.background, 'rgba(0, 0, 0, 0)')
      } finally { await page.mouse.up() }
      await ui.locator('#trigger').waitFor({ state: 'visible' })
    }
    await drag(await point(first), await point(first, true), text => assert.equal(text, lines[0]))
    await drag(await point(first, true), await point(first), text => assert.equal(text, lines[0]))
    await drag(await point(first), await point(third, true), text => {
      for (const line of lines) assert.ok(text.includes(line), text)
    })
    // 从文字框左侧空白起选，拖入第二行，不要求从精确字形边缘开始
    const blank = await point(first)
    blank.x -= 16
    await drag(blank, await point(second, true), text => assert.ok(text.includes(lines[1]), text))
    // 反向选区图标应靠近鼠标释放的首行，而非固定落到范围最后一行
    const start = await point(third, true)
    const end = await point(first)
    await drag(start, end, text => { for (const line of lines) assert.ok(text.includes(line), text) })
    const triggerBox = await ui.locator('#trigger').boundingBox()
    assert.ok(Math.abs(triggerBox.y - end.y) < 60, '反向选区入口应跟随活动端点')
    await page.keyboard.press('Escape')
    await page.locator('#zoom').selectOption('1.5')
    await page.waitForFunction(() => document.querySelector('.page').getBoundingClientRect().width > 1100)
    await third.waitFor()
    await drag(await point(first), await point(second, true), text => assert.ok(text.includes(lines[1]), text))
    // Shift 扩选和双击选词仍沿用浏览器行为
    await page.keyboard.press('Escape')
    const caret = await point(first)
    await page.mouse.click(caret.x, caret.y)
    const expand = await point(second, true)
    await page.keyboard.down('Shift')
    await page.mouse.click(expand.x, expand.y)
    await page.keyboard.up('Shift')
    assert.ok((await readSelection()).includes(lines[1]))
    await first.dblclick({ position: { x: 10, y: 10 } })
    assert.ok((await readSelection()).trim().length > 0)
    // 按住鼠标并滚动到下一页，验证跨页原生选区不会被划词入口打断
    await page.keyboard.press('Escape')
    const last = page.locator('.textLayer span').filter({ hasText: 'Paragraph 12 remains selectable.' }).first()
    await last.scrollIntoViewIfNeeded()
    const acrossStart = await point(last)
    await page.mouse.move(acrossStart.x, acrossStart.y)
    await page.mouse.down()
    try {
      await page.mouse.move(acrossStart.x + 80, acrossStart.y, { steps: 8 })
      await page.mouse.wheel(0, 900)
      const nextPageText = page.locator('.textLayer span').filter({ hasText: 'Next page can also be selected.' }).first()
      await nextPageText.waitFor()
      await page.waitForFunction(() => {
        const span = document.querySelector('.page[data-page-number="2"] .textLayer span[role="presentation"]')
        const rect = span?.getBoundingClientRect()
        return rect && rect.top >= 56 && rect.bottom <= innerHeight
      })
      const acrossEnd = await point(nextPageText, true)
      await page.mouse.move(acrossEnd.x, acrossEnd.y, { steps: 20 })
      await page.waitForTimeout(120)
      const acrossText = await readSelection()
      assert.ok(acrossText.includes('Paragraph 12'), acrossText)
      assert.ok(acrossText.includes('Next page'), acrossText)
      assert.equal(await ui.locator('#trigger').isVisible(), false)
    } finally { await page.mouse.up() }
    await ui.locator('#trigger').waitFor({ state: 'visible' })
    await page.screenshot({ path: '/tmp/web-reader-pdf-native-selection.png' })
    assert.deepEqual(errors, [])
    console.log('PDF 真实拖选回归通过：高 DPI、正向/反向、跨行、空白起选、图标释放后出现及端点定位、缩放后拖选、Shift 扩选/双击、跨页拖选')
  } finally {
    await context?.close()
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
