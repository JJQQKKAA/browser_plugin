const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function event() {
  const listeners = []
  return { addListener: listener => listeners.push(listener), emit: (...args) => listeners.forEach(listener => listener(...args)) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10))

test('原生 PDF 接管默认关闭，设置变化与启动时同步，保留其他存储项', async () => {
  const onInstalled = event()
  const onStartup = event()
  const onChanged = event()
  const options = []
  const stored = { webReaderConfig: { models: [] } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pdf-background.js'), 'utf8'), {
    console,
    chrome: {
      mimeHandler: { setMimeHandlerOptions: async (mime, value) => { assert.equal(mime, 'application/pdf'); options.push(value.enabled) } },
      runtime: { onInstalled, onStartup },
      storage: { local: { get: async () => stored }, onChanged }
    }
  })
  await tick()
  assert.deepEqual(options, [false])
  stored.pdfAutoOpen = true
  onChanged.emit({ pdfAutoOpen: { newValue: true } }, 'local')
  await tick()
  assert.equal(options.at(-1), true)
  const count = options.length
  onChanged.emit({ webReaderConfig: { newValue: {} } }, 'local')
  await tick()
  assert.equal(options.length, count)
  stored.pdfAutoOpen = false
  onStartup.emit()
  await tick()
  assert.equal(options.at(-1), false)
  onInstalled.emit()
  await tick()
  assert.equal(options.at(-1), false)
  assert.deepEqual(stored.webReaderConfig, { models: [] })
})

test('缺少原生 API 时仍可加载 background，API 失败不产生未处理拒绝', async () => {
  const errors = []
  for (const mimeHandler of [undefined, { setMimeHandlerOptions: async () => { throw new Error('失败') } }]) {
    vm.runInNewContext(fs.readFileSync(require.resolve('../pdf-background.js'), 'utf8'), {
      console: { error: (...args) => errors.push(args) },
      chrome: { mimeHandler, runtime: { onInstalled: event(), onStartup: event() }, storage: { local: { get: async () => ({}) }, onChanged: event() } }
    })
    await tick()
  }
  assert.equal(errors.length, 1)
})
