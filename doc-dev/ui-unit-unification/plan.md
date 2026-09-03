# 方案：UI 单位一元化（1px = 1 单位，UI 世界即像素世界，相机 contain 承担整体缩放）

> 状态：**已实施（2026-09-03 当日完成 Phase 0~4 原子切换，全部门禁绿）**｜ 验收用例：[test-cases.md](./test-cases.md)
> 实施结果：tsc 0 错误；vitest P2 6/6；smoke 全通过（24 资产编译 + round-trip 几何保真 + 综合用例）；e2e_mask_scroll 全绿；golden 对比 24 张中 21 张逐像素相等、3 张 GPU 单像素噪声（tol 1 全等），2 张已知预期差异（滚动条按 D3 微调变纤细；main_menu 字距按根因六修复后首次真实呈现）
> 实施中发现并修复的编译器/引擎深层缺陷：根因四（absolute 卷入行内流）、根因五（flexShrink 侧车缺失）、根因六（letterSpacing 乘数语义）、decompile 输入突变、fmtNum 精度、UIButtonComponent 点击层 ×200（GPU 纹理警告）、html data-props 与 levels.table 米制残留——细节见 test-cases.md 追记与 D3 追记表
> 关联：`doc-dev/ui-html-source-format/`（HTML 源格式，编译器上游）、sourceRect sidecar 专项（互补，另立）

---

## 一、目标与非目标

**目标**：widget.json 的几何字段（`worldWidth / worldHeight / position / anchorOffset` 及 `UILayout.spacingX/Y`、`UIMask.radius`）直接存设计 px，1 单位 = 1px，**数据链路上不存在任何缩放系数**——唯一的空间变换是 UI 相机的 contain 视锥（把 1920×1080 的 UI 世界整体缩放到实际渲染视口）。消灭"px↔米换算"这一整个 bug 类（画布比例依赖、round4 量化丢真、world 声明改变落盘数值、反编译坐标损坏）。

**核心性质（用户定案 2026-09-03）**：
- json 值 = 设计原值，运行时 Inspector 所见即所存，全程零换算误差（整数 px 精确落盘，无 round4 作用域）；
- 旧米制 json 资产直接弃，不做原地迁移——编译端翻转后从 `.widget.html` 全量重编译覆盖（html 是唯一事实源）；
- 因此可以**原子切换**：不存在"新引擎读旧资产"的兼容态，引擎 + 编译器 + 资产在同一分支一起翻转、一次合入。

**非目标**（明确不做）：
- 3D 游戏世界仍是米制——UI 世界（uiScene + UICamera）单位变成 px，与主世界是两个相机两个空间，仅通过屏幕投影发生关系；
- 文本自动尺寸 / shrink-to-fit 等有损环节归 sourceRect sidecar 专项，本方案不解决；
- `.widget.html` 源文件不重写（`world` 属性留在源里，编译器忽略并告警——避免 decompile 回写抹掉 html 手写特性的历史坑）。

## 二、现状链路（调研结论，2026-09-03 实测）

### 2.1 编译端（米制源头）
- `<widget world="WxH">`（缺省 4.8 × 4.8·canvasH/canvasW）+ `<widget canvas>`（缺省 1920×1080）构成 `CompileContext`，**不存在全局 px/m 常数**（`widgetMapping.ts:8-12`）。
- `pxToWorldX/Y = round4(px / canvas × world)`，`compile.ts` 里 `wx()/wy()` 共 32 个调用点，落在：
  - 所有节点的 `UITransformComponent.worldWidth/worldHeight/position/anchorOffset`；
  - `UILayoutComponent.spacingX/spacingY`（`compile.ts:741-742`，已显式写 0，不依赖引擎缺省）；
  - `UIMaskComponent.radius`（`compile.ts:759`）。
- **本来就是 px、不过 wx 的字段**（一元化后自然对齐，预期零改动）：`UIText.fontSize/width/height/letterSpacing/shadowOffset`（canvas px 语义）、`CanvasUIComponent.width/height`、`zOrder`、`sourceLayout` 侧车。
- ⚠️ 审计发现一处既有不一致：`emitRootBackground` 的根背景圆角 `radius = parseFloat(...)` **没过 wx**（`compile.ts:650-651`），px 值存进了米字段——今天就是 bug，一元化后反而自然正确，翻转时核实即可。

### 2.2 反编译端
- 从根 `CanvasUIComponent.width/height` 取画布、根 `UITransform.worldWidth/Height` 取世界尺寸，重建 ctx 后全链 `worldToPxX/Y`（`decompile.ts:91-104`），并回写 `world="WxH"` 属性（`decompile.ts:102`）。

### 2.3 引擎消费端
- **`UICamera` 已经就是"视口整体缩放"机制**：正交相机按固定 UI 画布尺寸做 contain 适配——`UI_CANVAS_W=9.6 / UI_CANVAS_H=5.4` 硬编码常量（`UICamera.ts:19-20`），`setCanvasSize` 以 `min(视口W/9.6, 视口H/5.4)` 缩放视锥、16:9 铺满否则留空。**本方案的核心开关 = 这两个常量换成 1920×1080**。UI 世界单位随之从"米"变为"px"。
- `UIManager.spawnUIActor` 是通用蓝图实例化，不做任何单位处理——px 世界下**无需新增任何逻辑**（v1 方案的 designUnit 标记 / metersPerPx / 根缩放全部不需要了）。
- `CanvasUIComponent.zOrder`：`panel.position.z = v × 0.001`（`CanvasUIComponent.ts:219`）。**无需修改**：深度精度只取决于正交相机 near/far（0.1..200，线性精度 ≈1.2e-5），0.001 步长有 ~84× 余量，且 renderOrder 本就主导透明排序；相机视锥数值变化不影响深度精度。
- `UIScrollContainerComponent` 依赖 `UI_CANVAS_H`：拖拽换算 `worldPerPx = UI_CANVAS_H / 屏幕px高`（`:255,336`）——常量替换后语义自动正确（设计px/屏幕px ≈ contain 比例）；但**滚动条尺寸是硬编码米值**（`0.1×0.4`、`0.08×0.4`，`:300,317`）必须换 px。
- `UITextComponent._pxToWorld = tsf世界高 / canvas高`（`:180-181`）：分子分母同为 px，商恒 1，字号随相机整体缩放——**零改动**（golden 兜底验证）。
- `UILayoutComponent.spacingX/Y` 引擎缺省 0.2：widget 编译器恒显式写值（含 0），px 世界下 0.2 ≈ 0.2px 无害；手写 UI 迁 px 后同理。**决定不改缺省**。
- 手写米制 UI 存量（必须随切换迁移，见 D3 清单）：`GMConsoleHUD.ts:98` 根 9.6m；`registerBuiltinComponents.ts` 缺省 worldSize 5×2.5；`CanvasUIComponent` 缺省 5×2.5；`UITextComponent` 兜底缺省 2.5。

### 2.4 编辑器消费端
- `UIPreviewManager` 三处**米制硬编码**全屏根判定：`getWorldSize()[1] >= 2.7`（`UIPreviewManager.ts:919-920, 1015`）→ px 阈值 540。
- 预览的视口驱动根尺寸、角点拖拽写 `worldWidth`、persist 跳过全屏根（`:1029-1064`）——机制保留（预览期可视化行为，persist 不落盘），数值随 px 自然变大，仅换判定阈值。

### 2.5 存量资产盘点（fish 全部 24 个）
- 全部按 200px/m 设计：全屏面板根 9.6×5.4（1920×1080 画布）、toast 4.8×0.9（960×180）、damage_number 0.8×0.4（160×80）、loot_fly 0.16×0.16（32×32）等。重编译后统一变为：根 = 画布 px（1920×1080、960×180…），与相机画布同一坐标系。
- ⚠️ `gm_cmd_item` 旧 json 根 2.74×0.24 @ 540 画布 ≈ 197.08px/m，与 html 设计存在 ~1.5% 既有漂移（疑手改 round2 残留）。重编译路线下无需复核：html 源是唯一事实源，旧 json 弃用（用户定案），漂移随旧 json 一并消失。
- 24 个 `.widget.json` 与 24 个 `.widget.html` 一一配对（2026-09-02 全量重建过），html 均可独立重编译；`tests/e2e` 无任何米制几何断言（已 grep 证实）；fish gameplay 无世界空间（3D 场景内）widget 用法（已 grep 证实，全部经 spawnUIActor 进 UI 场景）。

### 2.6 脚本与测试现状
- ~~⚠️ test-cases.md 写"P1 已实现 8/8 通过"与事实不符：`tests/uiUnitUnification.test.ts` 在仓库中不存在~~ Phase 0 已补课（2026-09-03）：测试文件已落库，P1 = 7/7（TC-U1~U7）、P2 6 项 skip 预置；vitest.config.ts 就位，tsconfig include 已加 `tests`（exclude `tests/e2e`，playwright spec 自有类型体系不进 tsc）。
- `scripts/ui-compiler-smoke.ts` 断言全是米制公式（`/1920*4.8`、`(px/1000)*4.8`）→ 随翻转改写为 px 口径。
- `scripts/ui-snapshot.mjs` 抓取 worldWidth → 重编译后重生成基线。`ui-compile-gate.ts` 无单位依赖（已核实）。

## 三、核心架构决策

### D1 ｜json 几何 = 设计 px，字段名不变，根 = 画布尺寸
`worldWidth` 等字段名保留，值 = 设计 px；根 `worldWidth/worldHeight` = canvas 尺寸（"canvas 即世界"）。精度：直发布局求解结果（round4 仅作浮点噪声归一，0.0001px 网格，无换算误差）。`<widget world>` 属性：解析器保留但**忽略 + deprecation 告警**（TC-U10 要求带/不带逐位相等；html 源无需批量清洗）。

### D2 ｜UI 世界即像素世界，UICamera contain 承担全部缩放（v2 核心变更）
- `UI_CANVAS_W/H`：9.6×5.4 → **1920×1080**。UI 世界坐标系 = 设计像素坐标系（原点画布中心、y 向上不变）；全屏 widget 根（1920×1080）恰好铺满 contain 视锥，toast（960×180）自然占半宽——与 fish 今天 200px/m 的视觉逐像素等价。
- **json 与运行时 Actor 树都不出现任何缩放系数**：无 designUnit 标记、无 metersPerPx、无根 scale——v1 根缩放路线整体废弃（该路线需在根 Actor 落 0.005 缩放、需要标记区分新旧、需要 zOrder 补偿，全部不再必要）。
- 相机 contain 换算（`min(视口W/1920, 视口H/1080)`）是连续无损的投影级缩放，不触碰任何属性值——"实际值属性不变"在数据与运行时两个层面都成立。
- 3D 主世界仍是米制，两空间互不相干；未来"世界空间跟随 UI"（血条类）需经容器缩放或辅助方法落回米制，属 gameplay 联调边界（文档化，本期不做）。

### D3 ｜手写米制 UI 一次性迁 px（UI 世界从此单一单位）
UI 场景由 UICamera 统一渲染，混用两种单位不可能——手写米制 UI 随原子切换一起改值（非编译产物，逐处手改）：

| 位置 | 现值（米） | 迁移 |
|---|---|---|
| `UICamera.ts:19-20` | 9.6 / 5.4 | 1920 / 1080（本方案总开关） |
| `GMConsoleHUD.ts:98` | 9.6 | 1920 |
| `UIScrollContainerComponent.ts:300,317` | 滚动条 0.1×0.4 / 0.08×0.4 | 8×160 / 6×160（视觉等比 80×，golden 复核） |
| `UIScrollListComponent.ts:378,405` | 滚动条 0.1×0.4 / 0.08×0.4 | 8×160 / 6×160（同上） |
| `UIScrollListComponent.ts:471,494` | thumb 保底 0.15 / trackW 0.1 | 12 / 8 |
| `UIScrollListComponent.ts:124-125` | 缺省 itemSize 1×0.4 / spacing 0.1 | [200, 80] / 20（×200 设计换算，仅程序化路径） |
| `registerBuiltinComponents.ts:99,339` 缺省 worldSize | 5×2.5 | 400×200（编辑器手建节点缺省，视觉取向值） |
| `CanvasUIComponent.ts:77-78` 缺省 | 5×2.5 | 400×200（仅程序化缺省路径） |
| `UITextComponent.ts:136-139` 兜底缺省 | 2.5 | 200（同上） |
| `RuntimeUIEditor.ts:29-30` | 本地 UI_CANVAS 9.6/5.4（复制自 UICamera） | 改 import UICamera 常量（消除复制漂移源头） |
| 全屏根判定阈值（3 文件 4 处） | `UIPreviewManager.ts:919,920,1015`、`UITransformComponent.ts:280` 的 `>= 2.7` | `>= 540`（半屏 1080/2） |
| `uiDesignChecker.ts:39` | pxPerWorldUnit 兜缺省 9.6（200px/m） | 兜缺省 1920（1px/单位；比率按资产实际值自适应） |
| 两 Scroll 组件 `worldPerPx` 兜底 | 0.02（米/px） | 1（px/px；正常路径 UI_CANVAS_H/屏高 自动正确） |
| `UIButtonComponent.ts:180` 点击层画布 | 世界尺寸 ×200px/单位（D3 初版误判"不动"，GPU 纹理警告实锤） | `Math.round(w/h)` 直取设计 px（预览曾生成 29200² 巨型纹理，clamp 后仍 ~1GB/张） |
| html 源 `data-props` 逃逸通道（6 处） | UILayout spacing / UIScrollList itemSize/spacing 米值（编译器原样透传） | ×200 直改 html 源（barracks/battle_hud/laboratory/gm_panel/tasks_ui） |
| `levels.table.json` 关卡卡片 pos（3 处） | UI 空间坐标 [-2.3,0.3] 等米值（MapPanel 脚本直写 anchorOffset） | ×200 → [-460,60] 等（golden 对比揪出：base_map 卡片堆回画布中心） |

`UIScrollContainer.worldPerPx`、`UIText._pxToWorld` 随常量/值域自动正确（D3 初版"UIButtonComponent 点击层不动"的判断有误，见上表追记行—— golden 纹理警告实测打脸）。

**追记（Phase 3 golden 对比揪出）——html 源 `data-props` 逃逸通道的米制几何**：data-comp 的 data-props 是作者直写的引擎参数（UILayout spacingX/Y、UIScrollList itemSize/spacing），编译器原样透传不换算。6 处随原子切换一并 ×200（html 唯一事实源，直接改源后重编译）：barracks_ui spacing 0.15→30、battle_hud 0.05/0.1→10/20、laboratory_ui 0.15/0.12→30/24、gm_panel itemSize [2.7,0.24]→[540,48] + spacing 0.02→4、tasks_ui 两处 0.15/0.1→30/20 与 0.12/0.1→24/20。

### D4 ｜反编译 = 直读 px
`worldToPxX/Y` 及 ctx 世界字段退场（TC-U12/TC-U13），ctx 收敛为 `{ canvasWidth, canvasHeight }`；不再回写 `world` 属性。旧米制 json 反编译：**不做兼容**——原子切换后仓库内不存在旧 json（全量重编译），不存在"旧 json 遇新反编译器"的窗口。

### D5 ｜px 字段家族零改动假设 + golden 兜底
UIText/fontSize/_pxToWorld、sourceLayout 侧车、Canvas width/height、zOrder 值与 0.001 步长——理论上对相机投影不变（§2.3），不改代码，用 golden 截图逐像素兜底验证。

## 四、分阶段实施（TDD，原子切换）

> ⚠️ 与 v1 的根本差异：相机换成 1920 画布后旧米制资产会放大 200 倍，**不存在"引擎先兼容、资产后迁移"的中间态**。Phase 1~3 是同一特性分支内的连续提交，整体一次合入 master；合入前每阶段的门禁都要绿。

### Phase 0 ｜测试基线补课（可独立合入，纠正文档与事实的偏差）
1. 补写 `tests/uiUnitUnification.test.ts` P1 基线（TC-U1~U7，锁当前米制编译行为），`npx vitest run` 全绿；
2. tsconfig include 加 `"tests"`（tsc --noEmit 覆盖测试文件）；
3. test-cases.md 更新"P1 已实现"表述为真实状态；
4. 采集 golden 基线：e2e 设施（dev server :5173 + 页面内真实模块）以固定视口渲染 24 资产出 PNG 存档（作为切换后逐像素比对的"改造前"图）。
- **验收**：P1 8/8 绿；tsc 无新增错误（对照 `tsc-baseline-known-failures` 既有 5 错）；24 张基线图入库（tests/fixtures 或临时目录）。

### Phase 1 ｜引擎切 px 世界（分支内提交 ①）
按 D3 清单迁移：UICamera 常量、滚动条尺寸、GMConsoleHUD、三处缺省值；UIPreviewManager 全屏判定阈值 2.7 → 540。
- **门禁**：此时资产还是旧 json，预览必然异常——本阶段不要求可视化验收，只要求 `npx tsc --noEmit` 无新增错误 + 非 UI 回归（3D 场景/e2e 非用例）不受影响；Phase 2/3 必须紧随。

### Phase 2 ｜编译端翻转 + P2 启用（分支内提交 ②）
1. `widgetMapping.ts`：删 `pxToWorldX/Y/worldToPxX/Y` 四函数与 `CompileContext` 世界字段（TC-U12）；`FULLSCREEN_WORLD_WIDTH` 退役（保留 canvas 缺省常量）；wx/wy 退化为 round4 直通；
2. `compile.ts`：忽略 `world` 属性 + 告警；根 `worldWidth/worldHeight` = canvas 尺寸（D1）；核实 emitRootBackground radius（§2.1 审计项）；
3. `decompile.ts`：直读 px（D4），不再回写 `world` 属性；
4. 翻新 P2 断言并启用（TC-U8~U13，含 round-trip 几何逐位相等）；同步改写 `scripts/ui-compiler-smoke.ts` 期望为 px 口径。
- **门禁**：P2 全绿 + smoke 全绿（纯编译器层，不依赖资产状态）。

### Phase 3 ｜全量重编译 + 全链验证（分支内提交 ③，合入门禁）
1. 批量重编译：对 fish 全部 24 个 `.widget.html` 走 ui_compile 同管线（`scripts/ui-compiler-cli.mjs` 循环），生成 px json 覆盖旧文件（§五）；
2. 重生成 `ui-snapshot.mjs` 基线；
3. round-trip 全量：24 资产 编译→反编译→再编译 几何字段逐位相等（TC-U13 批量化）；
4. golden 逐像素对比：Phase 0 基线图 vs 新链路（px 世界 + 重编译 json）同视口渲染，diff = 0；已知例外：`gm_cmd_item` 允许 ~1.5% 尺寸差（旧 json 漂移被 html 设计纠正）；
5. `e2e_mask_scroll` 全绿（覆盖 mask scissor / 滚动拖拽 / UILayout 在 px 世界的回归）+ fish 游戏内手工冒烟（HUD/toast/gm_panel/任务面板/滚动条视觉）。
- **验收**：四项全过；24 json 全部根 = 画布尺寸、无米制小数残留（`grep '"worldWidth": 0\.'` 类启发式复核）。全过后整分支合入 master。

### Phase 4 ｜边界收尾（可独立合入）
1. `DamageNumberFx.show(x,y)`：gameplay 入参保持米制（3D 世界语境），进入 UI 前按 `画布px / 9.6m`（= 1920/9.6）一次换算写 px anchorOffset；`floatHeight` 缺省 0.6m 同步换算（`DamageNumberFx.ts:50-67`）；
2. `doc/editor/ui/ui_widget_html_manual.md` 单位章节改写（px 直出、world 属性废弃、"UI 世界单位 = px"总述）；Inspector 文案注记；
3. 未来世界空间 UI 的边界文档（D2 末条）；
4. 记忆沉淀 + 本文件状态更新。
- **验收**：伤害数字在世界实体上方正确出现、上浮距离与切换前一致。

## 五、全量重编译规格（Phase 3）

```
对 src/projects/fish/asset/blueprints/ui/ 下全部 *.widget.html（当前 24 个）：
1. 走与 MCP ui_compile 完全相同的管线：读 .widget.html → 编译（px 口径）→ assetLint 零错误 → 覆写 .widget.json
2. 实现载体：scripts/ui-compiler-cli.mjs 循环调用（或等价批量脚本）；
   编译器此版已翻转，产出即 px json（根 = 画布尺寸），无需任何后处理
3. 旧 json 不读、不比对、直接覆盖——html 源是唯一事实源（用户定案 2026-09-03）
4. 产物核验（脚本输出汇总）：24/24 成功、根 worldWidth == 画布宽、sourceHash 与 html 一致
```

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| 原子切换跨度大（引擎+编译器+资产） | 分支内三提交各自有门禁（tsc / P2+smoke / golden+e2e），整体一次合入，master 不见中间态 |
| 手写米制 UI 清单漏项 | D3 清单来自全库 grep worldWidth/UI_CANVAS；合入前再跑一次 grep 复核 + gm_panel（手写）冒烟 |
| 滚动条/缺省值迁 px 后视觉比例失当 | 按 80× 等比换算 + golden 复核，允许微调（这些值本无精确基准） |
| UIMask scissor/圆角在 px 世界偏差 | mask 按世界矩阵 + 相机投影计算，投影级缩放不改变像素结果；e2e_mask_scroll + 含圆角资产 golden |
| UIText 字号漂移 | `_pxToWorld` = px/px = 1，字号随相机整体缩放（§2.3）；golden 文本特写比对 |
| 命中/点击偏移 | 射线经 UICamera 投影生成，视锥换算天然一致；gm_panel 点击冒烟 |
| gm_cmd_item 等旧 json 手改值随重编译丢失 | 用户已定案弃旧（html 为唯一事实源）；golden 中该资产按 ~1.5% 已知差异放行并记录 |
| html 源本身有编译不过/新告警 | 重编译即过 assetLint 零错误门槛；失败资产逐个修 html（编译器修复先例充足） |
| z-fighting | 理论排除（深度精度 84× 余量，§2.3）；层叠面板（gm_panel/toast）golden 复查 |
| 预览 persist 与预览期根尺寸适配互相覆盖 | 机制不变（persist 本就跳过全屏根），仅阈值换 px；golden 覆盖预览视口 |

## 七、改动文件清单

| 文件 | 阶段 | 改动 |
|---|---|---|
| `tests/uiUnitUnification.test.ts`（新） | 0/2 | P1 基线 → P2 翻新启用 |
| `tsconfig.json` | 0 | include 加 tests |
| `src/engine/rendering/UICamera.ts` | 1 | UI_CANVAS 9.6×5.4 → 1920×1080（总开关） |
| `src/engine/ui/UIScrollContainerComponent.ts` | 1 | 滚动条尺寸米→px、worldPerPx 兜底 1 |
| `src/engine/ui/UIScrollListComponent.ts` | 1 | 滚动条尺寸/缺省 itemSize/spacing 米→px、worldPerPx 兜底 1 |
| `src/engine/gm/GMConsoleHUD.ts` | 1 | 根 9.6 → 1920 |
| `src/engine/tools/registerBuiltinComponents.ts` | 1 | 缺省 worldSize → px |
| `src/engine/rendering/CanvasUIComponent.ts` | 1 | 缺省 world 5×2.5 → px 取向值 |
| `src/engine/ui/UITextComponent.ts` | 1 | 兜底缺省 2.5 → px 取向值 |
| `src/engine/ui/UITransformComponent.ts` | 1 | 全屏根判定阈值 2.7 → 540 |
| `src/editor/asset/UIPreviewManager.ts` | 1 | 全屏判定阈值 2.7 → 540 |
| `src/editor/asset/RuntimeUIEditor.ts` | 1 | 本地 UI_CANVAS 常量改 import UICamera |
| `src/editor/asset/assetLint/checkers/uiDesignChecker.ts` | 1 | pxPerWorldUnit 兜底缺省 → px 口径 |
| `src/editor/asset/uiCompiler/widgetMapping.ts` | 2 | 四函数与 ctx 世界字段退场 |
| `src/editor/asset/uiCompiler/compile.ts` | 2 | world 属性忽略、根 = 画布、radius 审计 |
| `src/editor/asset/uiCompiler/decompile.ts` | 2 | 直读 px、不回写 world |
| `scripts/ui-compiler-smoke.ts` | 2 | 期望改 px 口径 |
| `scripts/ui-snapshot.mjs` 基线 | 3 | 重生成 |
| fish 24 个 `.widget.json` | 3 | 从 html 全量重编译覆盖（无迁移脚本） |
| `src/projects/fish/gameplay/common/fx/DamageNumberFx.ts` | 4 | 米→px 边界换算 |
| `doc/editor/ui/ui_widget_html_manual.md` | 4 | 单位章节 |

## 八、执行命令

```bash
npx vitest run tests/uiUnitUnification.test.ts   # 阶段验收线（P0 起）
node scripts/ui-compiler-smoke.mjs               # 编译器冒烟（Phase 2 改口径）
node scripts/ui-compiler-cli.mjs <批量循环 24 个 .widget.html>   # Phase 3 全量重编译
npx tsc --noEmit                                 # 对照既有基线（根项目 5 错）
```

> 更新约定：实现若与本方案"核心架构决策"冲突，先更新本文件再改实现（对齐 test-cases.md 同名约定）。
