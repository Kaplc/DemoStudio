# 方案测试用例：UI 单位一元化（1px = 1 世界单位）

> 状态：方案定稿（2026-09-03，与 decompile 坐标 bug 根因链调查同步产出）｜ 对应可执行测试：`tests/uiUnitUnification.test.ts`
> 关联：decompile 坐标 bug 专项调查（`stackGate` 基准盒错传、绝对定位 fill 宽、flex column 交叉轴三项修复已落 `layout.ts`）；本方案为后续 px 一元化专项的验收用例
>
> 定案摘要：
> - widget.json 几何字段（`worldWidth/worldHeight/anchorOffset/position`）直接存 px，1 单位 = 1px，编译端布局求解器的 px 值无损落盘
> - `widgetMapping.ts` 的 `pxToWorldX/Y`、`worldToPxX/Y` 四个换算函数整体退场
> - `<widget world="WxH">` 属性废弃（canvas 即世界，不存在第二种单位）
> - 与米制世界的换算收敛到根节点一次性缩放（1920px 全屏面板根 `scale = 1/400 = 0.0025`），属引擎侧（CanvasUIComponent/UIManager）专项
> - 与 `sourceRect` sidecar 专项互补：一元化杀"单位换算"bug 类，sidecar 杀"重求解"bug 类（文本自动尺寸、shrink-to-fit 内容高等依然有损）

## 一、测试策略（TDD 两阶段）

按记忆中沉淀的测试先行约定（先锁行为再改实现）分两阶段：

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 基线 | 锁定当前米制行为（含既有缺陷：world 声明改变落盘数值、round4 量化丢真），改造前必须全绿，作为重构安全网 | 已实现，8/8 通过（`npx vitest run tests/uiUnitUnification.test.ts`） |
| P2 目标 | 一元化目标口径断言，当前 `describe.skip`；实现落地后删除 skip 翻新启用并全绿 | 已写好，待实现 |

公共样例资产（测试内联字符串，刻意隔离变量）：

- `MINI_WIDGET`：单 absolute 容器 342×72 @ (100,50) —— 几何断言的稳定载体
- `SUB_364_WIDGET`：960 画布 + world=10 下 36.4px 非整尺寸 —— round4 量化丢真最小复现
- `RT_WIDGET`：三层纯 absolute 嵌套（含 border-box/padding），不含 flex/文本 —— 往返保真样例，把"单位"变量从"布局求解"中隔离

## 二、缺陷复现类（P1 基线，改造前跑绿）

### TC-U1 pxToWorld 按 ctx 比例换算 【P0，已自动化】

- **步骤**：分别用全屏 ctx（1920px→4.8m = 400px/m）与 toast ctx（960px→4.8m = 200px/m）调 `pxToWorldX(342)`
- **预期**：全屏落 0.855、toast 落 1.71 —— 同一 px 值因画布不同落盘不同（缺陷证据）

### TC-U2 worldToPx 为 pxToWorld 的逆变换 【P0，已自动化】

- **步骤**：同 ctx 下 `worldToPxX(pxToWorldX(342))`
- **预期**：`toBeCloseTo(342, 6)` —— 双向换算自洽，证明误差不在单次换算而在"存在换算"本身

### TC-U3 round4 量化网格丢真 【P0，已自动化】

- **步骤**：任意比例 ctx（192px/m）下 `pxToWorldX(342)`，精确值 1.78125
- **预期**：落盘 1.7813 ≠ 1.78125 —— 量化网格 0.04px，米值不可精确复原 px

### TC-U4 world 声明改变换算比例 【P0，已自动化】

- **步骤**：同一 342px 设计，分别以缺省 world 与 `world="9.6x5.4"`（200px/m）编译
- **预期**：`worldWidth` 0.855 → 1.71，落盘数值翻倍 —— 用户实测 PersonalCenter 342px 变 684px 现象的直接原因。P2 启用后此差异必须归零（TC-U10）

### TC-U5 toast 画布独立换算比例 【P0，已自动化】

- **步骤**：960px 画布缺省 world 编译
- **预期**：落 1.71（200px/m）—— 无全局 px/m 常数的现状证据

### TC-U6 量化缺陷实测（36.4px @ 96px/m） 【P0，已自动化】

- **步骤**：`SUB_364_WIDGET` 编译
- **预期**：`worldWidth` 落 0.3792 ≠ 36.4/96 精确值 —— 量化丢真实测

### TC-U7 反编译端 px 回写正确性 【P0，已自动化】

- **步骤**：`MINI_WIDGET` 编译 → 反编译
- **预期**：产物含 `left: 100px` / `width: 342px` —— 反编译忠实转写，证明历史坐标损坏根因在编译端而非回写端

## 三、一元化目标类（P2，实现落地后启用）

### TC-U8 json 几何字段直接 = px 【P0】

- **步骤**：`MINI_WIDGET` 编译
- **预期**：`worldWidth: 342`、`worldHeight: 72`，无任何米制换算痕迹

### TC-U9 画布无关性 【P0】

- **步骤**：同一 342px 设计分别以 1920 与 960 画布编译
- **预期**：两次落盘 `worldWidth` 相等且 = 342 —— json 数值与画布分辨率解耦，TC-U1/U5 缺陷类消灭

### TC-U10 world 属性废弃 【P0】

- **步骤**：带/不带 `world="9.6x5.4"` 分别编译
- **预期**：两者所有几何字段逐位相等（且 = px 值）—— TC-U4 缺陷类消灭

### TC-U11 量化归零 【P0】

- **步骤**：`SUB_364_WIDGET` 编译
- **预期**：`worldWidth/worldHeight` 精确 = 36.4 —— round4 量化不再作用于几何落盘

### TC-U12 换算函数退场 【P1】

- **步骤**：动态 import `widgetMapping`
- **预期**：`pxToWorldX/pxToWorldY/worldToPxX/worldToPxY` 四个导出不存在 —— 单位这条缝从 API 面上焊死

### TC-U13 round-trip 几何保真 【P0】

- **步骤**：`RT_WIDGET` → 编译 json1 → 反编译 html2 → 再编译 json2，逐节点对比 `worldWidth/worldHeight/anchor/anchorOffset/position`
- **预期**：整树几何字段逐位相等 —— 反编译"UI 堆左上角"损坏类的验收标准

## 四、引擎侧专项（不在本测试文件覆盖，另立用例）

- 根节点缩放：1920px 全屏 widget 根 Actor `scale = 1/400`（200px/m 画布 = 1/200），视觉逐像素等价于现米制产物
- `UILayoutComponent.spacing` 缺省 0.2 世界单位需改 px 口径（改后 0.2m ≈ 80px，行为变化需评审）
- `zOrder` 0.001 分层步长在根缩放后 < 1ulp 风险，需按根缩放比例放大步长防 z-fighting
- 存量 widget 资产一次性脚本迁移：按各根 px/m 比例缩放全部几何字段；fish 全量 UI 资产回归
- 米制世界互动（如世界空间跟随血条与 gameplay 实体对齐）依赖根缩放换算，属 gameplay 联调用例

## 五、执行方式

```bash
npx vitest run tests/uiUnitUnification.test.ts   # P1 全绿为当前验收线；P2 实现落地后翻新
npx tsc --noEmit                                  # 类型检查（含本测试文件）
```

> 更新约定：一元化实现落地时，删除 P2 的 `describe.skip` 并按实际口径翻新断言；若实现语义与本文件"定案摘要"冲突，先更新本文件再改实现。
