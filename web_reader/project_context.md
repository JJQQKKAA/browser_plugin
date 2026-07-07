# Web Reader - 项目上下文（Project Context）

> 本文件面向 AI 助手、新贡献者和维护者，用于快速理解项目全貌、架构逻辑和注意事项。

---

## 1. 项目定位

**Web Reader** 是一款基于 Chrome/Edge Manifest V3 的浏览器扩展，帮助用户调用自定义 AI API（OpenAI 兼容格式）对当前网页内容进行总结，并支持多轮对话。

- **当前版本**: `1.2.0`
- **目标用户**: 需要快速获取网页核心内容、并希望通过自定义模型/Prompt 灵活控制总结风格的用户
- **核心卖点**: 完全本地化的配置管理、灵活的模型/Prompt 组合、流式响应、对话状态保持

---

## 2. 核心功能

| 功能 | 说明 |
|------|------|
| 网页内容提取 | 注入 `content.js`，支持站点特定规则、语义化标签、启发式算法、选中文字优先 |
| 自定义 AI API | 支持任意 OpenAI 兼容格式：OpenAI、Claude、通义千问、DeepSeek、Kimi、Ollama 等 |
| 多模型管理 | 可配置多个模型，每个模型包含名称、API URL、API Key、模型代码 |
| 多 Prompt 管理 | 可配置多个 Prompt，包含简称、System Prompt、User Prompt（`{{content}}` 占位符） |
| 流式响应 | SSE 流式读取 AI 返回，实时渲染 |
| 多轮对话 | 总结后可继续提问，保持完整对话上下文 |
| Markdown 渲染 | 使用 `marked.min.js` 渲染 AI 返回的 Markdown |
| 状态保持 | popup 关闭或切换标签页后，5 分钟内可恢复对话状态和模型/Prompt 选择 |
| 配置导入/导出 | 支持 JSON 文件和剪切板导入/导出 |
| 独立窗口模式 | 可将 popup 在新窗口打开，获得更大操作空间 |

---

## 3. 文件结构与职责

```
web_reader/
├── manifest.json          # Manifest V3 配置、权限、入口声明
├── background.js          # Service Worker：状态保持、标签页监听、生命周期管理
├── content.js             # 内容脚本：注入页面提取可见正文和元信息
├── popup.html / popup.js  # 扩展弹窗：主交互界面、API 调用、对话渲染
├── options.html / options.js  # 配置页面：模型/Prompt 管理、导入导出
├── styles.css             # 全局样式（popup + options 共用）
├── marked.min.js          # Markdown 渲染库
├── icon*.png              # 扩展图标
├── icon-generator.html    # 图标生成工具页
├── project_context.md     # 本文件
├── README.md              # 用户文档
├── CHANGELOG.md           # 版本变更记录
└── PRIVACY.md             # 隐私政策
```

### 3.1 各文件详细职责

#### `manifest.json`
- 声明版本、名称、权限、图标
- 注册 `background` service worker、`content_scripts`、`action` popup、`options_page`
- 关键权限：`activeTab`、`storage`、`scripting`、`windows`、`http://*/`、`https://*/`

#### `background.js`
- 监听 `chrome.runtime.onMessage`，处理以下消息类型：
  - `SAVE_SUMMARY_STATE`: 保存当前总结/对话状态
  - `GET_SUMMARY_STATE`: 读取状态并检查 5 分钟过期时间
  - `CLEAR_SUMMARY_STATE`: 清除状态
  - `SET_LAST_ACTIVE_TAB` / `GET_LAST_ACTIVE_TAB`: 支持独立窗口模式获取来源标签页
- 监听 `chrome.tabs.onActivated` 记录最后活跃标签页
- 监听 `chrome.tabs.onUpdated`：URL 变化时清理相关过期状态

#### `content.js`
- 作为 content script 注入所有 `http://*` 和 `https://*` 页面
- 在 `window` 上挂载 `webReaderExtractContent()` 方法，供 popup 调用
- 提取逻辑（按优先级）：
  1. 用户选中的文本（>10 字符）
  2. 站点特定选择器（GitHub、知乎、掘金、CSDN、微信公众号等）
  3. 语义化标签和常见 CMS 类名（`article`、`main`、`.post-content` 等）
  4. 启发式算法：按文本密度、链接密度找最大文本块
  5. `body.innerText` 回退
  6. `document.title` 最后回退
- 同时提取页面元信息（标题、作者、发布时间、来源、描述等）
- 清理零宽字符、多余空白、空行

#### `popup.js`
- 初始化：检测是否独立窗口模式、加载配置、渲染模型/Prompt 选择器、恢复状态
- 提取页面内容：调用 `chrome.scripting.executeScript` 执行 `window.webReaderExtractContent()`
- 调用 AI API：`fetch` 发送 OpenAI 兼容请求，`stream: true`，SSE 解析
- 对话管理：`chatHistory` 维护完整上下文，system 消息和初始 user 消息不显示在界面
- Token 统计：优先使用 API 返回的 `usage`，否则本地估算
- UI 交互：发送消息、清空对话、复制、字体大小调整、展开/收起配置面板、打开独立窗口

#### `options.js`
- 管理配置数据结构：`{ models, prompts, combinations }`
- 默认配置：内置一个 Qwen3-Next 模型 + 总结 Prompt + 默认组合
- 模型/Prompt 的增删改、复制、默认标识
- 旧配置迁移逻辑
- 配置导入/导出（文件 + 剪切板 + JSON 粘贴）

#### `styles.css`
- 同时服务 popup 和 options 页面
- popup 页面有响应式宽度：默认 380px，PC 端 520px，大屏 640px
- 聊天消息、Markdown 渲染、token 统计、复制按钮等样式

---

## 4. 数据流

```
用户点击扩展图标
    │
    ▼
popup.js 加载配置 ──► 检查 models/prompts 是否存在
    │
    ▼
用户选择 model + prompt，点击总结
    │
    ▼
popup.js 调用 chrome.scripting.executeScript
    │
    ▼
content.js 中的 window.webReaderExtractContent() 提取正文
    │
    ▼
popup.js 拼接 Prompt：User Prompt 中的 {{content}} 替换为正文
    │
    ▼
fetch(currentModel.apiUrl, { stream: true })
    │
    ▼
SSE 流式解析 ──► 更新 chatHistory ──► renderChatMessages()
    │
    ▼
popup.js 定时调用 background.js SAVE_SUMMARY_STATE 保持状态
```

---

## 5. 配置数据结构

所有配置保存在 `chrome.storage.local` 的 `webReaderConfig` 键下。

```json
{
  "models": [
    {
      "id": "model_xxx",
      "name": "显示名称",
      "apiUrl": "https://api.openai.com/v1/chat/completions",
      "apiKey": "sk-xxx",
      "modelCode": "gpt-4o-mini",
      "temperature": 0.3
    }
  ],
  "prompts": [
    {
      "id": "prompt_xxx",
      "shortName": "总结",
      "systemPrompt": "你是网页内容总结助手",
      "userPrompt": "请总结以下内容：\n\n{{content}}"
    }
  ],
  "combinations": [
    {
      "id": "combo_xxx",
      "name": "默认组合",
      "modelId": "model_xxx",
      "promptId": "prompt_xxx",
      "isDefault": true
    }
  ]
}
```

### 5.1 其他 storage 键

| 键 | 用途 |
|---|---|
| `webReaderConfig` | 主配置 |
| `lastUsedModelId` | 上次使用的模型 ID |
| `lastUsedPromptId` | 上次使用的 Prompt ID |
| `webReaderFontSize` | 聊天区域字体大小 |
| `configPanelCollapsed` | 配置面板是否收起 |
| `summaryState` | 当前总结/对话状态（background 维护，5 分钟过期） |
| `windowModeState` | 独立窗口模式的状态快照 |

---

## 6. 关键代码约定

### 6.1 Content Script 注入限制
- `popup.js` 通过 `chrome.scripting.executeScript({ target: { tabId }, func: () => { ... } })` 调用页面方法
- `func` 参数会被序列化后注入页面执行，**不能引用外部变量/函数**
- 因此 fallback 逻辑必须完全内联在 `func` 中

### 6.2 消息通信
- popup 与 background 之间使用 `chrome.runtime.sendMessage`
- 异步响应的分支需要 `return true` 保持消息通道开放
- 同步响应的分支不需要 `return true`

### 6.3 Token 估算
- 当前使用简单估算：`Math.ceil(text.length / 2.5)`
- 这只是一个粗略值，不区分中英文 token 差异
- 未来可替换为 `js-tiktoken` 等更精确方案

### 6.4 Markdown 渲染降级
- 优先使用 `marked.parse()`
- 若 `marked` 未加载，使用本地 `escapeHtml()` + `<br>` 降级

---

## 7. 最近修复记录（v1.2.0）

| Bug | 修复方式 |
|---|---|
| 模型/Prompt 选择状态切换标签页后无法恢复 | `background.js` 保存 `modelId`/`promptId` 而非不存在的 `comboId` |
| `executeScript` fallback 调用未定义函数崩溃 | fallback 逻辑内联到 `func` 中，不再依赖外部函数 |
| `renderMarkdown` 降级分支 `escapeHtml` 未定义 | 在 `popup.js` 中补全 `escapeHtml` 函数 |
| 无 `usage` 返回的 API 第二轮 token 统计显示为 0 | 用当前轮次实际发送的 messages 估算 input token，不再做减法 |
| 旧格式 content 状态恢复无法显示 | 将渲染结果设置到 `resultContent` 并显示 |
| 恢复状态后无法继续对话（`currentModel` 丢失） | 恢复状态时同步恢复 `currentModel` |
| 新用户导入配置时多余弹出覆盖确认 | 仅当用户已添加非默认配置时才询问确认 |
| `background.js` 中 `return true` 位置错误 | 删除多余/位置错误的 `return true` |
| `styles.css` 中重复媒体查询 | 删除重复的 `@media` 块 |
| manifest 版本号与 CHANGELOG 不一致 | 统一为 `1.2.0` |

## 后续小迭代

- **Temperature 可配置**：已在 `options.js` / `popup.js` 中实现，每个模型可独立设置 temperature，默认 `0.3`，范围 `0~2`。

---

## 8. 已知限制与注意事项

1. **流式响应无法跨 popup 生命周期保持**：fetch 在 popup.js 中进行，popup 关闭后流式连接会中断。如需完整后台流式，需重构让 background.js 接管 fetch。
2. **Token 估算不够精确**：当前为字符数/2.5，对不同模型差异较大。
3. **内容提取对动态渲染页面有限制**：SPA 页面若内容未加载完成，提取可能不准确。
4. **API 格式单一**：目前仅支持 OpenAI 兼容格式，Anthropic/Gemini 原生格式需要额外适配。
5. **Service Worker 全局变量不稳定**：`lastActiveTab` 放在全局变量中，SW 被浏览器回收后会丢失。建议持久化到 storage。
6. **没有单元测试**：内容提取、配置导入导出、token 估算等逻辑缺乏自动化测试。

---

## 9. 常见迭代方向

### 9.1 短期可做
- ~~模型参数可配置（temperature、max_tokens、top_p）~~ → temperature 已支持，每个模型独立配置
- 自定义请求头（适配 Azure OpenAI、Anthropic 等）
- 更精确的 token 估算库
- 快捷键触发总结
- 暗夜模式
- 提示词模板市场
- 对话历史/会话管理

### 9.2 中期重构
- 引入 TypeScript 提升可维护性
- 使用 `mozilla/readability` 替代手写内容提取
- background.js 接管 fetch，支持 popup 关闭后继续流式
- 单元测试覆盖核心逻辑
- ESLint + Prettier 统一代码风格

### 9.3 长期方向
- 支持非 OpenAI 兼容 API 格式
- 多 API 备用/负载均衡
- 国际化（i18n）
- 打包工具迁移（Vite/Webpack）
- 对话导出为 Markdown/PDF

---

## 10. 开发调试提示

- 加载扩展：Chrome/Edge 中开启开发者模式 → 加载已解压的扩展程序 → 选择本文件夹
- 查看 background 日志：`chrome://extensions/` → 找到 Web Reader → 点击「Service Worker」查看 console
- 查看 popup 日志：右键扩展图标 → 检查弹出内容
- 查看 content script：在网页 DevTools 的 Console 中，筛选来自 content.js 的日志
- 修改代码后，需要在扩展管理页面点击刷新按钮重新加载

---

## 11. 隐私与安全

- 所有配置、API Key 仅保存在 `chrome.storage.local`
- 网页内容仅在用户主动点击总结时提取
- AI 请求直接发送到用户配置的端点，不经过开发者服务器
- 详见 [PRIVACY.md](PRIVACY.md)

---

*最后更新：2026-06-19（v1.2.0 修复迭代）*
