# Web Reader - 项目上下文（Project Context）

> 面向 AI 助手、新贡献者和维护者，说明当前实现、数据流与开发边界。编码约定见 `AGENTS.md`，用户操作见 `README.md`。

## 1. 项目定位与版本

Web Reader 是 Chrome / Edge Manifest V3 浏览器扩展，调用用户配置的 OpenAI 兼容 API，对网页进行摘要、解读、翻译，并支持多轮追问。

- Manifest 当前版本为 `1.2.0`；本文包含工作区已实现、记录在 `CHANGELOG.md` 的 `Unreleased` 能力，不表示已发布新版本。
- 使用原生 JavaScript、HTML、CSS，无框架和构建步骤，直接加载源码目录运行。
- 配置、API Key 和会话快照保存在 `chrome.storage.local`；模型请求直接发往用户配置的端点，不经过开发者服务器。
- 只支持 OpenAI 兼容请求格式；接入 Claude、Gemini 等模型需要兼容网关，不支持其原生协议。

## 2. 当前功能

| 功能 | 实现说明 |
|---|---|
| 正文提取 | 优先选中文本，其次站点规则、语义标签、文本密度算法及回退策略 |
| PDF 阅读与划词 | 在线/本地文字型 PDF；原生自动接管可关闭，滚动、页码、缩放、搜索，复用划词卡片；无 OCR/全文总结 |
| 网页划词助手 | 28×28 图标打开卡片，单行工具栏、可手动生成或配置图标点击后直接运行指定 Prompt，支持临时切换模型、停止、重试、复制与关闭取消 |
| 模型配置 | 独立维护名称、API URL、Key、模型代码、Temperature、Thinking 和流式 usage 开关 |
| 阅读任务 | 底层保留 `prompts` 字段，提供快速摘要、详细解读、翻译模板和自定义任务 |
| 任务管理 | 首页显示开关、拖拽/键盘/菜单排序、复制、删除后 12 秒撤销；System Prompt 在高级设置 |
| 流式生成 | SSE 实时显示，支持停止并保留部分内容、按本轮原始输入重新生成 |
| 多轮对话 | 保留 system、首轮输入及后续消息；system 与首轮 user 输入不在聊天区显示 |
| Markdown | 本地官方 Marked 17.0.5，按原始列表、引用、段落和代码结构解析 |
| Token 统计 | 优先使用 API usage，逐项推导或估算，显示输入/输出/合计及缓存/思考明细 |
| 状态恢复 | 保存最近一份会话快照，5 分钟内按标签页及 URL 匹配恢复 |
| 阅读界面 | 生成及恢复后收起任务区，浮层切换任务；正文独立滚动、固定输入区、回到最新、字体调整 |
| 窗口和主题 | popup 为 440×590，独立窗口自适应，跟随系统浅色/深色主题 |
| 配置迁移 | JSON 文件或剪贴板导出，文件或粘贴 JSON 导入；保留旧模型与任务，移除旧组合 |

## 3. 文件与运行架构

| 文件 | 职责 |
|---|---|
| `manifest.json` | MV3 入口、权限、CSP、图标；注册 background、content script、popup 和 options |
| `background.js` | 会话快照读写、5 分钟过期检查、来源标签页记录、URL 变化清理 |
| `pdf-reader.html` / `pdf-reader.js` / `pdf-reader.css` | PDF 阅读器外壳及 PDF.js 官方 Viewer 组件，复用划词脚本 |
| `pdf-selection.js` | PDF 空白起选的文字几何定位、滚动扩选及手势清理 |
| `pdf-highlight.js` | PDF 基线与实际字体字形度量高亮，原生选区用于交互和复制 |
| `pdf-background.js` | 启动/安装/偏好变化时同步原生 MIME 接管开关 |
| `vendor/pdfjs/` | 官方 pdfjs-dist@6.4.299 预编译资源及 Apache-2.0 许可证 |
| `tests/pdf-background.test.js` / `tests/pdf-browser.cjs` | PDF 设置同步单测及真实加载扩展的浏览器回归 |
| `selection-translate.js` | 主文档选区监听及 Shadow DOM 任务卡片，动态文字仅按纯文本显示 |
| `selection-background.js` | 划词 Port 通道、本地模型读取、独立流式请求与取消 |
| `content.js` | 挂载 `window.webReaderExtractContent()`，返回正文、元信息、原始内容及选中标记 |
| `reader-core.js` | 共用任务模板、配置结构迁移、Thinking 请求参数、SSE、usage 归一化/累计/显示 |
| `popup.html` / `popup.js` | 模型/任务选择、页面提取、请求、对话、渲染、重试、状态与独立窗口 |
| `options.html` / `options.js` | 配置初始化、模型和任务编辑、模板复制、排序、删除撤销及导入导出 |
| `styles.css` | 弹窗和设置页共用样式、阅读布局、系统主题；设置页另有内联补充样式 |
| `marked.min.js` / `marked.LICENSE.md` | 本地 Marked UMD 文件及 MIT 许可证，无需 CDN |
| `tests/reader-core.test.js` | 共用逻辑回归 |
| `tests/markdown.test.js` / `tests/fixtures/summary.md` | Markdown 结构回归和样例 |
| `tests/selection-background.test.js` | 划词请求、取消、错误、模型隔离与连接来源回归 |
| `tests/selection-browser.cjs` | 页面划词卡片与真实后台处理器联动回归，模拟 Chrome 通道及模型响应 |
| `tests/browser-smoke.cjs` | 使用 Playwright、模拟 Chrome API 和模型响应的浏览器回归 |
| `icon-generator.html` / `icon*.png` | 图标生成工具及扩展图标 |
| `README.md` / `CHANGELOG.md` / `PRIVACY.md` | 用户说明、版本变更和隐私政策 |

`popup.html` 依次加载 `marked.min.js`、`reader-core.js`、`popup.js`；设置页先加载 `reader-core.js` 再加载 `options.js`。`ReaderCore` 在浏览器中作为共用变量使用，同时通过 CommonJS 导出供 Node 测试加载。background 为 module，导入 `reader-core.js`、`selection-background.js` 与 `pdf-background.js`；核心通过 `globalThis.ReaderCore` 提供给后台模块。

权限为 `activeTab`、`storage`、`scripting`、`windows`，以及 HTTP/HTTPS 主机权限。CSP 为 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`，Wasm 用于本地 PDF.js 解码；Manifest 最低 Chrome 151。

## 4. 主数据流

```text
加载配置并迁移结构 → 恢复上次模型/任务选择 → 尝试恢复匹配的会话
    ↓
点击阅读任务 → chrome.scripting.executeScript → content.js 提取正文
    ↓
用正文替换 User Prompt 的 {{content}} → 初始化 system + user 历史
    ↓
ReaderCore.buildRequest → popup 中 fetch → ReaderCore.readSSE
    ↓
更新 assistant 内容和 usage → Markdown 渲染 → 节流保存会话快照
    ↓
完成 / 停止 / 失败 → 结算本轮 Token → 保存最终状态 → 可追问或重试
```

### 4.1 页面提取

`content.js` 自动注入 HTTP/HTTPS 页面。正文提取优先级为：

1. 用户选中文本（超过 10 字符）。
2. 站点规则，如 GitHub、知乎、掘金、CSDN、微信公众号。
3. `article`、`main` 和常见正文类名。
4. 文本密度、链接密度等启发式算法。
5. `body.innerText`，最终回退到标题。

同时提取标题、作者、发布时间、来源、描述等元信息并清理文本。popup 调用脚本时另有完全内联的 fallback，在 content script 不存在时提取常见正文元素，最多保留约 15000 字符；不要将此上限理解为所有提取路径都统一截断。运行任务时，popup 对少于 50 字符的结果报错。

`executeScript` 的 `func` 会被序列化注入，不能引用 popup 外部变量或函数。

### 4.2 生成、停止与重试

- 新运行阅读任务会开始新会话，重置对话及累计 Token。
- `chatHistory` 保留完整上下文；发请求时只发送各消息的 `role` 和 `content`。
- `lastRequest` 保存 `messages`、`history` 和 `modelId`，重试从快照重建输入，替换本轮回答，不重复追加用户消息或发送半截回答。
- 重试按保存的模型 ID 查找当前配置；原模型被删除则提示重新运行任务。切换选择器不会改变重试模型，需重新运行任务开启新的模型会话。
- 停止使用 `AbortController`，保留已生成内容。恢复时若快照仍标记加载中，提示上次生成已中断，可重新生成。
- 首轮结束回到正文开头；多轮阅读时避免强制滚到底部，提供「回到最新」。

### 4.3 SSE 与 Markdown

`ReaderCore.readSSE()` 用流式 `TextDecoder` 保留跨字节分块的 UTF-8 字符，并缓存半行；支持 CRLF / CR / LF、多行 data、`[DONE]` 及无末尾换行的事件。无正文的末尾 usage 也会处理；损坏 JSON 明确报错。

Markdown 使用 `marked.parse(text, { breaks: false, gfm: true })`，不自动给引用或列表补缩进。列表内引用须由源 Markdown 正确缩进，顶格段落/引用按独立块处理。库未加载时用 `escapeHtml()` 和 `<br>` 降级。

### 4.4 网页划词助手

`selection-translate.js` 随 content script 加载到 HTTP/HTTPS 主文档。选中文字后显示 28×28 的书本图标，点击通过 `web-reader-selection` Port 打开卡片，取得模型/任务的 ID、名称与默认点击行为。缺省只开面板，点击运行才请求；设置为指定任务时直接运行。任务、运行/停止、复制、调节菜单与关闭合并为顶部一行，模型和原文收进不挤占正文的浮层，移除底栏。

任务读取本地全部 `prompts`，包括未在首页显示的任务；为空时临时提供 `ReaderCore.defaultTasks`，不写回配置。执行时使用保存的 System/User Prompt，替换全部 `{{content}}`；没有占位符时附加选区文本。卡片只传模型/任务 ID，端点、凭证和任务正文均由后台从配置读取。

`selectionDefaultAction` 为独立本机界面偏好，设置页「划词助手」即时保存，默认 `{ mode: "panel" }`，自动执行为 `{ mode: "task", promptId }`，不随模型/任务导出。指定任务优先于上次任务；被删除时退回仅打开并显示原因，无模型时提示配置。每次打开卡片重新读取。

模型默认使用 `lastUsedModelId` 或首项，临时切换不改变弹窗偏好。划词任务单独保存为 `lastUsedSelectionPromptId`；无有效记录时参考 `lastUsedPromptId`，再回退到首项。单次最多 12000 字符，超限明确报错；请求两分钟超时。生成期间内容脚本每 20 秒发送 Port 消息维持活跃。

每个连接只有一个活跃请求，通过请求 ID 忽略旧响应。切换模型/任务取消旧请求并等待手动生成，重新生成、关闭卡片、离开页面也会取消旧请求。结果不持久保存，不修改总结快照和 Token 累计。输入框、可编辑区域不弹入口；普通页面不支持 iframe 选区和浏览器内部页；PDF 通过本扩展阅读器接入同一划词脚本。扩展更新后需刷新原网页加载脚本。

### 4.5 PDF 阅读器

Manifest 使用 Chrome 151+ 的 `mime_types_handler`，将顶层 `application/pdf` 注册到 `pdf-reader.html`，不接管嵌入式 PDF。`pdfAutoOpen` 默认 false，在设置页 PDF 标签即时保存，后台串行同步原生开关。未实现 `chrome.mimeHandler` 的浏览器保留手动文件和 URL 入口，禁用自动接管开关。

自动接管时，阅读器用 `getStreamInfo()` 获得 `originalUrl` 和一次性 `streamUrl`，读取浏览器已接收的原始响应；无需二次 GET，适用于单次链接。在线及本地文件都可使用此方式，不要求 file:// 访问权限。手动本地文件用 File API；手动 URL 交给 PDF.js 加载，支持 HTTP/HTTPS；file:// 直接读取失败时引导选择文件。加载新文件会销毁旧文档和任务，避免旧结果覆盖。

本地打包 PDF.js 6.4.299 的核心、Worker、PDFViewer 组件、文字层样式/图像、字体、CMap 和 Wasm/ICC 数据。不加载 scripting sandbox，禁用 eval。Viewer 提供连续滚动与渲染队列、缩放、页码跳转、搜索和文字选择；不做 OCR、全文总结或密码解密。

PDF 页使用 `box-sizing: content-box`，防止全局 border-box 将画布挤小，造成与文字层坐标累积偏移。`enableSelectionRendering: false` 禁用 PDF.js 行框 SVG；浏览器选区负责交互与复制，`pdf-highlight.js` 按 PDF 基线和实际字体/字重的字形度量绘制可视高亮，支持混合字号，rAF 合并更新并只处理可见页。无法映射、旋转/竖排及 Type3 字体保留原生反馈；销毁文字层/切换文档时清理。回归比较画布真实字形像素与高亮边界，包括页下方粗体标题，而非仅检查文字层框。

无修饰键的左键重新起选会释放旧范围；不可选占位层不接收指针。`pdf-selection.js` 仅接管鼠标从空白起选的手势，按最近文字几何定位 caret，避免段间空白误落到上一段；文字内拖选、双击及 Shift 仍走原生行为。几何按页/手势缓存，rAF 合并更新，支持滚动扩选及释放、取消、失焦清理。划词脚本在拖选期间不安排解析，松手后按活动 caret 端点定位图标。

阅读器加载原有 `selection-translate.js`，共用任务、模型与图标默认事件。后台仅信任本扩展精确阅读器路径，并允许 MIME frame 不带 sender.tab，仍拒绝其他扩展页面。仅发送用户执行任务时的选区和指令，PDF 本身不发送给模型。原生「浏览器查看」回退可能重新请求 URL。

## 5. 配置与存储

主配置键为 `webReaderConfig`：

```json
{
  "models": [
    {
      "id": "model_xxx",
      "name": "我的模型",
      "apiUrl": "https://example.com/v1/chat/completions",
      "apiKey": "",
      "modelCode": "model-code",
      "temperature": 0.3,
      "thinkingMode": "auto",
      "thinkingFirst": false,
      "thinkingFollowup": true,
      "includeUsage": true
    }
  ],
  "prompts": [
    {
      "id": "prompt_xxx",
      "shortName": "摘要",
      "systemPrompt": "你是阅读助手",
      "userPrompt": "请总结以下内容：\n\n{{content}}",
      "showAsTask": true
    }
  ],
  "readingTasksVersion": 2
}
```

### 5.1 初始化、迁移和导入导出

- 无配置时，设置页初始化一个 Qwen3-Next 模型（API URL、Key 留空）和三个内置任务。
- `prompts` 顺序决定下拉列表与首页按钮顺序；首页只显示 `showAsTask` 为真的任务，隐藏任务仍可在下拉列表运行。
- `ReaderCore.prepareConfig()` 删除旧 `combinations` 并设置 `readingTasksVersion: 2`，不修改任务原文、顺序或显示设置，不补模板。
- 最早的单模型配置由设置页迁移为模型和任务数组。
- 模板仅在首次初始化或用户主动「从内置模板添加」时复制；更新内置模板不会覆盖已有任务。
- 已移除默认组合与默认标识；记住上次选择，选项失效时使用列表第一项。
- 导出包含 `version: '2.0'`、`exportDate`、模型、任务和结构版本，与 Manifest 版本独立。
- 导入校验数组、必要字段、重复 ID 和 Temperature 范围；当前有模型或任务时确认后整体替换。旧文件中的组合不保留。
- 配置导出含 API Key，调试和分享时应避免泄露。

### 5.2 其他存储与状态

| 键 | 用途 |
|---|---|
| `lastUsedModelId` / `lastUsedPromptId` | 弹窗上次使用的模型和任务 |
| `lastUsedSelectionPromptId` | 划词卡片上次执行的任务 |
| `pdfAutoOpen` | 原生 PDF 自动接管，本机偏好，缺省 false，不随配置导出 |
| `selectionDefaultAction` | 图标点击后只开面板或自动执行指定任务的本机偏好 |
| `webReaderFontSize` | 聊天区字体大小 |
| `configPanelCollapsed` | 配置面板折叠偏好 |
| `summaryState` | 最近一份会话快照，由 background 保存，读取时检查 5 分钟过期 |
| `windowModeState` | 转移到独立窗口的临时快照，检查过期，成功恢复后移除 |

`summaryState` 包含 tabId、URL、标题、模型/任务 ID、`chatHistory`、`lastRequest`、`generationStatus`、`totalTokens`、加载/错误状态和时间戳。流式正文更新时约每 500ms 节流保存，开始及结束也保存。恢复需匹配当前 tabId 和 URL；URL 改变时 background 清除对应旧状态。

background 消息为 `SAVE_SUMMARY_STATE`、`GET_SUMMARY_STATE`、`CLEAR_SUMMARY_STATE`、`SET_LAST_ACTIVE_TAB`、`GET_LAST_ACTIVE_TAB`。异步回复分支须 `return true` 保持消息通道。`lastActiveTab` 只在 Service Worker 内存中维护。

## 6. 模型参数与 Token

### 6.1 请求和 Thinking

请求发送到配置中的完整 `apiUrl`，使用 POST JSON、Bearer Key、`stream: true`；Temperature 默认 0.3，设置页允许 0～2。

| `thinkingMode` | 参数行为 |
|---|---|
| `auto`（缺省） | 仅对 `modelscope.cn` 及其子域名发送顶层 `enable_thinking` |
| `custom` | 显式发送顶层 `enable_thinking` |
| `default` | 跟随服务默认，不发送该参数 |
| 旧 `on` / `off` | 兼容为两轮都开启 / 关闭，显式的新开关可分别覆盖 |

`thinkingFirst` 缺省 false，`thinkingFollowup` 缺省 true。轮次按实际请求中的 user 消息数量判断；重试保持原轮次，重新运行任务开始首轮。直接 fetch 的字段位于 JSON 顶层，不嵌套在 SDK 的 `extra_body` 中。

### 6.2 usage 统计

- `includeUsage` 缺省 true，请求 `stream_options: { include_usage: true }`；不兼容服务可单独关闭。
- 归一化 `prompt_tokens` / `completion_tokens` / `total_tokens`，兼容 `input_tokens` / `output_tokens` 及缓存/思考字段。
- 每块 usage 作为本轮累计快照覆盖，不逐块相加；0 有效，null 不覆盖已知值。
- 已知总数及一个分项时推导另一个；缺失项按字符数 `/2.5` 向上取整估算。输入估算覆盖实际发送的全部历史，输出估算包含收到的 reasoning 文本和正文。
- 缺失分项用 `≈` 标记；仅有平台合计时保留该合计，分项单独估算。缓存和思考作为输入/输出组成部分展示，不重复计费累计。
- 会话累计包括重试、收到响应后的失败或停止请求。中断请求标记不完整，仅反映已收到的数据，不代表最终账单；旧累计来源不明时保守显示估算。

## 7. 运行、测试与调试

无需构建或安装运行依赖。进入 Chrome / Edge 扩展管理页，开启开发者模式，加载本目录；修改后刷新扩展。

```bash
# 全部核心和 Markdown 回归
node --test tests/*.test.js

# 单独运行
node --test tests/reader-core.test.js
node --test tests/markdown.test.js

# 浏览器回归：另需 Playwright 和本机 Chrome
node tests/browser-smoke.cjs
node tests/selection-browser.cjs
node tests/pdf-browser.cjs
node tests/pdf-selection-browser.cjs
```

浏览器测试可用 `PLAYWRIGHT_MODULE_PATH` 指向已有 Playwright 模块；模拟 Chrome API、正文和流式服务，不调用真实模型，也不覆盖真实扩展的全部权限和生命周期行为。

2026-10-23 验证时，37 项核心、Markdown 及划词后台测试全部通过；此前弹窗/设置页、网页划词及 PDF 浏览器回归均通过。本次 PDF 选区修复再次通过核心测试、PDF 真扩展及真实拖选回归：覆盖高 DPI、连续重选、正反向/跨行/跨页、行首/段间空白、视口外滚动扩选、缩放、Shift 和精确双击单词；在 100%/150% 缩放下对照画布真实字形像素，验证紧行距单词、页下方粗体标题及混合字号，并检查搜索嵌套高亮不重复绘制。额外用临时嵌入字体 PDF 验证字形边界；该临时样例不随仓库提交。真扩展回归覆盖本地/在线、单次链接、自动接管开关、原生回退、选区任务和错误恢复。测试使用临时 Chrome 配置与模拟模型服务，未调用真实模型；测试数量以实际执行结果为准。

手动验证应覆盖真实网页提取、模型配置、任务显示/排序、停止与重试、多轮 Thinking、usage、关闭 popup 后恢复、独立窗口、复制和导入导出。查看 background 日志可从扩展管理页打开 Service Worker；popup 可右键检查弹出内容，content script 从网页 DevTools 查看。

## 8. 现有限制与后续方向

1. 总结/对话的 fetch 仍在 popup 中，关闭后会中断；划词助手走后台 Port 请求，关闭卡片或离开网页即取消，并受浏览器后台生命周期约束。
2. `summaryState` 只有一份，不同标签页运行任务会覆盖，不是多会话历史系统。
3. `lastActiveTab` 在 Service Worker 被回收后会丢失。
4. 动态网页提取取决于当前 DOM，未完成加载的 SPA、站点结构变化等仍需真实环境验证。
5. 缺失 usage 时的字符估算较粗，真实服务对 Thinking 和流式 usage 的兼容性需实际联调。
6. 只支持 OpenAI 兼容协议，尚无原生 Anthropic / Gemini 适配。
7. 已有核心和模拟浏览器测试，但正文提取、真实扩展生命周期等覆盖仍有限。

可考虑的后续工作包括 background 接管总结/对话流式请求、来源标签页持久化、多会话管理、扩充真实页面提取验证、更精确的 Token 估算和对话导出。上述均为候选方向，不是已实现功能或本次修改要求。

---

*最后更新：2026-10-23（Manifest v1.2.0 + 当前 Unreleased 实现）*
