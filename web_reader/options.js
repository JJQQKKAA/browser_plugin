// 配置只包含独立模型和阅读任务，内置模板仅在首次使用或主动添加时复制
const DEFAULT_CONFIG = {
  models: [{ id: 'model_default_qwen', name: 'Qwen3-Next-80B-A3B-Instruct', apiUrl: '', apiKey: '', modelCode: 'Qwen/Qwen3-Next-80B-A3B-Instruct', temperature: 0.3, thinkingMode: 'auto' }],
  prompts: ReaderCore.defaultTasks.map(task => ({ ...task })),
  readingTasksVersion: 2
}
let configData = { models: [], prompts: [], readingTasksVersion: 2 }
let draggedId = null
let undoAction = null
let toastTimeout = null
let modalTrigger = null
let saving = false

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function showToast(message, action = null) {
  clearTimeout(toastTimeout)
  undoAction = action
  document.getElementById('toastText').textContent = message
  document.getElementById('undoBtn').classList.toggle('hidden', !action)
  document.getElementById('settingsToast').classList.remove('hidden')
  toastTimeout = setTimeout(dismissToast, action ? 12000 : 4000)
}

function dismissToast() {
  clearTimeout(toastTimeout)
  undoAction = null
  document.getElementById('settingsToast').classList.add('hidden')
}

async function persist(next, message) {
  if (saving) return false
  saving = true
  try {
    await chrome.storage.local.set({ webReaderConfig: next })
    configData = next
    renderAll()
    if (message) showToast(message)
    return true
  } catch (error) {
    console.error('保存配置失败:', error)
    showToast('保存失败：' + error.message)
    renderAll()
    return false
  } finally {
    saving = false
  }
}

async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('webReaderConfig')
    const saved = result.webReaderConfig
    if (!saved) {
      configData = structuredClone(DEFAULT_CONFIG)
      await persist(configData)
    } else {
      if (Array.isArray(saved.models) && Array.isArray(saved.prompts)) {
        configData = saved
      } else {
        // 兼容最早的单模型配置，原有指令原样保留
        configData = {
          models: [{ id: generateId('model'), name: saved.modelName || '我的模型', apiUrl: saved.apiUrl || '', apiKey: saved.apiKey || '', modelCode: saved.modelName || 'gpt-4o-mini', temperature: 0.3 }],
          prompts: [{ id: generateId('prompt'), shortName: '总结', systemPrompt: saved.systemPrompt || '', userPrompt: saved.userPrompt || '请总结以下内容：\n\n{{content}}', showAsTask: true }]
        }
      }
      const changed = ReaderCore.prepareConfig(configData)
      if (changed || !Array.isArray(saved.models)) await persist(configData)
    }
    renderAll()
  } catch (error) {
    showToast('加载配置失败：' + error.message)
  }
}

function moreMenu(type, id, index, length) {
  return `<details class="item-more"><summary aria-label="更多操作">更多</summary><div class="item-menu">
    <button class="copy-${type}" data-id="${escapeHtml(id)}">复制</button>
    ${type === 'prompt' ? `<button class="move-prompt" data-id="${escapeHtml(id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>上移</button><button class="move-prompt" data-id="${escapeHtml(id)}" data-direction="1" ${index === length - 1 ? 'disabled' : ''}>下移</button>` : ''}
    <button class="delete-${type} danger-text" data-id="${escapeHtml(id)}">删除</button>
  </div></details>`
}

function renderAll() {
  document.getElementById('modelList').innerHTML = configData.models.length ? configData.models.map(model => `
    <div class="item-card" data-model-id="${escapeHtml(model.id)}"><div class="item-header"><span class="item-title">${escapeHtml(model.name)}</span><div class="item-actions"><button class="btn btn-small edit-model" data-id="${escapeHtml(model.id)}">编辑</button>${moreMenu('model', model.id)}</div></div>
    <div class="hint">${escapeHtml(model.modelCode)}</div><div class="hint">${escapeHtml(model.apiUrl || '尚未填写 API 地址')}</div>
  </div>`).join('') : '<div class="empty-state">还没有模型，点击「添加模型」开始连接。</div>'
  document.getElementById('promptList').innerHTML = configData.prompts.length ? configData.prompts.map((prompt, index) => `
    <div class="item-card task-card" data-prompt-id="${escapeHtml(prompt.id)}">
      <button class="drag-handle" draggable="true" data-id="${escapeHtml(prompt.id)}" title="拖动排序，或按上下方向键" aria-label="调整${escapeHtml(prompt.shortName)}的顺序">⠿</button>
      <div class="task-card-body"><div class="item-header"><span class="item-title">${escapeHtml(prompt.shortName)}</span><div class="item-actions">
        <label class="task-visibility"><input type="checkbox" class="toggle-task" data-id="${escapeHtml(prompt.id)}" ${prompt.showAsTask ? 'checked' : ''}><span>首页显示</span></label>
        <button class="btn btn-small edit-prompt" data-id="${escapeHtml(prompt.id)}">编辑</button>${moreMenu('prompt', prompt.id, index, configData.prompts.length)}
      </div></div><p class="task-preview">${escapeHtml(prompt.userPrompt)}</p></div>
    </div>`).join('') : '<div class="empty-state">还没有阅读任务。可以新建任务，也可以从内置模板添加。</div>'
}

function openModal(id) {
  modalTrigger = document.activeElement
  const modal = document.getElementById(id)
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-label', modal.querySelector('h3').textContent)
  modal.classList.add('active')
  const input = modal.querySelector('input:not([type="hidden"]), textarea, button')
  input?.focus()
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active')
  if (modalTrigger?.isConnected && modalTrigger.getClientRects().length) modalTrigger.focus()
  else document.getElementById(id === 'modelModal' ? 'addModelBtn' : 'addPromptBtn').focus()
}

function openTask(prompt = null) {
  document.getElementById('promptModalTitle').textContent = prompt?.id ? '编辑任务' : '新建任务'
  document.getElementById('promptId').value = prompt?.id || ''
  document.getElementById('promptShortName').value = prompt?.shortName || ''
  document.getElementById('promptUserPrompt').value = prompt?.userPrompt || ''
  document.getElementById('promptSystemPrompt').value = prompt?.systemPrompt || ''
  document.getElementById('promptShowAsTask').checked = prompt?.showAsTask ?? true
  document.getElementById('promptAdvanced').open = false
  openModal('promptModal')
  document.getElementById('promptShortName').focus()
}

function openModel(model = null) {
  document.getElementById('modelModalTitle').textContent = model ? '编辑模型' : '添加模型'
  for (const [element, key] of [['modelId', 'id'], ['modelName', 'name'], ['apiUrl', 'apiUrl'], ['apiKey', 'apiKey'], ['modelCode', 'modelCode']]) {
    document.getElementById(element).value = model?.[key] || ''
  }
  document.getElementById('modelTemperature').value = model?.temperature ?? 0.3
  document.getElementById('modelThinkingMode').value = ['on', 'off'].includes(model?.thinkingMode) ? 'custom' : (model?.thinkingMode || 'auto')
  const policy = ReaderCore.thinkingPolicy(model || {})
  document.getElementById('modelThinkingFirst').checked = policy.first
  document.getElementById('modelThinkingFollowup').checked = policy.followup
  updateThinkingControls()
  document.getElementById('modelIncludeUsage').checked = model?.includeUsage !== false
  openModal('modelModal')
  document.getElementById('modelName').focus()
}

function updateThinkingControls() {
  const disabled = document.getElementById('modelThinkingMode').value === 'default'
  document.getElementById('modelThinkingFirst').disabled = disabled
  document.getElementById('modelThinkingFollowup').disabled = disabled
}

function uniqueName(name, items, key) {
  const names = new Set(items.map(item => item[key]))
  const base = name.replace(/ 副本(?: \d+)?$/, '')
  let next = `${base} 副本`
  let index = 2
  while (names.has(next)) next = `${base} 副本 ${index++}`
  return next
}

async function copyItem(type, id) {
  const key = type === 'model' ? 'models' : 'prompts'
  const item = configData[key].find(item => item.id === id)
  if (!item) return
  const nameKey = type === 'model' ? 'name' : 'shortName'
  const copy = { ...item, id: generateId(type), [nameKey]: uniqueName(item[nameKey], configData[key], nameKey) }
  const next = structuredClone(configData)
  next[key].splice(next[key].findIndex(item => item.id === id) + 1, 0, copy)
  await persist(next, '已创建副本')
}

async function deleteItem(type, id) {
  const key = type === 'model' ? 'models' : 'prompts'
  const index = configData[key].findIndex(item => item.id === id)
  if (index < 0) return
  const item = structuredClone(configData[key][index])
  const next = structuredClone(configData)
  next[key].splice(index, 1)
  if (await persist(next)) {
    showToast(`已删除「${item.name || item.shortName}」`, async () => {
      const restored = structuredClone(configData)
      restored[key].splice(Math.min(index, restored[key].length), 0, item)
      await persist(restored, '已撤销删除')
    })
  }
}

async function moveTask(id, targetId, direction) {
  const items = [...configData.prompts]
  const from = items.findIndex(item => item.id === id)
  let to = targetId ? items.findIndex(item => item.id === targetId) : from + direction
  if (from < 0 || to < 0 || to >= items.length || from === to) return
  const [item] = items.splice(from, 1)
  items.splice(to, 0, item)
  if (await persist({ ...configData, prompts: items }, '任务顺序已保存')) {
    document.querySelector(`.drag-handle[data-id="${CSS.escape(id)}"]`)?.focus()
  }
}

// 导入仅替换模型与任务；旧版组合会被丢弃，不自动添加模板或改变上次选择
function validateConfig(data) {
  if (!data || !Array.isArray(data.models) || !Array.isArray(data.prompts)) throw new Error('配置需要包含 models 和 prompts 数组')
  for (const [key, fields] of [['models', ['id', 'name', 'modelCode']], ['prompts', ['id', 'shortName', 'userPrompt']]]) {
    const ids = new Set()
    for (const item of data[key]) {
      if (!item || fields.some(field => typeof item[field] !== 'string' || !item[field].trim())) throw new Error(`${key} 中有项目缺少必要信息`)
      if (ids.has(item.id)) throw new Error(`${key} 中存在重复 ID`)
      ids.add(item.id)
    }
  }
  for (const model of data.models) {
    if (model.temperature !== undefined && (!Number.isFinite(model.temperature) || model.temperature < 0 || model.temperature > 2)) throw new Error('Temperature 必须在 0~2 之间')
  }
}

async function importConfig(data) {
  validateConfig(data)
  if ((configData.models.length || configData.prompts.length) && !confirm(`导入将替换当前 ${configData.models.length} 个模型和 ${configData.prompts.length} 个任务，是否继续？`)) return false
  const next = { models: data.models, prompts: data.prompts, readingTasksVersion: 2 }
  return persist(next, '配置已导入')
}

function getExportData() {
  return { version: '2.0', exportDate: new Date().toISOString(), readingTasksVersion: 2, models: configData.models, prompts: configData.prompts }
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  const input = document.createElement('textarea')
  input.value = text
  document.body.appendChild(input)
  input.select()
  try {
    if (!document.execCommand('copy')) throw new Error('无法复制，请使用导出文件')
  } finally { input.remove() }
}

function bindEvents() {
  document.getElementById('modelThinkingMode').addEventListener('change', updateThinkingControls)
  document.getElementById('addModelBtn').addEventListener('click', () => openModel())
  document.getElementById('addPromptBtn').addEventListener('click', () => openTask())
  document.getElementById('addTemplateBtn').addEventListener('click', () => {
    const descriptions = ['把事情简明白地说清楚，保留必要背景和关键事实。', '梳理观点、依据、细节与局限，帮助深入理解。', '保留原文结构，将外文译为中文、中文译为英文。']
    document.getElementById('templateList').innerHTML = ReaderCore.defaultTasks.map((task, index) => `<button class="template-option" data-template="${index}"><strong>${escapeHtml(task.shortName)}</strong><span>${descriptions[index]}</span></button>`).join('')
    openModal('templateModal')
  })
  document.getElementById('templateList').addEventListener('click', e => {
    const option = e.target.closest('[data-template]')
    if (!option) return
    const task = { ...ReaderCore.defaultTasks[Number(option.dataset.template)] }
    delete task.id
    const names = new Set(configData.prompts.map(prompt => prompt.shortName))
    if (names.has(task.shortName)) task.shortName = uniqueName(task.shortName, configData.prompts, 'shortName')
    closeModal('templateModal')
    openTask(task)
  })
  document.getElementById('savePromptBtn').addEventListener('click', async () => {
    const id = document.getElementById('promptId').value
    const name = document.getElementById('promptShortName')
    const instructions = document.getElementById('promptUserPrompt')
    if (!name.value.trim() || !instructions.value.trim()) {
      showToast('请填写任务名称和任务指令')
      const missing = !name.value.trim() ? name : instructions
      missing.focus()
      return
    }
    const next = structuredClone(configData)
    const index = next.prompts.findIndex(item => item.id === id)
    const item = { ...(next.prompts[index] || {}), id: id || generateId('prompt'), shortName: name.value.trim(), userPrompt: instructions.value.trim(), systemPrompt: document.getElementById('promptSystemPrompt').value, showAsTask: document.getElementById('promptShowAsTask').checked }
    if (index >= 0) next.prompts[index] = item
    else next.prompts.push(item)
    if (await persist(next, '任务已保存')) closeModal('promptModal')
  })
  document.getElementById('saveModelBtn').addEventListener('click', async () => {
    const id = document.getElementById('modelId').value
    const item = { id: id || generateId('model') }
    for (const [element, key] of [['modelName', 'name'], ['apiUrl', 'apiUrl'], ['apiKey', 'apiKey'], ['modelCode', 'modelCode']]) {
      item[key] = document.getElementById(element).value.trim()
      if (!item[key]) {
        showToast('请填写所有必填项')
        document.getElementById(element).focus()
        return
      }
    }
    const temperature = document.getElementById('modelTemperature').value.trim()
    item.temperature = temperature === '' ? 0.3 : Number(temperature)
    if (!Number.isFinite(item.temperature) || item.temperature < 0 || item.temperature > 2) return showToast('Temperature 必须在 0~2 之间')
    item.thinkingMode = document.getElementById('modelThinkingMode').value
    item.thinkingFirst = document.getElementById('modelThinkingFirst').checked
    item.thinkingFollowup = document.getElementById('modelThinkingFollowup').checked
    item.includeUsage = document.getElementById('modelIncludeUsage').checked
    const next = structuredClone(configData)
    const index = next.models.findIndex(model => model.id === id)
    if (index >= 0) next.models[index] = { ...next.models[index], ...item }
    else next.models.push(item)
    if (await persist(next, '模型已保存')) closeModal('modelModal')
  })
  for (const [listId, type] of [['modelList', 'model'], ['promptList', 'prompt']]) {
    document.getElementById(listId).addEventListener('click', e => {
      const button = e.target.closest('button[data-id]')
      if (!button) return
      const id = button.dataset.id
      if (button.classList.contains(`edit-${type}`)) {
        const item = configData[type === 'model' ? 'models' : 'prompts'].find(item => item.id === id)
        type === 'model' ? openModel(item) : openTask(item)
      } else if (button.classList.contains(`copy-${type}`)) copyItem(type, id)
      else if (button.classList.contains(`delete-${type}`)) deleteItem(type, id)
      else if (button.classList.contains('move-prompt')) moveTask(id, null, Number(button.dataset.direction))
    })
  }
  const list = document.getElementById('promptList')
  list.addEventListener('change', async e => {
    if (!e.target.matches('.toggle-task')) return
    const next = structuredClone(configData)
    next.prompts.find(item => item.id === e.target.dataset.id).showAsTask = e.target.checked
    await persist(next, e.target.checked ? '已加入首页' : '已从首页隐藏，仍可从任务列表选择')
  })
  list.addEventListener('keydown', e => {
    if (!e.target.matches('.drag-handle') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    moveTask(e.target.dataset.id, null, e.key === 'ArrowUp' ? -1 : 1)
  })
  list.addEventListener('dragstart', e => {
    const handle = e.target.closest('.drag-handle')
    if (!handle) return
    draggedId = handle.dataset.id
    e.dataTransfer.setData('text/plain', draggedId)
    e.dataTransfer.effectAllowed = 'move'
    handle.closest('.task-card').classList.add('dragging')
  })
  list.addEventListener('dragover', e => {
    if (!draggedId) return
    const card = e.target.closest('.task-card')
    if (!card) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    list.querySelectorAll('.drop-target').forEach(item => item.classList.remove('drop-target'))
    if (card.dataset.promptId !== draggedId) card.classList.add('drop-target')
  })
  list.addEventListener('drop', e => {
    e.preventDefault()
    const target = e.target.closest('.task-card')
    if (draggedId && target) moveTask(draggedId, target.dataset.promptId)
    draggedId = null
  })
  list.addEventListener('dragend', () => {
    draggedId = null
    list.querySelectorAll('.dragging, .drop-target').forEach(item => item.classList.remove('dragging', 'drop-target'))
  })
  document.getElementById('undoBtn').addEventListener('click', async () => {
    const action = undoAction
    if (!action) return
    // 撤销写入成功前保留动作，快速重复点击由 persist 的保存锁拦截
    await action()
  })
  document.getElementById('dismissToast').addEventListener('click', dismissToast)
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)))
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id) }))
  document.addEventListener('keydown', e => {
    const modal = document.querySelector('.modal.active')
    if (!modal) return
    if (e.key === 'Escape') closeModal(modal.id)
    if (e.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button, input:not([type="hidden"]), textarea, select, summary')].filter(element => element.getClientRects().length && !element.disabled)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  })
  document.addEventListener('click', e => document.querySelectorAll('.item-more[open]').forEach(menu => { if (!menu.contains(e.target)) menu.open = false }))
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab))
    document.querySelectorAll('.tab-content').forEach(item => item.classList.toggle('active', item.id === tab.dataset.tab))
    history.replaceState(null, '', '#' + tab.dataset.tab)
  }))
  document.getElementById('exportFileBtn').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(getExportData(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `web-reader-config-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('配置文件已导出')
  })
  document.getElementById('exportClipboardBtn').addEventListener('click', async () => {
    try {
      await copyToClipboard(JSON.stringify(getExportData(), null, 2))
      showToast('配置已复制')
    }
    catch (error) { showToast('复制失败：' + error.message) }
  })
  document.getElementById('importFileBtn').addEventListener('click', () => document.getElementById('importFileInput').click())
  document.getElementById('importFileInput').addEventListener('change', async e => {
    const file = e.target.files[0]
    if (!file) return
    try { await importConfig(JSON.parse(await file.text())) }
    catch (error) { showToast('导入失败：' + error.message) }
    finally { e.target.value = '' }
  })
  document.getElementById('importJsonBtn').addEventListener('click', () => {
    document.getElementById('jsonImportTextarea').value = ''
    document.getElementById('jsonImportError').style.display = 'none'
    openModal('jsonImportModal')
  })
  document.getElementById('confirmJsonImportBtn').addEventListener('click', async () => {
    try {
      if (await importConfig(JSON.parse(document.getElementById('jsonImportTextarea').value))) closeModal('jsonImportModal')
    } catch (error) {
      document.getElementById('jsonImportError').textContent = error.message
      document.getElementById('jsonImportError').style.display = 'block'
    }
  })
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents()
  if (location.hash === '#prompts') document.querySelector('[data-tab="prompts"]').click()
  loadConfig()
})
