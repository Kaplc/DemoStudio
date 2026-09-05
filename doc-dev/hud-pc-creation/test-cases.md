# 方案测试用例：HUD 创建权移交 PlayerController

> 状态：已实施（2026-09-05，与 [plan.md](./plan.md) 同步）｜ TC-H1~H6 单测落 `tests/hudOwnership.test.ts` 全绿；TC-H7 e2e 与基线一致（3 失败均既有：full-flow ×2 + level-deploy-click）
> 编号体系：TC-H*（HUD）。单测落 `tests/hudOwnership.test.ts`；引擎级 vitest 两坑：须先 `import '@/engine'` barrel（Actor↔HUD 循环环）、Actor 抽象用 GenericActor。

## 一、测试策略

| 层级 | 内容 | 前置 |
|---|---|---|
| 单测 | ClientSetHUD 三分支语义、归属断言、EndPlay 联动、幂等与残留诊断（TC-H1~H6） | 方案步骤 1~3 |
| e2e | fish 三段切换 HUD 换装 + GM 控制台回归（TC-H7） | 方案步骤 1~4 |

单测零资产依赖：`createHUD` 对不存在的蓝图路径仍创建 HUD 容器（`spawnUIActor` 返回 null → `hasUI === false`），故 HUDClass 直接用合成路径字符串，不依赖真实 widget 资产。

## 二、单测

### TC-H1 归属与单槽一致 【核心】

- **步骤**：构造 World + 最小 GameMode（`HUDClass = 'test/hud_a'`，`spawnPlayerInternal` 返回最小 controller + 最小 Pawn 子类），`world.SwitchScene(gmA)`。
- **预期**：`gmA.controller.hud === world.ui.hud`；`hud.blueprintPath === 'test/hud_a'`；PC 持有引用与 UIManager `_hud` 单槽指向同一实例。

### TC-H2 无 HUDClass → 无 HUD（UE：无 PC 登录则无 HUD）

- **步骤**：同上但 GameMode 不声明 HUDClass。
- **预期**：`world.ui.hud === null`、`pc.hud === null`、UI 树中无 HUD Actor；`SpawnPlayer` 正常返回。

### TC-H3 切场景回收与换装（UE：non-seamless Travel）

- **步骤**：`SwitchScene(gmA('test/hud_a'))` → 捕获旧 hud 引用 → `SwitchScene(gmB('test/hud_b'))`。
- **预期**：旧 hud `bPendingDestroy === true`；`gmB.controller.hud.blueprintPath === 'test/hud_b'` 且 `=== world.ui.hud`；SwitchScene 基线残留诊断为空（旧 HUD 不泄漏）；旧 PC 的 hud 引用随旧 PC 一起失效，无可达悬挂引用。

### TC-H4 ClientSetHUD 三分支（同构 `ClientSetHUD_Implementation`）

- **步骤**：对同一存活 PC 依次：① `ClientSetHUD('test/hud_a')` 后再 `ClientSetHUD('test/hud_a')`；② `ClientSetHUD('test/hud_b')`；③ `ClientSetHUD(undefined)`。
- **预期**：① 复用——同一实例不重建（对齐 UE 类相同不动）；② 旧 a 销毁、新实例 blueprintPath 为 b（对齐 UE 类不同即重建）；③ HUD 清空且销毁、`pc.hud === null`、`world.ui.hud === null`（对齐 UE 传空类=清除）。

### TC-H5 PC.EndPlay 联动销毁 + 双销毁幂等（D4 回退判定用例）

- **步骤**：① `pc.EndPlay()` → 断言 `hud.bPendingDestroy === true`、`pc.hud === null`、`world.ui.hud === null`；② 对同一 World 继续走 `DestroyAllActors()`；③ 完整 `SwitchScene` 流程后检查残留诊断输出。
- **预期**：①②③ 均无异常、无重复 EndPlay 副作用、残留诊断为空。**红灯处理**：若双销毁路径（PC.EndPlay 提前 destroy + DestroyAllActors 再处理）触发重复释放/诊断误报，回退 plan.md D4 预案 B（EndPlay 只清引用不销毁）。

### TC-H6 无玩家 GameMode

- **步骤**：GameMode 不覆写 `spawnPlayerInternal`（基类返回 null），声明了 HUDClass，走 `SwitchScene`。
- **预期**：`SpawnPlayer` 返回 null、无 controller、无 HUD 创建、无异常（warn 级日志可接受）。

## 三、e2e 回归

### TC-H7 fish 三段切换 + GM 控制台

- **步骤**：menu→base→level 三段切换全程；各阶段检查 HUD 内容（main_menu / base_hud / battle_hud）；base 阶段打开 GM 控制台（G+M）确认挂 HUD 子树且层级正确（GM_ZORDER_BASE）；走一次 gameover 回菜单。
- **预期**：HUD 正常换装、GM 控制台最顶层、`setupMenuPhase` 读 `hud.uiActor` 不为空（时序未破坏）；既有 3 个 e2e 失败不新增。
