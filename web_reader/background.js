// Background Service Worker
// 用于在 popup 关闭时保持总结状态

// 存储最后活跃的标签页信息
let lastActiveTab = null;

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SAVE_SUMMARY_STATE') {
    // 保存总结状态
    chrome.storage.local.set({
      summaryState: {
        tabId: request.tabId,
        url: request.url,
        title: request.title,
        comboId: request.comboId,
        chatHistory: request.chatHistory,
        isLoading: request.isLoading,
        error: request.error,
        timestamp: Date.now()
      }
    });
    sendResponse({ success: true });
  } else if (request.type === 'GET_SUMMARY_STATE') {
    // 获取总结状态
    chrome.storage.local.get('summaryState').then(result => {
      // 检查状态是否过期（5分钟）
      if (result.summaryState) {
        const age = Date.now() - result.summaryState.timestamp;
        if (age > 300000) {
          // 过期，清除状态
          chrome.storage.local.remove('summaryState');
          sendResponse({ state: null });
        } else {
          sendResponse({ state: result.summaryState });
        }
      } else {
        sendResponse({ state: null });
      }
    });
    return true; // 保持消息通道开放以进行异步响应
  } else if (request.type === 'CLEAR_SUMMARY_STATE') {
    // 清除总结状态
    chrome.storage.local.remove('summaryState');
    sendResponse({ success: true });
  } else if (request.type === 'SET_LAST_ACTIVE_TAB') {
    // 设置最后活跃的标签页
    lastActiveTab = request.tab;
    sendResponse({ success: true });
  } else if (request.type === 'GET_LAST_ACTIVE_TAB') {
    // 获取最后活跃的标签页
    sendResponse({ tab: lastActiveTab });

  return true;
  }
});



// 监听标签页切换，记录最后活跃的标签页
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      lastActiveTab = { id: tab.id, url: tab.url, title: tab.title };
    }
  } catch (error) {
    // 忽略错误
  }
});

// 监听标签页更新，清除过期的总结状态
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // URL 改变时，检查是否需要清除相关状态
    chrome.storage.local.get('summaryState').then(result => {
      if (result.summaryState && result.summaryState.tabId === tabId) {
        if (result.summaryState.url !== changeInfo.url) {
          chrome.storage.local.remove('summaryState');
        }
      }
    });
  }
});

console.log('Web Reader background service worker started');
