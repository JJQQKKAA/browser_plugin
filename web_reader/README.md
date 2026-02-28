# Web Reader - AI 网页总结插件

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
2. **模型配置**: 添加模型（名称、API URL、API Key、模型代码）
3. **Prompt 配置**: 添加 Prompt（简称、System Prompt、User Prompt）
   - User Prompt 中使用 `{{content}}` 作为网页内容占位符

## 使用方法

1. 打开任意网页，点击 Web Reader 图标
2. 选择模型和 Prompt
3. 点击「总结当前页面」按钮
4. 可继续提问进行多轮对话

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
├── manifest.json      # 插件配置
├── background.js      # Service Worker
├── popup.html/js      # 弹窗界面和逻辑
├── options.html/js    # 配置页面
├── content.js         # 内容提取脚本
├── marked.min.js      # Markdown 渲染库
├── styles.css         # 样式文件
└── icon*.png          # 图标文件
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

