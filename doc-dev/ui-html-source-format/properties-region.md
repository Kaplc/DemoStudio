# 方案：widget HTML `<properties>` 参数区（设计/参数分层）

> 状态：已实施（2026-09-05） ｜ 提出日期：2026-09-04 ｜ 类型：资产格式扩展（编译器/编辑器保存链路，不改运行时）
>
> 关联：[plan.md](plan.md)（HTML 源格式方案沿革）、[full-mapping.md](full-mapping.md)（映射权威文档，实施后需同步）
>
> 沿革：2026-09-04 人工属性编辑引入「原地数值补丁」（patch.ts）后，组件参数以 JSON 字符串
> 散落在 HTML 属性里的问题暴露为回写链路中最脆弱的一环；本文将其收敛为文件内独立参数区。

## 1. 背景与动机

HTML 源格式的目的：AI 按「原生 HTML + CSS」设计页面，编译器全包引擎细节。现状组件参数
（锚点/脚本参数/布局调参）以 JSON 字符串散落三类位置：

| 现状承载 | 例 | 问题 |
|---|---|---|
| `<widget>` 标签 `data-comp`/`data-props` | 根锚点 UIWorldAnchorComponent | `&quot;` 转义噪音、属性串冗长 |
| body 元素 `data-comp`/`data-props` | UILayout 调参、UIScrollList | 同上；且与原生标签映射并存时语义易混 |
| `data-args` | UIScriptComponent 参数 | 同上 |

对保存链路的影响：人工在 Inspector 改属性（如 pxPerMeter）→ 保存 → 原地补丁需解析
「JSON 塞在 HTML 属性」的结构做键级合并 + 自动补 data-comp——是 26 用例矩阵中
最脆弱的分支；且属性串对 AI 可读性差（AI 的设计画布上挂着转义 JSON）。

目标：**原生 HTML 保持纯设计（结构 + CSS + 内联文本），组件参数收敛到文件内一个
机器管理的 `<properties>` 参数区**。人工改属性 = 重写参数区对应键，平凡且不伤排版。

## 2. 方案

### 2.1 语法

```html
<widget name="BuildingInfoCard" canvas="520x300" data-script="gameplay/base/BuildingInfo">
  <properties>
    {
      "BuildingInfoCard": { "UIWorldAnchorComponent": { "pxPerMeter": 150, "mode": "world", "pixelDensity": 2, "faceCamera": true, "alwaysOnTop": true } },
      "Btn_collect": { "UIScriptComponent": { "args": { "hover": { "color": "#66bb6a" } } } }
    }
  </properties>
  <style>…纯视觉样式…</style>
  <div class="CardRoot">…纯原生结构…</div>
</widget>
```

- 位置：`<widget>` 直接子级（嵌套更深不识别）；内容为**原始 JSON**（同 script/style
  原文语义：不解析实体、不解析子节点）
- 键结构：`节点名 → 组件 baseClass → properties 对象`；节点名即编译产物 name
  （全局唯一是编译器既有保证 usedNames）

### 2.2 职责边界

判定标准：**该值在 HTML/CSS 里有没有原生表达位**（不是"影不影响外观"）。

| 表达位 | 归属 | 例 |
|---|---|---|
| 有 CSS/标签对应写法 | 原生 HTML | `fontSize`→`font-size:`、`color`、`z-index`、`hit-test`、文本内联、`gap`→UILayout spacing |
| 无 CSS 对应物的组件参数/挂载 | `<properties>` 区 | UIWorldAnchorComponent 全部参数（pxPerMeter/pixelDensity/mode/faceCamera/alwaysOnTop/…）、UIScriptComponent args、未来行为组件 |

- **视觉组件禁止在 region 声明**：UITransformComponent / CanvasUIComponent /
  UITextComponent / UIImageComponent / UIButtonComponent → 编译报错，引导用标签+CSS
  （避免同一视觉值出现两个真相源）
- 文本内容保持内联（AI 设计所见即所得），不进 region

### 2.3 编译语义

1. tokenize + unwrapDocument 后、样式收集前：提取 `<properties>` 并从树中移除
   （不参与布局求解与标签白名单校验）
2. JSON 解析失败/结构非法/视觉组件声明/引用不存在节点 → **CompileFail（带行号）**，
   绝不静默降级
3. 产物发射完成后按节点名挂载：节点存在 → 组件已存在则键级合并（region 覆盖，
   与 emitDataComp 现语义一致）；不存在则新挂
4. 应用顺序在 emitDataComp（legacy data-comp）之后 → **region 永远赢**（迁移期双声明容忍）
5. sourceHash 对全文（含 region）计算——region 改动即换 hash，双边同改冲突检测天然生效

### 2.4 保存链路（人工属性编辑回写）

- 基线差量（UIPreviewManager._propBaseline，只写改过的属性）不变
- 原地补丁（patch.ts）分工调整：
  - region 承载组件（UIWorldAnchorComponent）差分 → 解析 region JSON → 并入差分键 →
    **整块规范化重写**（`JSON.stringify(,2)` 2 空格缩进；region 是机器管理数据区，
    规范化即特性，不承诺保留手写排版）；region 缺失时在 widget 开标签后创建
  - 视觉/文本/根标签属性 → 既有 span 补丁不变（22 用例路径）
- 重编译验证安全网不变（UILayoutComponent 双侧豁免、volatile 派生字段条件剥离）

### 2.5 反编译（回退整篇重写路径）

- 前置遍历产物 JSON：所有节点的 UIWorldAnchorComponent 摘出 → region（按节点名）；
  其余组件沿用现有逃逸通道（data-comp/data-props 等）
- region 非空时在 `<widget>` 开标签后输出规范格式 `<properties>` 块
- 往返保证：decompile → recompile 语义逐位等价（锚点经 region 原样还原）

### 2.6 向后兼容

- `data-comp`/`data-props`/`data-args` 语法保留可编译（存量资产无需立即迁移）
- 同组件双声明（attrs + region）→ region 覆盖，lint 迁移期不告警
- assetLint comp checker 不变——region 挂载发生在产物节点上，现有 checker 直接校验

## 3. 实现清单

| 文件 | 改动 |
|---|---|
| `src/editor/asset/uiCompiler/miniParser.ts` | `properties` 加入 RAW_TEXT_TAGS（原文读取） |
| `src/editor/asset/uiCompiler/compile.ts` | 提取/校验 region（CompileFail 三类）；`applyPropertiesRegion` 按节点名挂载（含视觉组件 BLOCKED 表） |
| `src/editor/asset/uiCompiler/patch.ts` | UIWorldAnchorComponent 从 DATA_COMP_FAMILY 移出 → region 键重写分支（缺失时创建） |
| `src/editor/asset/uiCompiler/decompile.ts` | UIWorldAnchorComponent 前置摘出 → region 规范格式输出 |
| fish 资产 ×3 | building_info / building_collect / base_hologram 根锚点迁入 region（**以磁盘现值为准**，pxPerMeter 勿回退） |
| `doc/editor/ui/ui_widget_html_manual.md` | §2 增加 properties 区说明（含 2.2 判定标准表） |

## 4. 测试计划

1. 26 用例属性矩阵重跑：根锚点 7 用例改走 region 路径，其余 19 用例不变（回归）
2. 反编译往返：3 资产 decompile → region 回写 → recompile 语义逐位等价
3. 离线 gate（ui-compile-gate.mjs）编译 + lint 零错误
4. `tsc --noEmit` + `smoke:ui` 全绿

## 5. 风险与边界

- **改名耦合**：region 按节点名键控——节点改名后 region 项失配（编译报错提示）。
  改名属结构改动（大纲已禁人工改名），AI 改名需同步 region 键
- **region 格式规范化**：补丁/反编译重写时统一 2 空格缩进，手写排版不保留——数据区定位使然
- **迁移期双声明**：attrs 与 region 同时声明同组件 → region 赢；不告警，逐步迁移
- **不做的事**：region 不承载视觉属性、不引入新单位/换算、不改变运行时（JSON 产物结构不变）
