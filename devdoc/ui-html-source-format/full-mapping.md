# 完整原生 HTML 映射（2026-09-01 定案并实现）

> 本文是 `.widget.html` 完整映射的权威文档。方案沿革见 [plan.md](plan.md)（§5 受控子集为
> v1 历史，已被本文取代）；测试用例基线见 [test-cases.md](test-cases.md)。

## 1. 架构

编译管线（`src/editor/asset/uiCompiler/`）：

```
HTML 解析 (miniParser v2：实体/inline style/原始文本元素/完整 void 表)
  → 样式表收集（<style> + link/@import 内联 + UA 默认样式表）
  → @media 静态评估（相对画布尺寸）
  → 级联/继承 (css/cascade：特异性 × !important × 来源层 × 顺序；inline style 最高)
  → 标签/属性白名单校验（越界硬报错，绝不静默降级）
  → 静态布局求解 (layout.ts：编译期解出每盒 px 矩形)
  → 发射 Actor 树 (compile.ts：anchor/position + 引擎组件)
```

核心决策：**CSS 静态布局在编译期求解**。产物只含具体 `anchor/anchorOffset/position +
worldWidth/Height`，运行时零布局计算。`display:flex` 的等尺寸简单容器保留
UILayoutComponent 运行时发射（兼容旧资产与动态子项）；其余一律静态坐标。

三方坐标语义（编译器/运行时 applyAnchor/反编译器一致）：
- 流内元素：`position` = 相对**父边盒中心**的本地偏移（米），无锚点；
- 绝对定位元素：九宫格锚点 + `anchorOffset`（基准 = 父边盒尺寸，与运行时
  applyAnchor 公式一致；编译期包含块 = 父内容盒；CSS `left/top` 语义 =
  子项边盒缘相对父内容原点）；
- uitransform 尺寸 = 边盒（背景铺满视觉框）；求解器内部 Box.x/y = 内容盒原点。
- **sourceLayout 侧车**：节点级元数据字段 `{ padding: [t,r,b,l]px, border: [t,r,b,l]px }`，
  承载 json 组件 schema 表达不了的盒模型信息（引擎忽略未知节点字段，assetLint
  schema 只校验声明字段——sourceHash 先例）；反编译据此还原作者层 CSS。

**UILayoutComponent 补发**：flex 容器且静态解可被运行时公式精确复现时
（等主轴尺寸/子项无 margin 与盒模型/容器净/无 wrap/无绝对子项/space-* 需 gap=0），
产物补挂 UILayoutComponent（引擎缺省 justify/align=center 与 CSS 不同，恒显式写），
保留 v1"脚本动态加子项自动重排"能力；不满足时纯静态坐标。

## 2. HTML 标签映射面（全集）

| 类别 | 标签 | 映射 |
|---|---|---|
| 透传容器 | div/section/article/header/footer/main/nav/aside/figure/figcaption/blockquote/address/center/hgroup/h1-h6/p/form/fieldset/legend/label/output/details/summary/dialog/center | Actor（块级流/弹性/网格参与） |
| 列表 | ul/ol/li/dl/dt/dd/menu | 纵向流 + li 标记（•/○/▪/1.，`list-style-type`） |
| 内联样式 | a/b/strong/i/em/u/s/small/big/mark/code/kbd/samp/cite/q/dfn/abbr/time/data/var/sub/sup/bdi/bdo 等 | 行内片段（样式随级联；`text-transform` 编译期实现） |
| 表格 | table/thead/tbody/tfoot/tr/td/th/caption | 行堆叠 + 列宽取内容最大（近似浏览器 auto 布局） |
| 控件 | img/button/text(专有)/input/textarea/progress/br | UIImage/UIButton/UIText/UITextInput/UIProgressBar/换行 |
| 结构处理 | html/head/body/style/script/title/meta/link/base/noscript | 剥离/样式收集/名称来源 |
| 映射面外 | select/option/video/audio/canvas/svg/iframe/object/embed/map/area/slot/template/picture/source/track/meter/keygen/datalist | **硬报错**（附替代建议） |
| 未知标签 | 其余一切 | **硬报错** |

事件属性（`onclick` 等）→ 硬报错；行为一律 `data-script="脚本路径"` + UIScript。
`data-comp`/`data-props` 逃逸通道保留（任意引擎组件）。

## 3. CSS 映射面（全集）

- **选择器**：标签/`.class`/`#id`/复合、后代空格、子代 `>`、`:first-child`/
  `:last-child`/`:nth-child(an+b)`/`:not()`/`:root`/`:empty`、`:hover/:active/:disabled`
  （仅 button，进 `UIScript.args.hover/pressed/disabled`）。不支持：属性选择器、
  兄弟 `~`/`+`、`::before`/`::after`（硬报错）。
- **级联**：来源层 UA < 作者；`!important` > 普通；特异性 (id,class,tag)；平局按顺序；
  inline style 最高。**继承**：color/font-*/text-align/line-height/letter-spacing/
  text-transform/white-space/visibility/list-style-type 等。
- **自定义属性**：`--x` 作用域继承 + `var(--x, fallback)` 替换（编译期求值）。
- **单位**：px/%/em/rem/vw/vh/pt/pc/in/cm/mm/q、无单位倍数、`calc()`（静态求值）、
  `fr`（grid）。
- **颜色**：148 命名色、#hex3/4/6/8、rgb/rgba、hsl/hsla、transparent（统一归一
  `#rrggbb[aa]`）。
- **简写展开**：margin/padding/inset/border(四边)/background/font/flex/flex-flow/
  gap/overflow/place-*/text-shadow/border-radius。
- **布局**：display(block/inline/inline-block/flex/inline-flex/grid/inline-grid/
  list-item/table 族/none)、position(static/relative/absolute/fixed)、盒模型
  （margin/padding/border、content-box/border-box）、width/height/min-/max-、
  aspect-ratio、flex-direction/wrap/grow/shrink/basis、justify-content(6)/
  align-items/align-self/stretch、grid-template-columns/rows（px/%/fr/auto、
  repeat()）、grid-column/row 线位与 span、order 忽略、z-index→zOrder。
- **溢出与滚动**：`overflow: hidden/clip` → `UIMaskComponent`（radius 取同元素
  border-radius；scissor 矩形 + 圆角 SDF 裁剪，troika 退化矩形）；
  `overflow: auto/scroll` → `UIMaskComponent` + `UIScrollContainerComponent`
  （子项包进 `_ScrollContent` 内容层，滚动/滚动条/回弹运行时驱动；显式
  `data-comp="UIScrollList"` 时仍走等步长列表逃逸通道）。
- **视觉**：background-color/image(url 剥离)/linear-gradient（引擎 UIImage 渐变
  渲染，见下）、border-radius（四角一致；不一致报错）、border（实线，四条子 Actor
  模拟）、opacity、visibility、transform(translate/rotate/scale/matrix→rotation/scale)、
  box-sizing。
- **文本**：font(简写)/font-family(取首族)/font-size/font-weight(≥600=bold)/
  font-style/line-height(px 或倍数)/letter-spacing/text-align/standard text-shadow
  （→shadowColor/Blur/OffsetX/Y；专有 `text-shadow-color/blur` 别名兼容）/
  text-transform(uppercase/lowercase/capitalize 编译期实现)/white-space(normal/
  nowrap/pre/pre-line 影响编译期空白折叠)/list-style-type。
- **@规则**：`@media`（min/max-width/height 静态评估）、`@import` 与
  `<link rel=stylesheet>`（内联，需调用方提供文件读取）、`:root`。
  `@keyframes/@font-face/@supports` 等 → 硬报错（动效用 UIScript + TweenSystem）。

### 引擎配套改动

`UIImageComponent` 新增 `gradient` 属性
（`{ angle, stops: [{color, offset}] }`，CSS 角度语义，canvas 渐变渲染，持久化支持）。

## 4. 警告通道（编译成功但需作者知悉）

近似/装饰类声明走 `CompileResult.warnings`（行号+原因，CLI/MCP 透传）：

- 文本测宽为字体学估算（CJK≈1em、拉丁≈0.52em/字符）——需要精确尺寸请显式声明；
- 混排内联内容按行框静态切片，切片后不再运行时换行（纯文本块仍走 troika 动态换行）；
- 垂直 margin 不折叠（恒相加，与浏览器有偏差、确定性更强）；
- `%` 边距/内边距按画布宽解算（浏览器按包含块宽）；
- 绝对定位包含块 = 父内容盒（浏览器为最近定位祖先 padding 边缘）；
- `text-decoration`/`cursor`/`user-select`/`word-spacing` 等装饰属性不渲染；
- `white-space: nowrap` 不保证单行（troika 恒按控件宽换行）；
- button 的 `disabled`/input 的 `disabled/readonly`/`type=password` 无引擎对应态；
- 非 button 元素的 `:hover` 等交互态不生效；`:hover` 色无 data-script 时仅入
  args 不生效。

## 5. 反编译（widget.json → .widget.html）

**作者层结构还原**（2026-09-01 起，round-trip 损耗已解决）：

- **padding/border**：读 `sourceLayout` 侧车还原 `box-sizing: border-box` +
  `padding` + `border-<side>` CSS；编译端 border 的产物形（`<名>Border<侧>` 纯色
  条子 Actor）折叠回 border CSS，重编译时按名重建、逐字节稳定；
- **flex**：节点带 UILayoutComponent → 还原 `display:flex` + 方向/gap/justify/align，
  子项去掉绝对定位回归流内（引擎 UILayout 本就重排全部子项，json 里的子项
  position 对 v1 资产是占位、对新资产与公式一致）；重编译经求解器 + 门判定
  复原 UILayout，往返稳定；
- **纵/横堆叠**：无 UILayout 的净容器，全部子项几何与块级纵排/净 flex 横排一致时
  （首项贴内容原点、逐项紧贴前一项边盒 = margin 全 0、无锚点/变换）还原为
  流内子项（横排补 `display: flex`）；有手工拖动偏差则保持绝对定位，几何不丢；
- 其余（grid、有 margin/锚点的自由布局）保持**绝对定位 + class 样式**规范形。

`html → json → html' → json''` 布局/组件/侧车全等效（78 节点综合用例 +
padding/flex/v1 旧 json 用例，容差 0.1px = 世界 2 位小数量化精度）。
已知边界：grid 轨道模板不还原（保持绝对坐标，几何精确）；手工拖动过的
流内子项保持绝对定位（不丢拖动结果）。

## 6. 工具链

- CLI（`scripts/ui-compiler-cli.mjs`）改为 **esbuild 现场打包 TS 源**执行——
  单一事实来源，旧 mjs 手工镜像已废弃；外部样式相对源文件解析。
- MCP `ui_compile` / 编辑器命令透传 `warnings`。
- `CompileOptions.resolveInclude`：编辑器/CLI 注入文件读取以支持 link/@import。
