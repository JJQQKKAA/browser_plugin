// 默认配置
const DEFAULT_CONFIG = {
  apiUrl: '',
  apiKey: '',
  modelName: 'gpt-4o-mini',
  systemPrompt: '你是一个专业的网页内容总结助手，擅长提取文章的核心观点和关键信息。请用简洁清晰的语言总结内容。',
  userPrompt: '请总结以下网页内容，提取关键信息和核心观点：\n\n{{content}}\n\n请用中文简洁地总结，控制在 200 字以内。'
};

// DOM 元素
const elements = {
  apiUrl: document.getElementById('apiUrl'),
  apiKey: document.getElementById('apiKey'),
  modelName: document.getElementById('modelName'),
  systemPrompt: document.getElementById('systemPrompt'),
  userPrompt: document.getElementById('userPrompt'),
  saveBtn: document.getElementById('saveBtn'),
  saveStatus: document.getElementById('saveStatus')
};

// 加载配置
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('webReaderConfig');
    const config = result.webReaderConfig || DEFAULT_CONFIG;

    elements.apiUrl.value = config.apiUrl || '';
    elements.apiKey.value = config.apiKey || '';
    elements.modelName.value = config.modelName || '';
    elements.systemPrompt.value = config.systemPrompt || '';
    elements.userPrompt.value = config.userPrompt || '';
  } catch (error) {
    console.error('加载配置失败:', error);
    showStatus('加载配置失败: ' + error.message, 'error');
  }
}

// 保存配置
async function saveConfig() {
  const config = {
    apiUrl: elements.apiUrl.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    modelName: elements.modelName.value.trim(),
    systemPrompt: elements.systemPrompt.value.trim(),
    userPrompt: elements.userPrompt.value.trim()
  };

  // 简单验证
  if (!config.apiUrl) {
    showStatus('请填写 API URL', 'error');
    return;
  }
  if (!config.apiKey) {
    showStatus('请填写 API Key', 'error');
    return;
  }
  if (!config.modelName) {
    showStatus('请填写模型名称', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({ webReaderConfig: config });
    showStatus('配置已保存！', 'success');
  } catch (error) {
    console.error('保存配置失败:', error);
    showStatus('保存失败: ' + error.message, 'error');
  }
}

// 显示状态信息
function showStatus(message, type) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = 'status ' + type;

  setTimeout(() => {
    elements.saveStatus.textContent = '';
    elements.saveStatus.className = 'status';
  }, 3000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  elements.saveBtn.addEventListener('click', saveConfig);
});
