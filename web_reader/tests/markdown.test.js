const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const marked = require('../marked.min.js')
const parse = text => marked.parse(text, { gfm: true, breaks: false })

test('用户示例：结论段落位于四项列表之后，不在 ol 或 li 内', () => {
  const html = parse(readFileSync(path.join(__dirname, 'fixtures/summary.md'), 'utf8'))
  assert.equal((html.match(/<li>/g) || []).length, 4)
  assert.match(html, /<\/ol>\s*<p><strong>结论：<\/strong>/)
  assert.doesNotMatch(html.match(/<ol>[\s\S]*?<\/ol>/)[0], /结论/)
})

test('混合嵌套列表位于父 li 中，父级编号连续且保留起始值', () => {
  const html = parse('3. 父项\n   - 子项\n     1. 孙项\n   - 子项二\n4. 下一父项')
  assert.match(html, /<ol start="3">/)
  assert.match(html, /<li>父项\s*<ul>/)
  assert.match(html, /<li>子项\s*<ol>/)
  assert.match(html, /<\/ul>\s*<\/li>\s*<li>下一父项/)
  assert.equal((html.match(/<ol/g) || []).length, 2)
})

test('列表内引用与续段按原始缩进归属，不截断外层编号', () => {
  const html = parse('1. 第一项\n   - 子项\n\n   > 原文引用\n\n   解释段落\n\n2. 第二项')
  assert.equal((html.match(/<ol>/g) || []).length, 1)
  assert.match(html, /<blockquote>\s*<p>原文引用<\/p>\s*<\/blockquote>/)
  assert.match(html, /<p>解释段落<\/p>\s*<\/li>\s*<li>/)
})

test('顶格引用、标题和段落结束列表，不自动猜测引用归属', () => {
  for (const suffix of ['> 独立引用', '# 独立标题', '独立段落']) {
    const html = parse(`1. 列表项\n\n${suffix}`)
    assert.ok(html.indexOf('</ol>') < html.indexOf(suffix.replace(/^[>#] /, '')))
  }
})

test('代码缩进、空行、转义与 Markdown 代码示例不被预处理改写', () => {
  const source = '```markdown\n1. literal\n\n> literal quote\n  \\*escaped\\*\n```'
  const html = parse(source)
  assert.match(html, /<pre><code class="language-markdown">1\. literal\n\n&gt; literal quote\n  \\\*escaped\\\*/)
  assert.doesNotMatch(html, /<ol>|<blockquote>/)
  assert.match(parse('    first\n      second'), /<pre><code>first\n  second/)
})

test('代码块可嵌入列表，末尾段落与表格不被列表吸入', () => {
  const html = parse('1. 代码\n\n   ```js\n   if (x) {\n     work()\n   }\n   ```\n\n2. 下一项\n\n结束。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  assert.match(html, /<li><p>代码<\/p>\s*<pre>/)
  assert.match(html, /<\/ol>\s*<p>结束。<\/p>\s*<table>/)
  assert.match(html, /if \(x\) \{\n  work\(\)\n\}/)
})

test('松散列表、CRLF、制表符和多段引用保持块级结构', () => {
  const html = parse('1. 第一项\r\n\r\n2. 第二项\r\n\r\n结论。')
  assert.match(html, /<li><p>第一项<\/p>/)
  assert.match(html, /<\/ol>\s*<p>结论。<\/p>/)
  assert.match(parse('- 父项\n\t- 子项'), /<li>父项\s*<ul>/)
  assert.equal((parse('> 第一段\n>\n> 第二段\n>\n> > 内层').match(/<blockquote>/g) || []).length, 2)
})

test('流式未完成语法重复解析不污染后续完整结果', () => {
  const text = '1. **标题**\n   - 子项\n\n结论。\n\n```js\n  work()\n```'
  const expected = parse(text)
  for (let end = 1; end < text.length; end++) {
    parse(text.slice(0, end))
    assert.equal(parse(text), expected)
  }
})
