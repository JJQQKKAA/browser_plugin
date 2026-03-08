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
  error: document.getElementById('error')
};

let configData = null;
let currentTabId = null;
let currentUrl = null;
let isSummarizing = false;
let isChatting = false;
let abortController = null;
let selectedModelId = null;
let selectedPromptId = null;
let chatHistory = []; // 对话历史
let currentModel = null; // 当前使用的模型
let currentTurnTokens = { input: 0, output: 0 }; // 当前轮次的 token 统计
let totalTokens = { input: 0, output: 0 }; // 累计 token 统计


// 常量定义
const CONSTANTS = {
  DEFAULT_FONT_SIZE: 13,
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

// 通用选择器渲染函数
async function renderSelector(selectElement, items, lastUsedKey, selectedRef) {
  const placeholder = selectElement === elements.modelSelect ? '选择模型...' : '选择 Prompt...';
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
      currentTabId = tab.id;
      currentUrl = tab.url;
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
      if (response.state.modelId) {
        elements.modelSelect.value = response.state.modelId;
        selectedModelId = response.state.modelId;
      }
      // 恢复 Prompt 选择
      if (response.state.promptId) {
        elements.promptSelect.value = response.state.promptId;
        selectedPromptId = response.state.promptId;
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
    currentTurnTokens = { input: 0, output: 0 };
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
        if (window.webReaderExtractContent) {
          return window.webReaderExtractContent();
        }
        const fallback = extractContentFallback();
        return { content: fallback, metadata: {}, rawContent: fallback, isSelection: false };
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
      breaks: false,  // 关闭自动换行，避免破坏列表解析
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

  // 为 AI 消息添加 token 统计和复制按钮（仅在非流式且有 token 数据时显示）
  if (message.role === 'assistant' && message.tokens && !isStreaming) {
    const tokenStatsRow = document.createElement('div');
    tokenStatsRow.className = 'token-stats-row';

    // 累计统计（最左边）
    const totalStats = document.createElement('span');
    totalStats.className = 'token-stats-total-inline';
    totalStats.textContent = `Total: In ${totalTokens.input} / Out ${totalTokens.output}`;
    tokenStatsRow.appendChild(totalStats);

    // 单轮统计
    const tokenStats = document.createElement('span');
    tokenStats.className = 'token-stats';
    tokenStats.textContent = `Cur: In ${message.tokens.input} / Out ${message.tokens.output}`;
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
function renderChatMessages(scrollMode = 'bottom') {
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
    elements.chatMessages.appendChild(renderChatMessage(msg, index));
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

// 估算 token 数量（简单估算：中文约 1.5 字符/token，英文约 4 字符/token）
function estimateTokens(text) {
  if (!text) return 0;
  // 简单估算：假设平均每个 token 约 2.5 个字符
  return Math.ceil(text.length / 2.5);
}

// 更新总 token 统计显示
function updateTotalTokenStats() {
  if (elements.tokenStatsTotal) {
    if (totalTokens.input > 0 || totalTokens.output > 0) {
      elements.tokenStatsTotal.textContent = `Total: In ${totalTokens.input} / Out ${totalTokens.output}`;
    } else {
      elements.tokenStatsTotal.textContent = '';
    }
  }
}

// 将当前轮次 token 加到累计中
function accumulateTokens() {
  totalTokens.input += currentTurnTokens.input;
  totalTokens.output += currentTurnTokens.output;
  currentTurnTokens = { input: 0, output: 0 };
  updateTotalTokenStats();
}

// 调用 API 进行总结（初始化对话）
async function summarizeContent(content) {
  if (!selectedModelId) {
    throw new Error('请先选择一个模型');
  }
  if (!selectedPromptId) {
    throw new Error('请先选择一个 Prompt');
  }

  const model = configData.models.find(m => m.id === selectedModelId);
  const prompt = configData.prompts.find(p => p.id === selectedPromptId);

  if (!model) {
    throw new Error('选中的模型不存在');
  }
  if (!prompt) {
    throw new Error('选中的 Prompt 不存在');
  }

  // 保存当前模型配置
  currentModel = model;

  // 重置 token 统计
  currentTurnTokens = { input: 0, output: 0 };
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

              // 更新最后一条 assistant 消息
              let lastMsg = chatHistory[chatHistory.length - 1];
              if (!lastMsg || lastMsg.role !== 'assistant') {
                chatHistory.push({ role: 'assistant', content: '' });
                lastMsg = chatHistory[chatHistory.length - 1];
              }
              lastMsg.content = fullContent;

              // 渲染消息，保持滚动位置避免页面跳动
              const scrollMode = isChatting && chatHistory.length > 2 ? 'none' : 'bottom';
              renderChatMessages(scrollMode);

              if (!window.saveStateTimeout) {
                window.saveStateTimeout = setTimeout(() => {
                  saveState({ isLoading: true });
                  window.saveStateTimeout = null;
                }, 500);
              }
            }

            // 检查是否有 token 使用信息（某些 API 在最后一个 chunk 返回）
            if (data.usage) {
              currentTurnTokens.input = data.usage.prompt_tokens || 0;
              currentTurnTokens.output = data.usage.completion_tokens || 0;
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    isChatting = false;

    // 将 token 信息添加到最后一条助手消息
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      // 如果 API 没有返回 token 信息，尝试估算
      if (currentTurnTokens.input === 0) {
        currentTurnTokens.input = estimateTokens(JSON.stringify(chatHistory.slice(0, -1)));
      }
      if (currentTurnTokens.output === 0) {
        currentTurnTokens.output = estimateTokens(fullContent);
      }

      // 计算当前轮次的实际输入 token（减去之前累计的输入）
      const actualInputTokens = currentTurnTokens.input - totalTokens.input;
      const turnTokens = {
        input: Math.max(0, actualInputTokens),
        output: currentTurnTokens.output
      };

      lastMsg.tokens = turnTokens;
      accumulateTokens();
      renderChatMessages();
    }

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
    elements.headerLoading.classList.remove('hidden');
    elements.loadingText.textContent = text;
    elements.summarizeBtn.disabled = true;
    elements.summarizeBtn.classList.add('loading');
  } else {
    elements.headerLoading.classList.add('hidden');
    elements.loadingText.textContent = '';
    elements.summarizeBtn.disabled = false;
    elements.summarizeBtn.classList.remove('loading');
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
  if (!selectedModelId) {
    showError('请先选择一个模型');
    return;
  }
  if (!selectedPromptId) {
    showError('请先选择一个 Prompt');
    return;
  }

  hideError();
  await clearState();

  try {
    setLoading(true, '正在提取内容...');
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
  currentTurnTokens = { input: 0, output: 0 };
  totalTokens = { input: 0, output: 0 };
  updateTotalTokenStats();
  elements.result.classList.add('hidden');
  elements.chatMessages.innerHTML = '';
  await clearState();
}

// 打开配置页面
function openOptions() {
  chrome.runtime.openOptionsPage();
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

  // 配置面板收起/展开
  elements.toggleConfigBtn?.addEventListener('click', () => {
    elements.configPanel.classList.toggle('collapsed');
    elements.toggleConfigBtn?.classList.toggle('expanded');
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

  // 如果已经选择了模型和 Prompt，自动收起配置面板
  if (selectedModelId && selectedPromptId) {
    elements.configPanel?.classList.add('collapsed');
    elements.toggleConfigBtn?.classList.remove('expanded');
  }
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
      chatHistory = state.chatHistory;
      currentModel = state.currentModel;
      selectedModelId = state.selectedModelId;
      selectedPromptId = state.selectedPromptId;
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
