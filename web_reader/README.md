# Web Reader - AI 网页总结插件

一个简单好用的浏览器插件，使用自定义 AI 模型总结网页内容。

## 功能特点

- 🔧 **灵活配置**: 支持任意 OpenAI 兼容格式的 API
- 💾 **本地存储**: 配置和 Prompt 都保存在本地，保护隐私
- 🤖 **自定义 Prompt**: 可自由配置 System Prompt 和 User Prompt
- ⚡ **流式响应**: 实时显示 AI 生成的总结内容
- 📋 **一键复制**: 方便地复制总结结果
- 🎨 **Markdown 渲染**: 支持渲染 AI 返回的 Markdown 格式内容
- 📌 **状态保持**: 切换到其他标签页再返回，总结结果不会丢失

## 安装方法

### 1. 准备图标文件

打开 `icon-generator.html`，下载三个尺寸的图标（icon16.png、icon48.png、icon128.png）放到插件目录中。

或者你也可以自己准备这三个尺寸的 PNG 图标。

### 2. 加载插件

1. 打开 Chrome/Edge 浏览器，进入 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `web_reader` 文件夹

### 3. 配置 API

1. 右键点击扩展图标，选择「选项」
2. 填写你的 API 信息：
   - **API URL**: 你的 API 地址，例如 `https://api.openai.com/v1/chat/completions`
   - **API Key**: 你的 API 密钥
   - **模型名称**: 例如 `gpt-4o-mini`、`claude-3-haiku`、`qwen-turbo` 等

3. 点击「保存配置」

## 使用方法

1. 打开任意网页
2. 点击浏览器工具栏上的 Web Reader 图标
3. 点击「总结当前页面」按钮
4. 等待 AI 生成总结（支持流式显示）
5. 点击复制按钮保存结果

## Prompt 配置说明

### System Prompt
设置 AI 的角色和行为方式，例如：
```
你是一个专业的网页内容总结助手，擅长提取文章的核心观点和关键信息。
```

### User Prompt
支持使用 `{{content}}` 占位符插入网页内容，例如：
```
请总结以下网页内容：

{{content}}

请用中文输出，控制在 200 字以内。
```

## 支持的大模型

任何 OpenAI 兼容格式的 API 都可以使用：

- OpenAI (GPT-4, GPT-3.5)
- Claude (通过兼容层)
- 通义千问
- DeepSeek
- 月之暗面 Kimi
- 自托管模型 (Ollama, LocalAI 等)

## 文件结构

```
web_reader/
├── manifest.json      # 插件配置
├── background.js      # 后台服务 worker（保持状态）
├── popup.html         # 弹窗界面
├── popup.js           # 弹窗逻辑
├── options.html       # 配置页面
├── options.js         # 配置逻辑
├── content.js         # 内容提取
├── marked.min.js      # Markdown 渲染库
├── styles.css         # 样式文件
├── icon16.png         # 图标 (16x16)
├── icon48.png         # 图标 (48x48)
└── icon128.png        # 图标 (128x128)
```

## 注意事项

1. 首次使用前必须配置 API 信息
2. 网页内容会被截取到约 15000 字符以内，避免超出 token 限制
3. API 密钥仅存储在浏览器本地，不会上传到任何服务器
4. 总结状态会在后台保持 5 分钟，切换标签页后返回不会丢失结果

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript (ES6+)
- Chrome Storage API
- Fetch API + 流式响应
