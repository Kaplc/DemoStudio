# 实施报告：M0 引擎前置包 + M1 垂直切片已落地

> 状态：M0 ✅ + M1 ✅（2026-09-06）｜ M2/M3 未实施
> 关联：[plan.md](./plan.md)（方案原文）

## 一、交付概览

### M0 引擎前置包（§五 A/B/C 组 P0/P1 全部落地）

| 项 | 内容 | 位置 |
|---|---|---|
| A1 触发器 | `ColliderComponent.isTrigger` + `onTriggerEnter/Stay/Exit` 委托；cannon 原生 `body.isTrigger`（接触照常进 `world.contacts` 驱动事件、求解器跳过方程=无物理响应），`dispatchCollisionEvents` 按 `isTrigger` 对分流触发/碰撞回调 | `physics/PhysicsWorld.ts`、`physics/ColliderComponent.ts` |
| A2 角色控制器 | 输入→期望速度（相机相对/世界系）、地面检测（碰撞事件+对方中心低于自身判定）、跳跃、翻滚（窗口+冷却+无敌帧接口）、击退、面朝转向 | `physics/CharacterControllerComponent.ts`（新） |
| A3 重力配置 | `PhysicsWorldOptions{gravity}` 构造透传 + `setGravity()`；场景资产根字段 `gravity:[x,y,z]`（`loadSceneAsActors` 应用）；默认 [0,0,0] 不变（fish 兼容底线）；doc:scene schema 增字段 | `physics/PhysicsWorld.ts`、`asset/SceneAsset.ts`、`editor/.../docCheckers.ts` |
| A4 跟随相机 | 目标阻尼跟随 + lookAt + `shake(intensity,duration)` 屏震 + `snapToTarget` | `rendering/FollowCameraComponent.ts`（新） |
| A5+B7 timeScale | `World.setTimeScale / hitstop(ms) / clearHitstop`；游戏侧 dt 缩放（Actor/GameMode/物理），UI tick 走真实 dt（强化卡界面可活）；未调用方恒等变换；GM 命令 `timescale` / `hitstop` | `gameflow/World.ts`、`gm/builtin/registerBuiltinGMCommands.ts` |
| A6 音频 | WebAudio 三总线（master/bgm/sfx，感性平方曲线）、`play/playAt(距离衰减)/playBgm/stopBgm`、全程序化 synth 音效（振荡器+噪声+包络+滤波，18 个内置片段）、无 AudioContext 环境静默降级、实现 GameSingleton 随 Game.shutdown 回收 | `audio/AudioSys.ts`（新） |
| A7 粒子 | `ParticleEmitterComponent.emit(burst)`：CPU 更新 + THREE.Points、sphere/hemisphere/disc 扩散、颜色 from→to、重力/阻尼/additive、固定容量环形分配（无 GC） | `rendering/ParticleEmitterComponent.ts`（新） |
| A8 状态机 | `StateMachineComponent`：表驱动 states/transitions（注册序=优先级）、`current/timeInState` 可查询（进 ai.getState）、setState 强制切换 | `gameplay/StateMachineComponent.ts`（新） |
| B2 通用血量 | `HealthComponent`：damage/heal/revive/resetHp、无敌帧窗口+手动授予、阵营 team、事件委托、hp 可注入（状态注入通道） | `gameplay/HealthComponent.ts`（新） |
| B6 碰撞层 | 层表扩充 player/enemy/projectile/pickup（组件 group/mask 直接可用） | `physics/PhysicsWorld.ts` |
| C1 AI 三件套 | `ai.getComponent`（editable 属性+可序列化公开字段）/ `ai.setProperty`（editable 通道+公开字段兜底）/ `ai.callActor`（白名单制+`allowAll` 放开）——payload 类型本就已备好，只差注册 | `ai/registerBuiltinAIHandlers.ts` |
| C2 报错可见 | `window.__ai_console` 收集器落地（Logger 新增 `addLogListener` 多订阅通道 + window.onerror/unhandledrejection，环形 300 条，window 标志防 HMR 重复）；cdp_dashboard_status / DashboardPanel 既有读者即刻生效 | `engine/Logger.ts`、`editor/EditorInitializer.ts` |
| C3 MCP 工具 | `start_game(project?)/stop_game` 两个 MCP 工具 + main.ts 往返白名单 + 渲染进程 sendMCPResponse 回传 | `editor/mcp-server.mjs`、`electron/main.ts` |
| C5 快照增强 | ai.getState 每个 Actor 附带 `hp/maxHp`（挂 Health 时）与 `state`（挂 FSM 时） | `ai/registerBuiltinAIHandlers.ts` |

### M1 垂直切片（arena 工程，`src/projects/arena/` 新工程）

- **场景** `asset/arena_room1.scene.json`：30×30 重力房间（gravity [0,-25,0]）、地板/墙/门/立柱、回血圈（**isTrigger 触发器**）、PlayerSpawn。
- **玩法**：WASD 相对相机移动 + Space 跳 + Shift 翻滚（无敌帧）+ J/左键**三段连击**（节奏窗口/连招缓冲/逐段递增伤害）；命中 = 扇形物理查询 + **打击反馈三件套**（hitstop 顿帧 + 粒子爆发 + 空间衰减音效，第三段加重+屏震）；史莱姆 **FSM 四态**（idle→chase→windup→attack→recover，扑击碰撞伤害+击退）；清房开门（门体上滑）。
- **HUD**：代码构建（UIProgressBar 血条/击杀计数/消息/连段提示），坐标画布中心原点 y 向上。
- **GM**：`arena.god / arena.killAll / arena.heal / arena.spawnSlime`（零修改 glob 注册）。
- **调试桥** `window.__arena`：state/stepTicks（确定性推帧，逐帧 clearHitstop）/teleport（同步写 body）/attack/killAll/heal/hurtPlayer/door。

## 二、过程中发现并修复的引擎问题（一手结论）

1. **GameInstance.start() 双份 InitGame/StartPlay**：`SetGameMode` 内部已调 InitGame+StartPlay（含 SpawnPlayer），start() 里又显式调一遍 → **SpawnPlayer 执行两遍、场景出现双份玩家**（AI 命中幽灵副本）。已修（fish 不走此路径不受影响）。
2. **physics.begin() 时序**：原在 `inst.start()` 之后——start→onStart→world.BeginPlay 期间场景碰撞体检查 `active` 会**全部跳过注册**（地板都没有）。已提前到 start() 之前。
3. **cannon 摩擦预算 ∝ |重力|**：零重力下摩擦恒 0（fish 的 setVelocity 模式因此一直没事）；重力世界默认摩擦会瞬间杀掉切向速度。直接速度控制的角色必须低摩擦——`PhysicsWorld.setDefaultFriction()`，arena 置 0。
4. **cannon sphere×Cylinder 深穿透无接触**：球心进入 Cylinder（=ConvexPolyhedron）内部时 narrowphase 不产出接触——**触发器用 Box 而非 Circle**（sphereBox 路径可靠）。
5. **dynamic body 位置权威**：瞬移/出生点定位只写 root 会被下一物理帧 `syncActorFromBody` 覆盖回 body 位置——必须同步写 body。
6. **Actor 子类 override Tick 忘调 super.Tick = 组件链全停**（FSM/无敌帧衰减等全部冻结，且无报错，极难察觉）。
7. **Pawn.controller 字段名与 PlayerController 占用**：挂 CharacterControllerComponent 时命名避开（arena 用 `charCtrl`）。
8. **UI 坐标系**：画布 1920×1080、原点画布中心、y 向上；UIProgressBar 的 fill 必须配锚点（middle-left）才能从边生长。

## 三、验收结果（§六 M0/M1 口径）

| 验收项 | 结果 |
|---|---|
| M0：重力房间跑跳翻滚/触发门/回血圈/跟随相机/hitstop/打击音 | ✅（经 arena M1 场景承载，e2e 全链路验证） |
| M0：AI 经 MCP 启动游戏/读组件属性/见运行时报错 | ✅ start_game/stop_game 工具 + ai.getComponent/setProperty/callActor + __ai_console |
| M0：fish 全量 e2e 回归不受影响 | ✅ 8 过 3 挂 = 既有基线（full-flow×2 为 `isBridgeReady` 用裸名 `clickActor` 匹配的既有 spec 缺陷 + level-deploy 既有失败；本会话零新增失败） |
| M1：e2e 完整跑通"启动→击杀 3 怪→开门"（含 ai.setProperty 注入低血量断言受击） | ✅ `tests/e2e/arena/room1.spec.ts` 2/2 过 |
| M1：vitest 引擎单测 | ✅ `tests/engineM0.test.ts` 15/15（重力/触发器/控制器/timeScale/hitstop/FSM/Health/音频降级），全仓 vitest 68/68 |
| M1：场景资产 assetLint | ✅ doc:scene error 0 / warn 0（离线 checker 复验） |
| M1：60fps 中档核显 | 未实测（无该环境），留 M3 性能观测面板一起做 |

## 四、M2/M3 待办（未实施）

- M2：3 敌型 + Boss 弹幕、强化卡（timeScale=0 + UI 模态）、5 房递进 + 波次配置表、meta 存档（版本迁移）、主菜单/暂停/结算、HUD 迁 .widget.html 源格式、A9 事件总线 / A10 Timer 服务 / B3 浮字下沉 / B4 模态栈。
- M3：百弹幕压测、性能观测面板（C4）、Rng 种子（A11）、Instancing/GLTF 立项依据、本文档修订。
