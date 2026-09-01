---
name: skl-create-ui-widget-asset
description: 创建 DemoStudio UI widget 资产。首选：写 .widget.html 源 + 调 MCP ui_compile 编译（自动过 lint）。仅旧资产小改才直接写 JSON。
---

# 创建 UI widget 资产（.widget.html → ui_compile）

## 何时使用
- 新建/编辑 UI 面板资产（HUD、主菜单、按钮/文本/图片控件）

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

2. 调 MCP `ui_compile` 工具编译（不要用 CLI，无 lint 门槛）：
   `{ "asset": "src/projects/<project>/asset/blueprints/ui/<描述>.widget.html" }`
3. 失败按 `errors[{line,message}]` 行号修源重试，不要手改 json

映射：`div`=容器（display:flex→UILayout；background→UIImage）｜`img`=UIImage｜`text`=UIText｜`button`=UIButton｜`data-comp/data-props`=组件透传｜`data-script/data-args`=UIScript。px 按根画布比例自动换算成米。

## 辅助路径：直接写 .widget.json（仅限无源文件的旧资产小改）

根三件套：UITransform（worldWidth/worldHeight 米）+ CanvasUI（width/height 像素 + active:true）+ 可选 UIScript。每控件 = Actor + UITransform + CanvasUI(markerOnly) + 功能组件。transform 只写在 UITransformComponent。id/name 唯一。

## 参考
- 系统文档：`doc/editor/ui_source_format_system.md`
- 示例：`src/projects/fish/asset/blueprints/ui/toast.widget.html`
