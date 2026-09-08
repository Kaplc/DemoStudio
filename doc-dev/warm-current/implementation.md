# 《暖流计划》实现报告

> 2026-09-07 全量交付。拖线星际物流生存游戏：拖拽画线建立航线，把氦-3 拉回地球维持聚能环运转；
> 研究海克斯三选一、三幕进程、引力窗口与太阳耀斑事件、物流派补给站、火星模块胜利。
> 设计文档 `doc/game/`（11 模块 + 平衡 V1），工程外部根 `projects/warm-current/`（hoi4 同款）。

## 一、最终架构

```
projects/warm-current/
├─ project.json                    # defaultScene → asset/scenes/warm_current.scene.json
├─ register.ts                     # GameModeRegistry.register('main') + GM glob + assets + configs
├─ index.ts                        # 集中 re-export（instance/mode/config loader/core 纯逻辑）
├─ WarmCurrentGameInstance.ts      # SwitchToScene 流程 + window.__warmCurrent 调试桥 + PhySys.setup
├─ WarmCurrentConfigLoader.ts      # ConfigLoaderBase：registerGlob 7 张表（'projects/…' 外部根前缀）
├─ asset/
│  ├─ scenes/warm_current.scene.json   # WarmCurrentMap(mode=main)：SunLight/AmbientLight/StarMap 三 actor
│  ├─ config/                      # 7 张配置（global/stars/node_burn/station/events/star_map/cards）+ index.ts glob
│  └─ blueprints/ui/               # hud / hex_modal / settle 三 widget（.widget.html 单源 → ui_compile）
└─ gameplay/
   ├─ base/    WarmCurrentGameMode（组件宿主+VM+指针命中）/ PlayerController（射线∩y=0）/ Pawn / audio
   ├─ core/    balance（B 单例+配置覆盖）/ helpers（纯函数+初始状态）/ types / cards
   ├─ systems/ 8 个 BObjectComponent（见下）
   ├─ map/     StarMapRenderComponent（3D 星图渲染器）
   ├─ ui/      uiCommon + HudScript / HexModalScript / SettleScript（.script.ts）
   └─ gm/      status/h3/node/ship/flare/window/win 七条 GM 命令
```

### 仿真子系统 = GameMode 上的引擎组件（用户定案）

`sim.ts` 单体类已删除，拆为 8 个 `BObjectComponent<WarmCurrentGameMode>`，对齐 SpawnComponent/CameraComponent 惯例：

| 组件 | 职责 |
|---|---|
| `SimStateComponent` | SimState 纯数据 + 事件队列 + rng + 快照/重试本幕/沙盒/派生查询（burnRate/demand/idleShips…） |
| `TransportComponent` | 航线 CRUD/派船召回/造船重建/火星任务 + 飞船状态机（loading→flying→unloading） |
| `EconomyComponent` | 焚烧 → 缓冲衰减 → 延续度回升 |
| `ResearchComponent` | 5 线推进 + cardQueue/pendingCard + 选卡 effects 数据驱动应用 + 研究点分配（allocateResearch，2026-09-08 点数制替代超频） |
| `HazardsComponent` | 引力窗口周期 + 耀斑（失联停滞/护盾限额保全/盾外冻毁） |
| `StationsComponent` | 中点建站/升级/拆除返还 + onDelivery 自动建成 |
| `ActsComponent` | 三幕门槛 + 幕入口快照 |
| `SimulationComponent` | 编排器：固定顺序 tick 全部子系统（buildQueue→引力→耀斑→飞船→经济→研究→三幕→失败判定） |

GameMode 持有 `readonly simState/transport/economy/research/hazards/stations/acts/sim`，
Tick 门禁 `!paused && (playing||sandbox)` → `this.sim.runTick(dt * timeScale)`。

### GameMode 字段注入的类型坑（重要）

- `addComponent(new Xxx(this))` **实例版返回基类型** `BObjectComponent<BObject>`（且触发 codeLint [addComponent] 旧写法 error）→ 一律用**类版** `this.addComponent(SimStateComponent)`。
- 组件↔GameMode 互相引用会循环推断（TS7022 implicitly any）→ 字段必须**显式注解**：
  `readonly simState: SimStateComponent = this.addComponent(SimStateComponent)`。

### 资产化（对齐 fish/hoi4 约定）

- **场景**：`warm_current.scene.json` 只布灯光 + 空壳 `StarMap` Actor；渲染组件由 GameMode.BeginPlay
  `node.addComponent(StarMapRenderComponent, this)` 挂载（provider 传 GameMode 自身，MapViewProvider 结构化最小依赖 `simState: { state }`）。
- **配置表**：代码默认值在 `B`（balance.ts）兜底，`refreshBalanceFromConfigs()` 读 ConfigRegistry 覆盖；
  glob 异步加载竞态下首局用默认值（与表同值，无害），GameInstance `watchConfigs` 轮询就绪后 `restart()` 应用真表值。
- **HUD**：三 widget 全部 `.widget.html` 源 + `ui_compile` 编译（MCP 参数传 **.widget.json** 路径）；
  HUD 由 `HUDClass = 'asset/blueprints/ui/hud.widget.json'` 经 PC.ClientSetHUD 链创建；
  hex/settle 由 HudScript.onStart `world.ui.spawnUIActor` 一次性生成，各自脚本自驱动可见性。
- **UI 脚本**：`gameplay/ui/*.script.ts` 被 asset/index.ts glob 注册（id='gameplay/ui/HudScript'）；
  TextBinder/ColorBinder/VisBinder 三差分刷新器 + 8Hz 节流同步 `mode.buildViewModel()`。

### 调试桥（e2e/GM）

`window.__warmCurrent`（WarmCurrentGameInstance.installDebugBridge，镜像 arena `__arena`）：
`ready/state/vm/stepTicks/pointerDown|Move|Up/createRoute/addShip/deleteRoute/buildStation/setNodes/setH3/
triggerFlare/triggerWindow/suppressFlare/startMission/retryAct/restart/togglePause…` 全部走组件 API。

## 二、e2e（tests/e2e/warm-current/warm-current.spec.ts）

单长用例全链路（34.6s）：启动教学关 → 拖线（europa 拒/moon 过）→ 首船净补 +160（载 200−油 40）→
forceResearch 三选一连选至队列清空 → setNodes(4) 推二幕 → 引力窗口木卫二线 speedMult 2/legTime 9s →
补给站物流链（建线自动派船 + 显式补船，送满 300 自动建成 Lv1）→ 耀斑护盾盾内(0.5)保全/盾外(0.95)冻毁 →
setNodes(8)+time=300 推三幕 → 火星模块任务胜利 → restart → 重推二幕 → 断燃料衰减 → 延续度归零 → 重试本幕恢复。

**确定性三板斧**（踩出来的）：
1. 编辑器 rAF 在用例步进间隙实时推进仿真 → **关键段落用 withBridge 在单次 evaluate 内
   「改状态+stepTicks」原子执行**（JS 单线程，evaluate 期间无 rAF 插入）；
2. 非关键断言全部容忍漂移（`>=`/区间），不写精确等式（储量在烧、时间在走）；
3. 幕转换会重置耀斑 nextIn → **压制必须放在转换 stepTicks 之后**；每个敏感段入口再压一次。
   「双生节点」卡一次 +2 交点 → 节点断言用 `>=`。桥对象含函数，**跨 evaluate 序列化会剥掉**，
   一律页面内调用（`call(page, method, ...args)` 模式）。

## 三、渲染与门禁

- **3D 标准**：XZ 地面 + 真实球体 + Lambert + 灯光 + 垂直俯视透视相机（fov50 @ y=1160，up=(0,0,-1)）；
  文字走 CanvasTexture Sprite（脏检查），实测 **71 fps**（旧 canvas2d 方案 8fps 已弃）。
- 指针拾取不用编辑器注入 worldPos（那是 z=0 平面交点），Controller 自己射线 ∩ y=0 再 +半宽半高回画布系。
- **CodeLint 全绿**：项目代码禁止裸 `new THREE.Mesh/Group/Line/*Geometry/*Material` → 全部改走
  `world.factory.createXxx`（本工程推动引擎 ThreeFactoryComponent 扩展：createRingGeometry 全参、
  createMeshLambertMaterial、createLineDashedMaterial、createPolyline）。
  工厂在组件 BeginPlay 时取 `owner.world?.factory`（构造期 world 未就绪）；`this.F` 非空访问器统一使用。
- 门禁链：`ui_compile` 三资产 0 error → run_asset_lint → `npx tsc --noEmit`（仅 hoi4 既有错误排除）→
  CodeLint 0 → 实机截图复核 → e2e 绿。

## 四、踩坑清单（一手）

1. **块注释里写 glob 通配符**（`asset/**/*.scene.json`）→ `*/` 提前终止注释，语法错误连环报。
   注释里别写通配符序列（hoi4 asset/index.ts 注释里早警告过，还是踩了）。
2. **`<progress>` 标签无子节点**，fill 无处挂 → 引擎进度条用 `div[data-comp=UIProgressBar] + Fill 子 div`；
   本次为减复杂度改纯文本 HUD，未用进度条。
3. **widget 参数区/双引号**：data-props 单引号包裹；本次全部走 CSS 原生表达，无参数区。
4. **反向线派船时序**：建线即自动派 1 艘，`addShip` 是"再加一艘"——e2e 曾误以为要两次显式派船，
   空闲池不足时返回 false 是正确行为（不是 bug）。
5. **`detachShipToIdle` else 分支残留 routeId/cargo**（召回退役路径）→ 已修：就地退役时清干净，
   否则调试桥按 routeId 过滤会踩到幽灵归属。
6. **evaluate 期间 rAF 不插入**是 e2e 确定性的根基；反过来说，**任何跨 evaluate 的多步操作都有竞态**。
7. **CodeLint [bareThree]** 黑名单含 `BufferGeometry`（`\w*Geometry`）→ 别忘 `createBufferGeometry()`；
   `LineLoop` 恰好不在正则内（豁免），语义上属规则边界。
8. Electron CDP 僵尸端口老坑复现：9222 幽灵监听（PID 已死），真端口读
   `~/AppData/Roaming/demostudio/DevToolsActivePort`（60953）。
9. headless 测试浏览器里游戏状态栏 3fps + 文本渐进消失是**步进压制主线程的伪影**；
   判渲染质量必须看实机（编辑器 71fps）或等真实 rAF 稳定帧。

## 五、运行入口

- 编辑器 Dashboard → WarmCurrent → Launch（拖月球到地球开局）。
- GM 命令：`status/h3/node/ship/flare/window/win`（GMRegistry glob 自动注册）。
- e2e：`cd tests/e2e && npx playwright test warm-current`（dev server :5174 由外部管理）。
