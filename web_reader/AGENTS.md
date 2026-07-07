# Web Reader - AI 网页总结（浏览器扩展）

> 本文件面向 AI 编码助手、新贡献者和维护者。阅读前应假设对项目一无所知。
> 项目自然语言为中文，注释和文档主要使用中文，代码标识符使用英文。

---

## 1. 项目概述

**Web Reader** 是一款基于 Chrome/Edge Manifest V3 的浏览器扩展，帮助用户调用自定义 AI API（OpenAI 兼容格式）对当前网页内容进行总结，并支持多轮对话。

- **当前版本**: `1.2.0`
- **技术栈**: 纯原生 JavaScript（ES2020+）、HTML、CSS，无框架、无构建工具
- **运行平台**: Chromium 系浏览器（Chrome、Edge 等），依赖 Chrome Extension API
- **核心能力**:
  - 注入 content script 提取网页正文（支持站点特定规则、语义化标签、启发式算法、用户选中文本优先）
  - 用户可配置多模型、多 Prompt、模型+Prompt 组合
  - 流式 SSE 调用 AI API 并实时渲染 Markdown
  - 多轮对话上下文保持
  - 总结状态 5 分钟内可恢复（切换标签页或 popup 关闭后）
  - 配置导入/导出（JSON 文件、剪贴板、JSON 粘贴）
  - 支持将 popup 在独立窗口中打开

---

## 2. 仓库结构

```
web_reader/
├── manifest.json          # Manifest V3 配置、权限、入口声明
├── background.js          # Service Worker：状态保持、标签页监听
├── content.js             # 内容脚本：注入页面提取正文与元信息
├── popup.html / popup.js  # 扩展弹窗：主交互、API 调用、对话渲染
├── options.html / options.js  # 配置页面：模型/Prompt 增删改、导入导出
├── styles.css             # 全局样式（popup + options 共用）
├── marked.min.js          # 第三方 Markdown 渲染库（已压缩，直接引入）
├── icon-generator.html    # 图标生成工具页（浏览器中打开生成 icon*.png）
├── icon16.png / icon48.png / icon128.png  # 扩展图标
├── project_context.md     # 项目上下文说明（面向 AI/新贡献者）
├── README.md              # 用户文档
├── CHANGELOG.md           # 版本变更记录
├── PRIVACY.md             # 隐私政策
└── .gitignore             # 忽略 macOS/编辑器/Node 构建输出等
```

### 2.1 关键文件职责

| 文件 | 职责 |
|------|------|
| `manifest.json` | 声明扩展名称、版本、权限、Service Worker、content scripts、action popup、options page、CSP。 |
| `background.js` | 通过 `chrome.runtime.onMessage` 接收 `SAVE_SUMMARY_STATE` / `GET_SUMMARY_STATE` / `CLEAR_SUMMARY_STATE` / `SET_LAST_ACTIVE_TAB` / `GET_LAST_ACTIVE_TAB` 消息，维护 `summaryState`（5 分钟过期）和 `lastActiveTab`。 |
| `content.js` | 作为 content script 注入所有 `http://*/*` 和 `https://*/*` 页面，在 `window` 上挂载 `webReaderExtractContent()` 方法。 |
| `popup.js` | 初始化配置选择器、提取页面内容、调用 AI API、渲染聊天消息、管理对话状态、支持独立窗口模式。 |
| `options.js` | 管理 `chrome.storage.local` 中的 `webReaderConfig`，包括模型/Prompt 的增删改复制、旧配置迁移、导入导出。 |
| `styles.css` | 同时服务 popup 和 options 页面；popup 响应式宽度：默认 380px、≥768px 520px、≥1200px 640px。 |

---

## 3. 技术栈与运行时架构

- **无构建工具**：没有 `package.json`、`pyproject.toml`、`Cargo.toml` 或类似的包管理/构建配置文件。
- **无依赖管理器**：`marked.min.js` 以 vendor 方式直接放在仓库根目录。
- **浏览器扩展模型**：Manifest V3
  - `background.service_worker` = `background.js`（`type: module` 但实际为普通脚本）
  - `content_scripts` 注入 `content.js` 到所有 HTTP/HTTPS 页面
  - `action.default_popup` = `popup.html`
  - `options_page` = `options.html`
- **通信方式**：
  - popup ↔ background：`chrome.runtime.sendMessage`
  - popup ↔ content script：`chrome.scripting.executeScript({ target: { tabId }, func })`
- **数据持久化**：`chrome.storage.local`
- **网络请求**：popup 中直接使用 `fetch` 向用户配置的 API URL 发送 OpenAI 兼容的 `chat/completions` 请求，`stream: true`，SSE 解析。

### 3.1 数据流

```
用户点击扩展图标
    │
    ▼
popup.js 加载配置（models / prompts / combinations）
    │
    ▼
用户选择 model + prompt，点击「总结当前页面」
    │
    ▼
popup.js 调用 chrome.scripting.executeScript
    │
    ▼
content.js 中的 window.webReaderExtractContent() 提取正文
    │
    ▼
popup.js 将 User Prompt 中的 {{content}} 替换为正文
    │
    ▼
fetch(currentModel.apiUrl, { stream: true }) → SSE 解析
    │
    ▼
更新 chatHistory → renderChatMessages()
    │
    ▼
定时 SAVE_SUMMARY_STATE 保持状态（5 分钟过期）
```

---

## 4. 存储约定

所有数据保存在 `chrome.storage.local`。

| 键 | 用途 |
|---|---|
| `webReaderConfig` | 主配置 `{ models, prompts, combinations }` |
| `lastUsedModelId` | 上次使用的模型 ID |
| `lastUsedPromptId` | 上次使用的 Prompt ID |
| `webReaderFontSize` | 聊天区域字体大小 |
| `configPanelCollapsed` | 配置面板是否收起 |
| `summaryState` | 当前总结/对话状态（background 维护，5 分钟过期） |
| `windowModeState` | 独立窗口模式的状态快照 |

### 4.1 配置数据结构

```json
{
  "models": [
    { "id": "model_xxx", "name": "...", "apiUrl": "...", "apiKey": "...", "modelCode": "...", "temperature": 0.3 }
  ],
  "prompts": [
    { "id": "prompt_xxx", "shortName": "...", "systemPrompt": "...", "userPrompt": "..." }
  ],
  "combinations": [
    { "id": "combo_xxx", "name": "...", "modelId": "...", "promptId": "...", "isDefault": true }
  ]
}
```

---

## 5. 构建与运行

### 5.1 没有构建命令

本项目没有构建脚本。开发时直接加载源码目录：

1. 打开 Chrome/Edge，进入 `chrome://extensions/`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择 `web_reader` 文件夹。
5. 修改代码后，在扩展管理页面点击刷新按钮重新加载。

### 5.2 图标生成

若需要重新生成图标，可在浏览器中打开 `icon-generator.html`，右键/下载对应尺寸保存为 `icon16.png`、`icon48.png`、`icon128.png`。

### 5.3 测试

- **当前没有自动化测试**（单元测试、集成测试、E2E 测试均未配置）。
- 手动测试流程：
  1. 在 `options.html` 配置模型和 Prompt。
  2. 打开任意网页，点击扩展图标触发 popup。
  3. 选择模型和 Prompt，点击「总结当前页面」。
  4. 验证流式输出、Markdown 渲染、多轮对话、状态恢复、复制、独立窗口、配置导入导出等功能。

---

## 6. 代码风格指南

请遵循现有代码风格：

- **缩进**：2 个空格。
- **分号**：不使用分号（现有代码除 JSON 外基本无分号）。
- **引号**：字符串使用单引号。
- **注释**：使用中文注释说明逻辑和意图；关键分支写清楚原因。
- **变量命名**：
  - 普通变量/函数：camelCase
  - DOM 元素集合对象：`elements`
  - 常量：全大写下划线，如 `DEFAULT_FONT_SIZE`
- **DOM 操作**：popup 和 options 中统一使用 `document.getElementById` 获取元素。
- **异步**：优先使用 `async/await`。
- **错误处理**：API 错误通过 `showError()` 显示；控制台日志使用中文前缀，如 `console.error('保存字体大小失败:', error)`。
- **HTML/CSS**：
  - class 使用 kebab-case。
  - popup 与 options 共用 `styles.css`，options 页面在 `<style>` 中补充自身样式。

---

## 7. 关键开发约定

### 7.1 Content Script 注入限制

`popup.js` 通过 `chrome.scripting.executeScript({ target: { tabId }, func: () => { ... } })` 调用页面方法。`func` 参数会被序列化后注入页面执行，**不能引用外部变量或函数**。因此 fallback 逻辑必须完全内联在 `func` 中。

### 7.2 消息通道

在 `background.js` 中：

- 同步响应的分支不需要 `return true`。
- 异步响应（如 `GET_SUMMARY_STATE` 使用 `chrome.storage.local.get().then(...)`）必须 `return true` 以保持消息通道开放。

### 7.3 Markdown 渲染降级

优先使用 `marked.parse()`；若 `marked` 未加载，使用本地 `escapeHtml()` + `<br>` 降级。

### 7.4 Token 估算

当前简单估算：`Math.ceil(text.length / 2.5)`。不同模型 token 差异较大，后续可替换为精确库。

### 7.5 状态保持

- `summaryState` 在 `background.js` 中保存，5 分钟过期。
- URL 变化时 `background.js` 会清除对应标签页的状态。
- popup 关闭后流式连接会中断；fetch 在 popup 中进行，未下沉到 background。

---

## 8. 安全与隐私

- 所有配置（含 API Key）仅保存在 `chrome.storage.local`，不上传到任何服务器。
- 网页内容仅在用户主动点击「总结」时通过 content script 提取，并直接发送到用户配置的 API 端点。
- `manifest.json` 中 CSP 设置为 `script-src 'self'; object-src 'self'`。
- 权限声明仅包含实现功能所需的最小集合：`activeTab`、`storage`、`scripting`、`windows`、所有 HTTP/HTTPS 主机权限。
- 详细隐私政策见 `PRIVACY.md`。

---

## 9. 已知限制（修改前请先了解）

1. **无构建/打包流程**：所有文件保持可直接在浏览器加载的平面结构。
2. **无自动化测试**：内容提取、配置导入导出等逻辑依赖手动验证。
3. **流式响应无法跨 popup 生命周期保持**：popup 关闭后 fetch 中断。
4. **Token 估算粗略**：按字符数 `/2.5` 估算。
5. **API 格式单一**：仅支持 OpenAI 兼容格式。
6. **Service Worker 全局变量不稳定**：`lastActiveTab` 放在全局变量中，SW 被回收后会丢失。
7. **SPA 动态页面**：内容提取可能在页面未加载完成时不准确。

---

## 10. 常用参考文件

- 用户文档：`README.md`
- 项目上下文/架构细节：`project_context.md`
- 版本变更：`CHANGELOG.md`
- 隐私政策：`PRIVACY.md`

---

*最后更新：2026-06-19（基于 v1.2.0 代码结构）*
