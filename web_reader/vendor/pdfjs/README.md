# PDF.js 本地发行文件

- 来源：Mozilla 官方 npm 包 `pdfjs-dist@6.4.299`（预编译 generic build）
- 上游：https://github.com/mozilla/pdf.js
- npm：https://www.npmjs.com/package/pdfjs-dist/v/6.4.299
- 许可证：Apache-2.0，见 `LICENSE`，保留各文件版权声明。
- 包含核心、Worker、Viewer 组件及其 CSS/图像、CMap、标准字体、Wasm 和 ICC 资源；未包含脚本执行 sandbox、源码映射或编辑器应用。
- 扩展运行时完全从本地加载，无 CDN、无安装或构建步骤。升级时核心、Worker 和 Viewer 版本必须一致，并运行 PDF 浏览器回归。
