# Web Reader - AI 网页总结插件

[![版本](https://img.shields.io/badge/version-1.2.0-blue.svg)](#更新日志)

使用自定义 AI 模型总结网页内容，支持多模型配置和多轮对话。

## 功能特点

- 🔧 **灵活配置**: 支持任意 OpenAI 兼容格式的 API
- 💾 **本地存储**: 配置和 Prompt 保存在本地，保护隐私
- 🤖 **自定义 Prompt**: 可配置 System Prompt 和 User Prompt
- ⚡ **流式响应**: 实时显示 AI 生成的总结内容
- 💬 **多轮对话**: 总结后可继续提问，保持对话上下文
- 🎨 **Markdown 渲染**: 支持渲染 AI 返回的 Markdown 格式内容
- 📌 **状态保持**: 切换标签页后总结结果不会丢失
- 📤 **配置导入/导出**: 支持 JSON 格式的配置备份和迁移

## 安装方法

1. 准备图标文件（icon16.png、icon48.png、icon128.png），可用 `icon-generator.html` 生成
2. 打开 Chrome/Edge 浏览器，进入 `chrome://extensions/`
3. 开启「开发者模式」，点击「加载已解压的扩展程序」
4. 选择 `web_reader` 文件夹

## 配置 API

1. 右键点击扩展图标，选择「选项」
2. **模型配置**: 添加模型（名称、API URL、API Key、模型代码、Temperature）
3. **阅读任务**：新建任务，填写名称和任务指令；需要额外角色约束时展开「高级设置」
   - 任务指令中使用 `{{content}}` 插入网页正文

## 使用方法

1. 打开任意网页，点击 Web Reader 图标
2. 选择模型和 Prompt
3. 点击「快速摘要」「详细解读」或「翻译」任务按钮，也可展开配置后运行自己的提示词
4. 可继续提问进行多轮对话

## 阅读任务与生成控制

- 默认提供「快速摘要、详细解读、翻译」三个按钮；翻译任务默认将外文译为中文、中文译为英文。
- 点击首页「管理任务」，新建或编辑任务；卡片上的「首页显示」开关可直接控制首页按钮，关闭后仍可在任务列表中运行。
- 拖动任务左侧手柄排序，也可选中手柄后按 ↑ / ↓，或使用「更多」里的上移、下移；顺序同步用于首页和任务下拉列表。
- 「从内置模板添加」提供快速摘要、详细解读、翻译，选中后可继续修改，保存为独立任务。模板不会自动覆盖已有任务。
- 模型和任务的「更多」菜单提供复制、删除，删除后有 12 秒可撤销。保存、排序、开关操作都有即时反馈。
- 移除旧的默认组合与默认标签；弹窗记住上次选择的模型和任务，首次使用或已选项目被删除时选择列表第一项。升级保留现有模型与任务内容，导入旧版文件也不再生成组合或额外补充模板。
- 生成时可点击「停止生成」，保留已输出内容；「重新生成」使用本轮原始输入重试，替换本轮回答，不会重复追加提问。
- 重新生成使用上次请求的模型；要切换模型，请选择模型后重新运行阅读任务。
- 开始生成或恢复结果后自动进入阅读模式，收起页面详情、模型配置和任务按钮；顶部标题行或下拉按钮可展开任务浮层，浮层不压缩正文，点击外部或按 Esc 收起。
- 首轮完成后从正文开头阅读；长对话只滚动消息区域，输入框固定在底部，向上阅读时不强制跳到底部，可点击「回到最新」。
- 界面自动跟随系统浅色 / 深色主题。

## ModelScope 与深度思考

模型设置新增「深度思考 / Thinking」选项：

- **自动（默认）**：ModelScope 域名的接口发送顶层 `enable_thinking: false`；其他服务不附加此参数。
- **关闭 / 开启**：显式发送 `enable_thinking: false / true`，适用于支持该参数的兼容服务或代理。
- **跟随服务默认**：不发送此参数；仅支持思考的模型可以选择此项。

现有模型无需重新保存，默认采用自动模式。直接使用 `fetch` 时参数放在请求 JSON 顶层，不嵌套在 `extra_body` 中。参见 [ModelScope 官方调用示例](https://community.modelscope.cn/6810a75dc89bb1649888b621.html)。

## Token 统计

每条回答底部统一显示「输入 120 · 输出 80 · 合计 200 Token」，累计数悬浮可查看输入、输出和合计明细；不额外增加常驻工具栏。

- 默认请求 `stream_options: { include_usage: true }`。每个模型的「请求流式 Token 统计」可独立关闭，兼容不接受此参数的接口。
- 适配现有 OpenAI 兼容接口：优先读取 `usage.prompt_tokens`、`completion_tokens`、`total_tokens`，兼容网关返回的 `input_tokens` / `output_tokens` 别名。这不意味着新增 Anthropic / Gemini 原生接口支持。
- 读取末尾无正文的 usage 分块；中途统计按本轮累计快照覆盖，不逐块相加。返回的 `0` 是有效值。
- 缺失字段才估算，数字前用 `≈` 标记；输入估算覆盖本轮发送的全部历史上下文。已知平台合计与一个分项时，另一分项由二者相减获得；仅返回合计时保留平台合计，缺失分项独立估算。
- 平台返回的缓存命中和思考 Token 在悬浮明细中展示，作为输入 / 输出的组成部分，不重复加到合计。
- 会话累计包括重试和收到响应后的中断请求；中断时只能估算已收到内容，可能缺少最终 usage，不代表平台最终账单。累计中含估算或来源不明的历史统计时同样标记 `≈`。
- ModelScope 的具体模型是否返回 usage 以实际响应为准，缺失时按上述规则估算。尚未使用真实账号逐个平台进行联调。

参考：[OpenAI 流式用量字段](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)、[百炼流式输出](https://help.aliyun.cn/zh/model-studio/stream)、[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Kimi 官方兼容说明](https://forum.moonshot.ai/t/api-not-fully-openai-compatible/67/2)、[ModelScope 官方 EvalScope 的兼容请求与 usage 处理](https://github.com/modelscope/evalscope/blob/main/evalscope/perf/plugin/api/openai_api.py)。

## Markdown 排版

- 使用本地打包的官方 Marked 17.0.5（UMD，MIT 许可证见 `marked.LICENSE.md`），无需 CDN、构建步骤或额外安装运行依赖。
- 按原始 Markdown 的层级解析列表、引用和段落，不再自动给引用补缩进。列表结束后的结论段落保持顶格，子列表保留在父列表项中。
- 若引用属于列表项，请在原始 Markdown 中按该项正文的缩进书写；顶格的独立引用不会被自动吸入前面的列表。
- 围栏代码块（包括标注为 markdown 的代码示例）按代码显示，保留缩进和转义字符。
- Markdown 回归：`node --test tests/markdown.test.js`；运行全部核心测试：`node --test tests/*.test.js`。

## 开发验证

无需构建，依然可以直接加载扩展源码目录。

- 核心回归测试：`node --test tests/reader-core.test.js`，覆盖 SSE 任意字节分块、中文解码、事件结束、任务迁移和 Thinking 参数。
- 浏览器回归：安装 Playwright 且本机有 Chrome 时运行 `node tests/browser-smoke.cjs`。也可用 `PLAYWRIGHT_MODULE_PATH` 指向已有 Playwright 模块。测试使用模拟 API，不会调用真实模型。

## Prompt 配置示例

**System Prompt:**
```
你是一个专业的网页内容总结助手，擅长提取文章的核心观点和关键信息。
```

**User Prompt:**
```
请总结以下网页内容：

{{content}}

请用中文输出，控制在 200 字以内。
```

## 支持的模型

任何 OpenAI 兼容格式的 API：OpenAI、Claude、通义千问、DeepSeek、Kimi、Ollama 等

## 文件结构

```
web_reader/
├── manifest.json      # 插件配置（Manifest V3）
├── background.js      # Service Worker，负责状态保持
├── popup.html/js      # 弹窗界面和逻辑
├── reader-core.js     # 阅读任务、请求参数、SSE 解析
├── tests/             # 核心逻辑与浏览器回归测试
├── options.html/js    # 配置页面
├── content.js         # 内容提取脚本
├── marked.min.js      # Markdown 渲染库
├── styles.css         # 样式文件
├── icon*.png          # 图标文件
├── project_context.md # 项目上下文说明（面向 AI/新贡献者）
├── CHANGELOG.md       # 更新日志
├── PRIVACY.md         # 隐私政策
└── README.md          # 本文件
```

## 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)

## 隐私政策

所有配置数据仅保存在本地，不会上传到任何服务器。详见 [PRIVACY.md](PRIVACY.md)


## 注意事项

- 首次使用前必须配置 API 信息
- 网页内容截取约 15000 字符，避免超出 token 限制
- API 密钥仅存储在浏览器本地
- 总结状态保持 5 分钟

