import * as pdfjsLib from './vendor/pdfjs/build/pdf.min.mjs'
import { EventBus, PDFViewer, PDFLinkService, PDFFindController, LinkTarget, FindState } from './vendor/pdfjs/web/pdf_viewer.mjs'

const elements = Object.fromEntries(['openFile', 'openUrl', 'chooseFile', 'chooseUrl', 'fileInput', 'urlDialog', 'urlForm', 'pdfUrl', 'cancelUrl', 'documentTitle', 'previousPage', 'nextPage', 'pageNumber', 'pageCount', 'zoom', 'toggleFind', 'nativeViewer', 'findBar', 'findInput', 'findStatus', 'findPrevious', 'findNext', 'closeFind', 'landing', 'documentArea', 'viewerContainer', 'viewer', 'notice'].map(id => [id, document.getElementById(id)]))
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/build/pdf.worker.min.mjs', import.meta.url).href
const assetUrl = path => new URL(`./vendor/pdfjs/${path}/`, import.meta.url).href
const eventBus = new EventBus()
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' })
const findController = new PDFFindController({ eventBus, linkService })
const viewer = new PDFViewer({
  container: elements.viewerContainer, viewer: elements.viewer, eventBus, linkService, findController,
  imageResourcesPath: assetUrl('web/images'), annotationMode: pdfjsLib.AnnotationMode.ENABLE,
  enableAutoLinking: false,
  // 划词优先使用浏览器原生选中反馈，避免额外 SVG 高亮与文字层的同步开销
  enableSelectionRendering: false
})
linkService.setViewer(viewer)
let loadingTask = null
let pdfDocument = null
let fetchController = null
let loadId = 0
let findTimer
let mimeSource = false

function notice(text, error = false) {
  elements.notice.textContent = text
  elements.notice.hidden = !text
  elements.notice.classList.toggle('error', error)
}

function updateNavigation() {
  const page = pdfDocument ? viewer.currentPageNumber : 1
  const count = pdfDocument?.numPages || 0
  elements.pageNumber.value = page
  elements.pageNumber.max = count || 1
  elements.pageCount.textContent = `/ ${count}`
  elements.previousPage.disabled = !count || page <= 1
  elements.nextPage.disabled = !count || page >= count
  for (const control of [elements.pageNumber, elements.zoom, elements.toggleFind]) control.disabled = !count
}

function filename(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'PDF 文档' }
  catch { return 'PDF 文档' }
}

async function loadPdf(source) {
  const id = ++loadId
  fetchController?.abort()
  const previousTask = loadingTask
  loadingTask = null
  pdfDocument = null
  viewer.setDocument(null)
  linkService.setDocument(null)
  elements.findBar.hidden = true
  elements.findInput.value = ''
  elements.findStatus.textContent = ''
  elements.documentArea.hidden = true
  elements.landing.hidden = false
  elements.nativeViewer.hidden = source.kind !== 'stream'
  mimeSource = source.kind === 'stream'
  updateNavigation()
  notice('正在打开 PDF…')
  try {
    await previousTask?.destroy()
    if (id !== loadId) return
    let input
    if (source.kind === 'file') {
      input = { data: new Uint8Array(await source.file.arrayBuffer()) }
    } else if (source.kind === 'stream') {
      // 原生 MIME 流只能取一次；消费 Chrome 已收到的响应，不重新访问原 URL
      fetchController = new AbortController()
      const response = await fetch(source.streamUrl, { signal: fetchController.signal })
      if (!response.ok) throw new Error('无法读取浏览器传入的 PDF')
      input = { data: new Uint8Array(await response.arrayBuffer()) }
    } else {
      const url = new URL(source.url)
      if (!['https:', 'http:', 'file:'].includes(url.protocol)) throw new Error('仅支持 HTTP、HTTPS 或本地文件地址')
      input = { url: url.href, withCredentials: true }
    }
    if (id !== loadId) return
    const title = source.kind === 'file' ? source.file.name : filename(source.url)
    elements.documentTitle.textContent = title
    document.title = `${title} · Web Reader`
    const task = pdfjsLib.getDocument({
      ...input, cMapUrl: assetUrl('cmaps'), cMapPacked: true,
      standardFontDataUrl: assetUrl('standard_fonts'), wasmUrl: assetUrl('wasm'), iccUrl: assetUrl('iccs'),
      isEvalSupported: false
    })
    loadingTask = task
    task.onProgress = ({ loaded, total }) => {
      if (id === loadId) notice(total > 0 ? `正在加载 PDF · ${Math.min(100, Math.round(loaded / total * 100))}%` : '正在加载 PDF…')
    }
    const loadedDocument = await task.promise
    if (id !== loadId) { await loadedDocument.destroy(); return }
    pdfDocument = loadedDocument
    elements.landing.hidden = true
    elements.documentArea.hidden = false
    linkService.setDocument(loadedDocument, source.url || null)
    viewer.setDocument(loadedDocument)
    updateNavigation()
  } catch (error) {
    if (id !== loadId || error.name === 'AbortError') return
    console.error('打开 PDF 失败:', error)
    let message = '无法打开 PDF，请检查文件或地址；在线文件可下载后通过「打开文件」重试。'
    if (error.name === 'PasswordException') message = '此 PDF 需要密码，请先使用其他阅读器解密后再打开。'
    else if (source.url?.startsWith('file:')) message = '无法通过地址读取本地 PDF，请点击「打开文件」选择该文件。'
    else if (error.name === 'InvalidPDFException') message = '文件不是有效的 PDF，或在线地址返回了登录页面。'
    notice(message, true)
  }
}

eventBus.on('pagesinit', () => {
  viewer.currentScaleValue = elements.zoom.value || 'auto'
  notice('')
  updateNavigation()
})
eventBus.on('pagechanging', updateNavigation)
eventBus.on('pagerendered', event => {
  if (event.error) notice('此页显示失败，可以尝试更换缩放比例或使用浏览器查看。', true)
})
eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
  elements.findStatus.textContent = `${matchesCount.current} / ${matchesCount.total}`
})
eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
  elements.findStatus.textContent = state === FindState.NOT_FOUND ? '无匹配' : state === FindState.PENDING ? '查找中…' : `${matchesCount.current} / ${matchesCount.total}`
})

function find(type = '', previous = false) {
  clearTimeout(findTimer)
  if (!pdfDocument) return
  eventBus.dispatch('find', {
    source: elements.findInput, type, query: elements.findInput.value, caseSensitive: false,
    entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false
  })
}
function showFind() {
  if (!pdfDocument) return
  elements.findBar.hidden = false
  elements.findInput.focus()
  elements.findInput.select()
}
function showUrlDialog() {
  elements.urlDialog.showModal()
  elements.pdfUrl.focus()
}
for (const button of [elements.openFile, elements.chooseFile]) button.addEventListener('click', () => elements.fileInput.click())
for (const button of [elements.openUrl, elements.chooseUrl]) button.addEventListener('click', showUrlDialog)
elements.fileInput.addEventListener('change', () => {
  const file = elements.fileInput.files[0]
  if (file) void loadPdf({ kind: 'file', file })
  elements.fileInput.value = ''
})
elements.urlForm.addEventListener('submit', event => {
  event.preventDefault()
  const url = elements.pdfUrl.value.trim()
  elements.urlDialog.close()
  void loadPdf({ kind: 'url', url })
})
elements.cancelUrl.addEventListener('click', () => elements.urlDialog.close())
elements.previousPage.addEventListener('click', () => { viewer.currentPageNumber -= 1 })
elements.nextPage.addEventListener('click', () => { viewer.currentPageNumber += 1 })
elements.pageNumber.addEventListener('change', () => {
  if (pdfDocument) viewer.currentPageNumber = Math.max(1, Math.min(pdfDocument.numPages, Number(elements.pageNumber.value) || 1))
  updateNavigation()
})
elements.zoom.addEventListener('change', () => { if (pdfDocument) viewer.currentScaleValue = elements.zoom.value })
elements.viewerContainer.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  if (!event.target.closest('.textLayer')) return
  const selection = window.getSelection()
  // 已有选区内重新起选时先释放旧范围，避免浏览器将本次手势用于旧选区
  // 保留 Shift 扩选、右键复制与键盘选择等原生交互
  if (selection && !selection.isCollapsed && elements.viewerContainer.contains(selection.anchorNode)) selection.removeAllRanges()
}, true)
elements.toggleFind.addEventListener('click', showFind)
elements.closeFind.addEventListener('click', () => { elements.findBar.hidden = true })
elements.findInput.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => find(), 150) })
elements.findInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); find('again', event.shiftKey) }
})
elements.findNext.addEventListener('click', () => find('again'))
elements.findPrevious.addEventListener('click', () => find('again', true))
elements.nativeViewer.addEventListener('click', async () => {
  if (mimeSource) {
    try { await chrome.mimeHandler.abortAndFallbackToNativeHandler() }
    catch { notice('无法切换阅读器，请关闭自动接管后重新打开原文件。', true) }
  }
})
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && pdfDocument) { event.preventDefault(); showFind() }
  if (event.key === 'Escape') elements.findBar.hidden = true
})
window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() })
window.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return
  event.preventDefault()
  const file = event.dataTransfer.files[0]
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') void loadPdf({ kind: 'file', file })
  else notice('请选择 PDF 文件。', true)
})
window.addEventListener('pagehide', () => { fetchController?.abort(); void loadingTask?.destroy() })

async function init() {
  if (chrome.mimeHandler?.getStreamInfo) {
    let stream
    try { stream = await chrome.mimeHandler.getStreamInfo() } catch { /* 手动打开的扩展页面没有 MIME 流 */ }
    if (stream) {
      const { pdfAutoOpen } = await chrome.storage.local.get('pdfAutoOpen')
      if (pdfAutoOpen !== true) {
        await chrome.mimeHandler.abortAndFallbackToNativeHandler()
        return
      }
      await loadPdf({ kind: 'stream', streamUrl: stream.streamUrl, url: stream.originalUrl })
      return
    }
  }
  const url = new URLSearchParams(location.search).get('file')
  if (url) await loadPdf({ kind: 'url', url })
}
init().catch(error => { console.error('初始化 PDF 阅读器失败:', error); notice('无法初始化阅读器，请重新打开页面。', true) })
