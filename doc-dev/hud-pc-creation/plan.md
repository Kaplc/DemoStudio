# 方案：HUD 创建权移交 PlayerController（对齐 UE ClientSetHUD 流程）

> 状态：已实施（2026-09-05）｜ 验收用例：[test-cases.md](./test-cases.md)
> 验证记录：vitest 28/28（含 TC-H1~H6 新单测）、`tsc --noEmit` 全绿、fish e2e 3 失败/8 通过与基线一致（stash 对照法核实，save-load 首轮为导航类 flake，复跑通过）
> 关联：`doc/engine/ui_system.md`、`doc/engine/gameflow_system.md`、`doc/engine/input_system.md`

---

## 一、目标与非目标

**目标**：HUD 创建流程与 UE 逐条同步——`GameMode.HUDClass` 声明不变，创建发起权移交 `PlayerController.ClientSetHUD`，HUD 引用归 PC 持有（对位 UE `MyHUD`），HUD 随 PC 销毁（对位 `APlayerController::Destroyed`）。`World.SwitchScene` 摘除越权的 createHUD 调用。

**非目标**：
- 不改 `UIManager.createHUD` 实现体与 `_hud` 单槽设计——"UI Actor 创建统一由 UIManager 负责"是引擎既定铁律，PC 只是**发起方与持有者**，不是生成器；
- 不修 `GameInstance.start()` 的双 StartPlay 既有 quirk（见 §六 R3，与本次正交，单列评估）；
- 不做多本地玩家/分屏多 HUD；
- 不动 PlayerCameraManager 归属 GameMode 的现状（引擎另一处既有 UE 偏离，与本次无关）。

## 二、现状链路（2026-09-05 实测）

| 环节 | 现状 | 位置 |
|---|---|---|
| 声明 | `GameMode.HUDClass` 只声明，注释即约定"World 在场景切换时据此创建" | `GameMode.ts:26-31` |
| 创建（唯一调用点） | `World.SwitchScene` 在 `SetGameMode` 之后手动 createHUD（**World 代劳，PC 缺位**） | `World.ts:449-454` |
| 创建实现 | `UIManager.createHUD`：new HUD → actorMgr.SpawnActor → spawnUIActor 蓝图实例化 → attachUI → `_hud` 登记 | `UIManager.ts:419-431` |
| Controller 时序 | `SetGameMode` 内部即调 `gm.InitGame()+gm.StartPlay()`，`StartPlay→SpawnPlayer→controller` 诞生——**早于** createHUD | `World.ts:178-190`、`GameMode.ts:93` |
| 销毁 | SwitchScene→DestroyAllActors 全清；`UIManager._hud` 靠 createHUD 覆盖，无显式失效点 | `World.ts` SwitchScene |
| PlayerController | 零 HUD 职责（全文无 HUD 字样），只做输入路由 + Pawn possess | `input/PlayerController.ts` |
| HUD 消费方 | GM 控制台挂 HUD 子树；fish setupMenuPhase 读 `hud.uiActor` | `GMModule.ts:203`、`FishGameInstance.ts:774` |
| fish 覆盖面 | menu/base/level 三 GM 全有 HUDClass **且全有 controller**（spawnPlayerInternal 均返回非空） | `fish/gameplay/*` |

与 UE 的唯一实质偏差：UE 是"GameMode 决定、PC 创建/持有/回收"，这里被 World 顺手代办了。且 `SetGameMode` 内部时序表明 controller 先于 createHUD 存在——移交不具备时序障碍。

## 三、UE 原生流程（对齐基准，UE5 源码）

**链路**：`UWorld::SpawnPlayActor` → `AGameModeBase::Login` → `AGameModeBase::InitNewPlayer` → `InitializeHUDForPlayer` → `APlayerController::ClientSetHUD(HUDClass)`。

**执行体**（`ClientSetHUD_Implementation`，`PlayerController.cpp`）三分支：

```cpp
// 1) 已有 HUD 且类不同 → 销毁重建（官方 API 文档简述为 "If there was already a HUD active, it is destroyed"）
if (IsLocalController() && MyHUD && MyHUD->GetClass() != NewHUDClass) { MyHUD->Destroy(); MyHUD = nullptr; }
// 2) 有类且无 HUD → SpawnActor（Owner = PC，RF_Transient），登记 MyHUD
if (IsLocalController() && NewHUDClass && !MyHUD) { MyHUD = GetWorld()->SpawnActor<AHUD>(NewHUDClass, SpawnParams); }
// 3) 类相同 → 复用不动；传入空类 = 清除 HUD（分支1销毁、分支2不建）
```

**回收**：`APlayerController::Destroyed` → `MyHUD->Destroy()`；关卡切换 non-seamless 时全部 Actor 随 World 销毁、seamless 时 PC 存活并经 InitNewPlayer 重新签发（类不同即重建）。

**多玩家语义**：每个本地 PC 一份 HUD；`HUDClass` 声明了但没有 PC 登录 → 不存在 HUD（这是 UE 的**正确行为**，不是缺陷）。

## 四、核心架构决策

### D1：链路映射（逐条对齐）

| UE | 引擎映射 |
|---|---|
| `AGameModeBase.HUDClass`（类引用） | `GameMode.HUDClass`（蓝图路径字符串）——"类比较"= `blueprintPath` 字符串比较 |
| `SpawnPlayActor→Login→InitNewPlayer` | `World.SetGameMode` → `gm.InitGame()+gm.StartPlay()`（已有） |
| `InitializeHUDForPlayer` | `GameMode.SpawnPlayer` 登记 controller 之后调用 `controller.ClientSetHUD(this.HUDClass)` |
| `ClientSetHUD_Implementation` 三分支 | `PlayerController.ClientSetHUD` 同构三分支（见 D2） |
| `World->SpawnActor<AHUD>` | `world.ui.createHUD(hudClass)`（实现体不动） |
| `MyHUD` | `PlayerController.hud` |
| `PC::Destroyed → MyHUD->Destroy()` | `PC.EndPlay` → 销毁 HUD + 清引用（见 D4） |
| non-seamless Travel 全销毁 | `SwitchScene→DestroyAllActors`（已有） |
| seamless travel 重新签发 | 同一 PC 上重复 `ClientSetHUD`，替换语义免费获得 |
| 分屏每 PC 一份 HUD | 单本地玩家，单 HUD（`_hud` 单槽现状保持） |

### D2：PlayerController.ClientSetHUD（引擎版三分支）

```ts
// PlayerController.ts 新增成员
world: World | null = null   // type-only import 防循环；GameMode.SpawnPlayer 注入（PC 创建点唯一，注入可靠）
hud: HUD | null = null       // 对位 UE MyHUD，仅引用

ClientSetHUD(hudClass?: string): void {
  if (!this.world) return
  // 分支1：类相同 → 复用（对齐 UE GetClass() == NewHUDClass 时不动）
  if (this.hud && hudClass && this.hud.blueprintPath === hudClass) return
  // 分支2：已有 HUD → 销毁（类不同或传入空类）；统一走 UIManager.destroyHUD()（幂等：存活才 destroy、必清 _hud 槽位）
  if (this.hud) { this.world.ui.destroyHUD(); this.hud = null }
  // 分支3：有类 → 创建（对齐 UE SpawnActor Owner=PC；生成体仍是 UIManager.createHUD）
  if (hudClass) this.hud = this.world.ui.createHUD(hudClass)
}
```

`GameMode.SpawnPlayer` 尾部（UE `InitializeHUDForPlayer` 对位）：

```ts
this.controller = result.controller
result.controller.world = this.world
result.controller.ClientSetHUD(this.HUDClass)   // HUDClass 未声明 → 三分支全不命中，静默无 HUD
```

### D3：UIManager 补 destroyHUD()

`destroyHUD(): void`——幂等：`_hud` 存活且未 pendingDestroy 则 `destroy()`，无条件清 `_hud = null`。ClientSetHUD 分支2 与 PC.EndPlay 统一走它，避免"HUD 已 pendingDestroy 但 `_hud` 悬挂"的中间态。头部注释（第 6-7、17-18 行"场景切换时创建"的旧约定）与 `HUD.ts` 创建链注释同步改写。

### D4：PC.EndPlay 销毁 HUD（PC::Destroyed 对齐）+ 回退预案

```ts
override EndPlay(): void {
  if (this.world) this.world.ui.destroyHUD()
  this.hud = null
  super.EndPlay()
}
```

引擎差异点（如实记录）：SwitchScene 的顺序是 `SetGameMode`（旧 GM.EndPlay → 旧 PC.EndPlay → **旧 HUD 此刻 pendingDestroy**）→ `DestroyAllActors`（幂等收尾）。整个过程同步单帧，无渲染空窗。**回退预案 B**：若落地时发现双销毁路径（PC.EndPlay 提前 destroy + DestroyAllActors 再处理）触发重复 EndPlay/诊断误报，则降级为"PC.EndPlay 只清引用不销毁"，注释标注与 UE 的差异——TC-H5 是该分支的判定用例。

### D5：无玩家的 GameMode 没有 HUD = UE 正确行为

`spawnPlayerInternal` 返回 null → 无 controller → 不调 ClientSetHUD → 无 HUD。现状 SwitchScene 是"不管有没有玩家都建 HUD"，移交后回归 UE 语义。fish 三 GM 均有 controller，不受影响；未来"无玩家但要 UI"的场景用 `spawnUIActor` 显式生成（文档标注逃生口）。

### D6：否决路线（明确记录）

- **形状 B"GameMode 创建、PC 仅登记引用"**：创建发起方仍非 PC，方案目标（对齐 UE）未达成，且留下两个 HUD 概念入口，否决。
- **落点 `GameMode.BeginPlay`**：HUD 创建将晚于 setup 回调，破坏 `FishGameInstance.setupMenuPhase` 对 `world.ui.hud?.uiActor`（FishGameInstance.ts:774）的既有依赖，否决。
- **ClientSetHUD 里加"UIManager 已有存活 HUD 则复用"的守卫**：偏离 UE 每 PC 一份的语义（本引擎双 StartPlay 会造出双 controller，UE 语义下本就该各有一份），否决；该场景由 §六 R3 记录。
- **把 `GameInstance.start()` 双 StartPlay 修复并入本次**：影响 demo2d/eatfish/racing/snake 四项目的既有行为（今天就在双 SpawnPlayer），可能有隐性依赖，与 HUD 目标正交，单列评估。

## 五、落地顺序（单阶段）

| 步骤 | 内容 | 交付判据 |
|---|---|---|
| 1 | PlayerController：`+world`（type-only import）/ `+hud` / `+ClientSetHUD` 三分支 / `+EndPlay` | TC-H4、TC-H5 绿 |
| 2 | `GameMode.SpawnPlayer` 尾部注入 world + 调 ClientSetHUD；`HUDClass` 注释改写 | TC-H6 绿 |
| 3 | `World.SwitchScene` 摘除 createHUD 块（含"未声明 HUDClass"日志，无测试断言可安全移除）；阶段注释改写 | TC-H1~H3 绿 |
| 4 | `UIManager.destroyHUD()` + 三处头注释同步（UIManager/HUD/GameMode）；`doc/engine/ui_system.md`、`gameflow_system.md` 流程章节更新 | — |
| 5 | 单测 `tests/hudOwnership.test.ts`（注意引擎级 vitest 两坑：先 `import '@/engine'` barrel、Actor 用 GenericActor） | 全绿 |
| 6 | fish e2e 回归：menu→base→level 三段切换 + GM 控制台 | 既有 3 失败不新增 |

工作量约半天。核心 diff 极小：SwitchScene 摘两行，SpawnPlayer/ClientSetHUD 各加几行；风险集中在 TC-H5 的双销毁幂等验证。

## 六、风险与对策

- **R1 双销毁幂等**：旧 HUD 在 SetGameMode 阶段（旧 PC.EndPlay）pendingDestroy，DestroyAllActors 阶段再遇——BObject.EndPlay 幂等已有先例（`GMModule.closeConsole` 依赖 `bPendingDestroy` 判定），TC-H5 锁定；不通过则走 D4 回退预案 B。
- **R2 UI 空窗**：SwitchScene 全同步单帧，旧 HUD 销毁与新 HUD 创建之间无渲染帧插入，无可见空窗。
- **R3 双 StartPlay quirk 在 UE 语义下的放大**：`GameInstance.start()` 基类路径跑两次 InitGame+StartPlay → 双 controller；UE 语义下各配一份 HUD。现状 demo2d/eatfish/racing/snake 均不声明 HUDClass，无实际影响；一旦未来有 HUDClass GM 走基类 start()，会因 `_hud` 单槽出现"旧 HUD 泄漏渲染"。对策：风险记录 + 单列评估修 quirk（见 D6）。
- **R4 日志变化**：`[World] SwitchScene: GameMode 未声明 HUDClass，跳过 HUD 创建` 消失（全工程无测试/e2e 断言，已核实）；"无 HUD"语义改由 ClientSetHUD 静默承担。
- **R5 `_hud` 悬挂窗口**：切换期 destroy→create 之间 `_hud` 指向 pendingDestroy 对象——全程同步单帧、期间无外部代码执行窗口（GM 控制台读取只发生在运行态），维持现状不加锁。
