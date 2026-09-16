# Zotero Comment Expand

一键完整显示 Zotero 阅读器中的批注评论／译文，再次点击恢复原生省略显示。批注原文保持 Zotero 原有行为。

评论气泡按钮固定在侧栏原生搜索按钮左侧。工具条保持单行，可以与 [Bilingual Outline](https://github.com/lllaterOn/zotero-bilingual-outline) 独立共存。

## 安装

1. 从 [最新正式版本](https://github.com/lllaterOn/zotero-comment-expand/releases/latest) 下载 `.xpi` 安装包。
2. 打开 Zotero 的“工具 → 插件”，通过齿轮菜单选择“从文件安装插件”。
3. 选择下载的 XPI，在阅读器侧栏点击评论气泡按钮。

首次安装默认关闭。按钮按下时，所有批注卡片的评论完整显示；再次点击恢复原生行为：未选中的长评论省略，选中的评论仍可展开和编辑。

开关在本机全局生效，已打开及新开的阅读器使用同一状态，重启后保留。插件不改动批注内容，不增加内容同步，也不向外部服务发送文献数据。停用后移除自己的按钮和样式。

## 兼容性

- 支持范围：桌面 Zotero 10.0.2–10.0.x。
- 已由维护者在 Windows 的 Zotero 10.0.2 PDF 阅读器中验收，包括与双语目录插件共存。
- PDF、EPUB 和网页快照共用批注侧栏实现；EPUB、网页快照及其他操作系统尚未完成实机验收。
- 使用中文界面时显示中文提示，其他语言显示英文提示。

评论显示依赖 Zotero Reader 的内部样式。若 Zotero 更新后出现问题，请通过 [Issues](https://github.com/lllaterOn/zotero-comment-expand/issues) 提供 Zotero 版本、插件版本、文件类型及可复现步骤。

## 开发与维护

需要 Node.js 22 或更高版本。

```sh
npm ci
npm run verify
```

```text
addon/       Zotero 清单、启动入口及图标
src/         评论显示和阅读器生命周期
tests/       行为与回归测试
scripts/     构建、安装包与发布检查
.github/     持续集成及发布工作流
docs/        维护说明
```

构建生成 `dist/zotero-comment-expand-<version>.xpi` 和 `dist/SHA256SUMS`。安装包发布在 GitHub Releases；源码仓库不保存构建产物。

后续通过分支和 pull request 维护。标签工作流生成 Draft Release，维护者验收后发布，发布工作流再更新 `updates.json`。详细步骤见 [开发与发布](docs/DEVELOPMENT.md)。

MIT License · Copyright © 2026 lllaterOn.
