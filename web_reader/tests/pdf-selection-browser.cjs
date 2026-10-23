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
    async function inkBounds(locator, pdfBaseline, fontSize) {
      return locator.evaluate((span, { pdfBaseline, fontSize }) => {
        const canvas = span.closest('.page').querySelector('canvas')
        const cr = canvas.getBoundingClientRect()
        const range = window.getSelection().getRangeAt(0).getBoundingClientRect()
        const sx = canvas.width / cr.width
        const sy = canvas.height / cr.height
        const baseline = (792 - pdfBaseline) / 792 * canvas.height
        const x = Math.floor((range.left - cr.left) * sx)
        const y = Math.floor(baseline - fontSize / 792 * canvas.height)
        const w = Math.ceil(range.width * sx)
        const h = Math.ceil((fontSize * 1.3) / 792 * canvas.height)
        const pixels = canvas.getContext('2d').getImageData(x, y, w, h).data
        let top = h
        let bottom = -1
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const i = (yy * w + xx) * 4
          if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) {
            top = Math.min(top, yy)
            bottom = Math.max(bottom, yy)
          }
        }
        return { top: cr.top + (y + top) / sy, bottom: cr.top + (y + bottom + 1) / sy }
      }, { pdfBaseline, fontSize })
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
        const feedback = await page.locator('.textLayer span[role="presentation"]').first().evaluate(span => ({
          custom: span.closest('.textLayer').classList.contains('selectionRendering'),
          background: getComputedStyle(span, '::selection').backgroundColor
        }))
        assert.equal(feedback.custom, false, '应禁用 PDF.js 的行框 SVG，使用字形高亮')
        assert.equal(feedback.background, 'rgba(0, 0, 0, 0)', '已映射文字应由 PDF 字形高亮代替浏览器行框')
        assert.ok(await page.locator('.pdf-selection-highlight > div').count(), '拖选期间应已有可视反馈')
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
    for (const blankStart of [false, true]) {
      const last = page.locator('.textLayer span').filter({ hasText: 'Paragraph 12 remains selectable.' }).first()
      await last.scrollIntoViewIfNeeded()
      const acrossStart = await point(last)
      if (blankStart) acrossStart.x -= 14
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
    }
    // 空白起点的拖拽到达视口外时仍可滚动扩选，松手后停止滚动。
    await page.keyboard.press('Escape')
    await first.scrollIntoViewIfNeeded()
    const scrollStart = await point(first)
    const scrollBefore = await page.locator('#viewerContainer').evaluate(el => el.scrollTop)
    await page.mouse.move(scrollStart.x - 12, scrollStart.y)
    await page.mouse.down()
    await page.mouse.move(scrollStart.x + 60, 880, { steps: 15 })
    await page.waitForFunction(before => document.getElementById('viewerContainer').scrollTop > before + 80, scrollBefore)
    await page.mouse.up()
    const scrollAfter = await page.locator('#viewerContainer').evaluate(el => el.scrollTop)
    await page.waitForTimeout(100)
    assert.equal(await page.locator('#viewerContainer').evaluate(el => el.scrollTop), scrollAfter)
    assert.ok((await readSelection()).includes(lines[0]))
    // 接近论文的衬线字体、紧行距和段落留白，覆盖用户报告的两个边界。
    const paragraphs = ['A transformer block is shared between', 'sentences.', '', 'Different from the data provided above,', 'ground-truth labels in this paragraph', 'are used for transferring the model.']
    await page.locator('#fileInput').setInputFiles({ name: 'paragraph.pdf', mimeType: 'application/pdf', buffer: createPdf([paragraphs], { font: 'Times-Roman', leading: 22 }) })
    await page.locator('#zoom').selectOption('1')
    const different = page.locator('.textLayer span').filter({ hasText: 'Different from' }).first()
    const groundTruth = page.locator('.textLayer span').filter({ hasText: 'ground-truth' }).first()
    await groundTruth.waitFor()
    const selectionStyle = await page.addStyleTag({ content: '.pdf-selection-highlight > div { background: rgb(17, 103, 231); }' })
    for (const zoom of ['1', '1.5']) {
      await page.keyboard.press('Escape')
      await page.locator('#zoom').selectOption(zoom)
      await different.waitFor()
      await different.dblclick({ position: { x: 30, y: 10 } })
      assert.equal(await readSelection(), 'Different', '双击必须只选择该单词')
      await page.locator('.pdf-selection-highlight > div').first().waitFor()
      const box = await different.boundingBox()
      const ink = await inkBounds(different, 654, 20)
      const mark = await page.locator('.pdf-selection-highlight > div').first().boundingBox()
      assert.ok(Math.abs(mark.y - ink.top) < 2, `高亮顶部须贴合实际画布字形：${JSON.stringify({ mark, ink })}`)
      assert.ok(Math.abs(mark.y + mark.height - ink.bottom) < 2, '高亮底部须贴合实际画布字形')
      // 检查实际绘制像素，Range 高度仍由浏览器字体度量决定，不能用它代替视觉验证。
      const clip = { x: Math.ceil(box.x + 2), y: Math.floor(box.y - 12), width: 80, height: Math.ceil(box.height + 26) }
      const png = await page.screenshot({ clip, scale: 'css' })
      const painted = await page.evaluate(async ({ png, top, bottom }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(bitmap, 0, 0)
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let inside = 0
        let outside = 0
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4
          if (data[i] !== 17 || data[i + 1] !== 103 || data[i + 2] !== 231) continue
          if (y < top - 1 || y > bottom + 1) outside++
          else inside++
        }
        bitmap.close()
        return { inside, outside }
      }, { png: [...png], top: ink.top - clip.y, bottom: ink.bottom - clip.y })
      assert.ok(painted.inside > 100, '必须存在可见高亮')
      assert.equal(painted.outside, 0, '单词高亮不得溢出到上下相邻行')
      for (const dx of [2, -12]) {
        await drag({ x: box.x + dx, y: box.y - 12 }, await point(groundTruth, true), text => {
          assert.ok(text.startsWith(paragraphs[3]), text)
          assert.ok(text.includes(paragraphs[4]), text)
          assert.ok(!text.includes('sentences') && !text.includes('transformer'), text)
        })
      }
    }
    await selectionStyle.evaluate(el => el.remove())
    await page.screenshot({ path: '/tmp/web-reader-pdf-paragraph-selection.png' })
    // 页面下半部最容易暴露 border-box 引起的累积偏移，同时覆盖粗体和混合字号。
    const keywords = [...Array(10).fill(''), { text: 'Keywords', fontSize: 30 }, { text: 'agent optimization, self-evolving, reasoning evaluation', fontSize: 20 }, '', { text: '1 Introduction', fontSize: 30 }]
    const keywordPdf = process.env.PDF_FONT_FIXTURE ? await fs.readFile(process.env.PDF_FONT_FIXTURE) : createPdf([keywords], { font: 'Times-Bold', leading: 36 })
    await page.locator('#fileInput').setInputFiles({ name: 'keywords.pdf', mimeType: 'application/pdf', buffer: keywordPdf })
    await page.locator('#zoom').selectOption('1')
    const heading = page.locator('.textLayer span').filter({ hasText: /^Keywords$/ }).first()
    const terms = page.locator('.textLayer span').filter({ hasText: /^agent optimization/ }).first()
    await heading.waitFor()
    for (const zoom of ['1', '1.5']) {
      await page.locator('#zoom').selectOption(zoom)
      await heading.scrollIntoViewIfNeeded()
      await heading.dblclick({ position: { x: 35, y: 15 } })
      assert.equal(await readSelection(), 'Keywords')
      await page.locator('.pdf-selection-highlight > div').first().waitFor()
      const ink = await inkBounds(heading, 360, 30)
      const mark = await page.locator('.pdf-selection-highlight > div').first().boundingBox()
      assert.ok(Math.abs(mark.y - ink.top) < 2, `粗体标题顶部偏离字形：${JSON.stringify({ ink, mark })}`)
      assert.ok(Math.abs(mark.y + mark.height - ink.bottom) < 2, '粗体标题底部须贴合字形')
      const geometry = await heading.evaluate(span => {
        const page = span.closest('.page')
        return { boxSizing: getComputedStyle(page).boxSizing, canvas: page.querySelector('canvas').getBoundingClientRect().height, text: page.querySelector('.textLayer').getBoundingClientRect().height }
      })
      assert.equal(geometry.boxSizing, 'content-box')
      assert.ok(Math.abs(geometry.canvas - geometry.text) <= 1, '画布与文字层不能因边框被缩为不同高度')
      await drag(await point(heading), await point(terms, true), text => {
        assert.ok(text.includes('Keywords') && text.includes('evaluation'), text)
        assert.ok(!text.includes('Introduction'), text)
      })
      await page.screenshot({ path: `/tmp/web-reader-pdf-keywords-${zoom}.png` })
    }
    await page.locator('#toggleFind').click()
    await page.locator('#findInput').fill('Keywords')
    await heading.locator('.highlight').waitFor()
    await page.locator('#closeFind').click()
    await heading.dblclick({ position: { x: 35, y: 15 } })
    assert.equal(await readSelection(), 'Keywords')
    await page.waitForFunction(() => document.querySelectorAll('.pdf-selection-highlight > div').length === 1)
    assert.deepEqual(errors, [])
    console.log('PDF 真实拖选回归通过：高 DPI、正反向/跨行/跨页、空白起选、自动滚动、图标、缩放、Shift/双击；紧行距单词及页下方混合字号粗体高亮与画布字形像素贴合（100%/150%）')
  } finally {
    await context?.close()
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
