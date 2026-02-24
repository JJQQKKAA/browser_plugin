// 新的配置结构
// {
//   models: [{ id, name, apiUrl, apiKey, modelCode }],
//   prompts: [{ id, shortName, systemPrompt, userPrompt }],
//   combinations: [{ id, name, modelId, promptId, isDefault }]
// }

let configData = {
  models: [],
  prompts: [],
  combinations: []
};

// 生成唯一 ID
function generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 加载配置
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('webReaderConfig');

    if (result.webReaderConfig) {
      // 检查是否是新格式
      if (result.webReaderConfig.models && Array.isArray(result.webReaderConfig.models)) {
        configData = result.webReaderConfig;
      } else {
        // 迁移旧配置
        migrateOldConfig(result.webReaderConfig);
      }
    }

    renderAll();
  } catch (error) {
    console.error('加载配置失败:', error);
    alert('加载配置失败: ' + error.message);
  }
}

// 迁移旧配置
function migrateOldConfig(oldConfig) {
  const modelId = generateId('model');
  const promptId = generateId('prompt');
  const comboId = generateId('combo');

  configData.models = [{
    id: modelId,
    name: oldConfig.modelName || '默认模型',
    apiUrl: oldConfig.apiUrl || '',
    apiKey: oldConfig.apiKey || '',
    modelCode: oldConfig.modelName || 'gpt-4o-mini'
  }];

  configData.prompts = [{
    id: promptId,
    shortName: '总结',
    systemPrompt: oldConfig.systemPrompt || '',
    userPrompt: oldConfig.userPrompt || '请总结以下内容：\n\n{{content}}'
  }];

  configData.combinations = [{
    id: comboId,
    name: '默认组合',
    modelId: modelId,
    promptId: promptId,
    isDefault: true
  }];

  saveConfig();
}

// 保存配置
async function saveConfig() {
  try {
    await chrome.storage.local.set({ webReaderConfig: configData });
    return true;
  } catch (error) {
    console.error('保存配置失败:', error);
    alert('保存失败: ' + error.message);
    return false;
  }
}

// 渲染所有列表
function renderAll() {
  renderModels();
  renderPrompts();
  renderCombinations();
}

// 渲染模型列表
function renderModels() {
  const container = document.getElementById('modelList');
  if (configData.models.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无模型，请点击下方按钮添加</div>';
    return;
  }

  container.innerHTML = configData.models.map(model => {
    const isDefault = configData.combinations.some(c => c.modelId === model.id && c.isDefault);
    return `
      <div class="item-card ${isDefault ? 'default' : ''}" data-model-id="${model.id}">
        <div class="item-header">
          <span class="item-title">
            ${escapeHtml(model.name)}
            ${isDefault ? '<span class="default-badge">默认</span>' : ''}
          </span>
          <div class="item-actions">
            <button class="btn btn-small btn-secondary edit-model" data-id="${model.id}">编辑</button>
            <button class="btn btn-small btn-danger delete-model" data-id="${model.id}">删除</button>
          </div>
        </div>
        <div class="hint">模型代码: ${escapeHtml(model.modelCode)}</div>
        <div class="hint">API: ${escapeHtml(model.apiUrl)}</div>
      </div>
    `;
  }).join('');
}

// 渲染 Prompt 列表
function renderPrompts() {
  const container = document.getElementById('promptList');
  if (configData.prompts.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无 Prompt，请点击下方按钮添加</div>';
    return;
  }

  container.innerHTML = configData.prompts.map(prompt => {
    const isDefault = configData.combinations.some(c => c.promptId === prompt.id && c.isDefault);
    return `
      <div class="item-card ${isDefault ? 'default' : ''}" data-prompt-id="${prompt.id}">
        <div class="item-header">
          <span class="item-title">
            ${escapeHtml(prompt.shortName)}
            ${isDefault ? '<span class="default-badge">默认</span>' : ''}
          </span>
          <div class="item-actions">
            <button class="btn btn-small btn-secondary edit-prompt" data-id="${prompt.id}">编辑</button>
            <button class="btn btn-small btn-danger delete-prompt" data-id="${prompt.id}">删除</button>
          </div>
        </div>
        <div class="hint" style="margin-top:8px;">
          <strong>System:</strong> ${escapeHtml(prompt.systemPrompt?.substring(0, 50) || '无')}...
        </div>
        <div class="hint">
          <strong>User:</strong> ${escapeHtml(prompt.userPrompt?.substring(0, 50) || '')}...
        </div>
      </div>
    `;
  }).join('');
}

// 渲染组合列表
function renderCombinations() {
  const container = document.getElementById('comboList');
  if (configData.combinations.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无组合，请点击下方按钮添加</div>';
    return;
  }

  container.innerHTML = configData.combinations.map(combo => {
    const model = configData.models.find(m => m.id === combo.modelId);
    const prompt = configData.prompts.find(p => p.id === combo.promptId);
    return `
      <div class="item-card ${combo.isDefault ? 'default' : ''}" data-combo-id="${combo.id}">
        <div class="item-header">
          <span class="item-title">
            ${escapeHtml(combo.name)}
            ${combo.isDefault ? '<span class="default-badge">默认</span>' : ''}
          </span>
          <div class="item-actions">
            <button class="btn btn-small btn-secondary edit-combo" data-id="${combo.id}">编辑</button>
            <button class="btn btn-small btn-danger delete-combo" data-id="${combo.id}">删除</button>
          </div>
        </div>
        <div class="hint" style="margin-top:8px;">
          模型: ${escapeHtml(model?.name || '未知')} | Prompt: ${escapeHtml(prompt?.shortName || '未知')}
        </div>
      </div>
    `;
  }).join('');
}

// 辅助函数：转义 HTML
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 打开模态框
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

// 关闭模态框
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  // 清空表单
  const inputs = document.querySelectorAll(`#${modalId} input, #${modalId} textarea`);
  inputs.forEach(input => {
    if (input.type !== 'hidden' && input.type !== 'checkbox') {
      input.value = '';
    } else if (input.type === 'checkbox') {
      input.checked = false;
    }
  });
}

// ===== 模型操作 =====

document.getElementById('addModelBtn').addEventListener('click', () => {
  document.getElementById('modelId').value = '';
  document.getElementById('modelModalTitle').textContent = '添加模型';
  openModal('modelModal');
});

document.getElementById('saveModelBtn').addEventListener('click', async () => {
  const id = document.getElementById('modelId').value;
  const name = document.getElementById('modelName').value.trim();
  const apiUrl = document.getElementById('apiUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelCode = document.getElementById('modelCode').value.trim();

  if (!name || !apiUrl || !apiKey || !modelCode) {
    alert('请填写所有必填项');
    return;
  }

  const modelData = { id: id || generateId('model'), name, apiUrl, apiKey, modelCode };

  if (id) {
    const index = configData.models.findIndex(m => m.id === id);
    if (index !== -1) configData.models[index] = modelData;
  } else {
    configData.models.push(modelData);
  }

  if (await saveConfig()) {
    closeModal('modelModal');
    renderAll();
  }
});

function editModel(id) {
  const model = configData.models.find(m => m.id === id);
  if (!model) return;

  document.getElementById('modelId').value = model.id;
  document.getElementById('modelName').value = model.name;
  document.getElementById('apiUrl').value = model.apiUrl;
  document.getElementById('apiKey').value = model.apiKey;
  document.getElementById('modelCode').value = model.modelCode;
  document.getElementById('modelModalTitle').textContent = '编辑模型';
  openModal('modelModal');
}

async function deleteModel(id) {
  if (!confirm('确定要删除这个模型吗？相关的组合也会被删除。')) return;

  configData.models = configData.models.filter(m => m.id !== id);
  configData.combinations = configData.combinations.filter(c => c.modelId !== id);

  if (await saveConfig()) {
    renderAll();
  }
}

// ===== Prompt 操作 =====

document.getElementById('addPromptBtn').addEventListener('click', () => {
  document.getElementById('promptId').value = '';
  document.getElementById('promptModalTitle').textContent = '添加 Prompt';
  openModal('promptModal');
});

document.getElementById('savePromptBtn').addEventListener('click', async () => {
  const id = document.getElementById('promptId').value;
  const shortName = document.getElementById('promptShortName').value.trim();
  const systemPrompt = document.getElementById('promptSystemPrompt').value.trim();
  const userPrompt = document.getElementById('promptUserPrompt').value.trim();

  if (!shortName || !userPrompt) {
    alert('请填写简称和 User Prompt');
    return;
  }

  const promptData = {
    id: id || generateId('prompt'),
    shortName,
    systemPrompt,
    userPrompt
  };

  if (id) {
    const index = configData.prompts.findIndex(p => p.id === id);
    if (index !== -1) configData.prompts[index] = promptData;
  } else {
    configData.prompts.push(promptData);
  }

  if (await saveConfig()) {
    closeModal('promptModal');
    renderAll();
  }
});

function editPrompt(id) {
  const prompt = configData.prompts.find(p => p.id === id);
  if (!prompt) return;

  document.getElementById('promptId').value = prompt.id;
  document.getElementById('promptShortName').value = prompt.shortName;
  document.getElementById('promptSystemPrompt').value = prompt.systemPrompt || '';
  document.getElementById('promptUserPrompt').value = prompt.userPrompt;
  document.getElementById('promptModalTitle').textContent = '编辑 Prompt';
  openModal('promptModal');
}

async function deletePrompt(id) {
  if (!confirm('确定要删除这个 Prompt 吗？相关的组合也会被删除。')) return;

  configData.prompts = configData.prompts.filter(p => p.id !== id);
  configData.combinations = configData.combinations.filter(c => c.promptId !== id);

  if (await saveConfig()) {
    renderAll();
  }
}

// ===== 组合操作 =====

document.getElementById('addComboBtn').addEventListener('click', () => {
  if (configData.models.length === 0 || configData.prompts.length === 0) {
    alert('请先至少添加一个模型和一个 Prompt');
    return;
  }

  document.getElementById('comboId').value = '';
  document.getElementById('comboModalTitle').textContent = '添加组合';

  // 填充选择框
  const modelSelect = document.getElementById('comboModelSelect');
  const promptSelect = document.getElementById('comboPromptSelect');

  modelSelect.innerHTML = '<option value="">选择模型...</option>' +
    configData.models.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

  promptSelect.innerHTML = '<option value="">选择 Prompt...</option>' +
    configData.prompts.map(p => `<option value="${p.id}">${escapeHtml(p.shortName)}</option>`).join('');

  document.getElementById('comboIsDefault').checked = false;
  openModal('comboModal');
});

document.getElementById('saveComboBtn').addEventListener('click', async () => {
  const id = document.getElementById('comboId').value;
  const name = document.getElementById('comboName').value.trim();
  const modelId = document.getElementById('comboModelSelect').value;
  const promptId = document.getElementById('comboPromptSelect').value;
  const isDefault = document.getElementById('comboIsDefault').checked;

  if (!name || !modelId || !promptId) {
    alert('请填写组合名称并选择模型和 Prompt');
    return;
  }

  // 如果设为默认，清除其他默认
  if (isDefault) {
    configData.combinations.forEach(c => c.isDefault = false);
  }

  const comboData = {
    id: id || generateId('combo'),
    name,
    modelId,
    promptId,
    isDefault: isDefault || configData.combinations.length === 0
  };

  if (id) {
    const index = configData.combinations.findIndex(c => c.id === id);
    if (index !== -1) configData.combinations[index] = comboData;
  } else {
    configData.combinations.push(comboData);
  }

  if (await saveConfig()) {
    closeModal('comboModal');
    renderAll();
  }
});

function editCombo(id) {
  const combo = configData.combinations.find(c => c.id === id);
  if (!combo) return;

  document.getElementById('comboId').value = combo.id;
  document.getElementById('comboName').value = combo.name;
  document.getElementById('comboIsDefault').checked = combo.isDefault;

  const modelSelect = document.getElementById('comboModelSelect');
  const promptSelect = document.getElementById('comboPromptSelect');

  modelSelect.innerHTML = '<option value="">选择模型...</option>' +
    configData.models.map(m => `<option value="${m.id}" ${m.id === combo.modelId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');

  promptSelect.innerHTML = '<option value="">选择 Prompt...</option>' +
    configData.prompts.map(p => `<option value="${p.id}" ${p.id === combo.promptId ? 'selected' : ''}>${escapeHtml(p.shortName)}</option>`).join('');

  document.getElementById('comboModalTitle').textContent = '编辑组合';
  openModal('comboModal');
}

async function deleteCombo(id) {
  if (!confirm('确定要删除这个组合吗？')) return;

  configData.combinations = configData.combinations.filter(c => c.id !== id);

  if (await saveConfig()) {
    renderAll();
  }
}

// 关闭模态框按钮事件
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.closeModal;
    closeModal(modalId);
  });
});

// 事件委托 - 绑定编辑/删除按钮事件
document.addEventListener('DOMContentLoaded', () => {
  // 模型列表事件委托
  document.getElementById('modelList').addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('edit-model')) {
      e.preventDefault();
      editModel(target.dataset.id);
    } else if (target.classList.contains('delete-model')) {
      e.preventDefault();
      deleteModel(target.dataset.id);
    }
  });

  // Prompt 列表事件委托
  document.getElementById('promptList').addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('edit-prompt')) {
      e.preventDefault();
      editPrompt(target.dataset.id);
    } else if (target.classList.contains('delete-prompt')) {
      e.preventDefault();
      deletePrompt(target.dataset.id);
    }
  });

  // 组合列表事件委托
  document.getElementById('comboList').addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('edit-combo')) {
      e.preventDefault();
      editCombo(target.dataset.id);
    } else if (target.classList.contains('delete-combo')) {
      e.preventDefault();
      deleteCombo(target.dataset.id);
    }
  });

  // 模态框关闭按钮事件（动态添加的需要在这里处理）
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.closeModal;
      closeModal(modalId);
    });
  });

  loadConfig();
});

// ===== Tab 切换 =====

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});
