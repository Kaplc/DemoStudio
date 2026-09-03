# UI Widget HTML 编写手册（作者版）

> **一句话定位**：这是给 AI / 人**手写 `.widget.html` 资产**的编写手册——你只写普通 HTML + CSS，编译器把它翻译成引擎认的 `.widget.json`。
>
> **什么时候会用到你**：AI 接到「做一个 HUD / 面板 / 弹窗 / 列表」任务从零写 widget 时、改现有 widget 时、编译报错不知道怎么改时、不确定某个 HTML/CSS 写法支不支持时。
>
> 代码位置：你写的源在 `src/projects/<project>/asset/blueprints/ui/*.widget.html`；编译器在 `src/editor/asset/uiCompiler/`

---

## 0. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [compile.ts](../../../src/editor/asset/uiCompiler/compile.ts) | HTML → json 全管线：解析 → 级联 → 布局求解 → 发射 | 查"某个写法支不支持"的最终依据 |
| [decompile.ts](../../../src/editor/asset/uiCompiler/decompile.ts) | json → 规范形 HTML | 理解为什么保存后源变成一堆 absolute |
| [uiSourceActions.ts](../../../src/editor/asset/uiSourceActions.ts) | 编辑器编译动作：编译 → lint 门槛 → 落盘 | 排查"编译了但没落盘" |
| [toast.widget.html](../../../src/projects/fish/asset/blueprints/ui/toast.widget.html) | 最小可编译范例（9 行） | 新 widget 从它抄骨架 |
| [ui_source_format_system.md](./ui_source_format_system.md) | 兄弟文档：编译/反编译**机制** | 要改编译器、查 map 规则细节时去那边 |

**与兄弟文档的分工**（别走错门）：

- **本手册**（本文档）= **怎么写源**。面向写 `.widget.html` 的人，讲白名单、布局配方、禁区。
- [ui_source_format_system.md](./ui_source_format_system.md) = **编译器怎么工作**。面向改编译器的人，讲编译管线、反编译回写、冲突仲裁、CLI 退出码。

**关键心智模型**：**把 widget 当一张普通网页写。** 你在浏览器里写出的样子，就是游戏里运行的样子。以下引擎概念你完全不用管，也不要出现在代码里：

| 引擎概念 | 你要做的 |
|---|---|
| UITransform / worldWidth（米制） | 不用管。你写 px，编译器按画布比例自动换算 |
| 九宫格锚点 / anchorOffset | 不用管。flex / margin / absolute 由编译器解算成精确坐标 |
| UILayout 运行时重排 | 不用管。纯静态布局自动出坐标；动态列表见 §7 |
| 组件 properties / assetLint schema | 不用管。合法标签+CSS 编译产物必然过 lint |

**三条铁律：**

1. **只写 HTML + CSS**——正常网页写法，流式布局优先。
2. **不写任何脚本**——没有 `<script>`、没有 `onclick`；行为一律 `data-script` 挂脚本（§6）。
3. **越界写法编译期硬报错**，绝不静默忽略——报错按行号改源就行，见 §8 禁区清单。

---

## 1. 30 秒最小骨架

[toast.widget.html](../../../src/projects/fish/asset/blueprints/ui/toast.widget.html) 是仓库里最小的合法 widget，全文 9 行：

```html
<widget name="Toast" canvas="960x180" world="4.8x0.9" anchor="top-center" offset="0,0.55">
  <style>
    .ToastPanel { width: 960px; height: 180px; position: absolute; left: 0px; top: 0px; background-color: #3a2418eb; border-radius: 24px; }
    .ToastText { width: 920px; height: 160px; z-index: 1; font-size: 28px; color: #f5e6c8; text-align: center; font-weight: bold; text-shadow: 1px 2px 4px #00000099; }
  </style>
    <div class="ToastPanel">
      <text class="ToastText"></text>
    </div>
</widget>
```

**class 名就是节点名**（§5）。`<style>` 里的 CSS 支持级联/继承/选择器全套（§3）。注意它的 `<text>` 是**空标签**——游戏里文案由脚本填，源里只占位。

---

## 2. `<widget>` 根标签参数

```html
<widget name="面板Actor名" canvas="宽x高(px)" world="宽x高(米)" anchor="锚点" offset="x,y(米)" data-script="脚本路径" active="false">
```

| 属性 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 根 Actor 名 |
| `canvas` | ✅ | 画布像素尺寸，**你的 CSS 都按这个坐标系写**。全屏 1920x1080，小件自定（如 480x90） |
| `world` | 推荐 | 根世界尺寸（米）。全屏 = `9.6x5.4`；缺省宽 4.8、高按画布比例 |
| `anchor` / `offset` | 可选 | 根锚点（如 `top-center`）+ 世界米偏移。全屏面板不用写（铺满即可） |
| `data-script` | 可选 | 面板行为脚本，挂根节点（§6） |
| `active="false"` | 可选 | 根默认隐藏（脚本控制显示时用） |

编译器怎么读这些属性（[compile.ts:514](#) `compileWidgetHtml` 内）：

```ts
const name = root.attrs['name'] ?? root.attrs['data-name']
if (!name) {
  throw new CompileFail(
    '缺少 widget 名称（<widget name="..."> 或 <body name="...">；full-document 可用 <title>）',
    root.line,
  )
}
const canvasStr = root.attrs['canvas'] ?? `${FULLSCREEN_CANVAS_WIDTH}x${FULLSCREEN_CANVAS_HEIGHT}`
const cm = /^(\d+)x(\d+)$/.exec(canvasStr)
if (!cm) throw new CompileFail(`<widget> canvas 属性格式应为 "宽x高"（如 canvas="960x540"）`, root.line)
```

`name` 缺了直接报错——它是根节点名，脚本按名字找控件的前提。`canvas` 有默认值（全屏），但**强烈建议显式写**：缺省时你按 960 宽度写的 CSS 会被当成 1920 画布解算，所有尺寸差一倍。

`anchor` 与 `offset` 是**成对**的，写了 `anchor` 才会去解析 `offset`（`compile.ts:578`）：

```ts
const rootAnchor = root.attrs['anchor']
if (rootAnchor) {
  rootTfProps.anchor = rootAnchor
  const off: [number, number] = [0, 0]
  const rootOffset = root.attrs['offset']
  if (rootOffset) {
    const parts = rootOffset.split(',').map((s) => parseFloat(s.trim()))
    if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) {
      throw new CompileFail(`<widget> offset 属性格式应为 "x,y"（世界米）`, root.line)
    }
    off[0] = round4(parts[0]); off[1] = round4(parts[1])
  }
  rootTfProps.anchorOffset = off
}
```

**只写 `offset` 不写 `anchor` 是无效的**——`offset` 的解析整体嵌在 `if (rootAnchor)` 里，会被静默跳过。这是最容易踩的静默失效，不报错但位置不对。

`active="false"` 直接反映到根 Actor（[compile.ts:601](#)）：

```ts
if (root.attrs['active'] === 'false') doc.active = false
```

---

## 3. CSS 白名单（都支持，放心写）

属性白名单是硬门槛，不在名单里的属性**编译期直接报错**（见 §8）。白名单定义在 [compile.ts:150](#) 的 `KNOWN_CSS_PROPS`，实际支持的面：

- **选择器**：`.class` `#id` 标签、后代空格、子代 `>`、`:first-child` `:last-child` `:nth-child(an+b)` `:not()` `:root`；按钮状态 `:hover` `:active` `:disabled`。级联 + 继承 + `!important` + inline style + CSS 变量 `var(--x, fallback)` 全套。
- **布局**：`display: flex/grid/block/inline-block/none`、`flex-direction/wrap/grow/shrink/basis`、`justify-content`、`align-items/align-self`、`gap`、`grid-template-*`（px/%/fr/auto/repeat()）、`grid-column/row` 线位与 span、`z-index`。
- **盒模型**：`margin`（含 `margin: 0 auto` 水平居中）/`padding`/`border`/`box-sizing`、`width/height/min-/max-`、`aspect-ratio`、`border-radius`。
- **定位**：默认块级流（不写 position 也自动堆叠）；`position: absolute` + `left/top/right/bottom`（相对父元素）；`position: fixed` 等价画布级 absolute。
- **视觉**：`background-color`、`linear-gradient(...)`、`opacity`、`visibility`、`transform: translate/rotate/scale`、`box-shadow`、`filter`。
- **文本**：`font-*` 全家、`color`、`text-align`、`line-height`、`letter-spacing`、标准 `text-shadow`、`text-transform`、`white-space`。
- **单位**：`px` `%` `em` `rem` `vw` `vh` `calc()`、命名色、`#hex3/4/6/8`、`rgb/rgba/hsl`。
- **媒体查询**：`@media (min/max-width/height)`（编译期静态评估）。
- **引擎专有**：`z-order`、`hit-test`、`text-shadow-color`、`text-shadow-blur`。

校验逻辑在 `validateComputedStyles`（[compile.ts:334](#)）——**级联完成后**逐属性查表，而不是解析时查源码文本：

```ts
for (const [prop] of el.computed) {
  if (prop.startsWith('--')) continue
  if (!KNOWN_CSS_PROPS.has(prop)) {
    throw new CompileFail(`CSS 属性 "${prop}" 不在映射面（属性清单见 devdoc/ui-html-source-format）`, el.node.line)
  }
  if (DECORATION_ONLY_PROPS.has(prop) && el.computed.get(prop) !== 'none') {
    const v = el.computed.get(prop)!
    if (prop === 'text-decoration-line' && (v === 'underline' || v === 'line-through')) {
      warnings.push({ line: el.node.line, message: `text-decoration: ${v} 引擎文本不渲染装饰线（troika 单色字形），按普通文本处理` })
    } else if (prop !== 'text-decoration-line') {
      warnings.push({ line: el.node.line, message: `属性 "${prop}: ${v}" 为装饰/交互提示，不影响渲染` })
    }
  }
}
```

三个要点：**CSS 变量（`--` 开头）直接放行**，不查白名单；不在白名单的属性是 `CompileFail` **硬报错**；`DECORATION_ONLY_PROPS` 里的属性（`cursor`、`user-select`、`text-decoration` 等）只是警告，写了不生效但不阻断。

有一批属性**接受但不渲染**（`DECORATION_ONLY_PROPS`，[compile.ts:200](#)）：`cursor`、`user-select`、`word-spacing`、`text-decoration`（及 line/color/style）、`text-overflow`、`tab-size`、`resize`、`touch-action`、`direction`、`text-indent`、`text-align-last`。引擎没有对应渲染能力，写了只为让源在浏览器里预览时好看。

---

## 4. 标签白名单

白名单 = `CONTAINER_TAGS ∪ WIDGET_TAGS ∪ STRUCTURAL_TAGS`，**白名单外一律硬报错**（[compile.ts:86](#)）。

| 你想做的 | 用什么 | 说明 |
|---|---|---|
| 容器 / 背景板 | `div` `span` `section` `header` `footer` `main` `nav` `p` `h1`-`h6` `ul/ol/li` `table/tr/td/th` … | 带背景色/圆角自动成为视觉面板，纯布局则只是容器 |
| 文本 | `<text>`（专有）或直接写 `p`/`h1` 等 | `font-size` `color` `text-align` `text-shadow` 全支持 |
| 按钮 | `<button>` | 原生出 UIButton；`:hover/:active/:disabled` 颜色自动生效（§6） |
| 图片 | `<img src="精灵资产路径">` | **必须显式给 width/height**（编译期拿不到图片原始尺寸） |
| 输入框 | `<input placeholder="...">` | 单行输入；`type` 仅支持 text/number |
| 多行输入 | `<textarea>` | 合法，等价 `<input>`（引擎无多行输入） |
| 进度条 | `<progress>` | 发射 `UIProgressComponent` |
| 换行 | `<br>` | |

`WIDGET_TAGS` 是"发射专属组件"的那一类（[compile.ts:102](#)）：

```ts
const WIDGET_TAGS = new Set(['widget', 'img', 'button', 'text', 'input', 'textarea', 'progress', 'br'])
```

标签在发射阶段按 tag 分发（[compile.ts:776](#)）：

```ts
case 'img': this.emitImage(box, node, nodeName, true); this.emitBorders(box, node, nodeName); break
case 'button': this.emitButton(box, node, nodeName, usedNames); this.emitBorders(box, node, nodeName); break
case 'text': this.emitTextElement(box, node, nodeName); break
case 'input': case 'textarea': this.emitInput(box, node); break
case 'progress': this.emitProgress(box, node); break
```

注意 `img` 传了 `requireSize = true`，这就是"必须给宽高"的执行点（见 §9 坑 3）。

白名单外的标签按 `UNSUPPORTED_TAGS`（[compile.ts:107](#)）给**带替代建议**的报错，而不是干巴巴一句"不支持"：

```ts
export const UNSUPPORTED_TAGS: Record<string, string> = {
  select: '引擎无下拉控件（用 UIScrollList 或 data-comp 逃逸承载）',
  video: '引擎无视频控件（UI 层不支持视频播放）',
  audio: '引擎 UI 层不支持音频控件（用游戏脚本播放）',
  canvas: '引擎 UI 不支持位图画布（用 UIImage + 贴图）',
  svg: '引擎不支持 SVG 矢量（转贴图后用 img）',
  iframe: '引擎不支持内嵌网页',
  ...
}
```

其余未知标签（拼错也算）走 `assertTagSupported` 报"不在映射面"。

---

## 5. 节点命名（脚本按名字找控件）

编译器按 **data-name > name > id > class 首词 > 标签序号** 生成节点名。`nameOf` 实现（[compile.ts:1715](#)）：

```ts
/** 节点名（data-name > name > id > class 首词 > tag_seq），全资产去重 */
private nameOf(el: StyleElement, box: Box | null, usedNames: Set<string>, fallbackPrefix = ''): string {
  let base: string
  if (el.node.attrs['data-name']) base = el.node.attrs['data-name']
  else if (el.node.attrs['name']) base = el.node.attrs['name']
  else if (el.id) base = el.id
  else if (el.classes.length > 0) base = el.classes[0]
  else {
    const t = fallbackPrefix || el.tag
    base = `${t.charAt(0).toUpperCase()}${t.slice(1)}_${nextNodeId()}`
  }
  if (usedNames.has(base)) {
    let i = 2
    while (usedNames.has(`${base}_${i}`)) i++
    base = `${base}_${i}`
  }
  usedNames.add(base)
  return base
}
```

**关键规则**：gameplay 脚本用 `findInChildren('节点名')` 查找控件——**被脚本引用的节点名必须与脚本逐字一致**。改现有资产时先查脚本（`src/projects/<project>/gameplay/**/*.script.ts`）引用了哪些名字；新资产给关键控件起语义化 class 名（`Btn_close`、`DailyList`、`Title`）。

重名会自动加后缀（`Btn_2`、`Btn_3`）。**这不是警告而是既定行为**——所以同一个 class 用在多个元素上时，第二个以后的名字会变，脚本里按名字找会找不到（见 §9 坑 2）。

---

## 6. 行为与交互

- **面板行为**：根标签 `data-script="gameplay/base/MyPanel"`，脚本 id 必须真实存在于 `src/projects/<project>/gameplay/**/*.script.ts`。
- **按钮状态**：`:hover/:active/:disabled` 的颜色自动传给运行时，无需任何脚本。
- **输入框**：`<input>` 自带焦点/占位符；`placeholder` 属性直接写。
- **点击行为**：按钮的响应逻辑写在 data-script 指向的脚本里，不在 HTML 里。

`data-script` 发射成 `UIScriptComponent`（[compile.ts:1537](#)）：

```ts
emitDataScript(el: StyleElement, node: Record<string, unknown>): void {
  const script = el.node.attrs['data-script']
  if (!script) return
  const scriptProps: Record<string, unknown> = { script }
  const dataArgs = el.node.attrs['data-args']
  if (dataArgs) {
    try {
      scriptProps.args = JSON.parse(dataArgs)
    } catch {
      throw new CompileFail(`data-args 属性不是合法 JSON: "${dataArgs}"`, el.node.line)
    }
  }
  // 与交互态合并（emitButtonStates 可能已建）
  const existing = (node.components as Array<{ baseClass: string; properties: Record<string, unknown> }>)
    .find((c) => c.baseClass === 'UIScriptComponent')
  if (existing) {
    const args = { ...(scriptProps.args as Record<string, unknown> | undefined), ...(existing.properties.args as Record<string, unknown> | undefined) }
    existing.properties = { ...scriptProps, args }
  } else {
    ;(node.components as unknown[]).push({ baseClass: 'UIScriptComponent', properties: scriptProps })
  }
}
```

注意合并逻辑：**已有的 `args` 覆盖 `data-args`**。因为按钮状态色（`emitButtonStates`）会先写入 `args`，`data-script` 后发射时必须保住它们，否则 `:hover` 配的颜色就丢了。这也是为什么 [compile.ts:771](#) 有注释强调"`data-script` 先于功能组件发射"。

`data-args` 可传脚本参数，但**必须是合法 JSON，否则硬报错**。

---

## 7. 布局配方：流式优先，能不写坐标就不写

**优先级：flex/grid 流式布局 ≫ 绝对定位。** 静态布局在编译期被 `solveLayout` 解算成精确坐标，你写的层级关系就是运行时关系。

### 配方 A：全屏对话框（遮罩 + 居中面板 + 内衬）

参考 [tasks_ui.widget.html](../../../src/projects/fish/asset/blueprints/ui/tasks_ui.widget.html) 的结构（该源是保存回写后的规范形，全是 absolute；**新写的源用 flex 即可**）：

```html
<widget name="MyPanel" canvas="1920x1080" world="9.6x5.4" data-script="gameplay/base/MyPanel">
  <style>
    .Dim { position: absolute; left: 0px; top: 0px; width: 1920px; height: 1080px; background-color: #0e0a04b8; }
    .Panel { width: 1460px; height: 980px; margin: 50px auto; background-color: #8a6a3a; border-radius: 24px; }
    .Inner { width: 1420px; height: 940px; margin: 20px auto; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 16px; background-color: #3a2418; border-radius: 18px; }
    .Title { width: 400px; height: 50px; font-size: 32px; color: #fff; text-align: center; }
    .Btn_close { width: 260px; height: 78px; display: flex; justify-content: center; align-items: center; background-color: #ffae00; border-radius: 16px; }
    .Label_close { width: 200px; height: 40px; font-size: 24px; color: #3d2600; text-align: center; }
  </style>
  <div class="Dim"></div>
  <div class="Panel">
    <div class="Inner">
      <text class="Title">标题</text>
      <button class="Btn_close"><text class="Label_close">关闭</text></button>
    </div>
  </div>
</widget>
```

要点：外框/内衬用**嵌套 div**（不要写成兄弟叠加，兄弟会垂直堆排出画布）；面板 `margin: 上下px auto` 居中；内容 flex 纵向栈 `justify-content: center` + `gap`。

### 配方 B：动态卡片列表容器（脚本生成子项）

```html
<div class="CardList" data-comp="UILayout" data-props='{"mode":"grid","columns":4,"spacingX":0.12,"spacingY":0.1,"autoLayout":true}'></div>
```

```css
.CardList { width: 880px; height: 380px; }
```

实际用法见 [tasks_ui.widget.html](../../../src/projects/fish/asset/blueprints/ui/tasks_ui.widget.html)：

```html
<div class="AchievementList" data-comp="UILayout" data-props='{"mode":"grid","columns":4,"spacingX":0.12,"spacingY":0.1,"autoLayout":true}'></div>
```

要点：容器**显式给宽高**；宽 ≥ 列数×卡片宽+(列数-1)×间距px，高 ≥ 行数×卡高+(行数-1)×间距px（spacing 是世界米，×100≈px）。运行时脚本 spawn 的卡片由 UILayout 自动网格排列、自动换行。

### 配方 C：按钮（背景直接写按钮上）

```css
.Btn_ok { width: 260px; height: 78px; display: flex; justify-content: center; align-items: center; background-color: #ffae00; border-radius: 16px; }
.Btn_ok:hover { background-color: #ffc233; }
```

```html
<button class="Btn_ok"><text class="Label_ok">确定</text></button>
```

要点：背景色/圆角写在 button 上，内部一个 text 居中；**不要**再造一层"背景 div"（除非要多层装饰）。`emitButton` 内部会自己取按钮的尺寸发一个背景图组件（[compile.ts:1045](#)），再包一层 div 只会多一个节点。

### 配方 D：溢出裁剪与滚动列表（overflow 语义）

```html
<style>
  .Card { width: 300px; height: 200px; overflow: hidden; border-radius: 16px; }
  .List { width: 300px; height: 400px; overflow-y: auto; }
</style>
```

- `overflow: hidden` / `clip` → 自动挂裁剪遮罩（`UIMaskComponent`）：超出容器的子内容被裁掉，`border-radius` 同时成为圆角裁剪半径。适合头像框、卡片溢出图片裁剪。
- `overflow-y: auto`（或 `overflow: auto/scroll/x-auto`）→ 裁剪 + 通用滚动容器：内容超出即可拖拽滚动（自带滚动条、越界回弹），编译器自动生成内容层，HTML 写法与浏览器一致。
- 需要等步长 item 对象池列表（几百项不卡帧）时仍用配方 B 的 `data-comp="UIScrollList"`。

判定逻辑（[compile.ts:723](#)）：

```ts
const scrollDir = this.scrollDirectionOf(el)
const overflowHidden = ['overflow-x', 'overflow-y'].some((p) => {
  const v = el.computed.get(p)
  return v === 'hidden' || v === 'clip'
})
```

实际例子见 [gm_panel.widget.html](../../../src/projects/fish/asset/blueprints/ui/gm_panel.widget.html) 的命令列表：

```html
<div class="GM_CmdList" data-comp="UIScrollList" data-props='{"itemWidget":"asset/blueprints/ui/gm_cmd_item.widget.json","itemSize":[2.7,0.24],"spacing":0.02,"zOrderLift":0,"draggable":true,"scrollbar":true}'></div>
```

### 什么时候才用 absolute

- 全屏遮罩/背景层（`left:0 top:0` 铺满）
- 钉在面板角落的元素（如右上角关闭按钮：父元素 `position: relative` + 按钮 `position: absolute; right: 16px; top: 16px`）
- 叠加装饰（角标、光效）

其余一律流式。

---

## 8. 逃逸通道：data-comp / data-props

白名单标签覆盖不到的引擎组件，用逃逸通道挂载：

```html
<div class="X" data-comp="UILayout" data-props='{"mode":"grid","columns":5,"spacingX":0.15}'></div>
```

常用组件速查：

| 组件 | 用途 | 关键 props |
|---|---|---|
| `UILayout` | 动态子项自动排列（配方 B） | `mode`(horizontal/vertical/grid) `columns` `spacingX/Y`(米) `autoLayout` |
| `UIScrollList` | 滚动列表（itemWidget 复用） | `itemWidget`(资产路径) `itemSize`[米] `spacing` `scrollbar` `draggable` |
| `UIProgressBar` | 进度条 | 见组件 schema |

`emitDataComp`（[compile.ts:1560](#)）的两个关键行为：

```ts
private emitDataComp(el: StyleElement, node: Record<string, unknown>): void {
  const compName = el.node.attrs['data-comp']
  if (!compName) return
  const baseClass = compName.endsWith('Component') ? compName : `${compName}Component`
  let props: Record<string, unknown> = {}
  const dataProps = el.node.attrs['data-props']
  if (dataProps) {
    try {
      props = JSON.parse(dataProps)
    } catch {
      throw new CompileFail(`data-props 不是合法 JSON: "${dataProps}"`, el.node.line)
    }
  }
  const comps = node.components as Array<{ baseClass: string; properties: Record<string, unknown> }>
  const existing = comps.find((c) => c.baseClass === baseClass)
  if (existing) {
    // 原生映射/已挂载的组件：data-props 并入（显式声明优先），不重复挂载
    existing.properties = { ...existing.properties, ...props }
    return
  }
  if (Emitter.NATIVE_MAPPED_COMPS.has(baseClass) && !dataProps) return
  comps.push({ baseClass, properties: props })
}
```

- `data-comp="UILayout"` 会**自动补 `Component` 后缀**再查，所以两种写法都行。
- 已存在的同 baseClass 组件是**合并而非替换**（`props` 在后，显式声明优先）。这样 `<div title="x" data-comp="UITooltip" data-props='{"delay":0.5}'>` 能精确覆盖默认 text，不丢 text。
- `data-props` 必须**单引号包裹**（`data-props='{...}'`），因为 JSON 里是双引号。JSON 非法则带行号硬报错。

---

## 9. 禁区清单（写了必硬报错，别绕）

| 写法 | 报错 | 替代 |
|---|---|---|
| `<script>` / `onclick` 等事件属性 | 硬报错 | `data-script`（§6） |
| `select` `video` `audio` `canvas` `svg` `iframe` 等映射面外标签 | 硬报错（附替代建议） | 组合白名单标签 |
| 未知标签（拼错也算） | 硬报错 | 查 §4 白名单 |
| `@keyframes` `@font-face` `@supports` | 硬报错 | 动效用 UIScript + TweenSystem |
| 兄弟选择器 `~` `+`、`::before/::after`、属性选择器 | 硬报错 | 用 class/后代/子代选择器 |
| 白名单外的 CSS 属性 | 硬报错（带行号） | 查 §3 白名单 |
| `data-props` / `data-args` 非法 JSON | 硬报错（带行号） | 属性值用单引号包裹 |
| `<img>` 不给 width/height | **警告**（非报错），按内容盒渲染 | 显式给尺寸 |

内嵌脚本的检查（[compile.ts:399](#) 等多处）与事件属性拦截（[compile.ts:363](#)）：

```ts
function assertNoEventAttrs(node: HtmlNode): void {
  for (const attr of Object.keys(node.attrs)) {
    if (/^on[a-z]+$/i.test(attr)) {
      throw new CompileFail(
        `事件属性 ${attr} 不在声明式映射面（行为请用 data-script="脚本路径" + UIScript）`,
        node.line,
      )
    }
  }
}
```

任何 `on*` 属性（正则 `/^on[a-z]+$/i`）都拦，不只 `onclick`。

---

## 10. 警告类（能编译，但要知道）

- **文本宽度是字体学估算**（CJK≈1em/字、拉丁≈0.52em/字符）——对尺寸敏感的元素（面板、按钮、卡片）**显式写 width/height**。
- 混排内联内容（一行里多个 span）按行框静态切片，切片后不再运行时换行；纯文本块（单个 text/p）由引擎动态换行。
- 垂直 margin 不折叠（恒相加）。
- `text-decoration` `cursor` `user-select` 等装饰属性不渲染（可写，被忽略，见 §3）。
- 百分比 margin/padding 按画布宽解算。
- 非 button 元素写 `:hover`/`:active`/`:disabled` 只警告不生效——引擎只有按钮有状态机。

---

## 11. 编译与验收流程

1. 写/改 `.widget.html`（与目标 `.widget.json` 同目录同名）。
2. 调 MCP 工具 `ui_compile`，**参数 asset 传 `.widget.json` 路径**：
   `{"asset": "src/projects/fish/asset/blueprints/ui/my_panel.widget.json"}`
3. 成功：json 自动落盘（已过 assetLint 零错误门槛），`warnings[]` 逐条确认可接受（多为 §10 文本估算）。
4. 失败：`errors[{line, message}]` 行号指向 `.widget.html`——按行修源重试。**不要手改 json**。
5. 预览确认：资产面板选中 widget 走 UIPreviewManager 2D 预览，或进游戏实测。

MCP 分支（[EditorInitializer.ts:594](#)）对参数有硬要求：

```ts
const assetPath = (params?.asset as string | undefined)?.trim()
if (!assetPath || !assetPath.endsWith('.widget.json')) {
  const msg = { status: 'error', command: 'ui_compile', message: '缺少 asset 参数（需 .widget.json 路径）' }
  ...
}
```

**传 `.widget.html` 路径会直接报"缺少 asset 参数"**——虽然你要编译的是源，但参数必须传 json 路径，编译器内部自己换成 `.html` 去读。这是最常犯的调用错误（见 §12 坑 1）。

**注意**：编辑器保存 json 会自动把 html 反编译回写为编译器"规范形"（各节点变 `position: absolute` + 精确坐标）。这是**设计行为**，渲染完全等效——回写后的文件照样能读能改能再编译，别惊讶、别手工对抗。机制细节见 [ui_source_format_system.md](./ui_source_format_system.md)。

---

## 12. 关键方法速查

| 方法 | 位置 | 干什么 | 注意 |
|---|---|---|---|
| `compileWidgetHtml(source, options?)` | `compile.ts:503` | 编译主入口，返回 `{ok, errors, warnings, doc}` | 所有错误带源行号 |
| `compileUiSourceToAsset(assetPath)` | `uiSourceActions.ts:40` | 编辑器编译动作：编译→lint→落盘 | 入参传 **json** 路径，内部换源路径 |
| `validateTags(el)` | `compile.ts:141` | 标签白名单全量校验 | 白名单外硬报错 |
| `validateComputedStyles(el, warnings)` | `compile.ts:334` | 级联后逐属性查 CSS 白名单 | `--` 变量放行；装饰属性只警告 |
| `collectStylesheets(...)` | `compile.ts:236` | UA + style/link/@import 收集 | UA 排最前（origin 0） |
| `evaluateMedia(cond, w, h, ...)` | `compile.ts:313` | `@media` 静态评估 | 按 canvas 尺寸，非真实视口 |
| `assertNoEventAttrs(node)` | `compile.ts:363` | 拦截 `on*` 事件属性 | 正则 `/^on[a-z]+$/i` |
| `solveLayout(rootEl, ctx)` | `layout.ts:144` | 静态布局求解成矩形树 | 编译期算完，运行时无布局 |
| `Emitter.emitBox(...)` | `compile.ts:675` | 盒子 → json 节点（映射主干） | 尺寸用边盒；补 marker 组件 |
| `Emitter.nameOf(...)` | `compile.ts:1715` | 节点命名（data-name>name>id>class>tag_seq） | 重名自动加 `_2` |
| `Emitter.emitDataScript(el, node)` | `compile.ts:1537` | `data-script` → UIScriptComponent | 与按钮状态 args 合并 |
| `Emitter.emitDataComp(el, node)` | `compile.ts:1560` | `data-comp`/`data-props` 逃逸 | 同 baseClass 合并，非替换 |
| `Emitter.emitImage(...)` | `compile.ts:1030` | `img` → UIImageComponent | `requireSize` 触发无尺寸警告 |
| `Emitter.emitButton(...)` | `compile.ts:1045` | `button` → UIButtonComponent | 背景色取自按钮自身 |

---

## 13. 流程影响：牵动哪些功能

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| AI / 人写源 | 手写 `.widget.html` 后调 MCP `ui_compile` | [MCP 集成](../integration/mcp_integration.md) |
| MCP `ui_compile` | 传 `.widget.json` → `compileUiSourceToAsset`，带 lint 门槛 | [MCP 集成](../integration/mcp_integration.md) |
| 控制台命令 | `ui.compile` / `ui.decompile`（相对项目根） | [编辑器核心](../core/core_system.md) |
| 资产面板右键 | 「🔨 编译 UI 源」/「🛠️ 生成 HTML 源」 | [UI 面板组件](./ui_components_system.md) |
| CLI | `node scripts/ui-compiler-cli.mjs compile`（离线直写） | [UI 源格式](./ui_source_format_system.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| UI 源格式（编译器） | 本手册是它的**编写层**；编译管线/反编译/冲突仲裁都在那边 | [UI 源格式](./ui_source_format_system.md) |
| 资产检查 assetLint | 产物过零 error 门槛才落盘 | [资产预览与检查](../asset/asset_preview_lint_system.md) |
| 锚点系统 | `position:absolute + left/top %` ↔ 九宫格 anchor + anchorOffset | [UI 锚点系统](./ui_anchor_system.md) |
| UI 增强 | `title`/`overflow`/`data-script` 承载 tooltip、滚动、脚本 | [UI 增强系统](./ui_enhancement_system.md) |
| 引擎 UI 组件 | 产出 `UITransformComponent` / `CanvasUIComponent` / `UIButtonComponent` 等 | [引擎 UI 系统](../../engine/ui_system.md) |
| gameplay 脚本 | 节点名决定脚本 `findInChildren` 能否找到控件 | [gameplay 代码规范](../../projects/gameplay_code_standard.md) |
| 蓝图编辑 | 落盘与工作副本复用其体系 | [蓝图编辑](../blueprint/blueprint_edit_system.md) |

---

## 14. 踩坑清单（都是真踩过的）

**1. MCP `ui_compile` 传了 `.widget.html` 路径**

现象：报"缺少 asset 参数（需 .widget.json 路径）"。原因：`EditorInitializer.ts` 白名单校验 `assetPath.endsWith('.widget.json')`，而编译器内部自己把 json 路径换成 `.html` 去读源。规则：**参数永远传 `.widget.json`**，尽管你编译的是源。

**2. 改了现有资产，编译过了但游戏里控件不见了**

现象：一切正常，但脚本控制的控件不响应/不显示。原因：脚本用 `findInChildren('名字')` 找节点，而节点名来自 class 首词——改了 class 名或元素重名被自动加 `_2` 后缀（§5），名字就对不上了。规则：改现有资产前先 grep 脚本里 `findInChildren(...)` 的每个名字，确保逐字一致。

**3. `<img>` 不给宽高，图片尺寸不对**

现象：图片按内容盒大小渲染，比例失真。原因：编译期无法得知图片原始尺寸，`emitImage` 只能 push 一条警告后按内容盒渲染。规则：`<img>` 一律显式写 `width`/`height`。注意这是**警告不是报错**，编译照样通过，所以容易漏。

**4. 两个面板叠放写成兄弟，下面的被顶出画布**

现象：外框+内衬想做嵌套效果，结果内衬跑到画布外。原因：块级流下兄弟元素**垂直堆叠**，不是叠加。规则：**嵌套** div（外框包内衬 + 内衬 `margin: (框厚)px auto`）。

**5. 只写 `offset` 不写 `anchor`，位置静默失效**

现象：设了偏移但元素没动，且不报错。原因：`offset` 的解析整体嵌在 `if (rootAnchor)` 块内（§2），没有 `anchor` 就整段跳过。规则：`anchor` 和 `offset` 必须成对写。

**6. 写了 `@keyframes` 做动画，编译直接失败**

现象：编译报错指向 `@keyframes` 那一行。原因：`tokenize.ts` 把它切进 `unsupportedAtRules`，`collectStylesheets` 遍历即抛 `CompileFail`。规则：动效走 `UIScript` + TweenSystem，别写进源样式。

**7. 非 button 元素写 `:hover` 编译过了但没效果**

现象：`<div class="X">` 加了 `.X:hover`，编译成功但 hover 无反应。原因：引擎只有按钮有 hover/pressed 状态机，`emitButtonStates` 只处理 button。规则：需要 hover 语义就用 `<button>`。

**8. 想在 widget 里写段 JS**

现象：加 `<script>` 编译直接失败。原因：`stripStyleScript` 遇到非空 `<script>` 抛 `CompileFail`；`assertNoEventAttrs` 还会拦所有 `on*` 属性。规则：行为一律 `data-script="脚本路径"` + `data-args`。

**9. 保存后源变成一堆 absolute，以为被破坏了**

现象：编辑器保存 json 后，`.widget.html` 里的 flex 变成了每个节点 `position:absolute` + 精确坐标。原因：`decompileBackOnSave` 把 json 反编译成"规范形"回写，这是设计行为，渲染完全等效。规则：别手工对抗；要保留 flex 源走离线 CLI（`node scripts/ui-compiler-cli.mjs <path>.widget.html`，直写 json 不回写）。详见 [UI 源格式](./ui_source_format_system.md)。

**10. `data-props` 用双引号包裹导致 JSON 解析失败**

现象：报"data-props 不是合法 JSON"。原因：HTML 属性值用双引号会和 JSON 内部的双引号冲突。规则：属性值用**单引号**包裹（`data-props='{...}'`）。

---

## 15. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| 源文件不存在（旧资产） | `compileUiSourceToAsset` 报「源文件不存在」 | 用右键「🛠️ 生成 HTML 源」反编译生成 |
| 标签不在白名单 | 硬报错 + 替代建议 | 查 §4 |
| CSS 属性不在白名单 | 硬报错（带行号） | 查 §3 |
| `@keyframes`/`@font-face`/`@supports` | 硬报错（带行号） | 删除；动效用 UIScript + TweenSystem |
| `@media` | **支持**（按 canvas 尺寸静态评估） | 只支持 `min/max-width/height` |
| CSS 变量 `--x` / `var()` | **支持**（`--` 开头直接放行校验） | 见 §3 |
| 内嵌 `<script>` / `on*` 属性 | 硬报错 | 用 `data-script` |
| 非 button 的 `:hover` 等 | 编译警告，声明不生效 | 改用 `<button>` |
| `data-props` / `data-args` 非法 JSON | 硬报错（带行号） | 属性值用单引号包裹 |
| `<img>` 无宽高 | **警告**，按内容盒渲染 | 显式给尺寸 |
| 节点重名 | 自动加 `_2`/`_3` 后缀（既定行为，非警告） | 注意脚本按名查找会失效 |
| `overflow: hidden/clip` | → `UIMaskComponent` 裁剪遮罩（radius=border-radius） | 见 §7 配方 D |
| `overflow: auto/scroll` | → UIMask + UIScrollContainer + 内容层 | 见 §7 配方 D |
| `z-order` 与 `z-index` 同写 | `z-order` 优先，`z-index` 被忽略 | 二者择一 |
| 编译成功但 assetLint 有 error | 拒绝落盘，返回 `lintIssues` | 按 `nodePath`/`rule` 修源重编译 |
| assetLint 只有 warn | 正常落盘，warn 透传 | 可忽略 |
| 保存 json 后源被回写 | 反编译为规范形（absolute 坐标），渲染等效 | 见 §14 坑 9 |
| 垂直 margin | 不折叠（恒相加） | 按相加计算高度 |

---

## 16. 完整参考实例

fish 项目 `src/projects/fish/asset/blueprints/ui/` 下全部 23 个 widget 都是此格式编写的，推荐阅读顺序（从简到繁）：

| 文件 | 学什么 |
|---|---|
| [toast.widget.html](../../../src/projects/fish/asset/blueprints/ui/toast.widget.html) | 最小面板（9 行） |
| [pause_menu.widget.html](../../../src/projects/fish/asset/blueprints/ui/pause_menu.widget.html) | 纵向菜单按钮栈 + 装饰条 |
| [tasks_ui.widget.html](../../../src/projects/fish/asset/blueprints/ui/tasks_ui.widget.html) | 全屏对话框 + 两个 UILayout grid 动态列表 + 按钮 |
| [gm_panel.widget.html](../../../src/projects/fish/asset/blueprints/ui/gm_panel.widget.html) | 输入框 / 滚动列表 / 输入行 / 角标关闭按钮全家桶 |
| [barracks_ui.widget.html](../../../src/projects/fish/asset/blueprints/ui/barracks_ui.widget.html) | 标题装饰条 + 卡片网格 + 多状态文本 |
