// 浏览器选区用于交互与复制；可视高亮使用 PDF 的基线和实际字体字形度量。
export function installPdfHighlight(container, eventBus, pdfjsLib) {
  const pages = new Map()
  const versions = new WeakMap()
  const context = document.createElement('canvas').getContext('2d')
  let frame = 0

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  function draw() {
    frame = 0
    const selection = window.getSelection()
    const selected = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null
    for (const [page, { entries, layer }] of pages) {
      if (!page.div.isConnected || !layer.isConnected) {
        page.div.querySelector('.pdf-selection-highlight')?.remove()
        pages.delete(page)
        continue
      }
      const overlay = page.div.querySelector('.pdf-selection-highlight')
      if (!overlay) continue
      const fragments = document.createDocumentFragment()
      const pageRect = page.div.getBoundingClientRect()
      const origin = overlay.getBoundingClientRect()
      if (selected && pageRect.bottom > 0 && pageRect.top < innerHeight && selected.intersectsNode(page.div)) {
        for (const { span, item, font } of entries) {
          if (!span.isConnected || !selected.intersectsNode(span)) continue
          const range = document.createRange()
          range.selectNodeContents(span)
          if (span.contains(selected.startContainer)) range.setStart(selected.startContainer, selected.startOffset)
          if (span.contains(selected.endContainer)) range.setEnd(selected.endContainer, selected.endOffset)
          const text = range.toString()
          if (!text.trim()) continue
          context.font = font
          const metrics = context.measureText(text)
          const matrix = pdfjsLib.Util.transform(page.viewport.transform, item.transform)
          const scale = Math.hypot(matrix[2], matrix[3]) / 1000
          const ascent = metrics.actualBoundingBoxAscent * scale
          const descent = metrics.actualBoundingBoxDescent * scale
          // 横向部分保留浏览器字距/子串定位，纵向直接由 PDF 基线推导，
          // 不再使用透明文字层的行框高度，兼容同页混合字号、粗体和下伸字母。
          const rects = [...range.getClientRects()].filter(rect => rect.width)
          if (!rects.length || !ascent && !descent) continue
          // 搜索嵌套 span 可能产生重叠 Range rect，合并后只绘制一次。
          const left = Math.min(...rects.map(rect => rect.left))
          const right = Math.max(...rects.map(rect => rect.right))
          const mark = document.createElement('div')
          mark.style.cssText = `left:${left - origin.left}px;top:${matrix[5] - ascent - .5}px;width:${right - left}px;height:${ascent + descent + 1}px`
          fragments.append(mark)
        }
      }
      overlay.replaceChildren(fragments)
    }
  }

  eventBus.on('textlayerrendered', async ({ source: page, error }) => {
    if (error || !page.textLayer) return
    const layer = page.textLayer.div
    const version = (versions.get(page) || 0) + 1
    versions.set(page, version)
    try {
      const content = await page.pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: true })
      if (!layer.isConnected || page.textLayer?.div !== layer || versions.get(page) !== version) return
      const spans = [...layer.querySelectorAll('span[role="presentation"]')]
      const items = content.items.filter(item => typeof item.str === 'string' && item.str.length)
      // 缩放/旋转可能复用原文字层，清除旧映射后再判断是否仍可绘制。
      for (const span of spans) span.classList.remove('pdf-selection-mapped')
      page.div.querySelector('.pdf-selection-highlight')?.remove()
      pages.delete(page)
      // 映射不一致时保留原生反馈，避免把一段文字的坐标用到另一段。
      if (items.length !== spans.length || items.some((item, i) => item.str !== spans[i].textContent)) return
      const entries = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const matrix = pdfjsLib.Util.transform(page.viewport.transform, item.transform)
        // 旋转/竖排保留原生反馈；这里处理水平文字，避免套用错误坐标。
        if (Math.abs(matrix[1]) > .01 || Math.abs(matrix[2]) > .01 || matrix[0] <= 0) continue
        if (!page.pdfPage.commonObjs.has(item.fontName)) continue
        const font = page.pdfPage.commonObjs.get(item.fontName)
        if (font.isType3Font || font.disableFontFace) continue
        // 与 PDF.js CanvasGraphics.setFont 使用完全相同的字体、字重及斜体。
        const family = font.systemFontInfo?.css || `"${font.loadedName}", ${font.fallbackName}`
        const descriptor = `${font.italic ? 'italic' : 'normal'} ${font.black ? '900' : font.bold ? 'bold' : 'normal'} 1000px ${family}`
        entries.push({ span: spans[i], item, font: descriptor })
        spans[i].classList.add('pdf-selection-mapped')
      }
      const overlay = document.createElement('div')
      overlay.className = 'pdf-selection-highlight'
      overlay.setAttribute('aria-hidden', 'true')
      page.div.append(overlay)
      pages.set(page, { entries, layer })
      schedule()
    } catch (error) {
      console.warn('PDF 选区字体度量不可用，保留浏览器高亮:', error)
    }
  })
  eventBus.on('pagesinit', () => { pages.clear(); schedule() })
  document.addEventListener('selectionchange', schedule)
  container.addEventListener('scroll', schedule, { passive: true })
}
