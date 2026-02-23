// Background Service Worker
// 用于在 popup 关闭时保持总结状态

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SAVE_SUMMARY_STATE') {
    // 保存总结状态
    chrome.storage.local.set({
      summaryState: {
        tabId: request.tabId,
        url: request.url,
        title: request.title,
        content: request.content,
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
        if (age > 5 * 60 * 1000) {
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
  }
  return true;
});

// 监听标签页切换，当用户切换标签页时保存当前状态
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // 可以在这里添加额外的逻辑
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
