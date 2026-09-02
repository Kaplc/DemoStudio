---
name: skl-create-ui-widget-asset
description: '创建 DemoStudio UI widget 资产。核心理念：只写普通 HTML+CSS 前端写法，引擎/编译器细节完全不用管（先读使用手册全文）。流程：写 .widget.html 源 + 调 MCP ui_compile 编译为 .widget.json（自动过 assetLint 零错误门槛）。仅当维护无源文件的旧资产时才直接写 JSON。使用时机：用户要求新建/编辑 UI 面板资产，如"创建一个 HUD"、"写主菜单 UI"、"添加一个按钮/文本/图片控件"、"widget 里挂脚本"。'
argument-hint: 'widget 名称或 UI 面板用途描述'
---

# 创建 UI widget 资产（.widget.html → ui_compile）

> **核心心智：把 widget 当一张普通网页写。** 你只需要 HTML + CSS 前端写法——布局用 flex/grid、盒模型用 margin/padding、颜色字体阴影按 CSS 写。引擎组件、锚点、世界坐标、米制换算、布局求解，**编译器全部自动处理，代码里不要出现任何引擎概念**。

## 何时使用
- 用户要求新建 UI 资产（如"创建一个 HUD"、"写主菜单 UI"）
- 修改现有 widget 的控件树（面板、按钮、文本、图片）

## 第 0 步：读手册（必须，先于一切）

**用 Read 工具完整阅读使用手册**（唯一权威写法参考，含标签/CSS 白名单、布局配方、禁区清单、FAQ）：

```
doc/editor/ui/ui_widget_html_manual.md
```

手册要点预告（细节以手册为准）：
- **流式布局优先**：全屏面板 = 遮罩 absolute + 面板 `margin: Npx auto` 居中 + 内容 flex 栈；99% 的布局不需要手写坐标
- **动态卡片列表** = 容器挂 `data-comp="UILayout" data-props='{"mode":"grid","columns":N,...}'` + 显式宽高（手册 §5 配方 B、§8）
- **被脚本引用的节点名（class 名）逐字保留**——脚本 `findInChildren('名字')` 按 class 首词查找；改现有资产前先查对应 `gameplay/**/*.script.ts` 引用了哪些名字
- **禁区**（写了必硬报错）：`<script>`、`onclick`、未知标签、`overflow: hidden`、`@keyframes`、兄弟选择器、`::before/::after`
- 对尺寸敏感的元素（面板/按钮/卡片）**显式写 width/height**（文本宽度是编译期估算）

## 主路径：写 .widget.html + 调 MCP ui_compile（新功能/改有源文件的 widget 一律走此路）

### 1. 文件位置与命名

- 源文件：`src/projects/<project>/asset/blueprints/ui/<描述>.widget.html`
- 编译产物：同目录同名 `<描述>.widget.json`（ui 目录下 .json 自动注册，无需写 path）
- 编辑器保存 json 会自动反编译回写 html（渲染等效的"规范形"，属正常现象，别手工对抗）

### 2. 骨架速记（完整写法见手册）

```html
<widget name="面板名" canvas="1920x1080" world="9.6x5.4" data-script="gameplay/base/MyPanel">
  <style>
    .Panel { width: 1460px; height: 980px; margin: 50px auto; background-color: #8a6a3a; border-radius: 24px; }
    .Title { width: 400px; height: 50px; font-size: 32px; color: #ffffff; text-align: center; }
  </style>
  <div class="Panel">
    <text class="Title">标题</text>
  </div>
</widget>
```

- `canvas` 是你写 CSS 的像素坐标系（全屏 1920x1080，小件自定）；`world` 全屏 = `9.6x5.4`，其余交给编译器
- 行为不用 HTML 表达：`data-script` 挂根节点，按钮 `:hover/:active/:disabled` 颜色自动生效，点击逻辑写在脚本里（脚本按节点名找控件挂 onClick）

### 3. 编译（必须）

写完源文件后**必须调用 MCP `ui_compile` 工具**（不要用 CLI——CLI 不带 assetLint 门槛），**asset 参数传 `.widget.json` 路径**：

```json
{ "asset": "src/projects/<project>/asset/blueprints/ui/<描述>.widget.json" }
```

- 成功：json 自动落盘（已过 assetLint 零 error 门槛）；`warnings[]` 多为文本估算披露，逐条确认可接受
- 失败：`errors[{line, message}]` 行号指向 `.widget.html`——按行修源重试，**不要手改 json**

### 4. 完成检查

- [ ] 已读手册全文（第 0 步）
- [ ] `ui_compile` 成功（零编译错误 + 零 lint error），同目录出现同名 .widget.json
- [ ] 脚本引用的节点名与 `gameplay/**/*.script.ts` 逐字一致；`data-script` id 真实存在
- [ ] （可选）资产面板选中 widget 走 UIPreviewManager 2D 预览

## 辅助路径：直接写 .widget.json（仅限维护无源文件的旧资产）

只在这些情况下用：给**没有同名 .html** 的旧 widget 做小改动。新功能禁止直接写 JSON。

要点（详见 `doc/editor/ui/ui_source_format_system.md` 与组件 schema）：
- 根三件套：UITransformComponent（worldWidth/worldHeight 米制，全屏 9.6×5.4）+ CanvasUIComponent（width/height 像素 + active: true）+ 可选 UIScriptComponent
- 每个控件节点 = Actor（name/id 唯一）+ UITransform + CanvasUI(markerOnly: true, name: "UIMarker") + 功能组件
- **组件优先约定**：position/rotation/scale 只写在 UITransformComponent properties（顶层写法 → error）
- 显隐由 `CanvasUIComponent.active` 控制；按钮纯交互（视觉归子节点/同节点 UIImage）；同一节点最多一个 UIImageComponent
- 改完保存时会提示是否生成 .html 源（`ui.decompile <路径>` 命令可手动生成）

## 参考
- **使用手册（写法权威）**：`doc/editor/ui/ui_widget_html_manual.md`——标签/CSS 白名单、布局配方、data-comp 逃逸通道、禁区清单、FAQ
- 系统文档：`doc/editor/ui/ui_source_format_system.md`（编译链路/双向同步/边界条件，改编译器时读）
- 映射面全集：`devdoc/ui-html-source-format/full-mapping.md`
- 编译器实现：`src/editor/asset/uiCompiler/`；组件实现：`src/engine/ui/`
- 示例源：`src/projects/fish/asset/blueprints/ui/`（toast 最小例 → tasks_ui 动态列表 → gm_panel 全家桶）
