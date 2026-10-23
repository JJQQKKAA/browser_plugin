// 文字上仍使用浏览器原生手势；只修正绝对定位文字层的空白起选。
export function installPdfSelection(container) {
  let gesture = null
  let frame = 0
  let geometry = new WeakMap()

  function caretAt(x, y) {
    const page = document.elementFromPoint(x, y)?.closest('.page')
    if (!page || !container.contains(page)) return null
    const pageRect = page.getBoundingClientRect()
    let cached = geometry.get(page)
    if (!cached || cached.width !== pageRect.width || cached.height !== pageRect.height) {
      // 一次手势只测量每页一次，滚动时只更新页偏移，避免逐帧遍历并读取全文布局。
      const spans = []
      for (const span of page.querySelectorAll('.textLayer span[role="presentation"]')) {
        if (!span.firstChild || !span.textContent.trim()) continue
        const rect = span.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        spans.push({ span, left: rect.left - pageRect.left, top: rect.top - pageRect.top, width: rect.width, height: rect.height })
      }
      cached = { width: pageRect.width, height: pageRect.height, spans }
      geometry.set(page, cached)
    }
    let nearest = null
    let distance = Infinity
    for (const entry of cached.spans) {
      const left = entry.left + pageRect.left
      const top = entry.top + pageRect.top
      const rect = { left, top, right: left + entry.width, bottom: top + entry.height, height: entry.height }
      const dx = Math.max(rect.left - x, 0, x - rect.right)
      const dy = Math.max(rect.top - y, 0, y - rect.bottom)
      // 优先同一文字行，同时避免跨栏吸附到横向很远的文字。
      const score = dx * dx + dy * dy * 4
      if (score < distance) { nearest = { span: entry.span, rect }; distance = score }
    }
    if (!nearest) return null
    const { span, rect } = nearest
    // 搜索命中时 PDF.js 会在文字内插入高亮 span，端点也须兼容嵌套文字。
    if (x <= rect.left) return { node: span, offset: 0 }
    if (x >= rect.right) return { node: span, offset: span.childNodes.length }
    const caret = document.caretRangeFromPoint(x, rect.top + rect.height / 2)
    return caret && span.contains(caret.startContainer)
      ? { node: caret.startContainer, offset: caret.startOffset } : null
  }

  function update() {
    frame = 0
    if (!gesture) return
    const bounds = container.getBoundingClientRect()
    const { x, y, anchor } = gesture
    const speed = y < bounds.top ? -Math.min(24, bounds.top - y) : y > bounds.bottom ? Math.min(24, y - bounds.bottom) : 0
    const before = container.scrollTop
    if (speed) container.scrollTop += speed
    const caret = caretAt(Math.max(bounds.left + 1, Math.min(bounds.right - 16, x)), Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, y)))
    if (caret && anchor.node.isConnected) {
      window.getSelection().setBaseAndExtent(anchor.node, anchor.offset, caret.node, caret.offset)
    }
    if (speed && before !== container.scrollTop) frame = requestAnimationFrame(update)
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(update) }
  function finish(event) {
    if (!gesture || event && event.pointerId !== gesture.pointerId) return
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (container.hasPointerCapture(gesture.pointerId)) container.releasePointerCapture(gesture.pointerId)
    gesture = null
    geometry = new WeakMap()
  }

  container.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    const layer = event.target.closest('.textLayer')
    if (!layer) return
    const selection = window.getSelection()
    // 重新拖选先释放旧范围，保留 Shift 扩选、右键及键盘行为。
    if (!selection.isCollapsed && container.contains(selection.anchorNode)) selection.removeAllRanges()
    if (event.target.closest('span[role="presentation"]')) return
    geometry = new WeakMap()
    const anchor = caretAt(event.clientX, event.clientY)
    if (!anchor) return
    event.preventDefault()
    selection.collapse(anchor.node, anchor.offset)
    gesture = { anchor, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    container.setPointerCapture(event.pointerId)
  }, true)
  container.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    gesture.x = event.clientX
    gesture.y = event.clientY
    schedule()
  })
  container.addEventListener('scroll', () => { if (gesture) schedule() }, { passive: true })
  // 释放前同步最终位置，使共享划词脚本在松手后读取完整选区。
  container.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    gesture.x = event.clientX
    gesture.y = event.clientY
    if (frame) cancelAnimationFrame(frame)
    update()
    finish(event)
  })
  container.addEventListener('pointercancel', finish)
  container.addEventListener('lostpointercapture', finish)
  window.addEventListener('blur', () => finish())
}
