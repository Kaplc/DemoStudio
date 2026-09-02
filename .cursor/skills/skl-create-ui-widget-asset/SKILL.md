---
name: skl-create-ui-widget-asset
description: 创建 DemoStudio UI widget 资产。核心理念：只写普通 HTML+CSS 前端写法，引擎/编译器细节不用管（第 0 步先读手册全文）。流程：写 .widget.html 源 + 调 MCP ui_compile 编译（自动过 lint）。仅旧资产小改才直接写 JSON。
---

# 创建 UI widget 资产（.widget.html → ui_compile）

> **核心心智：把 widget 当一张普通网页写。** 只写 HTML+CSS 前端写法（flex/grid/margin/CSS 全套）；引擎组件、锚点、米制换算、布局求解编译器全部自动处理，代码里不要出现任何引擎概念。

## 何时使用
- 新建/编辑 UI 面板资产（HUD、主菜单、按钮/文本/图片控件）

## 第 0 步：读手册（必须）
用 Read 完整阅读：`doc/editor/ui/ui_widget_html_manual.md`（标签/CSS 白名单、布局配方、禁区清单、FAQ）。

## 主路径：.widget.html + MCP ui_compile

1. 写源文件 `src/projects/<project>/asset/blueprints/ui/<描述>.widget.html`

```html
<widget name="Toast" canvas="960x180" world="4.8x0.9" anchor="top-center" offset="0,0.55">
  <style>
    .ToastPanel { width: 960px; height: 180px; background-color: rgba(58, 36, 24, 0.92); border-radius: 24px; }
    .ToastText { width: 920px; height: 160px; font-size: 28px; color: #f5e6c8; font-weight: bold; text-align: center; }
  </style>
  <div class="ToastPanel">
    <text class="ToastText"></text>
  </div>
</widget>
```

2. 调 MCP `ui_compile` 工具编译（不要用 CLI，无 lint 门槛），**asset 传 .widget.json 路径**：
   `{ "asset": "src/projects/<project>/asset/blueprints/ui/<描述>.widget.json" }`
3. 失败按 `errors[{line,message}]` 行号修源重试，不要手改 json

速记：布局流式优先（遮罩 absolute + 面板 `margin:auto` 居中 + 内容 flex 栈）；动态列表容器挂 `data-comp="UILayout"` + 显式宽高；被脚本引用的 class 名逐字保留（脚本 findInChildren 按名查找）；禁区：`<script>`/onclick/overflow:hidden/@keyframes/兄弟选择器。

## 辅助路径：直接写 .widget.json（仅限无源文件的旧资产小改）

根三件套：UITransform（worldWidth/worldHeight 米）+ CanvasUI（width/height 像素 + active:true）+ 可选 UIScript。每控件 = Actor + UITransform + CanvasUI(markerOnly) + 功能组件。transform 只写在 UITransformComponent。id/name 唯一。

## 参考
- **使用手册（写法权威）**：`doc/editor/ui/ui_widget_html_manual.md`
- 系统文档：`doc/editor/ui/ui_source_format_system.md`
- 示例：`src/projects/fish/asset/blueprints/ui/`（toast 最小例 → tasks_ui 动态列表 → gm_panel 全家桶）
