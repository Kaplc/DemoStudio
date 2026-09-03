# 需求方案：UI 资产 HTML 源格式（AI 编写层 + 单向编译）

> 状态：方案设计（待排期） ｜ 提出日期：2026-09-01 ｜ 类型：架构扩展（AI 工作流/资产管线，不改运行时）

## 1. 背景

当前 UI 资产为 JSON 蓝图树（`asset/blueprints/ui/*.widget.json`，与 blueprint.json 同构：
`components[]` + `children[]` 递归）。布局由三套机制拼出：

| 机制 | 实现 | 说明 |
|---|---|---|
| 锚点定位 | `UITransformComponent`（`src/engine/ui/UITransformComponent.ts`） | Unity 九宫格锚点 + `anchorOffset`，尺寸单位是**米** |
| 容器排列 | `UILayoutComponent`（`src/engine/ui/UILayoutComponent.ts`） | horizontal/vertical/grid，实现方式是**写回**每个子节点的 anchorOffset |
| 画布/标识 | `CanvasUIComponent`（`src/engine/rendering/CanvasUIComponent.ts`） | 真画布/markerOnly + zOrder + hitTest |

AI 直接编辑 widget.json 排布局效果差，根因：

1. **单位反直觉**：尺寸/偏移是米，与像素直觉脱节，AI 手算换算易错；
2. **布局是计算结果不是声明**：UILayoutComponent 会把排列结果写回
   anchorOffset，AI 手改的 offset 会被容器 Tick 覆盖，改了也白改；
3. **表达形状差**：一个控件 = 3~5 个 component 对象的数组，而模型训练语料中
   最密集的 UI 先验是 HTML/CSS——同样的布局，AI 写 flex 的准确率远高于
   手算锚点偏移。

## 2. 目标

1. AI 产出 UI 布局的质量对齐其 Web 前端水平（声明式、模式匹配，而非几何推理）；
2. **运行时零改动**：widget.json 仍是运行时唯一正本资产，Canvas 2D 纹理 +
   Three mesh 管线、组件系统全部不动；
3. 源文件只有一个（HTML 与 CSS 合体），不产生三文件同步负担；
4. 超出编译能力的写法**编译期硬报错**，绝不静默降级成坏布局。

## 3. 架构

```
AI 编写/编辑  xxx.widget.html（唯一源文件，样式内联 <style>）
              │
              ▼   ui-compiler：html → json（新增，editor/tooling 层，非 engine）
        xxx.widget.json（运行时正本，资产注册/lint/预览照旧）
              ▲
              │   ui-decompiler：json → html（编辑器保存 widget.json 时
        用户在 UIPreviewManager 可视化修改          同步回写源文件）
              │
              ▼   现有运行时（UIManager 实例化蓝图，不改）
```

定位类比：HTML 是 UMG 给 AI 的"源码视图"，widget.json 是编译后的资产。
双向同步：AI 改源 → 重编译；用户在预览窗口改 json → 反编译回写源。
任一方向改动后两个文件始终等效，文件数 = 2（1 源 + 1 产物）。

## 4. 源文件格式：`*.widget.html`

单个文件，`<widget>` 根元素声明画布，样式全部内联 `<style>`：

```html
<widget name="game_hud" canvas="960x540" anchor="top-center" offset="0,0.55">
  <style>
    .root { display:flex; flex-direction:column; align-items:center; gap:8px; }
    .btn  { width:200px; height:36px; z-order:7; hit-test:visible; }
    .btn:hover { color:#ffd700; }        <!-- UIButton 状态色，见映射表 -->
  </style>
  <div class="root">
    <div class="btn" data-script="gameplay/BaseHud">开始游戏</div>
    <img class="icon" src="asset/texture/ui/icon_start.png" />
  </div>
</widget>
```

元素→控件映射：`div` → 空 Actor（可挂 CanvasUI markerOnly / Layout）、
`img` → UIImageComponent、`button` → UIButtonComponent、
文本节点 → UITextComponent、`data-script` 属性 → UIScriptComponent。

## 5. CSS 映射面（2026-09-01 升级：完整原生 HTML 映射）

> **v1 受控子集已被取代**。现行权威文档：[full-mapping.md](full-mapping.md)——
> 完整标签全集、全属性选择器/级联/继承、单位/命名色/calc/var、盒模型、
> 块级流/内联流/flex(wrap/grow)/grid/表格、UA 默认样式、编译期静态布局求解、
> 警告通道与已知偏差表。以下为 v1 历史记录。

### v1 历史：CSS 受控子集（成败点）

第一版只映射现有引擎能力能**精确表达**的子集，超出即编译报错（含行号）。
不做的：grid 复杂用法、flex wrap、grow/shrink、动画、伪类（:hover 仅映射
UIButton 已有状态色除外）、选择器嵌套/级联（只支持单 class + 元素选择器，
样式冲突报错不叠加）。

| CSS | 目标 | 备注 |
|---|---|---|
| `display:flex; flex-direction:row/column` | `UILayoutComponent.mode: horizontal/vertical` | 无 wrap/grow |
| `gap` | `UILayoutComponent.spacingX/spacingY` | |
| `justify-content`（flex-start/center/flex-end/space-between/space-around/space-evenly） | `UILayoutComponent.justify` | 主轴对齐，需 UILayout 补齐（见 §8，完整支持） |
| `align-items`（flex-start/center/flex-end/stretch） | `UILayoutComponent.align` | 交叉轴对齐 + 拉伸，需 UILayout 补齐（见 §8，完整支持） |
| `width/height`（px） | `UITransform.worldWidth/worldHeight` | 按画布 DPI 换算米：`px / canvasWidth * worldWidth` |
| `position:absolute + left/top`（%或px） | `anchor + anchorOffset` | % 直接对应锚点比例 |
| `color/font-size/font-family/text-align` | `UITextComponent` properties | |
| `background-image`（或 `<img src>`） | `UIImageComponent` | |
| `z-order / hit-test`（自定义属性） | `CanvasUIComponent` | 非 CSS 标准，用普通声明语法承载引擎专有属性 |

## 6. 编译器设计

- 位置：`src/editor/asset/uiCompiler/`（tooling 层；engine 不感知 HTML）。
- 实现：HTML 解析用现成库（node-html-parser 等，无浏览器依赖，可在
  编辑器进程与 CLI 双跑）；CSS 解析用 postcss 或轻量子集解析器。
- 产物校验：生成的 widget.json 走现有 assetLint（doc:widget/node:comp），
  **必须零 lint 错误**才算编译成功，双重把关。
- **双向同步（html ↔ json 等效）**：编译器在产物 widget.json 顶层写入
  `sourceHash` 字段（定案：单文件自洽）。同步规则：
  - AI/手动改源 → 重编译，覆盖 json；
  - 用户在 UIPreviewManager/编辑器保存 widget.json → **ui-decompiler
    反编译回写源文件**，随后重算 sourceHash（json 与源重新等效）；
  - 判定依据：保存 json 时若其 sourceHash 与源文件当前编译指纹一致 →
    正常回写；不一致（源也被改过）→ 提示二选一，以最后保存方为准。
- **反编译（json → html）可行性基础**：反编译面对的是本编译器自己生成的
  json（结构、组件顺序、命名均为编译器规范形），不是任意手写资产，因此
  逆向映射表与 §5 完全对称、输出格式固定（规范缩进/属性顺序），round-trip
  稳定：`html → json → html'` 应与 html 语义等效。组件/属性不在映射表内
  （如 UIProgressBar、UIScrollList 等复合组件）→ 用引擎专有属性承载
  （如 `data-comp="UIProgressBar" data-props='{"value":0.5}'`），保证
  反编译不丢信息；
- 触发时机：a) AI 通过工具显式调用（编译/反编译）；b) 资产面板手动
  "编译 UI 源"；c) 编辑器保存 widget.json 时自动反编译回写。不做文件
  watcher。

## 7. AI 工作流改造

- `skl-create-ui-widget-asset` 技能改造：AI 改为编写/编辑 `*.widget.html`，
  通过编译器（CLI 或编辑器工具）产出 widget.json，**不再直接编辑** json；
- AI 工具面新增 `ui_compile(source) -> widget.json + lint 结果 + 错误定位`；
- 报错信息面向 HTML 源（行号指向 .widget.html），不暴露生成物坐标。

## 8. 引擎侧必做改动：UILayoutComponent 对齐能力（完整支持）

现有 UILayout 只有 direction + spacing，无主轴/交叉轴对齐概念。为完整
支持 CSS 对齐语义，UILayoutComponent 需一次性补齐（**定案：完整支持，
不做分期砍减**）：

新增属性：

- `justify: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly'`
  —— 主轴分布（justify-content）；
- `align: 'start' | 'center' | 'end' | 'stretch'` —— 交叉轴对齐
  （align-items；stretch = 非绝对尺寸子项沿交叉轴拉伸至容器内高/宽）。

实现要点：

- 保持现有"写回子项 anchorOffset"的排列方式不变，对齐只是排列公式扩展
  （space-* 即 gap 重新分布：`space-between` 首尾贴边、`space-around/evenly`
  按定义均分间隔），不引入新的布局 passes；
- stretch 通过写回子项 `worldWidth/worldHeight`（仅当子项未显式设置该轴
  尺寸）实现，与UILayout 写回 offset 同一套脏检测机制；
- 对齐属性缺省值 `start/start`，与现有已排资产行为完全兼容（不重排旧
  widget 的既有 offset 结果）；
- 与容器自身锚点正交：容器锚点定整组位置，justify/align 定组内分布。

依旧不做（明确排除）：flex wrap、grow/shrink、baseline 对齐、
`align-content`（多行语义，无 wrap 即无多行）。

## 9. 边界与已知限制

- 既有 17 个 fish widget.json 为"无源资产"：由 AI 按本方案逆向逐个重建
  `.widget.html` 源（重建后编译产物须与原 json 等效，UIPreviewManager
  预览比对通过后替换），不留双格式并存的资产；
- `<style>` 不支持跨文件引用、不支持 @media/@keyframes；
- 一份源只编译一个 widget（弹窗/Toast 各自一个 .widget.html），不做一对多模板；
- 动态数据绑定（血条进度、列表项）不在源格式职责内，仍由 UIScript/
  UIProgressBar 运行时驱动。

## 10. 实施清单（一次性完成，不分期）

- [ ] UILayoutComponent 补 justify/align（§8，含 stretch 写回与旧资产兼容验证）
- [ ] ui-compiler：HTML/CSS 解析 + §5 子集映射 + 超集硬报错（含行号）
- [ ] 产物走 assetLint 零错误门槛
- [ ] sourceHash 同步 + 双向同步规则（含反编译回写）
- [ ] CLI 入口 + 编辑器"编译 UI 源"动作
- [ ] 改造 skl-create-ui-widget-asset：AI 只写 .widget.html
- [ ] AI 工具注册 ui_compile
- [ ] ui-decompiler：json → html 回写（含 data-comp 逃逸通道）、
      round-trip 等效测试（html→json→html 语义一致）
- [ ] UIPreviewManager 保存链路接入反编译回写
- [ ] 既有 17 个 fish widget.json 由 AI 逆向重建 .widget.html 源并等效替换
- [ ] 验证：拿 1 个现有 widget（如 toast）逆向我们写源编译对比

## 11. 已定案决策（原待决问题）

1. **脚本引用语法**：用 `data-script="gameplay/BaseHud"` 属性（HTML 规范
   的 data-* 承载私有数据，语义干净），不用 `onclick` + `script:` 前缀
   （onclick 语义是执行 JS 代码，与引擎脚本路径不符）。
2. **产物指纹**：`sourceHash` 写入 widget.json 顶层字段，单文件自洽。
   实施时需验证 assetLint 对未知顶层字段的容忍度，不容忍则 lint 加白名单。
3. **双向同步**：用户在预览窗口/编辑器修改 widget.json 后由 ui-decompiler
   反编译回写 .widget.html 源，两侧始终等效；仅当源与 json 同时被改
   （sourceHash 对不上）时提示二选一，以最后保存方为准。
