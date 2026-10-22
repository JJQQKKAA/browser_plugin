// 获取 DOM 元素
const elements = {
  openOptions: document.getElementById('openOptions'),
  openInWindow: document.getElementById('openInWindow'),
  gotoConfig: document.getElementById('gotoConfig'),
  noConfig: document.getElementById('noConfig'),
  mainContent: document.getElementById('mainContent'),
  pageTitle: document.getElementById('pageTitle'),
  toggleConfigBtn: document.getElementById('toggleConfigBtn'),
  configPanel: document.getElementById('configPanel'),
  modelSelect: document.getElementById('modelSelect'),
  promptSelect: document.getElementById('promptSelect'),
  summarizeBtn: document.getElementById('summarizeBtn'),
  result: document.getElementById('result'),
  resultContent: document.getElementById('resultContent'),
  chatMessages: document.getElementById('chatMessages'),
  tokenStatsTotal: document.getElementById('tokenStatsTotal'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  copyBtn: document.getElementById('copyBtn'),
  increaseFontBtn: document.getElementById('increaseFontBtn'),
  decreaseFontBtn: document.getElementById('decreaseFontBtn'),
  headerLoading: document.getElementById('headerLoading'),
  loadingText: document.getElementById('loadingText'),
  taskButtons: document.getElementById('taskButtons'),
  configSummary: document.getElementById('configSummary'),
  emptyState: document.getElementById('emptyState'),
  stopBtn: document.getElementById('stopBtn'),
  retryBtn: document.getElementById('retryBtn'),
  generationStatus: document.getElementById('generationStatus'),
  latestBtn: document.getElementById('latestBtn'),
  error: document.getElementById('error')
};

let configData = null;
let currentTabId = null;
let currentUrl = null;
let isSummarizing = false;
let lastRequest = null;
let hasEnteredReadingMode = false;
let generationStatus = '准备就绪';
let isChatting = false;
let abortController = null;
let selectedModelId = null;
let selectedPromptId = null;
let chatHistory = []; // 对话历史
let currentModel = null; // 当前使用的模型
let totalTokens = { input: 0, output: 0 }; // 累计 token 统计


// 常量定义
const CONSTANTS = {
  DEFAULT_FONT_SIZE: 15,
  MIN_FONT_SIZE: 10,
  MAX_FONT_SIZE: 18,
  STATE_EXPIRY_MS: 5 * 60 * 1000, // 5分钟
  MAX_CONTENT_LENGTH: 15000
};

// 加载字体大小
async function loadFontSize() {
  try {
    const result = await chrome.storage.local.get('webReaderFontSize');
    return result.webReaderFontSize || CONSTANTS.DEFAULT_FONT_SIZE;
  } catch (error) {
    return CONSTANTS.DEFAULT_FONT_SIZE;
  }
}

// 保存字体大小
async function saveFontSize(fontSize) {
  try {
    await chrome.storage.local.set({ webReaderFontSize: fontSize });
  } catch (error) {
    console.error('保存字体大小失败:', error);
  }
}

// 检查配置
async function checkConfig() {
  try {
    const result = await chrome.storage.local.get('webReaderConfig');

    if (!result.webReaderConfig) {
      elements.noConfig.classList.remove('hidden');
      elements.mainContent.classList.add('hidden');
      return false;
    }

    configData = result.webReaderConfig;
    if (!Array.isArray(configData.models) || !Array.isArray(configData.prompts)) {
      elements.noConfig.classList.remove('hidden');
      elements.mainContent.classList.add('hidden');
      return false;
    }
    if (ReaderCore.prepareConfig(configData)) {
      await chrome.storage.local.set({ webReaderConfig: configData });
    }

    elements.noConfig.classList.add('hidden');
    elements.mainContent.classList.remove('hidden');
    return true;
  } catch (error) {
    showError('检查配置失败: ' + error.message);
    return false;
  }
}

// 通用选择器渲染函数
async function renderSelector(selectElement, items, lastUsedKey, selectedRef) {
  const placeholder = selectElement === elements.modelSelect ? '选择模型...' : '选择任务...';
  selectElement.innerHTML = `<option value="">${placeholder}</option>`;

  if (!items?.length) return;

  const lastUsed = await chrome.storage.local.get(lastUsedKey);
  const lastUsedId = lastUsed[lastUsedKey];

  // 确定要选中的 ID：优先使用 lastUsedId，否则使用第一个
  let selectedId = lastUsedId;
  if (!selectedId || !items.find(item => item.id === selectedId)) {
    selectedId = items[0].id;
  }

  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name || item.shortName;

    if (item.id === selectedId) {
      option.selected = true;
      if (selectElement === elements.modelSelect) {
        selectedModelId = item.id;
      } else {
        selectedPromptId = item.id;
      }
    }

    selectElement.appendChild(option);
  });
}

// 渲染模型选择器
async function renderModelSelector() {
  await renderSelector(elements.modelSelect, configData?.models, 'lastUsedModelId', selectedModelId);
}

// 渲染 Prompt 选择器
async function renderPromptSelector() {
  await renderSelector(elements.promptSelect, configData?.prompts, 'lastUsedPromptId', selectedPromptId);
}

// 注意：change 事件监听器在 init 函数中统一绑定，避免重复绑定

// 获取当前标签页（统一处理窗口模式）
async function getCurrentTab() {
  if (isWindowMode) {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LAST_ACTIVE_TAB' });
    return response?.tab || null;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.runtime.sendMessage({ type: 'SET_LAST_ACTIVE_TAB', tab: { id: tab.id, url: tab.url, title: tab.title } });
  }
  return tab || null;
}

// 获取当前页面信息
async function getCurrentTabInfo() {
  try {
    const tab = await getCurrentTab();
    if (tab) {
      elements.pageTitle.textContent = tab.title || '未知页面';
      document.getElementById('pageSource').textContent = tab.url ? new URL(tab.url).hostname : '';
      currentTabId = tab.id;
      currentUrl = tab.url;
      // 常见 PDF 地址可直接带入阅读器；其他地址仍从空白阅读器手动打开
      if (tab.url && /^(https?|file):/.test(tab.url) && /\.pdf$/i.test(new URL(tab.url).pathname)) {
        document.getElementById('openPdf').href = chrome.runtime.getURL('pdf-reader.html') + '?file=' + encodeURIComponent(tab.url)
      }
      return tab;
    }
    if (isWindowMode) {
      elements.pageTitle.textContent = '请在浏览器中选择页面';
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
      modelId: selectedModelId,
      promptId: selectedPromptId,
      chatHistory: chatHistory,
      lastRequest,
      generationStatus,
      totalTokens,
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
      // 恢复模型选择
      if (configData.models.some(model => model.id === response.state.modelId)) {
        elements.modelSelect.value = response.state.modelId;
        selectedModelId = response.state.modelId;
        // 恢复当前模型对象，确保恢复状态后能继续对话
        currentModel = configData?.models?.find(m => m.id === selectedModelId) || null;
      }
      // 恢复 Prompt 选择
      if (configData.prompts.some(prompt => prompt.id === response.state.promptId)) {
        elements.promptSelect.value = response.state.promptId;
        selectedPromptId = response.state.promptId;
      }

      currentModel = configData.models.find(model => model.id === selectedModelId) || null;
      lastRequest = response.state.lastRequest || null;
      generationStatus = response.state.isLoading ? '上次生成已中断，可重新生成' : (response.state.generationStatus || '已恢复阅读笔记');
      totalTokens = response.state.totalTokens || { input: 0, output: 0 };
      // 恢复对话历史
      if (response.state.chatHistory && response.state.chatHistory.length > 0) {
        chatHistory = response.state.chatHistory;
        renderChatMessages();
        elements.result.classList.remove('hidden');
      } else if (response.state.content) {
        // 兼容旧格式：直接渲染为单条结果
        elements.result.classList.remove('hidden');
        elements.chatMessages.classList.add('hidden');
        elements.resultContent.classList.remove('hidden');
        elements.resultContent.innerHTML = renderMarkdown(response.state.content);
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
    lastRequest = null;
    currentModel = null;
    totalTokens = { input: 0, output: 0 };
    updateTotalTokenStats();
  } catch (error) {
    console.error('清除状态失败:', error);
  }
}

// 提取页面内容
async function extractPageContent() {
  try {
    const tab = await getCurrentTab();
    if (!tab) {
      throw new Error(isWindowMode ? '无法获取当前页面，请在浏览器中先打开一个页面' : '无法获取当前页面');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.webReaderExtractContent === 'function') {
          return window.webReaderExtractContent();
        }

        // 页面未注入 content.js 时的安全 fallback
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
        let content = (bestElement.innerText || '').replace(/\s+/g, ' ').trim();
        if (content.length > 15000) {
          content = content.substring(0, 15000) + '...';
        }
        return { content, metadata: {}, rawContent: content, isSelection: false };
      }
    });

    if (results?.[0]?.result) {
      const result = results[0].result;
      return {
        content: result.content || result,
        isSelection: result.isSelection || false
      };
    }

    throw new Error('内容提取返回空结果');
  } catch (error) {
    console.error('提取内容失败:', error);
    throw error;
  }
}

// 转义 HTML 特殊字符（用于 Markdown 不可用时的降级渲染）
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 直接遵循 Markdown 结构，避免补缩进把顶格段落或引用错误吸入列表
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text, { breaks: false, gfm: true });
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
  header.textContent = message.role === 'user' ? '你的提问' : '阅读助手';

  const content = document.createElement('div');
  content.className = 'chat-message-content';
  content.innerHTML = renderMarkdown(message.content);

  div.appendChild(header);
  div.appendChild(content);

  // 为 AI 消息添加 token 统计和复制按钮（仅在非流式且有 token 数据时显示）
  if (message.role === 'assistant' && message.tokens && !isStreaming) {
    const tokenStatsRow = document.createElement('div');
    tokenStatsRow.className = 'token-stats-row';

    // 累计统计（最左边）
    const totalStats = document.createElement('span');
    totalStats.className = 'token-stats-total-inline';
    const cumulative = ReaderCore.formatUsage(totalTokens);
    totalStats.textContent = `累计 ${cumulative.total}`;
    totalStats.title = `本次会话所有请求累计（含重试及收到响应的中断请求）\n${cumulative.title}`;
    tokenStatsRow.appendChild(totalStats);

    // 单轮统计
    const tokenStats = document.createElement('span');
    tokenStats.className = 'token-stats';
    const display = ReaderCore.formatUsage(message.tokens);
    tokenStats.textContent = display.text;
    tokenStats.title = display.title;
    tokenStatsRow.appendChild(tokenStats);

    // 添加复制按钮（图标形式）
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
    copyBtn.title = '复制';
    copyBtn.addEventListener('click', () => {
      copyMessageContent(message.content, copyBtn);
    });
    tokenStatsRow.appendChild(copyBtn);

    div.appendChild(tokenStatsRow);
  }

  // 用户消息的复制按钮（放在右下角）
  if (message.role === 'user' && !isStreaming) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn user-copy-btn';
    copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
    copyBtn.title = '复制';
    copyBtn.addEventListener('click', () => {
      copyMessageContent(message.content, copyBtn);
    });
    div.appendChild(copyBtn);
  }

  return div;
}

// 渲染所有聊天消息
// 永远隐藏 system 和第一个 user 消息（它们是初始总结的上下文，不显示给用户）
function renderChatMessages(scrollMode = 'auto') {
  if (!elements.chatMessages) return;

  // 保存当前滚动位置和滚动高度（用于保持相对位置）
  const oldScrollTop = elements.chatMessages.scrollTop;
  const oldScrollHeight = elements.chatMessages.scrollHeight;
  const oldClientHeight = elements.chatMessages.clientHeight;
  const isNearBottom = oldScrollTop + oldClientHeight >= oldScrollHeight - 50;

  elements.chatMessages.innerHTML = '';

  chatHistory.forEach((msg, index) => {
    // 永远跳过 system 和第一个 user 消息（即索引 0 和 1）
    if (msg.role === 'system' || index === 1) {
      return;
    }
    elements.chatMessages.appendChild(renderChatMessage(msg, index, Boolean(abortController) && index === chatHistory.length - 1));
  });

  // 处理滚动
  const newScrollHeight = elements.chatMessages.scrollHeight;
  
  if (scrollMode === 'none') {
    // 保持原来的滚动位置
    elements.chatMessages.scrollTop = oldScrollTop;
  } else if (scrollMode === 'preserve') {
    // 保持相对位置（适用于添加新消息时）
    const heightDiff = newScrollHeight - oldScrollHeight;
    elements.chatMessages.scrollTop = oldScrollTop + heightDiff;
  } else if (scrollMode === 'bottom' || isNearBottom) {
    // 滚动到底部（默认行为，或当用户已经在底部时）
    elements.chatMessages.scrollTop = newScrollHeight;
  } else {
    // 用户不在底部，保持当前位置
    elements.chatMessages.scrollTop = oldScrollTop;
  }
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

// 更新总 token 统计显示
function updateTotalTokenStats() {
  if (elements.tokenStatsTotal) {
    if (totalTokens.input > 0 || totalTokens.output > 0) {
      elements.tokenStatsTotal.textContent = ReaderCore.formatUsage(totalTokens).text;
    } else {
      elements.tokenStatsTotal.textContent = '';
    }
  }
}

// 调用 API 进行总结（初始化对话）
async function summarizeContent(content) {
  if (!selectedModelId) {
    throw new Error('请先选择一个模型');
  }
  if (!selectedPromptId) {
    throw new Error('请先选择一个任务');
  }

  const model = configData.models.find(m => m.id === selectedModelId);
  const prompt = configData.prompts.find(p => p.id === selectedPromptId);

  if (!model) {
    throw new Error('选中的模型不存在');
  }
  if (!prompt) {
    throw new Error('选中的任务不存在');
  }

  // 保存当前模型配置
  currentModel = model;

  // 重置 token 统计
  totalTokens = { input: 0, output: 0 };
  updateTotalTokenStats();

  const finalUserPrompt = (prompt.userPrompt || '请总结以下内容：\n\n{{content}}').replace('{{content}}', content);

  // 初始化对话历史
  chatHistory = [
    { role: 'system', content: prompt.systemPrompt || '你是一个网页内容总结助手。' },
    { role: 'user', content: finalUserPrompt }
  ];

  // 清空消息区域
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

  // 添加用户消息到历史
  chatHistory.push({ role: 'user', content: userMessage });
  renderChatMessages('preserve'); // 保持相对位置，让新消息显示在视野内


  return await callAPIWithHistory();
}

// 调用 API（使用对话历史）
async function callAPIWithHistory(messages = null) {
  abortController = new AbortController();
  elements.stopBtn.disabled = false;
  const requestMessages = messages || chatHistory.map(msg => ({ role: msg.role, content: msg.content }));
  // 保存本轮输入快照，重试时替换本轮回答，不把半截回答再次发给模型
  const requestHistory = chatHistory.map(message => ({ ...message }));
  if (requestHistory[requestHistory.length - 1]?.role === 'assistant') requestHistory.pop();
  lastRequest = { messages: requestMessages, history: requestHistory, modelId: currentModel.id };
  if (chatHistory[chatHistory.length - 1]?.role === 'assistant') chatHistory.pop();
  chatHistory.push({ role: 'assistant', content: '' });
  const assistant = chatHistory[chatHistory.length - 1];
  let usage = {};
  let reasoningText = '';
  let receivedResponse = false;
  let completed = false;
  renderChatMessages('bottom');
  await saveState({ isLoading: true });

  try {
    const response = await fetch(currentModel.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentModel.apiKey}` },
      body: JSON.stringify(ReaderCore.buildRequest(currentModel, requestMessages)),
      signal: abortController.signal
    });
    if (!response.ok) throw new Error(`请求失败 (${response.status})：${await response.text()}`);
    if (!response.body) throw new Error('API 没有返回可读取的响应');
    receivedResponse = true;
    isChatting = true;
    await ReaderCore.readSSE(response.body, data => {
      if (data.error) throw new Error(data.error.message || 'API 返回错误');
      usage = ReaderCore.mergeUsage(usage, data.usage);
      const reasoning = data.choices?.[0]?.delta?.reasoning_content;
      if (typeof reasoning === 'string') reasoningText += reasoning;
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) {
        assistant.content += delta;
        renderChatMessages();
        if (!window.saveStateTimeout) {
          window.saveStateTimeout = setTimeout(() => {
            saveState({ isLoading: true });
            window.saveStateTimeout = null;
          }, 500);
        }
      }
    });
    if (!assistant.content) throw new Error('模型没有返回正文，请检查模型设置后重试');
    completed = true;
    generationStatus = '已完成 · 可继续提问';
    return assistant.content;
  } catch (error) {
    if (error.name === 'AbortError') {
      generationStatus = '已停止 · 已保留生成内容';
      return assistant.content;
    }
    generationStatus = '生成失败 · 可重试';
    throw error;
  } finally {
    if (receivedResponse) {
      assistant.tokens = ReaderCore.finalizeUsage(usage, JSON.stringify(requestMessages), reasoningText + assistant.content, !completed);
      totalTokens = ReaderCore.addUsage(totalTokens, assistant.tokens);
    }
    clearTimeout(window.saveStateTimeout);
    window.saveStateTimeout = null;
    isChatting = false;
    abortController = null;
    await saveState({ isLoading: false });
    renderChatMessages();
  }
}

// 显示加载状态
function setLoading(isLoading, text = '正在处理…') {
  isSummarizing = isLoading;
  elements.headerLoading.classList.toggle('hidden', !isLoading);
  elements.loadingText.textContent = isLoading ? '生成中' : '';
  elements.generationStatus.textContent = isLoading ? text : generationStatus;
  elements.stopBtn.classList.toggle('hidden', !isLoading);
  elements.stopBtn.disabled = isLoading && !abortController;
  elements.retryBtn.classList.toggle('hidden', isLoading || !lastRequest);
  for (const element of [elements.summarizeBtn, elements.sendBtn, elements.modelSelect, elements.promptSelect, elements.clearChatBtn, elements.openInWindow]) {
    element.disabled = isLoading;
  }
  elements.taskButtons.querySelectorAll('button').forEach(button => { button.disabled = isLoading; });
  elements.emptyState.classList.toggle('hidden', chatHistory.length > 0 || isLoading);
  const reading = isLoading || chatHistory.length > 0;
  document.body.classList.toggle('reading-mode', reading);
  // 开始生成与恢复结果时自动收起工具，普通阅读过程中尊重手动展开状态
  if (isLoading || reading !== hasEnteredReadingMode) setReadingControlsOpen(false);
  hasEnteredReadingMode = reading;
  updateReadingContext();
}

function setReadingControlsOpen(open) {
  document.body.classList.toggle('controls-open', open);
  elements.toggleConfigBtn.setAttribute('aria-expanded', String(open));
  elements.toggleConfigBtn.classList.toggle('expanded', open);
}

function updateReadingContext() {
  const prompt = configData?.prompts.find(prompt => prompt.id === selectedPromptId);
  const title = elements.pageTitle.textContent;
  const context = document.getElementById('readingContext');
  context.textContent = `${prompt?.shortName || '阅读笔记'} · ${title} ▾`;
  context.title = `${title}（点击切换阅读任务）`;
}

function renderReadingTasks() {
  elements.taskButtons.replaceChildren();
  for (const prompt of configData.prompts.filter(prompt => prompt.showAsTask)) {
    const button = document.createElement('button');
    button.className = 'task-button';
    button.textContent = prompt.shortName;
    button.title = prompt.userPrompt;
    button.classList.toggle('active', prompt.id === selectedPromptId);
    button.addEventListener('click', () => handleSummarize(prompt.id));
    elements.taskButtons.appendChild(button);
  }
  const model = configData.models.find(model => model.id === selectedModelId);
  const prompt = configData.prompts.find(prompt => prompt.id === selectedPromptId);
  elements.configSummary.textContent = `${model?.name || '选择模型'} · ${prompt?.shortName || '选择任务'} ▾`;
  document.getElementById('resultTitle').textContent = prompt?.shortName || '阅读笔记';
  updateReadingContext();
}

async function retryGeneration() {
  if (isSummarizing || !lastRequest) return;
  const model = configData.models.find(model => model.id === lastRequest.modelId);
  if (!model) return showError('上次使用的模型已删除，请重新选择任务');
  hideError();
  currentModel = model;
  const messages = lastRequest.messages.map(message => ({ ...message }));
  // 以输入快照重建历史，重试不会增加一条重复的用户消息
  chatHistory = (lastRequest.history || messages).map(message => ({ ...message }));
  elements.result.classList.remove('hidden');
  setLoading(true, '正在重新生成…');
  try {
    await callAPIWithHistory(messages);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
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
async function handleSummarize(promptId) {
  if (isSummarizing) return;
  if (typeof promptId === 'string') {
    selectedPromptId = promptId;
    elements.promptSelect.value = promptId;
    chrome.storage.local.set({ lastUsedPromptId: promptId });
    renderReadingTasks();
  }
  if (!selectedModelId) {
    showError('请先选择一个模型');
    return;
  }
  if (!selectedPromptId) {
    showError('请先选择一个任务');
    return;
  }

  hideError();
  setLoading(true, '正在提取内容…');

  try {
    await clearState();
    const extractResult = await extractPageContent();

    const content = extractResult.content || extractResult;
    const isSelection = extractResult.isSelection || false;

    if (!content || content.length < 50) {
      throw new Error('页面内容太少，无法总结');
    }

    // 如果是选中的内容，显示提示
    if (isSelection) {
      setLoading(true, '正在总结选中的内容...');
    } else {
      setLoading(true, '正在调用 AI 总结...');
    }

    await summarizeContent(content);
  } catch (error) {
    console.error('总结失败:', error);
    generationStatus = '生成失败 · 请重试';
    showError(error.message);
  } finally {
    setLoading(false);
    elements.chatMessages.scrollTop = 0;
  }
}



// 处理发送聊天消息
async function handleSendMessage() {
  const message = elements.chatInput?.value.trim();
  if (!message) return;

  if (isSummarizing) return;

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
  lastRequest = null;
  generationStatus = '准备就绪';
  currentModel = null;
  totalTokens = { input: 0, output: 0 };
  updateTotalTokenStats();
  elements.result.classList.add('hidden');
  elements.chatMessages.innerHTML = '';
  await clearState();
  setLoading(false);
}

// 打开配置页面
function openOptions(section) {
  if (section === 'prompts') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#prompts') });
  } else {
    chrome.runtime.openOptionsPage();
  }
}

// 在新窗口打开
async function openInNewWindow() {
  try {
    const width = Math.min(900, screen.availWidth - 100);
    const height = Math.min(700, screen.availHeight - 100);
    const left = Math.round((screen.availWidth - width) / 2);
    const top = Math.round((screen.availHeight - height) / 2);
    
    // 保存当前状态到 storage，让新窗口可以恢复
    const windowState = {
      chatHistory: chatHistory,
      currentModel: currentModel,
      selectedModelId: selectedModelId,
      selectedPromptId: selectedPromptId,
      currentTabId: currentTabId,
      currentUrl: currentUrl,
      pageTitle: elements.pageTitle.textContent,
      isWindowMode: true,
      totalTokens: totalTokens,
      lastRequest,
      generationStatus,
      timestamp: Date.now()
    };
    
    await chrome.storage.local.set({ windowModeState: windowState });
    
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html?window=true'),
      type: 'popup',
      width: width,
      height: height,
      left: left,
      top: top
    });
    
    // 关闭当前 popup
    window.close();
  } catch (error) {
    console.error('打开新窗口失败:', error);
    showError('打开新窗口失败: ' + error.message);
  }
}

// 复制单条消息内容
async function copyMessageContent(content, btnElement) {
  if (!content) return;

  try {
    await navigator.clipboard.writeText(content);

    // 显示成功反馈
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>已复制</span>
    `;
    btnElement.classList.add('copied');

    setTimeout(() => {
      btnElement.innerHTML = originalHtml;
      btnElement.classList.remove('copied');
    }, 1500);
  } catch (error) {
    console.error('复制失败:', error);
    showError('复制失败: ' + (error.message || '请检查剪贴板权限'));
  }
}

// 复制结果（复制全部对话）
async function copyResult() {
  // 复制整个对话
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
    showError('复制失败: ' + (error.message || '请检查剪贴板权限'));
  }
}

// 初始化
async function init() {
  elements.openOptions?.addEventListener('click', (e) => {
    e.preventDefault();
    openOptions();
  });
  
  elements.openInWindow?.addEventListener('click', openInNewWindow);

  elements.gotoConfig?.addEventListener('click', openOptions);
  elements.summarizeBtn?.addEventListener('click', handleSummarize);
  elements.stopBtn.addEventListener('click', () => {
    if (!abortController) return;
    abortController.abort();
    elements.stopBtn.disabled = true;
    elements.generationStatus.textContent = '正在停止…';
  });
  elements.retryBtn.addEventListener('click', retryGeneration);
  document.getElementById('manageTasks').addEventListener('click', e => { e.preventDefault(); openOptions('prompts'); });
  elements.configSummary.addEventListener('click', () => {
    const collapsed = elements.configPanel.classList.toggle('collapsed');
    chrome.storage.local.set({ configPanelCollapsed: collapsed });
  });
  document.getElementById('readingContext').addEventListener('click', () => {
    setReadingControlsOpen(!document.body.classList.contains('controls-open'));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setReadingControlsOpen(false);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#readingControls, #toggleConfigBtn, #readingContext')) setReadingControlsOpen(false);
  });
  elements.latestBtn.addEventListener('click', () => { elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight; });
  elements.chatMessages.addEventListener('scroll', () => {
    elements.latestBtn.classList.toggle('hidden', elements.chatMessages.scrollHeight - elements.chatMessages.scrollTop - elements.chatMessages.clientHeight < 60);
  });
  elements.copyBtn?.addEventListener('click', copyResult);
  elements.clearChatBtn?.addEventListener('click', handleClearChat);
  elements.sendBtn?.addEventListener('click', handleSendMessage);

  // 字体大小调整
  let currentFontSize = await loadFontSize();
  if (elements.chatMessages) {
    elements.chatMessages.style.fontSize = currentFontSize + 'px';
  }

  async function adjustFontSize(delta) {
    const newSize = currentFontSize + delta;
    if (newSize >= 10 && newSize <= 18) {
      currentFontSize = newSize;
      if (elements.chatMessages) {
        elements.chatMessages.style.fontSize = currentFontSize + 'px';
      }
      await saveFontSize(currentFontSize);
    }
  }

  elements.increaseFontBtn?.addEventListener('click', () => adjustFontSize(1));
  elements.decreaseFontBtn?.addEventListener('click', () => adjustFontSize(-1));

  // 聊天输入框回车发送
  let isComposing = false;
  elements.chatInput?.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  elements.chatInput?.addEventListener('compositionend', () => {
    isComposing = false;
  });
  elements.chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // 自动调整输入框高度
  elements.chatInput?.addEventListener('input', function() {
    this.style.height = 'auto';
    const newHeight = Math.min(this.scrollHeight, 120);
    this.style.height = newHeight + 'px';
  });

  // 阅读时通过浮层切换任务，不挤占正文；初始界面仍可展开模型配置
  elements.toggleConfigBtn?.addEventListener('click', () => {
    if (document.body.classList.contains('reading-mode')) {
      setReadingControlsOpen(!document.body.classList.contains('controls-open'));
    } else {
      const collapsed = elements.configPanel.classList.toggle('collapsed');
      chrome.storage.local.set({ configPanelCollapsed: collapsed });
    }
  });

  // 加载配置面板的收起状态
  const configState = await chrome.storage.local.get('configPanelCollapsed');
  if (configState.configPanelCollapsed !== false) {
    elements.configPanel.classList.add('collapsed');
    elements.toggleConfigBtn?.classList.remove('expanded');
  } else {
    elements.configPanel.classList.remove('collapsed');
    elements.toggleConfigBtn?.classList.add('expanded');
  }

  // 配置选择变化处理
  async function handleSelectionChange(type, value) {
    if (type === 'model') {
      selectedModelId = value;
      if (value) chrome.storage.local.set({ lastUsedModelId: value });
    } else {
      selectedPromptId = value;
      if (value) chrome.storage.local.set({ lastUsedPromptId: value });
    }

    renderReadingTasks();
    if (selectedModelId && selectedPromptId) {
      elements.configPanel.classList.add('collapsed');
      elements.toggleConfigBtn?.classList.remove('expanded');
      await chrome.storage.local.set({ configPanelCollapsed: true });
    }
  }

  elements.modelSelect?.addEventListener('change', (e) => handleSelectionChange('model', e.target.value));
  elements.promptSelect?.addEventListener('change', (e) => handleSelectionChange('prompt', e.target.value));

  const hasConfig = await checkConfig();
  if (!hasConfig) return;

  await renderModelSelector();
  await renderPromptSelector();

  // 如果是独立窗口模式，尝试恢复窗口状态
  if (isWindowMode) {
    const restored = await restoreWindowState();
    if (!restored) {
      // 如果没有恢复状态，则获取当前标签页信息
      await getCurrentTabInfo();
    }
  } else {
    await getCurrentTabInfo();
  }

  await restoreState();
  renderReadingTasks();
  setLoading(false);
  if (chatHistory.length <= 3) elements.chatMessages.scrollTop = 0;

  document.querySelectorAll('[title]').forEach(element => {
    if (!element.textContent.trim() && !element.getAttribute('aria-label')) element.setAttribute('aria-label', element.title);
  });
}

// 恢复窗口状态（用于独立窗口模式）
async function restoreWindowState() {
  try {
    const result = await chrome.storage.local.get('windowModeState');
    if (!result.windowModeState) return false;

    const state = result.windowModeState;
    
    // 检查状态是否过期
    const age = Date.now() - state.timestamp;
    if (age > CONSTANTS.STATE_EXPIRY_MS) {
      await chrome.storage.local.remove('windowModeState');
      return false;
    }

    // 恢复状态
    if (state.chatHistory && state.chatHistory.length > 0) {
      lastRequest = state.lastRequest || null;
      generationStatus = state.generationStatus || '已恢复阅读笔记';
      chatHistory = state.chatHistory;
      if (configData.models.some(model => model.id === state.selectedModelId)) selectedModelId = state.selectedModelId;
      if (configData.prompts.some(prompt => prompt.id === state.selectedPromptId)) selectedPromptId = state.selectedPromptId;
      currentModel = configData.models.find(model => model.id === selectedModelId) || null;
      currentTabId = state.currentTabId;
      currentUrl = state.currentUrl;

      // 恢复 token 统计
      if (state.totalTokens) {
        totalTokens = state.totalTokens;
        updateTotalTokenStats();
      }

      // 更新 UI
      elements.pageTitle.textContent = state.pageTitle || '未知页面';
      if (elements.modelSelect) elements.modelSelect.value = selectedModelId || '';
      if (elements.promptSelect) elements.promptSelect.value = selectedPromptId || '';

      // 显示对话内容
      elements.result.classList.remove('hidden');
      renderChatMessages();

      // 清除已恢复的状态
      await chrome.storage.local.remove('windowModeState');

      return true;
    }
    
    return false;
  } catch (error) {
    console.error('恢复窗口状态失败:', error);
    return false;
  }
}

// 检测是否为独立窗口模式
let isWindowMode = false;

function checkWindowMode() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('window') === 'true') {
    isWindowMode = true;
    document.body.classList.add('window-mode');
  }
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  checkWindowMode();
  init();
});
