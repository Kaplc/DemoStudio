# 《暖流计划》实现报告

> 2026-09-07 全量交付。拖线星际物流生存游戏：拖拽画线建立航线，把氦-3 拉回地球维持聚能环运转；
> 研究海克斯三选一、三幕进程、引力窗口与太阳耀斑事件、物流派补给站、火星模块胜利。
> 设计文档 `doc/game/modules/`（12 篇，含 00 总览）+ 平衡 V1，工程外部根 `projects/warm-current/`（hoi4 同款）。

## 一、最终架构

```
projects/warm-current/
├─ project.json                    # defaultScene → asset/scenes/warm_menu.scene.json（启动进主菜单）
├─ register.ts                     # GameModeRegistry.register('warm-menu'/'warm-main') + 天体 Actor 注册 + GM glob + assets/configs
├─ index.ts                        # 集中 re-export（instance/mode/config loader/core 纯逻辑）
├─ WarmCurrentGameInstance.ts      # SwitchToScene 流程 + window.__warmCurrent 调试桥 + PhySys.setup
├─ WarmCurrentConfigLoader.ts      # ConfigLoaderBase：registerGlob 13 个配置 json（'projects/…' 外部根前缀）
├─ asset/
│  ├─ scenes/warm_menu.scene.json      # WarmCurrentMenu(mode=warm-menu)：启动默认场景（主菜单）
│  ├─ scenes/warm_current.scene.json   # WarmCurrentMap(mode=warm-main)：SunLight/AmbientLight/StarMap 三 actor
│  ├─ config/                      # 13 个配置 json：8 张 *.table.json（building/cards/stars/level_burn/level_cost/fleet_maint/ship_cap/orbit_build）+ 5 个 *.config.json（global/events/star_map/ring_build/orbit_build）+ index.ts glob；star_map=每行星系一张子表（systems.solar/earth/jupiter，子系局部画布，flattenMapSystems 展开为扁平 nodes/moons，B.map.moons 由表派生）
│  ├─ blueprints/ui/               # 19 个 .widget.json（hud / hex_modal / settle / main_menu / 各面板…；.widget.html 单源 → ui_compile）
│  └─ textures/                    # 行星贴图（*.jpg，天体蓝图按 asset/textures/… 引用；程序化贴图兜底见 map/starTextures.ts）
└─ gameplay/
   ├─ base/    WarmCurrentGameMode（组件宿主+VM+指针命中）/ PlayerController（射线∩y=0）/ Pawn / audio
   ├─ core/    balance（B 单例+配置覆盖）/ helpers（纯函数+初始状态）/ types / cards / save（三槽位序列化）
   ├─ systems/ 10 个 BObjectComponent（见下）
   ├─ map/     StarMapRenderComponent（3D 星图渲染器）+ StarActor（天体蓝图 Actor）/ starTextures（程序化贴图）/ starfieldTile（平铺星空）/ SolarCameraActor（云台相机）
   ├─ menu/    WarmCurrentMenuGameMode / Pawn / PlayerController / MainMenuScript
   ├─ ui/      uiCommon + 15 个 *.script.ts（HudScript / HexModalScript / SettleScript / 各面板）
   └─ gm/      status/h3/node/ship/flare/window/win/sol 八条 GM 命令
```

### 仿真子系统 = GameMode 上的引擎组件（用户定案）

`sim.ts` 单体类已删除，拆为 10 个 `BObjectComponent<WarmCurrentGameMode>`，对齐 SpawnComponent/CameraComponent 惯例：

| 组件 | 职责 |
|---|---|
| `SimStateComponent` | SimState 纯数据 + 事件队列 + 确定性 rng + 快照/重试本幕/沙盒/派生查询（burnRate/demand/idleShips…） |
| `TransportComponent` | 航线 CRUD/派船召回/造船重建/火星任务 + 飞船状态机（loading→flying→unloading） |
| `EconomyComponent` | 焚烧 → 断环堆心降温 → 补燃料堆心回温（2026-09-08 堆心温度改版替代缓冲倒计时） |
| `ResearchComponent` | 4 线推进 + cardQueue/pendingCard + 选卡 effects 数据驱动应用 + 研究点分配（allocateResearch，2026-09-08 点数制替代超频；环线已移除） |
| `RingBuildComponent` | 聚能环建设独立流（2026-09-08 从科研拆出）：交点解锁唯一来源、建设点数分配/计费（level_cost × 折扣，灌满 → 交点 +1） |
| `HazardsComponent` | 引力窗口周期 + 耀斑（失联停滞/护盾限额保全/盾外冻毁） |
| `BuildingsComponent` | 地图建筑（中转站/护盾发生器）：放置即扣 H3 建成、拆除按 refundPct（表值 0.5）返还、onDelivery 建材入缓存；无升级流 |
| `OrbitBuildComponent` | 近地轨道建筑（2026-09-09：点行星 → 轨道建设面板；船坞造船折扣/提速） |
| `ActsComponent` | 三幕门槛 + 幕入口快照 |
| `SimulationComponent` | 编排器：固定顺序 tick 全部子系统（buildQueue→引力→耀斑→飞船→经济→研究→环建设→轨道建筑→三幕→失败判定） |

GameMode 持有 `readonly simState/transport/economy/research/ringBuild/hazards/buildings/orbitBuild/acts/sim`，
Tick 门禁 `!paused && !s.pendingCard && (playing||sandbox)` → `this.sim.runTick(dt * timeScale)`（弹卡期间整体冻结）。

### GameMode 字段注入的类型坑（重要）

- `addComponent(new Xxx(this))` **实例版返回基类型** `BObjectComponent<BObject>`（且触发 codeLint [addComponent] 旧写法 error）→ 一律用**类版** `this.addComponent(SimStateComponent)`。
- 组件↔GameMode 互相引用会循环推断（TS7022 implicitly any）→ 字段必须**显式注解**：
  `readonly simState: SimStateComponent = this.addComponent(SimStateComponent)`。

### 资产化（对齐 fish/hoi4 约定）

- **场景**：`warm_current.scene.json` 只布灯光 + 空壳 `StarMap` Actor；渲染组件由 GameMode.BeginPlay
  `node.addComponent(StarMapRenderComponent, this)` 挂载（provider 传 GameMode 自身，MapViewProvider 结构化最小依赖 `simState: { state }`）。
- **配置表**：代码默认值在 `B`（balance.ts）兜底，`refreshBalanceFromConfigs()` 读 ConfigRegistry 覆盖；
  glob 异步加载竞态下首局用默认值（与表同值，无害），GameInstance `watchConfigs` 轮询就绪后 `restart()` 应用真表值。
- **HUD**：hud / hex_modal / settle 三 widget 全部 `.widget.html` 源 + `ui_compile` 编译（MCP 参数传 **.widget.json** 路径）；
  HUD 由 `HUDClass = 'asset/blueprints/ui/hud.widget.json'` 经 PC.ClientSetHUD 链创建；
  hex/settle 由 HudScript.onStart `world.ui.spawnUIActor` 一次性生成，各自脚本自驱动可见性。
- **UI 脚本**：`gameplay/ui/*.script.ts` 被 asset/index.ts glob 注册（id='gameplay/ui/HudScript'）；
  TextBinder/ColorBinder/VisBinder 三差分刷新器 + 8Hz 节流同步 `mode.buildViewModel()`。

### 调试桥（e2e/GM）

`window.__warmCurrent`（WarmCurrentGameInstance.installDebugBridge，镜像 arena `__arena`；权威清单见 `WarmCurrentDebugBridge` 接口）：
`ready/state/vm/stepTicks/pointerDown|Move|Up/createRoute/addShip/removeShip/deleteRoute/buildShip/rebuildShip/
allocateResearch/allocateBuildPoints/forceBuild/forceResearch/chooseCardByIndex/setNodes/setH3/
placeBuilding/demolishBuilding/selectBuilding/enterBuildMode/enterSandbox/placeOrbitBuilding/setShipFlying/
triggerFlare/triggerWindow/suppressFlare/startMission/retryAct/restart/togglePause/startNewGame/
saveSlot/loadSlot/slotMeta/doubleClickPlanet/view/bodyPos…` 全部走组件 API。

## 二、e2e（tests/e2e/warm-current/warm-current.spec.ts）

单长用例全链路（34.6s）：启动教学关 → 拖线（europa 拒/moon 过）→ 首船净补 +160（载 200−油 40）→
forceResearch 三选一连选至队列清空 → setNodes(4) 推二幕 → 引力窗口木卫二线 speedMult 2/legTime 9s →
中转站补给链（H3 直接放置 relay → 地↔站反向线建线自动派 1 艘 + 显式补 1 艘 → 建材入缓存 stock ≥200）→ 耀斑护盾盾内(0.5)保全/盾外(0.95)冻毁 →
setNodes(8)+time=300 推三幕 → 火星模块任务胜利 → restart → 重推二幕 → 断燃料断环 → 堆心降温归零 → 重试本幕恢复。

**确定性三板斧**（踩出来的）：
1. 编辑器 rAF 在用例步进间隙实时推进仿真 → **关键段落用 withBridge 在单次 evaluate 内
   「改状态+stepTicks」原子执行**（JS 单线程，evaluate 期间无 rAF 插入）；
2. 非关键断言全部容忍漂移（`>=`/区间），不写精确等式（储量在烧、时间在走）；
3. 幕转换会重置耀斑 nextIn → **压制必须放在转换 stepTicks 之后**；每个敏感段入口再压一次。
   「双生节点」卡一次 +2 交点 → 节点断言用 `>=`。桥对象含函数，**跨 evaluate 序列化会剥掉**，
   一律页面内调用（`call(page, method, ...args)` 模式）。

## 三、渲染与门禁

- **3D 标准**：XZ 地面 + 真实球体 + Standard/Lambert + 灯光 + 垂直俯视透视相机（fov50，`SolarCameraActor.place` 开局就位 y=3400，`applyViewMode` 取景 dist 太阳 480 / 地球 3200，up=(0,0,-1)）；
  文字走 CanvasTexture Sprite（脏检查）。旧 canvas2d 方案 8fps 已弃。
- **后处理（2026-09-12 群星观感改版）**：星图 `BeginPlay` 经 `world.gameRenderer.enablePostProcess`
  开引擎级 EffectComposer（RenderPass → UnrealBloom 0.85/0.55/0.62 → OutputPass，HalfFloat + 4x MSAA），
  ACES 色调映射只作用主场景（UICamera 渲染层中和，HUD 不被洗灰）；`EndPlay` 摘除。
  e2e 断言桥：`__warmCurrent.renderInfo()`（enabled/toneMapping/bloom/ambientIntensity）。
- **光照纪律（同日改版）**：ambient 0.85→0.22、定向补光 0.28（特写主光，方向 (300,800,200)）、
  太阳点光 (2.4, decay=0, 无限程) 挂 root3 常显——太阳系全景行星按相对太阳方位出明暗面；
  行星系视角聚焦行星钉在太阳位，点光落在球心无方向，特写明暗界线由定向光承担（点光因此不能进 sunGroup）。
- **地球特写增强**：bump（程序化）+ 海洋 PBR 高光（`applyEarthOceanRoughness` 从真实 albedo 派生
  海洋/陆地粗糙度分区，向阳海面出 GGX 高光）+ 大气 Fresnel 壳 + 双层受光动态云——全部蓝图资产声明
  （`earth.blueprint.json`：AtmosphereComponent + CloudLayerComponent×2 低浓/高疏），运行时零挂载（防蓝图保存
  全量写回撞出双实例）；CloudLayerComponent 引擎侧为 Lambert + alphaMap，加载后异步柔化（低通 +
  密度=灰度×alpha 兼容黑底/白底alpha 两类云图 + 稀薄化削底带 + smoothstep 软阈值 + 极区纬度衰减），
  双层 spin 0.35/0.55（慢于本体 1.0 → 云相对地表独立滑行）+ uvDrift 异速 → 视差体积感 + 云形演变；
  **StarActor 构造须 enableTick()**——Actor 默认 `_bTickEnabled=false` 不进 World Tick 循环，
  不开则 CloudLayerComponent.Tick（自转/漂移）永不执行（实测坑：云静止，回归锁
  render_postprocess"云层独立运动"用 stepTicks 断言增量）；
  StarActor root 加 23° 轴倾角（俯视特写看中纬度而非极区云带）。云图 `earth_clouds.png`
  （4096×2048 NASA 系 fair_clouds，归属见 textures/LICENSE）。
- **特写曝光（2026-09-12 三轮）**：ambient 0.22→0.12（背部阴影可读的前提）；定向主光 0.9 低仰角
  掠射 (620,300,280)；行星系视角点光与主光**同向**（stage+(1670,810,750)，两光异向会出双 terminator
  互相冲淡）功率 0.6 只做补强；太阳系全景点光回太阳位 2.4。
- **特写曝光（2026-09-12 二轮）**：行星系视角聚焦行星钉在太阳位 → 太阳点光重定位到掠射位
  （stage+(1500,900,850)）且功率 2.4→1.1（全景小行星口径）；bloom 阈值 0.62→0.85——受光云层
  亮度 ~0.6，阈值低了会被 bloom 炸成无结构白穹（隔离截图法定位：逐个隐藏云/大气/关 bloom）。
- 指针拾取不用编辑器注入 worldPos（那是 z=0 平面交点），Controller 自己射线 ∩ y=0 再 +半宽半高回画布系。
- **CodeLint 全绿**：项目代码禁止裸 `new THREE.Mesh/Group/Line/*Geometry/*Material` → 全部改走
  `world.factory.createXxx`（本工程推动引擎 ThreeFactoryComponent 扩展：createRingGeometry 全参、
  createMeshLambertMaterial、createLineDashedMaterial、createPolyline）。
  工厂在组件 BeginPlay 时取 `owner.world?.factory`（构造期 world 未就绪）；`this.F` 非空访问器统一使用。
- 门禁链：`ui_compile` 三资产 0 error → run_asset_lint → `npx tsc --noEmit`（仅 hoi4 既有错误排除）→
  CodeLint 0 → 实机截图复核 → e2e 绿。
- **渲染回归锁**：`e2e/warm/render_postprocess.spec.ts`（后处理开启 + ACES(4) + ambient ≤0.35 + 全景/特写
  基准截图）与 `e2e/warm/earth_closeup.spec.ts`（大气/云层各恰好一层，全蓝图声明）。

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

- 编辑器 Dashboard → WarmCurrent → Launch → 主菜单（warm_menu.scene.json）→ 点「NEW EXPEDITION」（Btn_new）切星图（`startNewGame`）后拖月球到地球建首条航线。
- GM 命令：`status/h3/node/ship/flare/window/win/sol`（GMRegistry glob 自动注册）。
- e2e：`npm run test:e2e:warm`（playwright.e2e.config.ts，dev server :5173 由外部管理）。

## 六、后续变更

- **2026-09-13 主菜单 SVG 重设计**：设计稿 `asset/ui/warm-main-menu.svg` 落地为 `main_menu.widget.html/json`（WARM 英文品牌太空 HUD 风，替换旧中文「暖流计划」版式）。行为契约不变：`Btn_new → 'new'`、`Btn_load → 'load'`（标签按最近存档槽位改写 `CONTINUE · S<n>`，`Label_load` 节点名保留）。设计稿四菜单项中 SETTINGS / EXIT TO DESKTOP 经用户决策（2026-09-13）为**占位禁用**：纯 div 无 UIButton 天然不可点，后端就绪后换 `<button>` 并在 MainMenuScript 绑定。渲染近似手法（引擎 UI 无 radial-gradient/SVG filter）：径向渐变→对角 linear-gradient、辉光→低透明同心圆、SVG 椭圆轨道环→低透明填充盘面 + `transform: rotate`（视觉旋转，不参与布局）、行星圆环描边→同心圆叠层（圆角元素上 CSS border 会发射直边条）、行星表面波浪→`overflow: hidden` 圆形遮罩内旋转条带。回归锁：`tests/warmMainMenuWidget.test.ts`（资产契约 12 例）+ `e2e/warm/main_menu.spec.ts`（运行时 4 例）。
