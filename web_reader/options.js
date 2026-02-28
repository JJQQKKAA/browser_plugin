// 新的配置结构
// {
//   models: [{ id, name, apiUrl, apiKey, modelCode }],
//   prompts: [{ id, shortName, systemPrompt, userPrompt }],
//   combinations: [{ id, name, modelId, promptId, isDefault }]
// }

// 默认配置
const DEFAULT_CONFIG = {
  models: [{
    id: 'model_default_qwen',
    name: 'Qwen3-Next-80B-A3B-Instruct',
    apiUrl: '',
    apiKey: '',
    modelCode: 'Qwen/Qwen3-Next-80B-A3B-Instruct'
  }],
  prompts: [{
    id: 'prompt_default_summary',
    shortName: '总结',
    systemPrompt: '你是一个专业的网页内容总结助手，擅长提取文章的核心观点和关键信息。',
    userPrompt: '请总结以下网页内容，提取核心观点和关键信息：\n\n{{content}}\n\n请用中文输出，条理清晰。'
  }],
  combinations: [{
    id: 'combo_default',
    name: '默认组合',
    modelId: 'model_default_qwen',
    promptId: 'prompt_default_summary',
    isDefault: true
  }]
};

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
    } else {
      // 新用户，使用默认配置
      configData = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      await saveConfig();
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
            <button class="btn btn-small btn-copy copy-model" data-id="${model.id}">复制</button>
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
            <button class="btn btn-small btn-copy copy-prompt" data-id="${prompt.id}">复制</button>
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

// 生成不重复的名称
function generateUniqueName(baseName, existingNames) {
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  // 如果名称已存在，尝试添加 (1), (2) 等后缀
  const regex = /^(.*)\s*\((\d+)\)$/;
  const match = baseName.match(regex);
  const base = match ? match[1] : baseName;
  let counter = match ? parseInt(match[2]) : 1;

  let newName = `${base} (${counter})`;
  while (existingNames.includes(newName)) {
    counter++;
    newName = `${base} (${counter})`;
  }
  return newName;
}

// 复制配置项的通用函数
async function copyConfigItem(type, id, items, createCopy) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  const nameKey = type === 'model' ? 'name' : 'shortName';
  const existingNames = items.map(i => i[nameKey]);
  const newName = generateUniqueName(item[nameKey], existingNames);

  const copiedItem = createCopy(item, newName);
  items.push(copiedItem);

  if (await saveConfig()) {
    renderAll();
  }
}

// 复制模型
async function copyModel(id) {
  await copyConfigItem('model', id, configData.models, (model, newName) => ({
    id: generateId('model'),
    name: newName,
    apiUrl: model.apiUrl,
    apiKey: model.apiKey,
    modelCode: model.modelCode
  }));
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

// 复制 Prompt
async function copyPrompt(id) {
  await copyConfigItem('prompt', id, configData.prompts, (prompt, newName) => ({
    id: generateId('prompt'),
    shortName: newName,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt
  }));
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
    } else if (target.classList.contains('copy-model')) {
      e.preventDefault();
      copyModel(target.dataset.id);
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
    } else if (target.classList.contains('copy-prompt')) {
      e.preventDefault();
      copyPrompt(target.dataset.id);
    } else if (target.classList.contains('delete-prompt')) {
      e.preventDefault();
      deletePrompt(target.dataset.id);
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

// ===== 配置导出/导入 =====

// 导出配置
document.getElementById('exportConfigBtn')?.addEventListener('click', async () => {
  try {
    const configToExport = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      models: configData.models,
      prompts: configData.prompts,
      combinations: configData.combinations
    };

    const blob = new Blob([JSON.stringify(configToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `web-reader-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('导出配置失败:', error);
    alert('导出配置失败: ' + error.message);
  }
});

// 导入配置 - 点击按钮触发文件选择
document.getElementById('importConfigBtn')?.addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

// 处理文件选择
document.getElementById('importFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importedData = JSON.parse(text);

    // 验证数据结构
    if (!importedData.models || !Array.isArray(importedData.models)) {
      throw new Error('配置文件格式错误：缺少 models 数组');
    }
    if (!importedData.prompts || !Array.isArray(importedData.prompts)) {
      throw new Error('配置文件格式错误：缺少 prompts 数组');
    }

    // 验证每个模型的必需字段
    for (const model of importedData.models) {
      if (!model.id || !model.name || !model.apiUrl || !model.apiKey || !model.modelCode) {
        throw new Error(`模型 "${model.name || '未命名'}" 缺少必需字段`);
      }
    }

    // 验证每个 prompt 的必需字段
    for (const prompt of importedData.prompts) {
      if (!prompt.id || !prompt.shortName || !prompt.userPrompt) {
        throw new Error(`Prompt "${prompt.shortName || '未命名'}" 缺少必需字段`);
      }
    }

    // 确认是否覆盖
    if (configData.models.length > 0 || configData.prompts.length > 0) {
      if (!confirm(`导入将覆盖现有配置：\n- ${importedData.models.length} 个模型\n- ${importedData.prompts.length} 个 Prompt\n- ${importedData.combinations.length} 个组合\n\n是否继续？`)) {
        e.target.value = '';
        return;
      }
    }

    // 导入配置
    configData.models = importedData.models;
    configData.prompts = importedData.prompts;
    configData.combinations = importedData.combinations;

    if (await saveConfig()) {
      renderAll();
      alert('配置导入成功！');
    }
  } catch (error) {
    console.error('导入配置失败:', error);
    alert('导入配置失败: ' + error.message);
  } finally {
    e.target.value = '';
  }
});

// ===== JSON 粘贴导入 =====

// 验证配置格式
function validateConfig(data) {
  const errors = [];

  // 检查基本结构
  if (!data || typeof data !== 'object') {
    throw new Error('配置必须是一个 JSON 对象');
  }

  // 检查 models
  if (!data.models || !Array.isArray(data.models)) {
    errors.push('缺少 models 数组');
  } else {
    data.models.forEach((model, index) => {
      if (!model.id) errors.push(`models[${index}]: 缺少 id`);
      if (!model.name) errors.push(`models[${index}]: 缺少 name`);
      if (!model.apiUrl) errors.push(`models[${index}]: 缺少 apiUrl`);
      if (!model.apiKey) errors.push(`models[${index}]: 缺少 apiKey`);
      if (!model.modelCode) errors.push(`models[${index}]: 缺少 modelCode`);
    });
  }

  // 检查 prompts
  if (!data.prompts || !Array.isArray(data.prompts)) {
    errors.push('缺少 prompts 数组');
  } else {
    data.prompts.forEach((prompt, index) => {
      if (!prompt.id) errors.push(`prompts[${index}]: 缺少 id`);
      if (!prompt.shortName) errors.push(`prompts[${index}]: 缺少 shortName`);
      if (!prompt.userPrompt) errors.push(`prompts[${index}]: 缺少 userPrompt`);
    });
  }

  if (errors.length > 0) {
    throw new Error('格式验证失败:\n' + errors.join('\n'));
  }

  return true;
}

// 打开 JSON 粘贴导入模态框
document.getElementById('importJsonBtn')?.addEventListener('click', () => {
  document.getElementById('jsonImportTextarea').value = '';
  document.getElementById('jsonImportError').style.display = 'none';
  document.getElementById('jsonImportError').textContent = '';
  openModal('jsonImportModal');
});

// 确认 JSON 导入
document.getElementById('confirmJsonImportBtn')?.addEventListener('click', async () => {
  const textarea = document.getElementById('jsonImportTextarea');
  const errorDiv = document.getElementById('jsonImportError');
  const jsonText = textarea.value.trim();

  if (!jsonText) {
    errorDiv.textContent = '请输入 JSON 配置';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    // 解析 JSON
    let importedData;
    try {
      importedData = JSON.parse(jsonText);
    } catch (parseError) {
      throw new Error('JSON 格式错误: ' + parseError.message);
    }

    // 验证格式
    validateConfig(importedData);

    // 确认是否覆盖
    if (configData.models.length > 0 || configData.prompts.length > 0) {
      if (!confirm(`导入将覆盖现有配置：\n- ${importedData.models.length} 个模型\n- ${importedData.prompts.length} 个 Prompt\n\n是否继续？`)) {
        return;
      }
    }

    // 导入配置
    configData.models = importedData.models;
    configData.prompts = importedData.prompts;
    // 如果导入的数据有 combinations，保留它；否则清空
    configData.combinations = importedData.combinations || [];

    if (await saveConfig()) {
      closeModal('jsonImportModal');
      renderAll();
      alert('配置导入成功！');
    }
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
  }
});
