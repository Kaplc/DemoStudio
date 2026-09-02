# UI Widget HTML 编写手册（作者版）

> **一句话定位**：这是给 AI / 人**编写 `.widget.html` 资产**的完整用法手册——你只需要写普通 HTML + CSS 前端，编译器自动把它变成引擎资产。
>
> **什么时候会用到你**：AI 接到「做一个 HUD / 面板 / 弹窗 / 列表」任务时，从零写或改一个 widget；编译报错不知道怎么改；不确定某个写法支不支持。
>
> 系统内部机制（编译器实现/双向同步/改编译器）见 [ui_source_format_system.md](./ui_source_format_system.md)；映射面全集见 `devdoc/ui-html-source-format/full-mapping.md`。

---

## 0. 心智模型：你写的是一张网页

**把 widget 当一张普通网页来写。你在浏览器里写出的样子，就是游戏里运行的样子。**

编译器替你做了全部脏活，以下东西**你完全不需要知道、也不要出现在代码里**：

| 引擎概念 | 你要做的 |
|---|---|
| UITransform / worldWidth（米制） | 不用管。你写 px，编译器按画布比例自动换算 |
| 九宫格锚点 / anchorOffset | 不用管。flex / margin / absolute 由编译器解算成精确坐标 |
| UILayout / 运行时重排 | 不用管。纯静态布局自动出坐标；动态列表见 §8 逃逸通道 |
| 组件 properties / assetLint schema | 不用管。合法标签+CSS 编译产物必然过 lint |

**三条铁律：**

1. **只写 HTML + CSS**——正常网页写法，流式布局优先。
2. **不写任何脚本**——没有 `<script>`、没有 `onclick`；行为一律 `data-script` 挂脚本（§7）。
3. **越界写法编译期硬报错**，绝不静默忽略——报错按行号改源就行，见 §9 禁区清单。

---

## 1. 30 秒最小骨架

```html
<widget name="Toast" canvas="960x180" world="4.8x0.9" anchor="top-center" offset="0,0.55">
  <style>
    .ToastPanel { width: 960px; height: 180px; background-color: rgba(58, 36, 24, 0.92); border-radius: 24px; }
    .ToastText { width: 920px; height: 160px; font-size: 28px; color: #f5e6c8; text-align: center; }
  </style>
  <div class="ToastPanel">
    <text class="ToastText">你好，世界</text>
  </div>
</widget>
```

这就是一个合法、可编译、可运行的 widget。**class 名就是节点名**（§6），`<style>` 里的 CSS 支持级联/继承/选择器全套（§4）。

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
| `data-script` | 可选 | 面板行为脚本，挂根节点（§7） |
| `active="false"` | 可选 | 根默认隐藏（脚本控制显示时用） |

---

## 3. 标签白名单

| 你想做的 | 用什么 | 说明 |
|---|---|---|
| 容器 / 背景板 | `div` `section` `header` `footer` `main` `nav` `p` `h1`-`h6` … | 带背景色/圆角自动成为视觉面板，纯布局则只是容器 |
| 文本 | `<text>`（专有）或直接写 `p`/`h1` 等 | `font-size` `color` `text-align` `text-shadow` 全支持 |
| 按钮 | `<button>` | 原生出 UIButton；`:hover/:active/:disabled` 颜色自动生效（§7） |
| 图片 | `<img src="精灵资产路径">` | **必须显式给 width/height**（编译期拿不到图片原始尺寸） |
| 输入框 | `<input placeholder="...">` | 单行输入；`type` 仅支持 text/number |
| 换行 | `<br>` | |
| 表格 | `table/tr/td/th` | 行堆叠 + 列宽取内容最大（近似浏览器） |
| 列表 | `ul/ol/li` | 纵向流 + 项目符号 |

其余标签（`select` `video` `audio` `canvas` `svg` `iframe` 等）**硬报错**，替代建议见报错信息。

---

## 4. CSS 白名单（都支持，放心写）

- **选择器**：`.class` `#id` 标签、后代空格、子代 `>`、`:first-child` `:last-child` `:nth-child(an+b)` `:not()` `:root`；按钮状态 `:hover` `:active` `:disabled`。级联 + 继承 + `!important` + inline style + CSS 变量 `var(--x, fallback)` 全套。
- **布局**：`display: flex/grid/block/inline-block/none`、`flex-direction/wrap/grow/shrink/basis`、`justify-content`（6 值）、`align-items/align-self`、`gap`、`grid-template-*`（px/%/fr/auto/repeat()）、`grid-column/row` 线位与 span、`z-index`。
- **盒模型**：`margin`（含 `margin: 0 auto` 水平居中）/`padding`/`border`/`box-sizing`、`width/height/min-/max-`、`aspect-ratio`、`border-radius`（四角一致）。
- **定位**：默认块级流（不写 position 也自动堆叠）；`position: absolute` + `left/top/right/bottom`（相对父元素）；`position: fixed` 等价画布级 absolute。
- **视觉**：`background-color`、`linear-gradient(...)`、`opacity`、`visibility`、`transform: translate/rotate/scale`。
- **文本**：`font-*` 全家、`color`、`text-align`、`line-height`、`letter-spacing`、标准 `text-shadow`、`text-transform`、`white-space`。
- **单位**：`px` `%` `em` `rem` `vw` `vh` `calc()`、命名色、`#hex3/4/6/8`、`rgb/rgba/hsl`。
- **媒体查询**：`@media (min/max-width/height)`（编译期静态评估）。

---

## 5. 布局指南：流式优先，能不写坐标就不写

**优先级：flex/grid 流式布局 ≫ 绝对定位。** 静态布局在编译期被解算成精确坐标，你写的层级关系就是运行时关系。

### 配方 A：全屏对话框（遮罩 + 居中面板 + 内衬）

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

要点：容器**显式给宽高**；宽 ≥ 列数×卡片宽+(列数-1)×间距px，高 ≥ 行数×卡高+(行数-1)×间距px（spacing 是世界米，×100≈px）。运行时脚本 spawn 的卡片由 UILayout 自动网格排列、自动换行。

### 配方 C：按钮（背景直接写按钮上）

```css
.Btn_ok { width: 260px; height: 78px; display: flex; justify-content: center; align-items: center; background-color: #ffae00; border-radius: 16px; }
.Btn_ok:hover { background-color: #ffc233; }
```

```html
<button class="Btn_ok"><text class="Label_ok">确定</text></button>
```

要点：背景色/圆角写在 button 上，内部一个 text 居中；**不要**再造一层"背景 div"（除非要多层装饰）。

### 什么时候才用 absolute

- 全屏遮罩/背景层（`left:0 top:0` 铺满）
- 钉在面板角落的元素（如右上角关闭按钮：父元素 `position: relative` + 按钮 `position: absolute; right: 16px; top: 16px`）
- 叠加装饰（角标、光效）

其余一律流式。

---

## 6. 节点命名（脚本按名字找控件）

编译器按 `data-name > name > id > class 首词 > 标签序号` 生成节点名。

**关键规则：gameplay 脚本用 `findInChildren('节点名')` 查找控件——被脚本引用的节点名必须与脚本逐字一致。** 改现有资产时先查脚本（`src/projects/<project>/gameplay/**/*.script.ts`）引用了哪些名字；新资产给关键控件起语义化 class 名（`Btn_close`、`DailyList`、`Title`）。

---

## 7. 行为与交互

- **面板行为**：根标签 `data-script="gameplay/base/MyPanel"`，脚本 id 必须真实存在于 `src/projects/<project>/gameplay/**/*.script.ts`。
- **按钮状态**：`:hover/:active/:disabled` 的颜色自动传给运行时，无需任何脚本。
- **输入框**：`<input>` 自带焦点/占位符；`placeholder` 属性直接写。
- **点击行为**：按钮的响应逻辑写在 data-script 指向的脚本里（脚本按 §6 的名字找到 button 挂 onClick），不在 HTML 里。

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

- `data-comp` 与标签原生组件同类时会**合并**（如 `text` + `data-comp="UIText"` 用于补 name）。
- `data-props` 只写该组件消费的字段，字段名 camelCase。

---

## 9. 禁区清单（写了必硬报错，别绕）

| 写法 | 报错 | 替代 |
|---|---|---|
| `<script>` / `onclick` 等事件属性 | 硬报错 | `data-script`（§7） |
| `select` `video` `audio` `canvas` `svg` `iframe` 等映射面外标签 | 硬报错（附替代建议） | 组合白名单标签 |
| 未知标签（拼错也算） | 硬报错 | 查 §3 白名单 |
| `overflow: hidden` | 硬报错（引擎无容器裁剪） | 圆角裁剪用嵌套+同色背景表达 |
| `@keyframes` `@font-face` `@supports` | 硬报错 | 动效用 UIScript + TweenSystem |
| 兄弟选择器 `~` `+`、`::before/::after`、属性选择器 | 硬报错 | 用 class/后代/子代选择器 |
| `border-radius` 四角不一致 | 硬报错 | 四角一致（引擎单值） |
| `<img>` 不给 width/height | 警告+按内容盒渲染 | 显式给尺寸 |

---

## 10. 警告类（能编译，但要知道）

- **文本宽度是字体学估算**（CJK≈1em/字、拉丁≈0.52em/字符）——对尺寸敏感的元素（面板、按钮、卡片）**显式写 width/height**。
- 混排内联内容（一行里多个 span）按行框静态切片，切片后不再运行时换行；纯文本块（单个 text/p）由引擎动态换行。
- 垂直 margin 不折叠（恒相加）。
- `text-decoration` `cursor` `user-select` 等装饰属性不渲染（可写，被忽略）。
- 百分比 margin/padding 按画布宽解算。

---

## 11. 编译与验收流程

1. 写/改 `.widget.html`（与目标 `.widget.json` 同目录同名）。
2. 调 MCP 工具 `ui_compile`，**参数 asset 传 `.widget.json` 路径**：
   `{"asset": "src/projects/fish/asset/blueprints/ui/my_panel.widget.json"}`
3. 成功：json 自动落盘（已过 assetLint 零错误门槛），`warnings[]` 逐条确认可接受（多为 §10 文本估算）。
4. 失败：`errors[{line, message}]` 行号指向 `.widget.html`——按行修源重试。**不要手改 json**。
5. 预览确认：资产面板选中 widget 走 UIPreviewManager 2D 预览，或进游戏实测。

**注意**：编辑器保存 json 会自动把 html 反编译回写为编译器"规范形"（各节点变 `position: absolute` + 精确坐标）。这是**设计行为**，渲染完全等效——回写后的文件照样能读能改能再编译，别惊讶、别手工对抗。

---

## 12. 完整参考实例

 fish 项目 `src/projects/fish/asset/blueprints/ui/` 下全部 23 个 widget 都是此格式编写的，推荐阅读顺序（从简到繁）：

| 文件 | 学什么 |
|---|---|
| `toast.widget.html` | 最小面板 |
| `pause_menu.widget.html` | 纵向菜单按钮栈 |
| `tasks_ui.widget.html` | 全屏对话框 + 两个 UILayout grid 动态列表 + 按钮运行时居中 |
| `gm_panel.widget.html` | 输入框 / 滚动列表 / 输入行 / 角标关闭按钮全家桶 |
| `barracks_ui.widget.html` | 标题装饰条 + 卡片网格 + 多状态文本 |

---

## 13. FAQ

**Q：要不要写引擎组件属性（anchor / worldWidth / zOrder）？**
A：不要。白名单 HTML/CSS 自动映射一切；特殊组件走 `data-comp`（§8）。`z-index` 是唯一例外（CSS 写法，映射 zOrder）。

**Q：px 怎么对应到游戏画面？**
A：不用管。canvas 声明画布像素，编译器按根画布比例换算米制。你只管按 1920x1080（或自定 canvas）写 px。

**Q：为什么我写的 flex 源，回写后变成了一堆 absolute？**
A：编辑器保存时反编译为"规范形"，渲染等效（§11）。要保留 flex 源可走离线 gate（`node scripts/ui-compile-gate.mjs <path>.widget.html`，直写 json 不回写）。

**Q：动态生成的子项（脚本 spawn）会自动排列吗？**
A：容器挂 `data-comp="UILayout"`（§8 配方 B）就会；`autoLayout:true` 时子项增删自动重排。

**Q：改了现有资产，编译过了但游戏里控件不见了？**
A：大概率脚本按名找的节点被改名/删除（§6）。核对脚本里 `findInChildren(...)` 的每个名字。

**Q：两个面板叠放（外框+内衬）怎么写？**
A：**嵌套** div（外框包内衬 + 内衬 `margin: (框厚)px auto`），不要写成兄弟（兄弟会上下堆叠，下面的被顶出画布）。
