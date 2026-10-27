# Web Reader - AI 网页总结（浏览器扩展）

> 本文件面向 AI 编码助手、新贡献者和维护者。阅读前应假设对项目一无所知。
> 项目自然语言为中文，注释和文档主要使用中文，代码标识符使用英文。

---

## 1. 项目概述

**Web Reader** 是一款基于 Chrome/Edge Manifest V3 的浏览器扩展，帮助用户调用自定义 AI API（OpenAI 兼容格式）对当前网页内容进行总结，并支持多轮对话。

- **当前版本**: Manifest 仍为 `1.2.0`；当前新增能力记录于 `CHANGELOG.md` 的 `Unreleased`
- **技术栈**: 纯原生 JavaScript（ES2020+，PDF.js 使用现代浏览器 API）、HTML、CSS，无框架、无构建工具
- **运行平台**: Chromium 系浏览器（最低 Chrome 内核 151），自动 PDF 接管需实现 `chrome.mimeHandler`
- **核心能力**:
  - 注入 content script 提取网页正文（支持站点特定规则、语义化标签、启发式算法、用户选中文本优先）
  - 独立管理多模型和阅读任务（底层仍使用 `prompts` 字段），已移除旧组合
  - 在线及本地文字型 PDF 阅读与划词，自动接管可关闭；支持页码、缩放、搜索，不做 OCR 或全文总结
  - 普通网页划词按钮和流式任务卡片：选择已有 Prompt、切换模型、停止、重试、复制与关闭取消
  - 内置快速摘要、详细解读、翻译模板；支持任务首页显示、排序和删除撤销
  - 支持停止生成、按原始输入重新生成，以及首轮/追问独立 Thinking 设置
  - 流式 SSE 调用 AI API 并实时渲染 Markdown
  - 多轮对话上下文保持
  - 总结状态 5 分钟内可恢复（切换标签页或 popup 关闭后）
  - 配置导入/导出（JSON 文件、剪贴板、JSON 粘贴）
  - 支持将 popup 在独立窗口中打开
  - 阅读模式、正文独立滚动、回到最新、跟随系统深色主题

---

## 2. 仓库结构

```
web_reader/
├── manifest.json          # Manifest V3 配置、权限、入口声明
├── background.js          # Service Worker：状态保持、标签页监听
├── pdf-reader.html/js/css # PDF.js 阅读器及现有划词脚本的复用入口
├── pdf-selection.js       # PDF 空白起选定位、滚动扩选与手势清理
├── pdf-highlight.js       # 按 PDF 基线、字体字形度量绘制可视高亮
├── pdf-background.js      # Chrome 原生 PDF MIME 接管偏好同步
├── vendor/pdfjs/          # PDF.js 6.4.299、Worker、字体/CMap/Wasm、许可证
├── selection-background.js # 独立划词助手请求、流式回传及取消
├── selection-translate.js  # 网页划词入口和 Shadow DOM 任务卡片
├── content.js             # 内容脚本：注入页面提取正文与元信息
├── popup.html / popup.js  # 扩展弹窗：主交互、API 调用、对话渲染
├── options.html / options.js  # 配置页面：模型/Prompt 增删改、导入导出
├── reader-core.js         # 共用任务模板、配置迁移、请求参数、SSE、Token 逻辑
├── tests/                 # 核心逻辑、Markdown 与模拟 API 浏览器回归
├── marked.LICENSE.md      # Marked 的 MIT 许可证
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
| `reader-core.js` | popup 和 options 共用的 `ReaderCore`；纯逻辑通过 CommonJS 导出供 Node 测试使用。 |
| `styles.css` | 同时服务 popup 和 options；popup 为 440×590，独立窗口自适应，支持系统深色主题。 |

---

## 3. 技术栈与运行时架构

- **无构建工具**：没有 `package.json`、`pyproject.toml`、`Cargo.toml` 或类似的包管理/构建配置文件。
- **PDF 资源**：`vendor/pdfjs/` 为官方 `pdfjs-dist@6.4.299` 预编译资源，Apache-2.0；核心、Worker 和 Viewer 版本须一致。
- `vendor/pdfjs/build/pdf.min.mjs` 和 `pdf.worker.min.mjs` 是运行资源，必须纳入 Git；`.gitignore` 的通用 `build/` 规则须保留此目录的例外。验证交付时使用 Git 跟踪文件的干净副本，不能只在含未跟踪资源的开发目录里测试。
- **运行无需安装依赖**：官方 Marked 17.0.5 UMD 文件直接放在仓库根目录；浏览器回归另需 Playwright 和本机 Chrome。
- **浏览器扩展模型**：Manifest V3
  - `background.service_worker` = `background.js`（`type: module`，导入共用核心、划词后台及 PDF 偏好同步模块）
  - `content_scripts` 注入 `content.js` 与 `selection-translate.js` 到 HTTP/HTTPS 主文档
  - `action.default_popup` = `popup.html`
  - `options_page` = `options.html`
- **通信方式**：
  - popup ↔ background：`chrome.runtime.sendMessage`
  - popup ↔ content script：`chrome.scripting.executeScript({ target: { tabId }, func })`
- **数据持久化**：`chrome.storage.local`
- **网络请求**：总结/对话由 popup，划词助手由 background 使用 `fetch` 向用户配置的 API URL 发送 OpenAI 兼容的 `chat/completions` 请求，`stream: true`，SSE 解析。

### 3.1 数据流

```
用户点击扩展图标
    │
    ▼
popup.js 加载配置（models / prompts / readingTasksVersion）
    │
    ▼
用户选择模型，点击阅读任务按钮或运行选中的任务
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
ReaderCore.buildRequest → fetch → ReaderCore.readSSE
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
| `webReaderConfig` | 主配置 `{ models, prompts, readingTasksVersion: 2 }` |
| `lastUsedModelId` | 上次使用的模型 ID |
| `lastUsedPromptId` | 上次使用的 Prompt ID |
| `lastUsedSelectionPromptId` | 划词卡片上次执行的任务，不改变弹窗任务选择 |
| `pdfAutoOpen` | 原生 PDF 接管开关，默认 false；独立本机偏好，不随模型/任务导出 |
| `selectionDefaultAction` | 划词图标点击行为：`{ mode: "panel" }`（缺省）或 `{ mode: "task", promptId }`；独立界面偏好，不随配置导出 |
| `webReaderFontSize` | 聊天区域字体大小 |
| `configPanelCollapsed` | 配置面板是否收起 |
| `summaryState` | 当前总结/对话状态（background 维护，5 分钟过期） |
| `windowModeState` | 独立窗口模式的状态快照 |

### 4.1 配置数据结构

```json
{
  "models": [
    {
      "id": "model_xxx", "name": "我的模型", "apiUrl": "https://example.com/v1/chat/completions",
      "apiKey": "", "modelCode": "model-code", "temperature": 0.3,
      "thinkingMode": "auto", "thinkingFirst": false, "thinkingFollowup": true, "includeUsage": true
    }
  ],
  "prompts": [
    {
      "id": "prompt_xxx", "shortName": "摘要", "systemPrompt": "你是阅读助手",
      "userPrompt": "请总结以下内容：\n\n{{content}}", "showAsTask": true
    }
  ],
  "readingTasksVersion": 2
}
```

- `prompts` 数组顺序决定任务下拉框及首页按钮顺序；只有 `showAsTask` 为真才显示首页按钮。
- `ReaderCore.prepareConfig()` 移除旧 `combinations`、设置版本标记，保留已有任务内容、顺序和显示设置，不补充模板。
- 首次在设置页初始化时创建一个 API 地址和 Key 留空的 Qwen3-Next 模型及三个任务；已有用户须主动从模板添加独立副本。
- 选择器记住上次使用项；首次使用或选中项已删除时回退到列表第一项。
- 导出格式 `version: '2.0'` 与扩展版本独立；包含导出时间、模型、任务及结构版本。导入替换当前配置，接受含旧组合字段的模型/任务文件，但不保留组合。

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

- 核心及 Markdown 回归：`node --test tests/*.test.js`，使用 Node 内置测试运行器，无需安装依赖。
- `tests/pdf-assets.test.js` 检查 PDF.js 核心/Worker/Viewer 文件、版本与构建标记一致，并检查 Git 跟踪及忽略规则；无 Git 元数据的源码导出只跳过 Git 检查。
- `tests/reader-core.test.js` 覆盖配置迁移、Thinking、SSE 任意字节分块/中文解码/结束事件、usage 与估算累计。
- `tests/markdown.test.js` 覆盖列表、段落、引用、代码缩进及流式重复解析；样例在 `tests/fixtures/summary.md`。
- 浏览器回归：安装 Playwright 且本机有 Chrome 后运行 `node tests/browser-smoke.cjs`，也可通过 `PLAYWRIGHT_MODULE_PATH` 指向已有模块。测试模拟 Chrome API 和模型响应，不调用真实模型，也不能替代真实扩展环境验证。
- 划词浏览器回归：`node tests/selection-browser.cjs`，连接真实划词脚本与后台处理器，模拟 Chrome 通道及模型服务，验证卡片与取消流程。环境要求同上。
- PDF 真实拖选回归：`node tests/pdf-selection-browser.cjs`，使用真实鼠标，验证高 DPI、连续重选、正反向/跨行/跨页、行首及段间空白、自动滚动、缩放、Shift 与精确双击单词；在 100%/150% 缩放下对照画布字形像素验证紧行距、页下方粗体及混合字号，并验证搜索嵌套高亮不重复绘制。不得仅用 `Range.addRange()` 代替手势验证。
- PDF 真扩展回归：`node tests/pdf-browser.cjs`，需 Chrome 151+ 和 Playwright，真实加载扩展到临时浏览器配置，本地 HTTP 服务模拟 PDF 和模型；不使用用户浏览器资料或真实模型。
- 手动测试流程：
  1. 在 `options.html` 配置模型和 Prompt。
  2. 打开任意网页，点击扩展图标触发 popup。
  3. 选择模型，运行快速摘要、详细解读、翻译或自定义阅读任务。
  4. 验证流式输出、停止/重试、Thinking、Token 显示、Markdown、多轮对话、状态恢复、复制、独立窗口和配置导入导出。

---

## 6. 代码风格指南

请遵循现有代码风格：

- **缩进**：2 个空格。
- **分号**：新增代码不使用分号；部分旧文件仍保留分号，避免无关的全文件格式化。
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

使用本地官方 Marked 17.0.5：`marked.parse(text, { breaks: false, gfm: true })`；未加载时用 `escapeHtml()` + `<br>` 降级。不要自动补引用或列表缩进，保持原始 Markdown 的块级结构；修改后运行 Markdown 回归。保留 `marked.LICENSE.md`。

### 7.4 Token 估算

- 默认请求 `stream_options: { include_usage: true }`，模型可用 `includeUsage: false` 关闭。
- usage 按累计快照覆盖，兼容输入/输出别名，保留 0；缓存与思考属于输入/输出明细，不重复累加。
- 缺失分项优先由 API 总数和已知分项推导，再按 `Math.ceil(text.length / 2.5)` 估算；输入覆盖实际发送的全部历史，估算用 `≈` 标记。
- 会话累计包含重试与收到响应后的中断请求；中断记录不完整标记，不代表最终账单。

### 7.5 状态保持

- `summaryState` 在 `background.js` 中保存，只有一份快照，5 分钟过期；恢复需匹配 tabId 和 URL。
- 快照包含 `chatHistory`、`lastRequest`、`generationStatus`、`totalTokens`、模型/任务选择及加载/错误状态；流式正文更新时节流约 500ms 保存。
- URL 变化时 `background.js` 会清除对应标签页的状态。
- 总结/对话的 fetch 仍在 popup 中，关闭后会中断；划词助手通过独立 Port 在后台执行，卡片关闭或页面离开时取消。

### 7.6 Thinking、停止与重试

- `thinkingMode` 为 `auto | custom | default`：auto 仅对 ModelScope 域名发送顶层 `enable_thinking`，custom 显式发送，default 跟随服务且不发送。
- `thinkingFirst` / `thinkingFollowup` 缺省为 false / true；旧 `on` / `off` 兼容为两轮同值，新开关可分别覆盖。
- 轮次按请求中 user 消息数判断；重新生成保留原始输入和原轮次，替换本轮回答，不重复追加提问。
- 停止使用 `AbortController`，保留部分输出；重试按 `lastRequest.modelId` 查找原模型配置。切换模型后需重新运行任务才能开始新的模型会话。

### 7.7 网页划词助手

- 卡片只常驻一行工具栏：任务、运行/停止、复制、调节菜单和关闭；模型、原文与设置入口收进浮层，不压缩正文，无底部操作栏。
- `selection-translate.js` 检测主文档选区，忽略输入框及可编辑区域，Shadow DOM 隔离 UI；结果只用 `textContent` 显示。
- 28×28 图标打开卡片，通过 `web-reader-selection` Port 获取模型/任务名称和 ID；缺省只开面板，点击运行才发请求；可在设置页选择点击图标后直接运行指定任务。选区检测不发网络请求。
- `selection-background.js` 从本地配置取端点/Key，复用本地 `prompts`（包括隐藏任务）、`ReaderCore` 请求参数和 SSE；无任务时临时提供内置模板；不接受内容脚本指定端点或 Key。
- 每个连接仅一个活跃请求；切换模型/任务取消旧请求并等待手动生成，重新生成取消旧请求，消息带请求 ID 防止旧输出覆盖新结果，断开连接时取消。
- 卡片默认使用 `lastUsedModelId` 或第一个模型；临时模型选择不写回；任务执行后单独保存 `lastUsedSelectionPromptId`，首次参考 `lastUsedPromptId` 或第一项。结果不持久化，不改写 `summaryState` 或 popup Token 累计。
- `selectionDefaultAction` 的默认任务优先于上次任务；默认任务已删除或无模型时不自动调用 API。设置页「划词助手」标签即时保存，已打开网页下次点击图标时读取新偏好。
- 最大 12000 字符，超限报错不截断；请求两分钟超时。生成期间定时 Port 消息维持活跃，仍受浏览器后台生命周期约束。
- 普通网页脚本不支持浏览器内部页或 iframe 内选区；PDF 从本扩展阅读器复用同一划词脚本；加载更新后需刷新已有网页。

---

### 7.8 PDF 阅读器与自动接管

- `mime_types_handler` 注册顶层 `application/pdf → pdf-reader.html`，最低 Chrome 151，`can_embed: false`。自动接管默认关闭，由 `pdf-background.js` 在启动、安装与 `pdfAutoOpen` 变化时串行同步原生 handler 选项。
- 设置页 PDF 标签切换原生开关并保存本机偏好；不支持 API 时禁用开关并保留手动入口。不增加 file:// 主机权限。
- MIME 阅读器通过 `getStreamInfo()` 取得一次性 streamUrl，完整读取 Chrome 已接收的响应；不重新请求 originalUrl。选择本地文件通过 File API 读取；手动在线地址交给 PDF.js 加载，附带站点凭据，失败可下载后本地打开。
- PDF 页必须使用 `box-sizing: content-box`，避免全局 border-box 将画布挤小，导致文字层与画布在页下方累积偏移。`enableSelectionRendering: false` 禁用 PDF.js 行框 SVG；选区交互/复制仍走浏览器，`pdf-highlight.js` 按 PDF 文字基线与实际字体、字重、字形度量绘制高亮；不可映射、旋转/竖排及 Type3 等情况保留原生反馈。按 rAF 合并绘制，只处理可见页面，切换文档/销毁文字层时清理。回归须对照画布实际字形像素，不能只验证透明文字层边界。
- 拖选期间共享划词脚本不读取选区/布局，松手后处理。不可选占位层不接收指针；`pdf-selection.js` 仅接管无修饰键鼠标从空白起选的手势，按最近文字几何定位 caret，避免误带上一段；文字内拖选、双击及 Shift 保留原生行为。几何按页/手势缓存，rAF 合并更新，支持滚动扩选及释放、取消、失焦清理。新手势释放旧范围。
- `pdf-reader.js` 使用官方 PDFViewer 的连续滚动、渲染队列、文字层、链接和查找组件；资源全部本地，`isEvalSupported: false`，不加载 scripting sandbox。扫描件不做 OCR；密码文件提示先解密。
- `selection-background.js` 只额外信任本扩展精确的 `/pdf-reader.html` 页面（含查询/片段），不对其他扩展页面或任意 chrome-extension URL 放开；MIME 页面可以没有 sender.tab。
- 保持选区处理，不从阅读器自动发送整份文件或第二页文字。「浏览器查看」回退调用原生接口，可能重新请求文件。普通网页与 PDF 的划词任务和默认事件共用。

## 8. 安全与隐私

- 配置（含 API Key）保存在 `chrome.storage.local`；调用模型时 Key 随 Authorization 请求头发送到用户配置的 API 端点。配置导出也包含 Key，应避免在日志或测试输出中泄露。
- 总结正文仅在运行阅读任务时提取；划词在本地检测选区，手动运行或点击配置为自动执行的图标后，才发送所选文本到配置的 API 端点。
- `manifest.json` 中 CSP 设置为 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`（Wasm 仅用于本地 PDF.js 解码资源）。
- 权限声明仅包含实现功能所需的最小集合：`activeTab`、`storage`、`scripting`、`windows`、所有 HTTP/HTTPS 主机权限。
- 详细隐私政策见 `PRIVACY.md`。

---

## 9. 已知限制（修改前请先了解）

1. **无构建/打包流程**：所有文件保持可直接在浏览器加载的平面结构。
2. **测试覆盖有限**：已有核心与模拟浏览器回归；真实页面提取、扩展权限/生命周期及真实服务兼容性仍需手动验证。
3. **总结流式响应无法跨 popup 生命周期保持**：总结/对话的 popup 关闭后 fetch 中断；划词助手使用独立后台请求。
4. **缺失 usage 时估算粗略**：按字符数 `/2.5` 估算，不等同于平台账单。
5. **API 格式单一**：仅支持 OpenAI 兼容格式。
6. **Service Worker 全局变量不稳定**：`lastActiveTab` 放在全局变量中，SW 被回收后会丢失。
7. **单份会话快照**：不同标签页的总结会覆盖同一个 `summaryState`，不是多会话历史。
8. **SPA 动态页面**：内容提取可能在页面未加载完成时不准确。

---

## 10. 常用参考文件

- 用户文档：`README.md`
- 项目上下文/架构细节：`project_context.md`
- 版本变更：`CHANGELOG.md`
- 隐私政策：`PRIVACY.md`

---

*最后更新：2026-10-27（Manifest v1.2.0 + 当前 Unreleased 实现）*
