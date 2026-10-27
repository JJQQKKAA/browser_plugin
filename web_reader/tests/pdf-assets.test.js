const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const modules = [
  'vendor/pdfjs/build/pdf.min.mjs',
  'vendor/pdfjs/build/pdf.worker.min.mjs',
  'vendor/pdfjs/web/pdf_viewer.mjs'
]

test('PDF.js 核心、Worker 和 Viewer 资源完整且版本、构建一致', () => {
  const builds = modules.map(file => {
    assert.ok(fs.existsSync(path.join(root, file)), `缺少运行资源：${file}`)
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /pdfjsVersion = 6\.4\.299\b/, `${file} 版本必须与本地 Viewer 一致`)
    const build = source.match(/pdfjsBuild = ([a-f0-9]+)/)?.[1]
    assert.ok(build, `${file} 缺少官方构建标记`)
    return build
  })
  assert.equal(new Set(builds).size, 1)
  assert.ok(fs.existsSync(path.join(root, 'vendor/pdfjs/LICENSE')))
})

test('PDF.js 核心和 Worker 已纳入 Git，不能仅存在于开发机', t => {
  if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }).status !== 0) {
    t.skip('源码导出不含 Git 元数据；仍执行资源完整性与版本检查')
    return
  }
  // 工作目录内文件齐全并不能保证新机器能运行，必须检查 Git 索引。
  execFileSync('git', ['ls-files', '--error-unmatch', '--', ...modules], { cwd: root, stdio: 'pipe' })
  const ignored = spawnSync('git', ['check-ignore', '--no-index', ...modules], { cwd: root, encoding: 'utf8' })
  assert.equal(ignored.status, 1, `PDF.js 运行资源不能被忽略：${ignored.stdout || ignored.stderr}`)
})
