---
name: skl-create-ui-widget-asset
description: '创建 DemoStudio UI widget 资产。首选路径：写 .widget.html 源 + 调 MCP ui_compile 编译为 .widget.json（自动过 assetLint 零错误门槛 + 双向同步）。仅当维护无源文件的旧资产时才直接写 JSON。使用时机：用户要求新建/编辑 UI 面板资产，如"创建一个 HUD"、"写主菜单 UI"、"添加一个按钮/文本/图片控件"、"widget 里挂脚本"。'
argument-hint: 'widget 名称或 UI 面板用途描述'
---

# 创建 UI widget 资产（.widget.html → ui_compile）

> 主路径（HTML 源格式）见 `doc/editor/ui/ui_source_format_system.md`；本文件是操作规范。

## 何时使用
- 用户要求新建 UI 资产（如"创建一个 HUD"、"写主菜单 UI"）
- 修改现有 widget 的控件树（面板、按钮、文本、图片）

## 主路径：写 .widget.html + 调 MCP ui_compile（新功能/改有源文件的 widget 一律走此路）

### 1. 文件位置与命名

- 源文件：`src/projects/<project>/asset/blueprints/ui/<描述>.widget.html`
- 编译产物：同目录同名 `<描述>.widget.json`（ui 目录下 .json 由 `import.meta.glob` 自动注册，无需写 path）
- 同名 .html 与 .json 成对存在时，编辑器保存 json 会自动反编译回写 html（双边同改以最后保存方为准）

### 2. 源文件写法（完整原生 HTML 映射，2026-09 升级）

> 编译器已支持完整原生 HTML/CSS 映射（权威文档 `devdoc/ui-html-source-format/full-mapping.md`）：
> 常规标签（div/p/h1-h6/ul/ol/li/span/b/i/table 等）、完整选择器（#id/后代/子代/:nth-child）、
> 级联+继承+!important+inline style、px/%/em/rem/vw/vh/calc()/var()/命名色、
> 盒模型（margin/padding/border）、块级流默认布局（不写 flex 也堆叠）、
> flex(wrap/grow/shrink)、grid、@media、linear-gradient 渐变、transform、标准 text-shadow。
> 越界写法（未知标签/属性、script、overflow:hidden）**编译期硬报错**，绝不静默忽略。

```html
<widget name="Toast" canvas="960x180" world="4.8x0.9" anchor="top-center" offset="0,0.55">
  <style>
    .ToastPanel { width: 960px; height: 180px; background-color: rgba(58, 36, 24, 0.92); border-radius: 24px; }
    .ToastText { width: 920px; height: 160px; font-size: 28px; color: #f5e6c8; font-weight: bold; text-align: center; z-order: 1; }
  </style>
  <div class="ToastPanel">
    <text class="ToastText"></text>
  </div>
</widget>
```

元素 ↔ 组件映射：

| 元素 | 产出组件 | 说明 |
|---|---|---|
| `<div>` | 容器 Actor（+UILayout 若 `display:flex`；+UIImage 若带 background/border-radius/opacity） | 纯容器或背景面板 |
| `<img src="...">` | UIImageComponent | void 叶子；background-color 作纯色填充 |
| `<text>` | UITextComponent | 原生文本也可直接写（`<p>`/`<h1>` 等 → 容器+文本） |
| `<button>` | UIButtonComponent + 可选 UIImage 背景 | `:hover/:active/:disabled` 颜色 → UIScript.args（需 data-script 消费） |
| `data-comp`/`data-props` | 任意组件透传 | 逃逸通道（UIProgressBar 等无映射组件） |
| `data-script`/`data-args` | UIScriptComponent | 任意元素可挂；script id 必须真实存在 |

关键属性：
- `<widget name="X" canvas="宽x高">`：canvas 为画布像素（1920×1080 常见全屏，480×90 等小件自定）
- `world="宽x高"`（米）：声明根世界尺寸，缺省宽 4.8、高按画布比例。全屏= `9.6x5.4`（1920×1080）；不带 world 属性时也可正常编译
- `anchor`/`offset`：根锚点（如 `top-center`）+ 世界米偏移
- 子元素定位：`position: absolute; left/top/right/bottom` ↔ 锚点自动反解；默认**块级流**（不写 flex 子项纵向堆叠）；`display:flex`（含 wrap/grow/shrink/basis）与 `display:grid`（px/%/fr/auto、repeat()、线位）编译期静态求解为精确坐标
- 布局期文本宽度为字体学估算（CJK≈1em/字、拉丁≈0.52em/字符）——需要精确尺寸的元素显式给 width/height
- px↔米换算按根画布比例自动处理，AI 只按像素写布局

### 3. 编译（必须）

写完源文件后**必须调用 MCP `ui_compile` 工具**（不要用 CLI——CLI 不带 assetLint 门槛）：

```json
{ "asset": "src/projects/<project>/asset/blueprints/ui/<描述>.widget.html" }
```

- 成功：json 自动落盘（含 sourceHash），产物已过 assetLint 零 error 门槛；`warnings[]` 为近似披露（文本估算/装饰属性不渲染等），逐条确认可接受
- 失败：返回 `errors[{line, message}]`——按行号修源重试，不要手改 json

### 4. 完成检查

- [ ] 调用 `ui_compile` 成功（零编译错误 + 零 lint error）
- [ ] 同目录出现同名 .widget.json
- [ ] 交互逻辑用 `data-script` 挂 UIScriptComponent（id 来自 `gameplay/**/*.script.ts`）

## 辅助路径：直接写 .widget.json（仅限维护无源文件的旧资产）

只在这些情况下用：给**没有同名 .html** 的旧 widget（如 `main_menu.widget.json`）做小改动。新功能禁止直接写 JSON。

要点（详见 `doc/editor/ui/ui_source_format_system.md` 与组件 schema）：
- 根三件套：UITransformComponent（worldWidth/worldHeight 米制，全屏 9.6×5.4）+ CanvasUIComponent（width/height 像素 + active: true）+ 可选 UIScriptComponent
- 每个控件节点 = Actor（name/id 唯一）+ UITransform + CanvasUI(markerOnly: true, name: "UIMarker") + 功能组件
- **组件优先约定**：position/rotation/scale 只写在 UITransformComponent properties（顶层写法 → error）
- 显隐由 `CanvasUIComponent.active` 控制；按钮纯交互（视觉归子节点/同节点 UIImage）；同一节点最多一个 UIImageComponent
- 颜色格式：CSS hex 或 rgba()
- 改完保存时会提示是否生成 .html 源（`ui.decompile <路径>` 命令可手动生成）

## 通用规则（两路径都遵守）

- name 同资产内唯一（AI 按定位/脚本按 name 找控件）
- 脚本 id 必须存在：`src/projects/<project>/gameplay/**/*.script.ts`
- 组件新增字段须同步 assetLint（comp:* 检查器）——本技能产出的资产必须零 lint 错误
- 预览验证：资产面板选中 widget 走 UIPreviewManager 2D 预览

## 参考
- 系统文档：`doc/editor/ui/ui_source_format_system.md`（映射规则/边界条件/双向同步）
- 编译器实现：`src/editor/asset/uiCompiler/`（compile/decompile/widgetMapping/miniParser）
- MCP 工具：`editor/mcp-server.mjs` 的 `ui_compile`（经 electron/main.ts 白名单 → EditorInitializer → uiSourceActions）
- 组件实现：`src/engine/ui/`（UITransform/UIText/UIImage/UIButton/UIScript/UILayout）
- 示例源：`src/projects/fish/asset/blueprints/ui/toast.widget.html`
