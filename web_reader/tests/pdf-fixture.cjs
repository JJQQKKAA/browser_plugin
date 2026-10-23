// 可重现的两页文字型 PDF，不依赖字体下载或第三方生成工具
module.exports = function createPdf(lines = ['Reading supports careful thinking.', 'This second page must stay private.'], options = {}) {
  const ids = lines.map((_, index) => 4 + index * 2)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] /Count ${lines.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${options.font || 'Helvetica'} >>`
  ]
  lines.forEach(line => {
    const contentId = objects.length + 2
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    const textLines = Array.isArray(line) ? line : [line]
    const escaped = text => text.replace(/[\\()]/g, character => `\\${character}`)
    const stream = `BT ${options.leading || 28} TL 72 720 Td ${textLines.map(line => {
      const item = typeof line === 'string' ? { text: line } : line
      return `/F1 ${item.fontSize || options.fontSize || 20} Tf (${escaped(item.text)}) Tj T*`
    }).join(' ')} ET`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  })
  let text = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(text)
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}
