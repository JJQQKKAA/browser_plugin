// 获取 DOM 元素
const elements = {
  openOptions: document.getElementById('openOptions'),
  gotoConfig: document.getElementById('gotoConfig'),
  noConfig: document.getElementById('noConfig'),
  mainContent: document.getElementById('mainContent'),
  pageTitle: document.getElementById('pageTitle'),
  comboSelect: document.getElementById('comboSelect'),
  summarizeBtn: document.getElementById('summarizeBtn'),
  btnText: document.getElementById('btnText'),
  result: document.getElementById('result'),
  resultContent: document.getElementById('resultContent'),
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  copyBtn: document.getElementById('copyBtn'),
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loadingText'),
  error: document.getElementById('error')
};

let configData = null;
let currentTabId = null;
let currentUrl = null;
let isSummarizing = false;
let isChatting = false;
let abortController = null;
let selectedComboId = null;
let chatHistory = []; // 对话历史
let currentModel = null; // 当前使用的模型
let isInitialSummary = false; // 是否是第一次总结（初始总结不显示用户输入）

// 检查配置
async function checkConfig() {
  try {
    const result = await chrome.storage.local.get('webReaderConfig');

    if (!result.webReaderConfig) {
      elements.noConfig.classList.remove('hidden');
      elements.mainContent.classList.add('hidden');
      return false;
    }

    // 检查是否是新格式
    if (result.webReaderConfig.combinations && Array.isArray(result.webReaderConfig.combinations)) {
      configData = result.webReaderConfig;

      if (configData.combinations.length === 0) {
        elements.noConfig.classList.remove('hidden');
        elements.mainContent.classList.add('hidden');
        return false;
      }
    } else {
      // 旧格式 - 显示配置提示
      elements.noConfig.classList.remove('hidden');
      elements.mainContent.classList.add('hidden');
      return false;
    }

    elements.noConfig.classList.add('hidden');
    elements.mainContent.classList.remove('hidden');
    return true;
  } catch (error) {
    showError('检查配置失败: ' + error.message);
    return false;
  }
}

// 渲染组合选择器
async function renderComboSelector() {
  const select = elements.comboSelect;
  select.innerHTML = '<option value="">选择模型+Prompt组合...</option>';

  if (!configData || !configData.combinations) return;

  // 获取上次使用的组合
  const lastUsed = await chrome.storage.local.get('lastUsedComboId');
  const lastUsedId = lastUsed.lastUsedComboId;

  configData.combinations.forEach(combo => {
    const model = configData.models.find(m => m.id === combo.modelId);
    const prompt = configData.prompts.find(p => p.id === combo.promptId);

    if (model && prompt) {
      const option = document.createElement('option');
      option.value = combo.id;
      option.textContent = `${combo.name} (${model.name} + ${prompt.shortName})`;

      // 默认选中默认组合或上次使用的组合
      if (combo.isDefault && !lastUsedId) {
        option.selected = true;
        selectedComboId = combo.id;
      } else if (combo.id === lastUsedId) {
        option.selected = true;
        selectedComboId = combo.id;
      }

      select.appendChild(option);
    }
  });

  // 如果没有选中的，选第一个
  if (!selectedComboId && configData.combinations.length > 0) {
    select.value = configData.combinations[0].id;
    selectedComboId = configData.combinations[0].id;
  }
}

// 处理组合选择变化
elements.comboSelect?.addEventListener('change', (e) => {
  selectedComboId = e.target.value;
  if (selectedComboId) {
    chrome.storage.local.set({ lastUsedComboId: selectedComboId });
  }
});

// 获取当前页面信息
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      elements.pageTitle.textContent = tab.title || '未知页面';
      currentTabId = tab.id;
      currentUrl = tab.url;
      return tab;
    }
  } catch (error) {
    console.error('获取页面信息失败:', error);
  }
  return null;
}

// 保存状态到 background
async function saveState(state) {
  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SUMMARY_STATE',
      tabId: currentTabId,
      url: currentUrl,
      title: elements.pageTitle.textContent,
      comboId: selectedComboId,
      chatHistory: chatHistory,
      ...state
    });
  } catch (error) {
    console.error('保存状态失败:', error);
  }
}

// 从 background 恢复状态
async function restoreState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SUMMARY_STATE' });
    if (response.state && response.state.tabId === currentTabId && response.state.url === currentUrl) {
      // 恢复组合选择
      if (response.state.comboId) {
        elements.comboSelect.value = response.state.comboId;
        selectedComboId = response.state.comboId;
      }

      // 恢复对话历史
      if (response.state.chatHistory && response.state.chatHistory.length > 0) {
        chatHistory = response.state.chatHistory;
        renderChatMessages();
        elements.result.classList.remove('hidden');
      } else if (response.state.content) {
        // 兼容旧格式
        elements.result.classList.remove('hidden');
        renderMarkdown(response.state.content);
      }

      if (response.state.isLoading) {
        elements.result.classList.remove('hidden');
      }
      if (response.state.error) {
        showError(response.state.error);
      }
      return true;
    }
  } catch (error) {
    console.error('恢复状态失败:', error);
  }
  return false;
}

// 清除状态
async function clearState() {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_SUMMARY_STATE' });
    chatHistory = [];
    currentModel = null;
  } catch (error) {
    console.error('清除状态失败:', error);
  }
}

// 提取页面内容
async function extractPageContent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('无法获取当前页面');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.webReaderExtractContent) {
          const result = window.webReaderExtractContent();
          // 返回 content 字段（包含元信息和正文）
          return result && result.content ? result.content : result;
        }
        return extractContentFallback();
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }

    throw new Error('内容提取返回空结果');
  } catch (error) {
    console.error('提取内容失败:', error);
    throw error;
  }
}

// 备用内容提取
function extractContentFallback() {
  const selectors = [
    'article', 'main', '[role="main"]',
    '.post-content', '.entry-content', '.article-content',
    '.content', '#content', '.post', '.article'
  ];

  let bestElement = null;
  let maxTextLength = 0;

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.innerText || '';
      if (text.length > maxTextLength) {
        maxTextLength = text.length;
        bestElement = element;
      }
    }
  }

  if (!bestElement) {
    bestElement = document.body;
  }

  let content = bestElement.innerText || '';
  content = content.replace(/\s+/g, ' ').trim();

  if (content.length > 15000) {
    content = content.substring(0, 15000) + '...';
  }

  return content;
}

// 渲染 Markdown
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });
    return marked.parse(text);
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// 渲染单条聊天消息
function renderChatMessage(message, index, isStreaming = false) {
  const div = document.createElement('div');
  div.className = `chat-message ${message.role}`;
  if (isStreaming) {
    div.id = 'streaming-message';
  }

  const header = document.createElement('div');
  header.className = 'chat-message-header';
  header.textContent = message.role === 'user' ? '你' : 'AI';

  const content = document.createElement('div');
  content.className = 'chat-message-content';
  content.innerHTML = renderMarkdown(message.content);

  div.appendChild(header);
  div.appendChild(content);
  return div;
}

// 渲染所有聊天消息
// isFirstSummary: 第一次总结时不显示 system 和第一个 user 消息
function renderChatMessages(isFirstSummary = false) {
  if (!elements.chatMessages) return;

  elements.chatMessages.innerHTML = '';

  chatHistory.forEach((msg, index) => {
    // 第一次总结时跳过 system 和第一个 user 消息（即索引 0 和 1）
    if (isFirstSummary && (msg.role === 'system' || index === 1)) {
      return;
    }
    elements.chatMessages.appendChild(renderChatMessage(msg, index));
  });

  // 滚动到底部
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// 添加消息到聊天历史
function addMessage(role, content) {
  chatHistory.push({ role, content, timestamp: Date.now() });
  renderChatMessages();
}

// 更新最后一条助手消息
function updateLastAssistantMessage(content) {
  const lastMsg = chatHistory[chatHistory.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.content = content;
    renderChatMessages();
  }
}

// 调用 API 进行总结（初始化对话）
async function summarizeContent(content) {
  if (!selectedComboId) {
    throw new Error('请先选择一个模型+Prompt组合');
  }

  const combo = configData.combinations.find(c => c.id === selectedComboId);
  if (!combo) {
    throw new Error('选中的组合不存在');
  }

  const model = configData.models.find(m => m.id === combo.modelId);
  const prompt = configData.prompts.find(p => p.id === combo.promptId);

  if (!model || !prompt) {
    throw new Error('模型或 Prompt 配置不完整');
  }

  // 保存当前模型配置
  currentModel = model;

  const finalUserPrompt = (prompt.userPrompt || '请总结以下内容：\n\n{{content}}').replace('{{content}}', content);

  // 初始化对话历史
  chatHistory = [
    { role: 'system', content: prompt.systemPrompt || '你是一个网页内容总结助手。' },
    { role: 'user', content: finalUserPrompt }
  ];

  // 标记为第一次总结（不显示用户输入）
  isInitialSummary = true;

  // 清空消息区域，第一次总结不显示历史
  elements.chatMessages.innerHTML = '';
  elements.result.classList.remove('hidden');
  elements.resultContent.classList.add('hidden');

  return await callAPIWithHistory();
}

// 发送聊天消息
async function sendChatMessage(userMessage) {
  if (!currentModel) {
    throw new Error('请先进行总结');
  }

  // 确保不是初始总结模式
  isInitialSummary = false;

  // 添加用户消息到历史
  chatHistory.push({ role: 'user', content: userMessage });
  renderChatMessages(false);

  // 添加空的助手消息占位
  chatHistory.push({ role: 'assistant', content: '' });

  return await callAPIWithHistory();
}

// 调用 API（使用对话历史）
async function callAPIWithHistory() {
  abortController = new AbortController();

  try {
    const requestBody = {
      model: currentModel.modelCode,
      messages: chatHistory.map(msg => ({ role: msg.role, content: msg.content })),
      stream: true,
      temperature: 0.7
    };

    const response = await fetch(currentModel.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentModel.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorData}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    isChatting = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

        if (trimmedLine.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmedLine.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;

              // 确保有一条 assistant 消息在 chatHistory 中
              let lastMsg = chatHistory[chatHistory.length - 1];
              if (!lastMsg || lastMsg.role !== 'assistant') {
                chatHistory.push({ role: 'assistant', content: '' });
                lastMsg = chatHistory[chatHistory.length - 1];
              }
              lastMsg.content = fullContent;

              // 渲染消息，第一次总结不显示 system 和第一个 user
              renderChatMessages(isInitialSummary);

              if (!window.saveStateTimeout) {
                window.saveStateTimeout = setTimeout(() => {
                  saveState({ isLoading: true });
                  window.saveStateTimeout = null;
                }, 500);
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    isChatting = false;
    // 第一次总结完成后，重置标志位，后续聊天正常显示
    isInitialSummary = false;
    await saveState({ isLoading: false });

    return fullContent;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('请求已取消');
    }
    throw new Error('API 调用失败: ' + error.message);
  } finally {
    isChatting = false;
    abortController = null;
  }
}

// 显示加载状态
function setLoading(isLoading, text = '正在处理...') {
  if (isLoading) {
    elements.loading.classList.remove('hidden');
    elements.loadingText.textContent = text;
    elements.summarizeBtn.disabled = true;
    elements.btnText.textContent = '处理中...';
  } else {
    elements.loading.classList.add('hidden');
    elements.summarizeBtn.disabled = false;
    elements.btnText.textContent = '总结当前页面';
  }
}

// 显示错误
function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove('hidden');
  saveState({ error: message, isLoading: false });
  setTimeout(() => {
    elements.error.classList.add('hidden');
  }, 5000);
}

// 隐藏错误
function hideError() {
  elements.error.classList.add('hidden');
}

// 处理总结按钮点击
async function handleSummarize() {
  if (!selectedComboId) {
    showError('请先选择一个模型+Prompt组合');
    return;
  }

  hideError();
  await clearState();

  try {
    setLoading(true, '正在提取内容...');
    const content = await extractPageContent();

    if (!content || content.length < 50) {
      throw new Error('页面内容太少，无法总结');
    }

    setLoading(true, '正在调用 AI 总结...');
    await summarizeContent(content);
  } catch (error) {
    console.error('总结失败:', error);
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

// 处理发送聊天消息
async function handleSendMessage() {
  const message = elements.chatInput?.value.trim();
  if (!message) return;

  if (isChatting) return;

  elements.chatInput.value = '';
  hideError();

  try {
    setLoading(true, '正在回复...');
    await sendChatMessage(message);
  } catch (error) {
    console.error('发送消息失败:', error);
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

// 清空对话
async function handleClearChat() {
  if (chatHistory.length === 0) return;

  if (!confirm('确定要清空当前对话吗？')) return;

  chatHistory = [];
  currentModel = null;
  elements.result.classList.add('hidden');
  elements.chatMessages.innerHTML = '';
  await clearState();
}

// 打开配置页面
function openOptions() {
  chrome.runtime.openOptionsPage();
}

// 复制结果
async function copyResult() {
  // 复制整个对话或最后一条消息
  let text = '';
  chatHistory.forEach(msg => {
    if (msg.role !== 'system') {
      text += `${msg.role === 'user' ? '你' : 'AI'}: ${msg.content}\n\n`;
    }
  });

  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const originalHtml = elements.copyBtn.innerHTML;
    elements.copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    setTimeout(() => {
      elements.copyBtn.innerHTML = originalHtml;
    }, 1500);
  } catch (error) {
    console.error('复制失败:', error);
  }
}

// 初始化
async function init() {
  elements.openOptions?.addEventListener('click', (e) => {
    e.preventDefault();
    openOptions();
  });

  elements.gotoConfig?.addEventListener('click', openOptions);
  elements.summarizeBtn?.addEventListener('click', handleSummarize);
  elements.copyBtn?.addEventListener('click', copyResult);
  elements.clearChatBtn?.addEventListener('click', handleClearChat);
  elements.sendBtn?.addEventListener('click', handleSendMessage);

  // 聊天输入框回车发送
  elements.chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  const hasConfig = await checkConfig();
  if (!hasConfig) return;

  await renderComboSelector();
  await getCurrentTabInfo();
  await restoreState();
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
