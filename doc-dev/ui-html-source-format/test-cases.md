# 测试用例：UI 资产 HTML 源格式（编译/反编译/双向同步）

> 对应方案：同目录 `plan.md`、`properties-region.md` ｜ 用例总数：58 ｜ 自动化优先级标注：P0 必须自动化 / P1 建议自动化 / P2 手工
>
> 前置说明：编译/反编译为纯函数式工具（输入字符串/AST → 输出字符串），
> A/B/C/G 四组用例全部可脱离 dev server 跑单元测试；D/E 组涉及编辑器与
> 预览窗口，走 e2e（dev server :5173 前提，参照 `e2e/` 既有设施）。

## A. UILayoutComponent 对齐能力（引擎侧）

### TC-A1 justify 主轴分布六值 【P0】

- **前置**：UILayoutComponent 新增 `justify` 属性（§8）
- **步骤**（单测，实例化 3 个子项的容器）：
  1. 分别设 `justify: start/center/end/space-between/space-around/space-evenly`
  2. Tick 后读取 3 个子项被写回的 anchorOffset
- **预期**：主轴偏移分布符合 CSS 语义——start 首项贴边、center 整组居中、
  space-between 首尾贴边中间均分、space-around/evenly 间隔按定义
  （around 首尾间隔 = 内间隔 1/2；evenly 全部相等）

### TC-A2 align 交叉轴对齐四值 【P0】

- **步骤**：容器高 200，子项高 60/100/140 各一，分别设
  `align: start/center/end/stretch`
- **预期**：前三值子项按各自高度对齐容器对应边/中线；stretch 下**未显式
  设高**的子项 worldHeight 被写回为容器内高，显式设高的不动

### TC-A3 水平/垂直方向 × 对齐组合 【P1】

- **步骤**：horizontal/vertical 两 mode 与 justify×align 全组合（2×6×4），
  校验子项偏移与尺寸写回
- **预期**：主轴/交叉轴语义随 direction 互换正确

### TC-A4 旧资产兼容（缺省值不重排） 【P0】

- **步骤**：加载现有 fish 项目全部含 UILayoutComponent 的 widget，
  对比补齐属性前后子项 anchorOffset
- **预期**：缺省 justify/align = start/start 时，所有旧资产排列结果与
  改动前逐位一致

### TC-A5 动态子项 + 对齐重排 【P1】

- **步骤**：运行时增删子 Actor，验证既有脏检测触发重排且对齐属性生效
- **预期**：增删后子项按当前 justify/align 重新分布，无残留旧偏移

## B. ui-compiler（html → json）

### TC-B1 基础控件映射 【P0】

- **步骤**：最小源（`<widget>` + div + 文本 + img + button + data-script）
  编译
- **预期**：产物结构 = Actor 树；div→空节点、文本→UITextComponent、
  img→UIImageComponent、button→UIButtonComponent、data-script→
  UIScriptComponent（properties.script 路径正确）；产物 assetLint 零错误

### TC-B2 flex 容器映射 【P0】

- **步骤**：`display:flex; flex-direction:row/column; gap:Npx` 编译
- **预期**：容器挂 `UILayoutComponent`，mode 正确，gap 按画布 DPI 换算
  成 spacingX/spacingY（米），数值与公式 `px / canvasWidth * worldWidth`
  一致

### TC-B3 justify/align 全枚举透传 【P0】

- **步骤**：justify-content 6 值 + align-items 4 值分别编译
- **预期**：产物 UILayoutComponent.justify/align 取对应引擎枚举；
  stretch 编译不报错（运行时行为由 TC-A 覆盖）

### TC-B4 px→米换算与 %锚点 【P0】

- **步骤**：`width:200px` 在 canvas="960x540"（worldWidth 4.8）下编译；
  `position:absolute; left:50%; top:0` 编译
- **预期**：worldWidth = 200/960*4.8 = 1；% 值映射为 anchor +
  anchorOffset 比例定位

### TC-B5 引擎专有属性承载 【P0】

- **步骤**：`z-order:7; hit-test:visible` 与 `.btn:hover { color:#ffd700 }`
  编译
- **预期**：z-order/hit-test → CanvasUIComponent 对应字段；
  :hover 仅映射 UIButton 状态色（hoverColor 等）

### TC-B6 超集硬报错（含行号） 【P0】

- **步骤**：分别注入越界写法——`display:grid`、`flex-wrap:wrap`、
  `flex-grow:1`、`@media`、`@keyframes`、嵌套选择器、`display:block`、
  未知属性 `margin:8px`
- **预期**：每条编译失败，错误信息含 .widget.html 源行号与具体属性名；
  **绝不**生成降级产物（无输出文件/无部分结果）

### TC-B7 lint 门槛联动 【P0】

- **步骤**：构造可解析但违反 assetLint 的源（如空 name、非法 script 路径）
- **预期**：编译器在 lint 阶段失败并透传 lint 错误，不落盘产物

### TC-B8 sourceHash 写入 【P0】

- **步骤**：同一源编译两次；改一字符再编译
- **预期**：两次产物除时间无关字段外逐字节一致（确定性输出），顶层含
  `sourceHash`；改源后 sourceHash 变化

### TC-B9 data-comp 逃逸通道编译方向 【P1】

- **步骤**：`<div data-comp="UIProgressBar" data-props='{"value":0.5}'>` 编译
- **预期**：产物节点挂 UIProgressBarComponent，properties 原样透传

### TC-B10 真实资产逆向验证（toast） 【P0】

- **步骤**：人工/AI 为 `toast.widget.json` 编写等效 .widget.html，编译
- **预期**：编译产物与原 json 在控件树/组件/属性上等效（anchorOffset
  语义级一致，不要求逐字节）；assetLint 零错误

## C. ui-decompiler（json → html）与 round-trip

### TC-C1 规范形反编译 【P0】

- **步骤**：TC-B1~B5、B9 的产物反编译
- **预期**：生成的 .widget.html 语法合法、样式在映射子集内、含全部
  信息（含 data-comp 逃逸还原）；格式为规范形（固定缩进/属性顺序）

### TC-C2 round-trip 等效 【P0】

- **步骤**：对 §B 全部正向用例执行 `html → json → html' → json'`
- **预期**：json' 与 json 语义等效（结构+属性），html' 与 html 规范形
  一致或语义等效

### TC-C3 反编译非编译器产物（防御） 【P1】

- **步骤**：对 AI 重建前的旧 toast.widget.json（无 sourceHash）反编译
- **预期**：能识别"非编译器规范形"，输出警告并尽力转换；映射不到的
  组件走 data-comp 逃逸，不丢字段（对比 json 节点/属性总数）

### TC-C4 data-comp 逃逸不丢信息 【P0】

- **步骤**：含 UIProgressBar/UIScrollList 的 json 反编译→再编译
- **预期**：round-trip 后该组件 properties 逐字段一致

## D. 双向同步与冲突

### TC-D1 编辑器保存自动回写 【P0，e2e】

- **步骤**：
  1. 打开有源资产的 UIPreviewManager，拖动某按钮位置
  2. 保存 widget.json
- **预期**：.widget.html 立即被反编译回写，重新打开源文件可见按钮
  新位置（left/top 或锚点值）；sourceHash 重算一致

### TC-D2 AI 改源重编译 【P0】

- **步骤**：修改 .widget.html 后调用 ui_compile 工具/CLI
- **预期**：widget.json 更新；UIPreviewManager 重新加载显示新布局

### TC-D3 双边同改冲突仲裁 【P1，e2e】

- **步骤**：
  1. 手动同时改 .widget.html 与 widget.json（不经过同步链路）
  2. 触发同步
- **预期**：检测 sourceHash 不一致，提示二选一；选择后仅保留所选方
  改动，另一侧被覆盖且等效

### TC-D4 同步链路外裸改 json 防御 【P1】

- **步骤**：绕过编辑器直接文本编辑带 sourceHash 的 widget.json
- **预期**：下次编译/打开资产时识别指纹失效并提示重编译或反编译，
  不静默覆盖任何一侧

### TC-D5 无源旧资产行为 【P1】

- **步骤**：打开无 sourceHash 的旧 widget.json 编辑保存
- **预期**：不触发反编译回写（无源可写），正常旧流程；不误删、不报错

## E. AI 工作流与旧资产重建

### TC-E1 skl-create-ui-widget-asset 新流程 【P0】

- **步骤**：按改造后技能让 AI 创建一个新 HUD（源→编译）
- **预期**：AI 全程只产出 .widget.html + 调用 ui_compile；产物 lint
  零错误且 UIPreviewManager 预览正常

### TC-E2 ui_compile 工具错误反馈 【P0】

- **步骤**：AI 提交 TC-B6 类越界源给工具
- **预期**：工具返回面向源文件的行号错误，AI 据此可一次修正；
  错误不暴露生成物坐标

### TC-E3 17 个旧资产重建等效 【P0，可分批】

- **步骤**：对 `src/projects/fish/asset/blueprints/ui/` 全部 widget 逐个：
  AI 写源 → 编译 → 与原 json 语义对比 → UIPreviewManager 预览比对
- **预期**：每个资产控件树/组件/布局属性等效、预览视觉一致；
  替换后游戏内 HUD/菜单/Toast 全部表现不变

### TC-E4 重建后进入双向同步 【P1】

- **步骤**：任一重建完成的资产执行 TC-D1 流程
- **预期**：已带 sourceHash，回写正常，旧资产升级为源资产管理

### TC-E5 全量回归 【P0】

- **步骤**：17 个资产替换后启动 fish 项目全流程（主菜单→游戏→HUD→Toast）
- **预期**：UI 表现与替换前一致；`tsc` 与既有 e2e 无回归
  （注意：ClashMaster 存在与本方案无关的既有失败，不作门槛）

## F. 并发与边界

### TC-F1 编译产物文件占用 【P2】

- **步骤**：游戏运行中（资产已加载）触发重编译
- **预期**：产物写盘成功；运行中实例不受影响，热重载/重启后生效

### TC-F2 空/畸形源 【P0】

- **步骤**：空文件、无 `<widget>` 根、未闭合标签、`<style>` CSS 语法错
- **预期**：各自给出定位明确的编译错误，不崩溃、无产物

### TC-F3 超大与深嵌套 【P2】

- **步骤**：200 节点 / 20 层嵌套的源编译+反编译
- **预期**：完成时间可接受（< 1s 量级），round-trip 等效，无栈溢出

## G. properties 参数区（编译/保存回写/反编译）

> 对应方案：同目录 `properties-region.md`。参数区语法：
> `<properties>{ "节点名": { "组件BaseClass": { …props } } }</properties>`，
> widget 直接子级、内容为原始 JSON。

### TC-G1 根节点组件挂载 【P0】

- **步骤**：region 声明根节点 `UIWorldAnchorComponent`（pxPerMeter/mode/faceCamera 等），
  无 data-comp，编译
- **预期**：产物根 components 含 UIWorldAnchorComponent 且属性逐键一致；
  assetLint 零错误

### TC-G2 子节点组件挂载 【P0】

- **步骤**：region 声明子节点（如 `"Btn_collect": { "UIScriptComponent": { "args": … } }`），
  编译
- **预期**：产物对应 name 子节点挂载该组件，属性一致；与父节点无关

### TC-G3 与原生组件键级合并 【P0】

- **步骤**：根 `<widget data-script="X">` + region 声明同节点 UIScriptComponent.args，
  编译
- **预期**：产物仅一个 UIScriptComponent：script 来自 data-script，args 来自 region
  （键级合并，region 覆盖同名键）

### TC-G4 region 覆盖 legacy 双声明 【P1】

- **步骤**：同一组件同时以 data-comp/data-props（attrs）与 region 声明且值不同，编译
- **预期**：产物单组件，冲突键取 region 值（应用顺序：emitDataComp 之后再挂 region）

### TC-G5 空/缺失 region 【P0】

- **步骤**：无 `<properties>`、`<properties></properties>`、空对象 `{}` 三种源编译
- **预期**：三者产物均与无 region 等价；空对象不报错

### TC-G6 sourceHash 随 region 变化 【P1】

- **步骤**：仅修改 region 内一个值后重编译
- **预期**：sourceHash 变化（hash 对全文计算），其余产物不变

### TC-G7 坏 JSON 【P0】

- **步骤**：region 内容为非法 JSON（缺引号/尾逗号），编译
- **预期**：CompileFail 带 properties 区行号，无产物

### TC-G8 未知节点名 【P0】

- **步骤**：region 引用不存在的节点名，编译
- **预期**：CompileFail 指明节点名（节点名必须与产物 name 唯一对应）

### TC-G9 视觉组件禁声明 【P0】

- **步骤**：region 声明 UITextComponent/UIImageComponent/UITransformComponent 之一
- **预期**：CompileFail（视觉属性用标签+CSS 表达），引导性错误信息

### TC-G10 嵌套 properties 不识别 【P1】

- **步骤**：`<div>` 内嵌 `<properties>` 编译
- **预期**：编译报错（非 widget 直接子级不提取，validateTags 按未知标签拒绝）——
  防止参数区被意外嵌进设计树

### TC-G11 锚点参数改写 region 【P0】

- **步骤**（保存回写，模拟 collectSaveData 基线差量）：Inspector 改 pxPerMeter → 保存 →
  patchWidgetHtmlInPlace
- **预期**：region 对应键更新，HTML 其余内容（缩进/注释/结构/CSS）逐字节不变；
  补丁后重编译语义 = 保存 JSON；无回退

### TC-G12 region 缺失的 legacy 资产自动创建 【P1】

- **步骤**：锚点仍以 data-props 承载的旧 HTML（未迁移资产）改锚点参数保存
- **预期**：`<properties>` 自动创建并写入新值（region 赢）；data-props 残留但被覆盖；
  后续编辑继续走 region

### TC-G13 多键同改一次重写 【P1】

- **步骤**：pxPerMeter 与 faceCamera 同次保存均变化
- **预期**：单次 region 规范化重写（一个编辑 span），无多次拼接

### TC-G14 视觉属性回归 【P0】

- **步骤**：fontSize/color/text/zOrder 编辑保存（region 存在于同文件）
- **预期**：仍走 CSS span 补丁/文本替换，region 内容零改动——两链路互不干扰

### TC-G15 UILayout 调参回归 【P1】

- **步骤**：flex 容器 spacingX（gap）编辑保存
- **预期**：仍走元素 data-props 属性路径（UILayout 有 CSS 表达位，不迁 region）

### TC-G16 根锚点输出 region 【P0】

- **步骤**：含根 UIWorldAnchorComponent 的 JSON 反编译
- **预期**：`<widget>` 开标签后输出规范格式 `<properties>` 块（2 空格缩进），
  无 data-comp 锚点残留

### TC-G17 子节点锚点输出 region 【P1】

- **步骤**：子节点级 UIWorldAnchorComponent 反编译
- **预期**：region 按该节点名键控输出，节点 components 中不再含锚点

### TC-G18 往返逐位等价 【P0】

- **步骤**：3 个 fish 资产（building_info/building_collect/base_hologram）
  decompile → recompile，与原 JSON 对比
- **预期**：语义逐位等价（忽略 id/sourceHash），锚点参数经 region 原样还原

### TC-G19 双边同改冲突仲裁 【P1】

- **步骤**：手改 region 值（不重编译）+ 预览改属性保存（sourceHash 不一致触发冲突）
- **预期**：以最后保存方 json 为准，region 被补丁重写 + 冲突告警日志；不丢预览改动

### TC-G20 矩阵与套件回归 【P0】

- **步骤**：26 用例属性矩阵重跑（根锚点 7 用例改走 region 路径）+ `tsc --noEmit` +
  `smoke:ui`
- **预期**：矩阵 22 项补丁/4 项设计内回退结论不变；tsc 零错误；smoke 全绿

## 用例 × 优先级汇总

| 组 | 数量 | P0 | P1 | P2 |
|---|---|---|---|---|
| A 布局对齐 | 5 | 3 | 2 | 0 |
| B 编译器 | 10 | 9 | 1 | 0 |
| C 反编译/round-trip | 4 | 3 | 1 | 0 |
| D 双向同步 | 5 | 2 | 3 | 0 |
| E AI 工作流/重建 | 5 | 4 | 1 | 0 |
| F 边界 | 3 | 1 | 0 | 2 |
| G properties 参数区 | 20 | 12 | 8 | 0 |
| 合计 | 58 | 34 | 16 | 2 |
