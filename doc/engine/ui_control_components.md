# UI 控件组件（UI Control Components）

> **一句话定位**：`UIImageComponent`（位图/纯色/渐变填充）、`UITextComponent`（troika 矢量文本）、`UITextInputComponent`（可编辑单行输入框）是引擎 UI 的三个基础视觉控件——它们继承 `CanvasUIComponent`、挂到 UI Actor 的节点上，负责把文字和图像渲染到屏幕。
>
> **什么时候会用到你**：UI 面板上要显示图片/文字/输入框；背景色不对、文字不显示、字号被控件尺寸牵动；输入框焦点/光标/粘贴不工作。
>
> 代码位置：`src/engine/ui/`

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [UIImageComponent.ts](../../src/engine/ui/UIImageComponent.ts) | 图像控件：纯色/渐变/图片填充 + 圆角裁剪 | 背景色/圆角不对、图片不加载、渐变方向错 |
| [UITextComponent.ts](../../src/engine/ui/UITextComponent.ts) | 文本控件：troika-three-text 矢量渲染 + 自动换行 | 文字不显示/字号不对/换行溢出/行高不对 |
| [UITextInputComponent.ts](../../src/engine/ui/UITextInputComponent.ts) | 输入框控件：继承 UITextComponent，加光标/选择/键盘路由 | 输入框无光标/不能打字/粘贴没反应/选中区不显示 |

**关键心智模型**：这三个控件都继承 `CanvasUIComponent`，但渲染方式完全不同——UIImage 走 2D Canvas 位图纹理，UIText 走 troika 矢量 mesh（`markerOnly=true` 不创建 Canvas 纹理），UITextInput 在 UIText 基础上叠加光标字符和选中区 mesh。**尺寸权威在 `UITransformComponent`**，控件自身不决定大小。

---

## 2. UIImageComponent：从颜色/图片到屏幕像素

### 2.1 构造与渲染

UIImageComponent 构造时创建 Canvas 纹理，调用 `redraw()` 触发首次绘制：

```ts
// UIImageComponent.ts:38
constructor(owner: Actor, options: UIImageComponentOptions = {}) {
  const width = options.width ?? 256
  const height = options.height ?? 256
  super(owner, { width, height, ... })
  this._color = options.color ?? '#ffffff'
  this._radius = options.radius ?? 0
  this._image = options.image ?? null
  this._gradient = options.gradient
  if (options.opacity !== undefined) this.setOpacity(options.opacity)
  this.redraw()
  if (!this._image && options.src) this.loadImage(options.src)
}
```

> 默认 256×256 像素画布，白色填充。`redraw()` 在构造时调用一次，异步加载图片完成后再次调用。`opacity` 通过 `setOpacity` 设置，不走 `redraw`（它是 CanvasUIComponent 基类的纹理透明度）。

### 2.2 三种填充模式

`render` 方法在 Canvas 2D 上绘制，支持三种模式，优先级：**图片 > 渐变 > 纯色**：

```ts
// UIImageComponent.ts:140
protected render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  if (this._radius > 0) {
    ctx.save()
    ctx.beginPath()
    this.roundRectPath(ctx, 0, 0, w, h, this._radius)
    ctx.clip()
  }
  if (this._image) {
    ctx.drawImage(this._image, 0, 0, w, h)
  } else if (this._gradient && this._gradient.stops.length >= 2) {
    const a = (this._gradient.angle * Math.PI) / 180
    const dx = Math.sin(a)
    const dy = Math.cos(a)
    const len = Math.abs(w * dx) + Math.abs(h * dy)
    const cx = w / 2
    const cy = h / 2
    const grad = ctx.createLinearGradient(
      cx - (dx * len) / 2, cy - (dy * len) / 2,
      cx + (dx * len) / 2, cy + (dy * len) / 2,
    )
    for (const stop of this._gradient.stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.fillStyle = this._color
    ctx.fillRect(0, 0, w, h)
  }
  if (this._radius > 0) ctx.restore()
}
```

> **圆角**：通过 `ctx.clip()` 实现，`roundRectPath` 用 `quadraticCurveTo` 画四角圆弧。半径自动钳制到 `min(w/2, h/2)`，避免矩形过小圆角重叠。
>
> **渐变**：CSS `linear-gradient` 语义映射——`angle=0` 向上、`90` 向右（度）。渐变线过画布中心，线长 = `|w·sin| + |h·cos|`，确保色标覆盖整个矩形。
>
> **图片**：`drawImage` 拉伸填满画布，不保持宽高比。异步加载通过 `loadImage(src)` 触发，完成自动 `redraw()`。

### 2.3 异步图片加载

```ts
// UIImageComponent.ts:113
loadImage(src: string): void {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    this._image = img
    this.redraw()
  }
  img.onerror = () => {
    logger.error(`[UIImageComponent] 图片加载失败: ${src}`)
  }
  img.src = src
}
```

> `crossOrigin='anonymous'` 保证跨域图片不污染 Canvas。加载失败只留 error 日志，不抛异常——图片区域保持纯色/渐变填充。

### 2.4 激活状态与 Inspector

UIImageComponent 覆写了 `applyActive`，使其 `bActive` 只控制自身 panel 显隐，**不下推到 owner**：

```ts
// UIImageComponent.ts:82
protected override applyActive(): void {
  if (this.panel) this.panel.visible = this.bActive
}
```

> 这是关键区别：UIImage 是"视觉块"而非"节点开关"。节点级显隐由同/父节点的 `CanvasUIComponent` 统一控制（`canvas.active → owner.bActive → 递归子树`）。如果 UIImage 把 `bActive` 下推到 owner，会误关同节点其他组件（如 UIText）。

---

## 3. UITextComponent：矢量文本渲染

### 3.1 构造与字号固化

UITextComponent 继承 `CanvasUIComponent` 但 `markerOnly=true`——不创建位图画布 mesh，文本由 troika-three-text 的 GPU 字形 mesh 渲染：

```ts
// UITextComponent.ts:89
constructor(owner: Actor, options: UITextComponentOptions = {}) {
  super(owner, { width, height, ..., markerOnly: true, ... })
  // ...
  // 构造时固化换算系数
  if (options.fontSizeScale != null) {
    this._pxToWorld = options.fontSizeScale
  } else {
    const [, dbgWh] = this.getWorldSize()
    this._pxToWorld = dbgWh / height
  }
  this.initTroika()
}
```

> **字号不随控件尺寸缩放**：`_pxToWorld` 在构造时固化一次，后续 `onWorldSizeChange` 只重算换行宽度（`maxWidth`），不改变字号。这是设计意图——拖大控件不该把字撑大。`fontSizeScale` 持久化到资产，蓝图重建时直接复用，避免预览重建打破字号。

### 3.2 troika mesh 创建与属性同步

```ts
// UITextComponent.ts:170
private initTroika(): void {
  const mesh = new TroikaText()
  mesh.name = 'UITextMesh'
  this.mesh = mesh
  mesh.renderOrder = this.zOrder
  mesh.position.z = this.zOrder * 0.001 + 0.0002
  this.owner.root.add(mesh)
  this.registerRenderObject(mesh)
  this.applyAll()
}
```

> troika mesh 挂在 `owner.root` 下（与 Canvas 面板同级）。`position.z` 的 `+0.0002` 偏移保证文本恒在面板底之上（同层不 z-fighting）。`registerRenderObject` 让 CanvasUIComponent 基类管理其生命周期。

`applyAll` 同步所有属性到 troika mesh：

```ts
// UITextComponent.ts:185
protected applyAll(): void {
  const [ww] = this.getWorldSize()
  mesh.fontSize = this._fontSize * this._pxToWorld
  mesh.maxWidth = ww
  mesh.textAlign = this._align
  mesh.anchorX = this._anchorX
  mesh.anchorY = 'middle'
  mesh.color = this._color
  // 换行：whiteSpace normal + overflowWrap break-word
  ;(mesh as unknown as { whiteSpace: string }).whiteSpace = 'normal'
  ;(mesh as unknown as { overflowWrap: string }).overflowWrap = 'break-word'
  mesh.font = resolveTroikaFontURL(this._fontFamily, this._bold)
  // ...
  mesh.sync()
}
```

> **换行**：`overflowWrap='break-word'` 让长中文/长单词在任意字符间断行（默认只在空格处断行，会溢出控件）。
>
> **字体**：troika 只接受字体文件 URL（XHR 加载），不支持 CSS `font-family` 名。`resolveTroikaFontURL` 把 CSS 名映射到内置思源黑体 woff 文件——与 `TroikaFontPreload` 共用同一 URL 推导，保证预热缓存命中。
>
> **左对齐补偿**：`anchorX='left'` 时设 `position.x = -ww/2`，让文本左边缘对齐元素左边缘（元素中心是 root 原点）。

### 3.3 行高与字间距

```ts
// 行高：内部 ×100 存储
this._lineHeight = Math.round((options.lineHeight ?? 1.4) * 100)
// troika lineHeight 语义为无单位倍数
mesh.lineHeight = this._lineHeight / 100

// 字间距：设计语义是绝对 px，troika 语义是 fontSize 倍数
mesh.letterSpacing = this._fontSize > 0 ? this._letterSpacing / this._fontSize : 0
```

> 行高系数 `1.4` 内部存为 `140`，显示时 `/100` 保留 2 位小数。字间距从绝对 px 换算为 fontSize 倍数传给 troika。

### 3.4 世界模式渲染适配

```ts
// UITextComponent.ts:310
override enableWorldRendering(maxAnisotropy: number): void {
  this._worldRendering = true
  if (this.mesh) {
    const mat = (this.mesh as unknown as THREE.Mesh).material as THREE.Material | undefined
    if (mat) mat.depthWrite = false
    this.mesh.renderOrder = this._renderOrderBias + this.zOrder + 0.5
  }
}
```

> world 模式关深度写入（内部定序全交 `renderOrder`），半步偏移 `+0.5` 保证文本恒压其面板底的相对序。

---

## 4. UITextInputComponent：可编辑文本输入框

### 4.1 继承 UITextComponent

UITextInputComponent 继承 UITextComponent，复用其 troika 文本渲染，叠加光标、选中区、键盘路由：

```ts
// UITextInputComponent.ts:51
export class UITextInputComponent extends UITextComponent {
  private _value = ''
  private _placeholder: string
  private _focused = false
  private _selectionStart = 0
  private _cursorPos = 0
  // ...
}
```

> 构造时强制 `anchorX='left'`（输入框单行文本必须左对齐——短文本从元素左边缘开始输入），`bold=true`。延迟一帧初始化选中区 mesh（等 troika 就绪）。

### 4.2 光标渲染：'|' 字符插入

```ts
// UITextInputComponent.ts:280
private refreshText(): void {
  if (this._focused) {
    this.text = this._value.slice(0, this._cursorPos) + '|' + this._value.slice(this._cursorPos)
    this.color = this._textColor
    this.updateSelectionMesh()
  } else if (this._value) {
    this.text = this._value
    this.color = this._textColor
    this.hideSelectionMesh()
  } else {
    this.text = this._placeholder
    this.color = this._placeholderColor
    this.hideSelectionMesh()
  }
}
```

> 光标不是独立 mesh，而是在文本中插入 `'|'` 字符。失焦时隐藏光标，`value` 为空显示灰色占位符。选中区用独立 `PlaneGeometry` mesh 叠加渲染（`getSelectionRects` 精确包围盒）。

### 4.3 键盘路由

组件不直接监听全局键盘，由使用方（GMConsoleHUD）在控制台打开时把按键转交：

```ts
// UITextInputComponent.ts:145
handleKey(key: string): boolean {
  if (key === 'Enter') { this._onSubmit?.(this._value); return true }
  if (key === 'Backspace') { /* 删选中或删光标前 */ }
  if (key === 'Delete') { /* 删光标后 */ }
  if (key === 'ArrowLeft' || key === 'Shift+ArrowLeft') { /* 左移/框选 */ }
  if (key === 'ArrowRight' || key === 'Shift+ArrowRight') { /* 右移/框选 */ }
  if (key.length === 1) { this._insertAtCursor(key); this._onTextChanged?.(this._value) }
  // Ctrl+A/C/V/X, Home/End, Ctrl+Home/End
}
```

> 支持 Shift 框选（锚点固定/光标移动模型）、Ctrl 快捷键（全选/复制/剪切/粘贴）、Home/End 跳转。`handlePasteText` 作为粘贴兜底（绕过 Ctrl+V 劫持）。

### 4.4 选中区高亮

```ts
// UITextInputComponent.ts:340
private updateSelectionMesh(): void {
  const mesh = this._selectionMesh
  const troika = (this as unknown as { mesh: TroikaText }).mesh
  // 立即尝试一次（布局已就绪时零延迟），再在 sync 回调里重试
  this.applySelectionRect()
  troika.sync(() => this.applySelectionRect())
}
```

> 字形布局是异步的（troika sync），`refreshText` 设新 text 后 `textRenderInfo` 仍是旧布局。双保险：立即尝试 + sync 回调重试，回调内重新读取当前选区（快速连按时避免过期闭包画旧选区）。

### 4.5 持久化与 Inspector

UITextInputComponent 覆写 `getEditableProperties` 和 `getPersistentProps`，**过滤掉父类 UITextComponent 的静态文本专属字段与基类 `hitTest`**（`text/align/bold/italic/lineHeight/letterSpacing/hitTest`）：

```ts
// UITextInputComponent.ts:300
override getEditableProperties(): EditableProperty[] {
  const blocked = new Set(['text', 'align', 'bold', 'italic', 'lineHeight', 'letterSpacing', 'hitTest'])
  const base = super.getEditableProperties().filter((p) => !blocked.has(p.key))
  return [
    ...base, // fontSize/color/zOrder
    { key: 'placeholder', type: 'string', ... },
    { key: 'value', type: 'string', ... },
  ]
}
```

> 输入框渲染由 `value/placeholder` 驱动，父类的静态文本属性对输入框无意义。不过滤的话保存资产时会被持久化污染，assetLint 报未知属性。

---

## 5. 关键方法速查

| 方法 | 位置 | 干什么 | 注意 |
|---|---|---|---|
| `UIImageComponent.redraw()` | [UIImageComponent.ts:130](../../src/engine/ui/UIImageComponent.ts) | 触发 Canvas 重绘（走 `draw(render)`） | 构造时自动调用，图片加载完成自动调用；改 color/radius/gradient 后手动调 |
| `UIImageComponent.loadImage(src)` | [UIImageComponent.ts:113](../../src/engine/ui/UIImageComponent.ts) | 异步加载图片，完成后自动 redraw | 跨域自动加 `anonymous`；失败只打 error 不抛异常 |
| `UIImageComponent.render(ctx,w,h)` | [UIImageComponent.ts:140](../../src/engine/ui/UIImageComponent.ts) | 三种填充模式：图片 > 渐变 > 纯色 | 圆角走 `ctx.clip()`；渐变线长 = \|w·sin\| + \|h·cos\| |
| `UITextComponent.initTroika()` | [UITextComponent.ts:170](../../src/engine/ui/UITextComponent.ts) | 创建 troika mesh + 注册 + applyAll | markerOnly=true，不创建 Canvas 位图 |
| `UITextComponent.applyAll()` | [UITextComponent.ts:185](../../src/engine/ui/UITextComponent.ts) | 同步所有属性到 troika mesh + sync | 改 text/fontSize/color 等都走此路径 |
| `UITextComponent.onWorldSizeChange()` | [UITextComponent.ts:260](../../src/engine/ui/UITextComponent.ts) | 尺寸变化只重算换行宽度（maxWidth） | 字号不随控件尺寸缩放——`_pxToWorld` 构造时固化 |
| `UITextInputComponent.focus()/blur()` | [UITextInputComponent.ts:100](../../src/engine/ui/UITextInputComponent.ts) | 聚焦/失焦：显示/隐藏光标 + 占位符切换 | 聚焦时光标到末尾 |
| `UITextInputComponent.handleKey(key)` | [UITextInputComponent.ts:145](../../src/engine/ui/UITextInputComponent.ts) | 键盘输入处理（由使用方转交） | 返回 true=按键被消费；支持 Shift 框选/Ctrl 快捷键 |
| `UITextInputComponent.setCursorFromClick()` | [UITextInputComponent.ts:130](../../src/engine/ui/UITextInputComponent.ts) | 根据点击世界坐标设置光标位置 | 用 troika `getCaretAtPoint` 精确定位 |
| `UITextInputComponent.handlePasteText(text)` | [UITextInputComponent.ts:115](../../src/engine/ui/UITextInputComponent.ts) | 粘贴文本（GMConsoleHUD 兜底） | 去掉换行符，替换选中区域 |

---

## 6. 流程影响：牵动哪些功能

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| `UIManager.spawnUIActor` | 蓝图解析 → ActorRegistry.create → 组件构造 → BeginPlay | [世界 UI 系统](./ui_system.md) |
| `UITransformComponent` 尺寸变化 | `onWorldSizeChange` 回调（UIText 重算换行宽，UIImage 不响应） | [世界 UI 系统](./ui_system.md) |
| 编译器 `emitImage`/`emitText`/`emitButton` | `.widget.html` 编译为蓝图 properties | [UI 源格式与编译器](../editor/ui/ui_source_format_system.md) |
| `TroikaFontPreload` | 预热字体缓存，影响 UIText 首次渲染延迟 | [字体预热与锚定](./ui_world_anchor_script.md) |
| GMConsoleHUD | 把键盘事件转交 `UITextInputComponent.handleKey` | [GM 命令系统](./gm_system.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| Canvas 渲染与命中拦截 | UIImage 的 Canvas 纹理参与 `hitTest` 拦截；UIText markerOnly 不参与 | [CanvasUIComponent](./ui_canvas_component.md) |
| 资产检查器（assetLint） | 组件新增字段必须同步资产样例与检查器；`gradient` 是历史上漏接的典型 | [资产预览与检查](../editor/asset/asset_preview_lint_system.md) |
| UI 锚点系统 | 控件尺寸由 `UITransformComponent` 决定，锚点定位依赖其 `worldSizeExplicit` | [UI 锚点系统](../editor/ui/ui_anchor_system.md) |
| 脚本系统 | `UIScriptComponent` 通过 `getComponent(UITextComponent/UIButtonComponent)` 直接操作控件属性 | [脚本系统](./script_system.md) |
| 世界 UI 锚定 | world 模式调用 `enableWorldRendering` 切换文本/图像的深度写入与 renderOrder | [世界锚定与脚本](./ui_world_anchor_script.md) |

---

## 7. 踩坑清单（都是真踩过的）

**1. 文字不显示 / 首次打开面板文字延迟出现** —— troika 冷启动链路：worker 首次创建 → 思源黑体 woff（~1.5MB）XHR 下载 → Typr 解析 → 逐字形 SDF 生成。**规则**：首次面板文字延迟是正常冷启动，`TroikaFontPreload.preloadTroikaFonts()` 在 App 启动时预热可缓解；预热与渲染必须共用 `resolveTroikaFontURL`，两处各写一份 URL 推导会让预热静默失效。

**2. 字号被控件尺寸牵动（拖大按钮字也变大）** —— `_pxToWorld` 在构造时固化，但若 `fontSizeScale` 未持久化，蓝图重建（预览拖拽尺寸）会重新推导系数。**规则**：`getPersistentProps` 必须高精度持久化 `fontSizeScale`（`Math.round(px * 1e6) / 1e6`），回灌时直接复用，避免重建打破字号。

**3. 长中文/长单词溢出控件不换行** —— troika 默认 `overflowWrap='normal'` 只在空格处断行。**规则**：`applyAll` 显式设 `overflowWrap='break-word'` 让任意字符间断行。

**4. 输入框粘贴没反应 / Ctrl+V 被浏览器劫持** —— 浏览器安全策略拦截 `navigator.clipboard.readText()`。**规则**：GMConsoleHUD 用 `handlePasteText` 作为兜底（从 paste 事件取 clipboardData），绕过 Ctrl+V 劫持。

**5. 输入框选中区不显示 / 位置错位** —— troika 字形布局异步，`refreshText` 设新 text 后 `textRenderInfo` 仍是旧布局。**规则**：`updateSelectionMesh` 用双保险——立即尝试 + sync 回调重试，回调内重新读取当前选区（避免过期闭包画旧选区）。

**6. 图片加载失败后区域保持白色** —— `loadImage` 失败只打 error 不抛异常，`_image` 保持 null，回退到纯色/渐变填充。**规则**：排查图片不显示先看日志的 `[UIImageComponent] 图片加载失败`。

**7. 渐变方向与 CSS 不一致** —— CSS `linear-gradient(90deg)` 向右，引擎 `angle=90` 也是向右，但 Canvas 渐变线计算用 `(sin a, cos a)` 且 canvas y 轴向下。**规则**：渐变方向公式已验证与 CSS 一致，若有偏差先检查 `angle` 单位（度）和色标 `offset` 范围 [0,1]。

---

## 8. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| UIImage 无 `src` 无 `gradient` | 纯色填充（默认白色） | 设 `color` 属性 |
| UIImage 圆角 > min(w/2, h/2) | 自动钳制到 min(w/2, h/2) | 圆角不会导致矩形变形 |
| UIText 无显式世界尺寸 | 按 canvas 宽高比自动推算（默认高 200） | 尺寸权威在 uitransform，显式设 tsf 尺寸 |
| UIText `fontFamily` 为 CSS 名 | 回退到内置思源黑体 | 要自定义字体传字体文件 URL |
| UITextInput 未聚焦 | 显示 value（有值）或 placeholder（灰色，无值） | 聚焦才显示光标 |
| UITextInput `handleKey` 未消费的键 | 返回 false，宿主可继续转发 | Escape 返回 false 让宿主关闭面板 |
| 选中区无内容（selStart === selEnd） | 隐藏选中区 mesh | 不影响光标显示 |
| 剪贴板不可用 | `_copySelection`/`_pasteFromClipboard` 静默失败 | 用 `handlePasteText` 兜底 |
