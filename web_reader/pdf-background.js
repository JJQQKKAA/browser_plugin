// Chrome 151+ 原生 MIME 接管：关闭时交回浏览器，避免重定向和二次下载 PDF
(() => {
  let pending = Promise.resolve()
  function syncPdfHandling() {
    pending = pending.catch(() => {}).then(async () => {
      if (!chrome.mimeHandler?.setMimeHandlerOptions) return
      const { pdfAutoOpen } = await chrome.storage.local.get('pdfAutoOpen')
      await chrome.mimeHandler.setMimeHandlerOptions('application/pdf', { enabled: pdfAutoOpen === true })
    }).catch(error => console.error('同步 PDF 接管设置失败:', error))
  }
  chrome.runtime.onInstalled.addListener(syncPdfHandling)
  chrome.runtime.onStartup.addListener(syncPdfHandling)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'pdfAutoOpen' in changes) syncPdfHandling()
  })
  syncPdfHandling()
})()
