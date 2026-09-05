# 方案：综合性游戏 Demo 探索——第三人称动作 Roguelite《Arena（暂名）》

> 状态：方案草案 v1（2026-09-05）｜ 未排期
> 定位：以一个"什么系统都要碰"的游戏 demo 作为引擎深水区测试场，真实需求倒逼引擎补齐空白子系统，产出**引擎补充功能清单**与排期建议。
> 关联：`doc/engine/*.md`（子系统现状）、`doc-dev/scene-shadow/plan.md`（阴影，互不阻塞）、fish/ClashMaster 工程（第一代测试场）

---

## 一、目标与非目标

### 目标

1. **用一个游戏覆盖引擎最大面积的空白**。fish（ClashMaster）已经把"俯视角 + UI widget + 配置表 + 存档 + 寻路 + GM + e2e"这条线测透了；引擎剩余的空白（音频、角色控制器、触发器、粒子、动画、状态机、timeScale、事件总线、Timer 服务……）恰好全部集中在**第三人称即时动作**这个类型里。选这个类型，让每一项空白都成为游戏的必经之路，而不是可选项。
2. **每个缺口都变成具体的引擎工作项**。demo 需求 → 引擎现状 → 需补工作 → 优先级，一张表说清（见 §五）。
3. **顺带补齐 AI 深度测试所需的脚手架**（运行时属性读写、报错可见性、启停工具、性能观测），因为"AI 深度测试游戏"本身就是本次探索的目的之一。
4. 验证"AI 操作引擎快速搭 demo"这条产品路线在**动作类**（对实时性、反馈、状态管理要求最高的品类）上是否依然成立。

### 非目标

- 不做 GLTF/骨骼动画加载（素材管线单独立项，本 demo 用参数化几何 + 程序化动画顶住）；
- 不做多人网络、移动端触屏、手柄（输入映射资产化后自然兼容，但不在本 demo 范围）;
- 不追求玩法平衡与"好玩"，追求**系统覆盖广度**与真实压力；
- 不重构 fish（fish 暴露的引擎缺口由本方案择机下沉，见 §五 C 组）。

---

## 二、现状结论（2026-09-05 三路摸底）

### 2.1 引擎已就位、fish 已验证（直接复用，不重复建设）

| 子系统 | 现状 | 位置 |
|---|---|---|
| UE 风格框架 | GameMode/GameInstance/GameState/World/Actor/Component、蓝图实例化、场景切换 | `engine/gameflow/` |
| UI（最强子系统） | HTML widget 编译器、screen+world 双模式、Scroll/Mask/Layout/Tooltip、troika 文字 | `engine/ui/`、`editor/asset/uiCompiler/` |
| 配置表 | ConfigRegistry 单例 + DataTable，热替换 | `engine/tools/ConfigRegistry.ts` |
| 存档 | SaveSlotComponent KV + flush + 版本迁移（fish v1→v2 实战） | `engine/gameflow/SaveSlotComponent.ts` |
| 物理（俯视角特化） | cannon-es 固定步长、Box/Circle/Capsule、Enter/Exit/Stay、3 个硬编码碰撞层、**重力恒 0** | `engine/physics/PhysicsWorld.ts:84` |
| 寻路 | NavGrid（static Box AABB 栅格化）+ A*，CoC 环绕站位 | `engine/navigation/` |
| 对象池 | ObjectPool + ObjectPoolManager | `engine/tools/ObjectPool.ts` |
| Tween | 数字/vec/颜色、13 种缓动、yoyo/repeat | `engine/ui/TweenSystem.ts` |
| GM 体系 | GM 控制台 + `*.gm.ts` 自动注册 + `ai.gmCommand` AI 通道 | `engine/gm/` |
| 相机 | CameraComponent、PlayerCameraManager、CameraRig（RTS 云台）、CameraZoom | `engine/rendering/` |
| AI 测试事件 | ai.getState/getActor/getHUD/getSceneOutline/transformActor、鼠标键盘模拟 | `engine/ai/` |
| e2e | Playwright + 页内 import 真实 TS 模块 + `window.__ai` 驱动 | `tests/e2e/` |

### 2.2 完全空白（0 代码，fish 全程绕开）

**音频**（全仓无一行音频代码/资产）、**粒子系统**（只有裸 THREE.Points 工厂）、**后处理**、**角色控制器**（`Pawn.MoveForward/MoveRight` 是空壳，`entity/Pawn.ts:27-29`）、**动画状态机/关键帧**、**触发器 isTrigger**（cannon `collisionResponse` 零引用）、**关节/约束**、**timeScale/分层暂停**（`gm/builtin/registerBuiltinGMCommands.ts:10` 明示无）、**通用事件总线**、**gameplay Timer 服务**、**随机数种子**、**i18n**、**手柄/触屏**。

### 2.3 半成品/局限

- 物理重力写死 0（俯视角假设）；碰撞层仅 default/troop/building 三个枚举；cannon 侧无 raycast（点击拾取走 THREE.Raycaster）。
- 输入 `BindAction` 的 action 名只是标注，实际按 key+eventType 匹配，无映射/重绑定。
- 相机只有 RTS 云台，无第三人称跟随。
- AI：`ai.getComponent/setProperty/callActor` **已声明未实现**（`AIEvents.ts:43`、handler 注册表无对应 `ai.register`）；AI 看不到运行时报错（`/api/console-logs`、SSE `game.error` 均未包成 MCP/DSH 工具，`__ai_console` 收集器无人安装）；无 start/stop_game 的 MCP 工具；性能只有双 FPS 数字（无 drawcall/内存/实体数）。
- fish 手写的、应下沉引擎的机制：GameEvents 事件总线、四套 `finishAt` 时间戳队列（升级/研究/清除/训练）、UI 模态互斥（手写 6 处）、面板静态字段桥传参、通用 Health/Damage（建筑血量是 GameMode 里的 Map）、浮字投影+池+频控（DamageNumberFx/LootFlyFx 各一份）、screenToGround（两个 GameMode 各一份）、网格放置占格系统。

---

## 三、候选类型对比与选型

| 候选 | 触碰空白面 | 与 fish 重复度 | AI 可搭建性 | 结论 |
|---|---|---|---|---|
| **A. 第三人称 3D 动作 Roguelite（竞技场爬塔）** | ★★★★★ 角色/相机/触发器/粒子/音频/动画/状态机/timeScale/事件/Timer 全沾 | 低（视角、操控、反馈全是新域） | 高（参数化几何+配置驱动，无美术依赖） | **✅ 推荐** |
| B. 俯视角 Survivor（割草） | ★★☆ 主要是性能压测（大规模实体/Instancing） | 高（与 fish 同为俯视角，寻路/索敌/兵种卡全重复） | 高 | 留作 M3 性能压测的**玩法皮肤**，不单独立项 |
| C. 轻量 RPG（对话/任务/背包） | ★★★ 对话/任务/背包是空白，但战斗薄，音频动画压力小 | 中（又是 UI 强导向，UI 已是最强项） | 高 | 对话/任务/背包系统挂到 A 的 meta 层可选做 |
| D. 3D 平台跳跃 | ★★★ 角色/相机/触发器有，但无战斗/AI 深度/经济，系统广度窄 | 低 | 高 | 覆盖面不如 A，否决 |

**选型理由（A）**：即时动作是唯一让"实时反馈三件套"（粒子+音效+顿帧/屏震）、"敌人 AI 状态机"、"角色物理（重力/冲击/无敌帧）"、"慢动作 timeScale"同时成为**核心循环刚需**的类型——它们不再是演示样例，而是游戏不成立就缺的东西。这正是"深度测试"想要的压力形态。

---

## 四、游戏设计概要（ Arena，代号 `arena`）

### 4.1 一句话

第三人称单人竞技场爬塔：**清房 → 三选一强化 → 更难的房 → Boss → 死亡/通关 → 局内货币回主菜单解锁永久强化 → 再来一局**（类 Hades/Neon White 的房间化循环，体量收缩到 demo 级）。

### 4.2 表现方针（不引入任何美术/模型资产依赖）

- 角色/敌人全部参数化几何拼装：主角 = 胶囊体 + 方块剑；敌人 = 球体史莱姆（跳跃压制）、胶囊哥布林（追击连击）、方块巨像（慢速重击、需打断）；Boss = 组合体 + 弹幕环。
- 动画全程序化：Tween 挤压拉伸（跳跃/受击）、前扑 lunge（攻击）、受击闪白（材质 emissive 瞬时置位）、死亡缩放溶解、待机呼吸正弦。**表现力上限本身就是测试点**——它会给出"引擎最小动画系统该长什么样"的一手结论（§五 A7）。
- 场景：3~5 个手工房间（.scene.json）+ 毒圈/门/火盆等触发器件；风格沿用平涂色块 + 雾。

### 4.3 系统清单（每一条都对应引擎工作项）

| # | 玩法系统 | 设计要点 | 主要压测的引擎能力 |
|---|---|---|---|
| 1 | 角色操控 | WASD 相对相机移动、加速/减速、翻滚冲刺（0.25s + 无敌帧 + 冷却） | 角色控制器、输入映射、重力 |
| 2 | 相机 | 第三人称跟随（阻尼、偏移、look-at）、锁定目标、**受击屏震**、终结技慢动作 | 跟随相机组件、timeScale、相机震动 |
| 3 | 近战连击 | 三段连击（节奏窗口）、命中框 = 物理重叠查询 + 顿帧（hitstop 60ms） | 触发器/overlap、timeScale 局部、打击反馈三件套 |
| 4 | 投射物/技能 | 玩家飞刀（冷却）+ Boss 弹幕环（百发级） | 对象池极限、粒子、性能观测 |
| 5 | 敌人 AI | 状态机：待机→索敌→追击（NavGrid）→攻击→硬直→死亡；精英怪带技能 | 状态机组件、事件总线、寻路复用 |
| 6 | 房间/波次 | 波次表驱动（配置表）、清房开门、房间递进难度曲线 | DataTable、Timer 服务、事件总线 |
| 7 | 拾取/区域 | 掉落货币/血瓶（走怪脚边吸附）、毒圈、火盆伤害区、门 | **触发器 isTrigger**、overlap 查询 |
| 8 | 血量/伤害 | 通用 Health/Damage：受击事件、无敌帧、击退 impulse、死亡掉落 | Health 组件下沉、cannon 冲击 |
| 9 | 反馈层 | 打击粒子、刀光拖尾、伤害数字（world 投影浮字）、升级光柱 | **粒子系统**、浮字下沉、音频 |
| 10 | 音频 | BGM（战斗/主菜单双轨淡切）、打击/受击/UI/脚步音效、Boss 战分层 | **音频系统从 0 建**（AudioSys + audio.table.json） |
| 11 | 强化卡 | 清房后暂停进入三选一（时间冻结、UI 活跃）、20+ 强化条目（配置表） | timeScale=0 但 UI tick、**模态栈**、面板传参 |
| 12 | meta 存档 | 局内货币 + 永久解锁树（血量/新技能/初始强化），版本迁移 | SaveSlot 深度使用 |
| 13 | 框架层 | 主菜单 → 局内 → 结算 → 主菜单的 phase 流转、暂停菜单 | GameMode 注册、场景切换复用 |
| 14 | GM/e2e | 无敌/跳房/满强化/秒 Boss/加货币 GM 命令；e2e 全流程 spec | GM、`window.__ai`、运行时属性工具 |

---

## 五、核心交付：系统 → 引擎能力映射（补充功能清单）

### A 组：完全空白，从 0 新建（demo 刚需，P0/P1）

| # | 引擎工作项 | 需求来源 | 设计要点（最小可用形态） | 优先级 |
|---|---|---|---|---|
| A1 | **触发器**：ColliderComponent 加 `isTrigger` + onTriggerEnter/Stay/Exit | 拾取/毒圈/门 | cannon `body.collisionResponse=false` + 碰撞事件复用现有 Enter/Exit 分发；overlapTest 已有可先顶 | **P0** |
| A2 | **角色控制器**：CharacterControllerComponent（输入→期望速度、动态胶囊锁旋转、地面检测、击退 impulse、闪避窗口） | 系统 1/8 | 填实 `Pawn.MoveForward/MoveRight` 空壳；物理层新增 `player` 分组并允许层表配置化 | **P0** |
| A3 | **重力/物理世界配置**：gravity 可按 scene/config 覆盖（**默认保持 0**，不影响 fish） | 系统 1/8 | `PhysicsWorldOptions` 透传 + 场景资产字段 + lint | **P0** |
| A4 | **跟随相机**：FollowCameraComponent（target、偏移、位置/朝向阻尼、lookAt、锁定模式、**震动 API**） | 系统 2 | 与 PlayerCameraManager priority 机制对接；CameraRig 不动 | **P0** |
| A5 | **timeScale**：`World.setTimeScale(v)` 全局缩放 dt + hitstop 局部短冻结；`timeScale=0` 时 UI tick 仍驱动（强化卡界面） | 系统 2/3/11 | World.tick 的 dt 乘系数；Pause() 保持现状（停 rAF），游戏内暂停菜单走 timeScale=0 | **P0** |
| A6 | **音频系统 AudioSys**：WebAudio 底座；`play(clipId)` 2D + `playAt(clipId, pos)` 3D 空间衰减；BGM 交叉淡切；master/bgm/sfx 三总线 + 音量设置；`asset/audio/` + `audio.table.json`（ConfigRegistry 消费）；无 IPC 环境降级可用 | 系统 10 | 资产来源：CC0 包（kenney.nl 音效包）为主，另备**程序化音效生成器**（振荡器合成打击/拾取音）作占位与兜底 | **P0**（最小 2D 播放）→ P1（3D 空间/BGM 淡切） |
| A7 | **粒子系统**：ParticleEmitterComponent（rate/lifetime/初速与扩散/重力/size+color over life/additive/池化）；THREE.Points 实现，CPU 更新，单发射器几百粒为档位 | 系统 4/9 | 先不做 GPU instancing 与 sub-emitter；给出性能上限实测数据反哺二期 | **P1** |
| A8 | **状态机组件**：StateMachineComponent（状态表：enter/exit/tick、转换条件、当前态可查询可打印） | 系统 5 | 不做行为树；状态名进 `ai.getState` 输出（AI 调试刚需）；fish 兵种组件 AI 不迁移 | **P1** |
| A9 | **事件总线**：引擎级 EventBus（字符串通道 + 类型常量表，World 生命周期自动清理） | 系统 5/6 | fish 的 GameEvents 平移升级；GameMode↔宿主 9 个可空回调字段后续可迁移 | **P1** |
| A10 | **Timer 服务**：World 驱动、timeScale 感知、可暂停、`after(delay, fn)`/周期句柄、可序列化剩余时间（供存档回放） | 系统 6/11 | 替代 fish 手写的四套 `finishAt` 队列与散落 setInterval/setTimeout | **P1** |
| A11 | **随机数种子**：项目级 `Rng`（可注入 seed，GM/e2e 可复现） | 系统 6/7 | mulberry32 级别即可；掉落/波次走它 | **P2** |
| A12 | **程序化动画小结**（非立项）：用 Tween+代码逐帧把角色表现做出来，过程中沉淀"最小动画系统"结论（姿势关键帧?顶点?仅记录） | 系统 1/3/5 | 产出一份 `devdoc` 备忘，作为骨骼/GLTF 立项依据 | **P2（记录）** |

### B 组：半成品补全（P0/P1）

| # | 引擎工作项 | 现状 | 需补 |
|---|---|---|---|
| B1 | 输入映射真实化 | BindAction 按 key+eventType 匹配 | action→keys 映射表（代码级配置即可，暂不做资产），重绑定与双键位（如手柄）留接口 |
| B2 | 通用 Health/DamageComponent | 建筑血量是 GameMode 的 Map；TroopHealth 是 fish 私有 | 受击/死亡事件、无敌帧窗口、击退参数、阵营判定挂碰撞层 |
| B3 | 浮字/资源飞行下沉 | DamageNumberFx/LootFlyFx 各写一份投影+池+频控 | FloatingTextComponent（world→screen 投影 + 池 + 排队上限） |
| B4 | UI 模态栈 + 面板传参 | fish 手写互斥 6 处；BuildingPanelState 静态桥 | UIManager `pushModal/popModal`；spawnUIActor 支持构造参数直传脚本 |
| B5 | screenToGround/射线工具 | 两个 GameMode 重复实现 | 进 PhySys 或 ActorUtils 统一 |
| B6 | 物理碰撞层配置化 | 3 个硬编码枚举 | 层表随项目注册（player/enemy/projectile/pickup/debris） |
| B7 | hitstop/顿帧原语 | 无 | 依托 A5：`world.hitstop(ms)` 全局短冻结（粒子/音频不受冻结的开关可选） |

### C 组：AI 深度测试脚手架（本次探索的直接产出，P0）

| # | 工作项 | 现状 | 做法 |
|---|---|---|---|
| C1 | 实现 `ai.getComponent/setProperty/callActor` | AIEvents 已声明、handler 未注册（`AIEvents.ts:43`） | 走 `getEditableProperties()` 既有通道读写；callActor 仅允许调 GM 白名单方法；输出接入 ai.getState |
| C2 | 运行时报错可见 | `/api/console-logs`、SSE `game.error`、`__ai_console` 三处半成品 | 安装 `__ai_console` 收集器（Logger 回调 + window.onerror）→ cdp_dashboard_status 即活；再把 console-logs 与 game.error 包成 DSH/MCP 工具 |
| C3 | start/stop_game 包成 MCP/DSH 工具 | 只有 HTTP 命令（`EditorInitializer.ts:292-331`） | mcp-server.mjs 加两个工具透传 `/api/command` |
| C4 | 性能观测面板 | 仅双 FPS 数字 | renderer.info（drawcall/三角面）+ 实体数 + 粒子数，进 StatusBar 或 GM 面板，暴露 `ai.getPerf` |
| C5 | 状态机/血量等进 getState | getState 只有 name/type/active/组件类名 | 挂 A8 的当前态 + B2 的血量到快照输出 |

### D 组：fish 已暴露、本 demo 不触达（另行择机）

网格放置/占格系统下沉（fish 专属形态）、离线结算（生产队列）、i18n、本地化、Instancing 大规模压测（可借 B 方案皮肤在 M3 做）。

---

## 六、里程碑（每个都有验收口径）

### M0 引擎前置包（约等于 §五 P0 全集）
A1 触发器、A2 角色控制器、A3 重力配置、A4 跟随相机、A5+ B7 timeScale/hitstop、A6 最小音频（2D 播放 + 总线）、C1~C3 AI 工具。
**验收**：技术验证场景——胶囊角色在重力房间里跑跳翻滚、撞触发门开门、吃到回血圈（触发器）、屏幕有跟随相机与一次 hitstop、有打击音；AI 可用 MCP 工具启动游戏/读组件属性/看到运行时报错。fish 全量 e2e 回归不受影响（默认重力仍为 0）。

### M1 垂直切片（1 房间可玩）
1 房间 + 1 小怪（状态机四态）+ 移动/三段连击/翻滚 + 打击反馈三件套（粒子+音效+顿帧）+ 清房开门。
**验收**：e2e spec 完整跑通"启动→击杀 3 只怪→开门"（含一次 `ai.setProperty` 注入低血量断言受击）；全程 60fps（中档核显）。

### M2 完整循环
3 敌型 + Boss（弹幕）+ 强化卡（模态、timeScale=0）+ 5 房递进 + 波次配置表 + meta 存档（版本迁移）+ 主菜单/暂停/结算。
**验收**：全流程 spec（菜单→局→Boss→死亡→meta 解锁→再局生效）；拔电重启后存档兼容；音频三总线可调。

### M3 深度测试与压测
百弹幕 Boss、双倍敌人密度压测（drawcall/实体/粒子观测面板出数据）；GM 全套；性能结论与"引擎还缺什么"终稿（含 Instancing/GLTF/骨骼动画的立项依据）。
**验收**：压测数据表 + 引擎补充功能清单 v2（本文档修订版）。

---

## 七、风险与备忘

| 风险 | 应对 |
|---|---|
| 音频资产无来源 | 程序化音效生成器兜底（WebAudio 振荡器合成），CC0 包（kenney）并行；audio.table.json 把资产引用与实现解耦 |
| 程序化动画表现力不足导致"打击感差被误判为引擎问题" | M0 先做一个打击感专项技术验证（hitstop+屏震+闪白+粒子+音效全开），把表现问题与引擎问题分开归因；沉淀 A12 备忘 |
| 重力/timeScale 改动波及 fish | gravity 默认值保持 0 且按场景覆盖；World.tick dt 缩放对"无 timeScale 调用方"是恒等变换；M0 跑 fish 全量 e2e 回归 |
| CPU 粒子/百弹幕性能 | 单发射器粒数上限档位化；M3 用观测面板实测；Instancing 列为 M3 结论项而非前置 |
| 状态机做重（行为树化） | 明确只做表驱动 FSM + 可查询当前态；行为树不立项 |
| 新工程位置 | 建议 `src/projects/arena/`（享受既有 skills/lint/注册链路）；顺带可选验证外部工程根目录特性（d44a0a） |

---

## 八、一句话结论

fish 证明了引擎"俯视角 + UI + 数据"这条线能跑通完整商业 demo 骨架；《Arena》要证明的是另一半——**实时动作所需的底层体感系统**（角色、相机、触发器、粒子、音频、状态机、timeScale、事件/Timer）能不能用同样的 AI 工作流补齐并沉淀为引擎能力。做完这个 demo，引擎的"补充功能清单"将不再靠猜，而是每一项都有对应的、跑在真实游戏里的需求作证。
