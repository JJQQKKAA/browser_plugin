// 网页内容提取脚本
// 这个脚本会被注入到每个页面中

(function() {
  'use strict';

  // 判断元素是否可见
  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  // 计算元素的文本密度（文本长度 / 元素数量）
  function getTextDensity(element) {
    const text = element.innerText || '';
    const textLength = text.trim().length;
    const tagCount = element.getElementsByTagName('*').length + 1;
    return textLength / tagCount;
  }

  // 获取元素的文本长度
  function getTextLength(element) {
    return (element.innerText || '').trim().length;
  }

  // 主内容提取函数
  function extractContent() {
    // 1. 首先尝试常见的语义化标签
    const semanticSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.content-area',
      '.main-content'
    ];

    for (const selector of semanticSelectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) {
        const text = cleanText(element.innerText);
        if (text.length > 200) {
          return text;
        }
      }
    }

    // 2. 使用启发式算法找最大文本块
    const candidates = findTopCandidates();
    if (candidates.length > 0) {
      const bestCandidate = candidates[0];
      const text = cleanText(bestCandidate.innerText);
      if (text.length > 100) {
        return text;
      }
    }

    // 3. 备用方案：使用 body
    const bodyText = cleanText(document.body.innerText);
    if (bodyText.length > 100) {
      return bodyText;
    }

    // 4. 最后的备用
    return document.title || '';
  }

  // 查找最佳候选元素
  function findTopCandidates() {
    const paragraphs = document.querySelectorAll('p, div, section');
    const candidates = [];

    paragraphs.forEach(p => {
      if (!isVisible(p)) return;

      const parent = p.parentElement;
      if (!parent) return;

      // 跳过明显的非内容区域
      const tagName = parent.tagName.toLowerCase();
      const className = (parent.className || '').toLowerCase();
      const id = (parent.id || '').toLowerCase();

      const skipPatterns = [
        'nav', 'header', 'footer', 'sidebar', 'menu',
        'comment', 'ad-', 'ads', 'popup', 'modal',
        'breadcrumb', 'pagination'
      ];

      const shouldSkip = skipPatterns.some(pattern =>
        className.includes(pattern) ||
        id.includes(pattern) ||
        tagName === pattern
      );

      if (shouldSkip) return;

      const textLength = getTextLength(parent);
      if (textLength > 200) {
        candidates.push({
          element: parent,
          textLength: textLength,
          density: getTextDensity(parent)
        });
      }
    });

    // 按文本长度排序，取前几个
    candidates.sort((a, b) => b.textLength - a.textLength);

    // 去重：合并父元素相同的
    const uniqueCandidates = [];
    const seen = new Set();

    for (const candidate of candidates) {
      let elem = candidate.element;
      let isNew = true;

      // 检查是否已经被包含
      for (const existing of uniqueCandidates) {
        if (existing.contains(elem) || elem.contains(existing)) {
          isNew = false;
          break;
        }
      }

      if (isNew) {
        uniqueCandidates.push(elem);
        if (uniqueCandidates.length >= 3) break;
      }
    }

    return uniqueCandidates;
  }

  // 清理文本
  function cleanText(text) {
    if (!text) return '';

    return text
      // 替换多个空白为单个空格
      .replace(/\s+/g, ' ')
      // 移除零宽字符
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // 清理多余换行
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  // 将函数挂载到 window 对象，供 popup.js 调用
  window.webReaderExtractContent = extractContent;

  // 同时提供一个直接调用的方式
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractContent };
  }
})();
