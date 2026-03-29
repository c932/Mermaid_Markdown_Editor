# Mermaid Markdown Editor (Windows)

一个面向 Windows 的现代桌面编辑器，支持 Mermaid 与 Markdown 双编辑，提供预览、打印与多格式导出。

## 特性

- Mermaid 与 Markdown 左右分栏编辑
- 类 Mermaid.ai 的画布视图（点阵背景、缩放、网格开关）
- 实时渲染（自动更新）
- Mermaid 节点拖拽布局，支持外层模块带动子模块一起移动
- Markdown 代码块语法高亮
- 打印预览与打印机选择
- 支持保存和打开工程文件（JSON）
- 导出能力：
  - Mermaid 图：`SVG` `PNG` `Visio(vsdx)`
  - Markdown 文档：`DOCX`

## 技术栈

- Electron (Windows 桌面)
- Mermaid.js
- Marked
- highlight.js
- docx
- PowerShell + Visio COM（用于 `.vsdx` 导出）

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 启动应用

```bash
npm run start
```

3. 打包为 Windows one-dir 版本

```bash
npm run pack:win-dir
```

打包完成后，可执行文件位于：

- `dist/win-unpacked/Mermaid Markdown Editor.exe`

## 文件菜单

- `文件`：打开文件、保存工程、打印、退出
- `导出`：导出 SVG、PNG、DOCX、Visio
- `视图`：放大、缩小、重置缩放、切换网格、切换拖拽布局

## 导出说明

- `SVG`: 导出当前 Mermaid 预览的 SVG 源码。
- `PNG`: 将当前 Mermaid SVG 栅格化后导出为 PNG。
- `DOCX`: 将 Markdown 文本按标题/列表/段落转换为 Word 文档。
- `Visio(vsdx)`: 先写入临时 SVG，再调用 PowerShell 的 Visio COM 自动化导出。
  - 需要本机安装并激活 Microsoft Visio。
  - 若未安装 Visio，会收到警告信息。

## 工程文件

- 工程文件保存为 JSON 格式，包含 Mermaid 与 Markdown 两部分内容。
- 可通过 `文件 -> 打开文件` 重新载入之前保存的工程。

## 打印说明

- 支持打印当前标签页、仅 Mermaid 图或仅 Markdown 文档。
- 打印前可选择打印机并查看预览。

## 项目结构

- `main.js`: 主进程，文件和导出逻辑
- `preload.js`: 安全 IPC 桥
- `src/index.html`: UI 布局
- `src/styles.css`: 现代化样式
- `src/renderer.js`: 渲染、编辑、导出交互

## 后续可扩展

- Monaco Editor（语法高亮、智能补全）
- 多文档标签页
- 工程文件关联（双击打开）
- 局部导出（仅画布）与高分辨率导出
- 云端同步与版本历史
