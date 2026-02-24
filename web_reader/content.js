// 网页内容提取脚本
// 这个脚本会被注入到每个页面中

(function() {
  'use strict';

  // 判断元素是否可见
  function isVisible(element) {
    if (!element) return false;

    // 检查 HTML hidden 属性
    if (element.hidden) return false;

    // 检查 ARIA 隐藏属性
    if (element.getAttribute('aria-hidden') === 'true') return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           style.height !== '0px' &&
           style.width !== '0px';
  }

  // 计算链接密度（用于过滤导航区域）
  function getLinkDensity(element) {
    const text = element.innerText || '';
    if (text.length === 0) return 0;

    const links = element.getElementsByTagName('a');
    let linkTextLength = 0;
    for (const link of links) {
      linkTextLength += (link.innerText || '').length;
    }

    return linkTextLength / text.length;
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

  // 站点特定的选择器
  const siteSpecificSelectors = {
    'github.com': '.markdown-body, .readme article, [data-testid="readme"]',
    'stackoverflow.com': '.question .post-text, .answer .post-text',
    'stackexchange.com': '.question .post-text, .answer .post-text',
    'reddit.com': '[data-testid="post-content"], .Post',
    'medium.com': 'article[data-testid="storyContent"]',
    'zhihu.com': '.RichContent-inner, .Post-RichTextContainer, .AnswerCard .RichContent',
    'juejin.cn': '.article-content, .markdown-body',
    'csdn.net': '#content_views, .blog-content-box',
    'weixin.qq.com': '#js_content, .rich_media_content',
    'sspai.com': '.article-content, .content',
    'bilibili.com': '.article-content, .read-article-holder',
    'douban.com': '.review-content, #link-report'
  };

  // 主内容提取函数
  function extractContent() {
    // 提取元信息
    const metadata = extractMetadata();

    // 提取正文内容
    let content = '';

    // 0. 首先检查站点特定规则
    const hostname = window.location.hostname.replace(/^www\./, '');
    for (const [domain, selector] of Object.entries(siteSpecificSelectors)) {
      if (hostname.includes(domain)) {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) {
          const text = cleanText(element.innerText);
          if (text.length > 100) {
            content = text;
            break;
          }
        }
      }
    }

    // 1. 首先尝试常见的语义化标签
    if (!content) {
      const semanticSelectors = [
        'article',
        'main',
        '[role="main"]',
        // 常见 CMS
        '.post-content', '.entry-content', '.article-content',
        '.content-area', '.main-content',
        // Schema.org 标记
        '[itemprop="articleBody"]',
        // 新闻媒体常见类名
        '.story-body', '.story-content', '.article-body',
        // BEM 命名规范
        '.post__content', '.article__body', '.content__body',
        // 其他常见模式
        '.entry', '.post', '.story'
      ];

      for (const selector of semanticSelectors) {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) {
          const text = cleanText(element.innerText);
          if (text.length > 200) {
            content = text;
            break;
          }
        }
      }
    }

    // 2. 使用启发式算法找最大文本块
    if (!content) {
      const candidates = findTopCandidates();
      if (candidates.length > 0) {
        const bestCandidate = candidates[0];
        const text = cleanText(bestCandidate.innerText);
        if (text.length > 100) {
          content = text;
        }
      }
    }

    // 3. 备用方案：使用 body
    if (!content) {
      const bodyText = cleanText(document.body.innerText);
      if (bodyText.length > 100) {
        content = bodyText;
      }
    }

    // 4. 最后的备用
    if (!content) {
      content = document.title || '';
    }

    // 组合元信息和正文
    const metadataText = formatMetadata(metadata);
    const fullContent = metadataText ? `${metadataText}\n\n---\n\n${content}` : content;

    return {
      content: fullContent,
      metadata: metadata,
      rawContent: content
    };
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
        // 导航和布局
        'nav', 'header', 'footer', 'sidebar', 'menu',
        'breadcrumb', 'pagination', 'toolbar', 'navbar',
        // 广告和推广
        'ad-', 'ads', 'advertisement', 'promo', 'promotion',
        'sponsor', 'banner', 'popup', 'modal', 'overlay',
        // 交互元素
        'comment', 'comments', 'reply', 'replies',
        'share', 'social', 'follow', 'like', 'vote',
        'subscribe', 'newsletter', 'signup', 'form',
        // Cookie 和法律
        'cookie', 'consent', 'gdpr', 'privacy', 'terms',
        'copyright', 'legal', 'disclaimer',
        // 推荐和元信息
        'related', 'recommend', 'suggested', 'similar',
        'popular', 'trending', 'tag', 'category', 'meta',
        'author-bio', 'about-author', 'author-info',
        // 导航和分页
        'prev', 'next', 'read-more', 'see-more', 'load-more',
        'navigation', 'pager', 'pages',
        // 固定和浮动元素
        'sticky', 'fixed', 'floating', 'affix',
        // 其他非内容
        'announcement', 'alert', 'notice', 'warning',
        'widget', 'gadget', 'plugin', 'embed'
      ];

      const shouldSkip = skipPatterns.some(pattern =>
        className.includes(pattern) ||
        id.includes(pattern) ||
        tagName === pattern
      );

      if (shouldSkip) return;

      const textLength = getTextLength(parent);
      if (textLength > 200) {
        // 检查链接密度，过滤导航区域
        const linkDensity = getLinkDensity(parent);
        if (linkDensity > 0.3) return; // 链接密度过高，可能是导航

        candidates.push({
          element: parent,
          textLength: textLength,
          density: getTextDensity(parent),
          linkDensity: linkDensity
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
      // 移除零宽字符
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // 清理行内多余空白（但保留换行和缩进）
      .replace(/[ \t]+/g, ' ')
      // 清理多余空行（最多保留一个空行）
      .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
      // 清理行尾空白
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  // 提取页面元信息
  function extractMetadata() {
    const getMeta = (selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el?.content) return el.content.trim();
        if (el?.textContent) return el.textContent.trim();
      }
      return '';
    };

    return {
      // 标题
      title: document.title || '',
      // 描述
      description: getMeta([
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]'
      ]),
      // 作者
      author: getMeta([
        'meta[name="author"]',
        'meta[property="og:author"]',
        'meta[property="article:author"]',
        '[rel="author"]',
        '.author-name', '.author', '.byline'
      ]),
      // 发布时间
      publishedTime: getMeta([
        'meta[property="article:published_time"]',
        'meta[name="publishedDate"]',
        'meta[name="datePublished"]',
        'time[datetime]'
      ]),
      // 修改时间
      modifiedTime: getMeta([
        'meta[property="article:modified_time"]',
        'meta[name="modifiedDate"]'
      ]),
      // 来源/网站名
      siteName: getMeta([
        'meta[property="og:site_name"]',
        'meta[name="application-name"]'
      ]),
      // 关键词
      keywords: getMeta([
        'meta[name="keywords"]'
      ]),
      // 原文链接
      canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || window.location.href
    };
  }

  // 格式化元信息为文本
  function formatMetadata(metadata) {
    const parts = [];
    if (metadata.title) parts.push(`标题: ${metadata.title}`);
    if (metadata.author) parts.push(`作者: ${metadata.author}`);
    if (metadata.publishedTime) parts.push(`发布时间: ${metadata.publishedTime}`);
    if (metadata.siteName) parts.push(`来源: ${metadata.siteName}`);
    if (metadata.description && metadata.description !== metadata.title) {
      parts.push(`摘要: ${metadata.description}`);
    }
    return parts.join('\n');
  }

  // 将函数挂载到 window 对象，供 popup.js 调用
  window.webReaderExtractContent = extractContent;

  // 同时提供一个直接调用的方式
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractContent };
  }
})();
