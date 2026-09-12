/**
 * WarmCurrentGameMode — 游戏规则胶水（hoi4 base/ 架构位）
 *
 * 仿真子系统全部做成 GameMode 上的引擎组件（对齐 SpawnComponent/CameraComponent 惯例）：
 * simState（状态+快照）/ transport（航线飞船）/ economy（焚烧衰减）/ research（研究海克斯）
 * / hazards（引力窗口+耀斑）/ buildings（地图建筑：建造面板选型→星图网格放置）/ acts（三幕）+ sim（总控编排器）。
 * HUD 不在此构建（HUDClass 指向 hud.widget.json，由 gameplay/ui/*.script.ts 消费 buildViewModel）。
 * 指针事件经 WarmCurrentPlayerController 进来后做节点/航线几何命中，转成组件指令；
 * 建筑模式（buildMode）下指针变为放置：网格吸附预览 + 点击落位（Esc 取消，优先于暂停菜单）。
 * 太阳系取景：SolarCameraActor 云台（滚轮缩放 + 右键/边缘平移）+ sol GM 命令聚焦天体。
 * Esc：togglePauseMenu 呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单），打开时强制暂停。
 * 海克斯三选一：节点达成弹卡即整体暂停仿真（paused=true），选卡后恢复运行（2026-09-08 拍板）。
 */
import { CameraComponent, GameMode, Instantiate, SphereMeshComponent, audioSys, logger, AtmosphereComponent } from '@/engine'
import { starTextureFor } from '../map/starTextures'
import { B, MAP_H, MAP_W, toWX, toWZ, refreshBalanceFromConfigs } from '../core/balance'
import type { BuildingDef, BuildingUpgradeDef, OrbitBuildingDef, RingBuildingDef, ShipHullDef, ShipModuleDef, SolarFocusBody } from '../core/balance'
import type { CardDef } from '../core/balance'
import type { PlanetId, PlanetBodyId, ShipOrder } from '../core/types'
import type { SolarBodyId } from '../core/helpers'
import { getCardDef } from '../core/cards'
import { restoreSimState } from '../core/save'
import {
  alignMoonRelativeAngle, buildingByEndpoint, buildingDefOf, buildingEffectiveDef, buildingPos, estimateNetFlow, endpointPos, findRoute, ledgerTotals,
  fleetMaintPerS, hiddenActorIsolated, legSeconds, moonRelativeAngle, orbitBuildingPos, resetMoonPhaseAdj, ringBuildRateOf, ringLevelOf, ringModsOf, roundFuel, routeCycleSeconds, snapToGrid,
  routeNetPerTrip, shipHullDefOf, shipModuleDefOf, shipPos, starLoad, starOfEndpoint, starPosAt,
  TUTORIAL_TARGETS,
} from '../core/helpers'
import type { RingLevelInfo } from '../core/helpers'
import type { Endpoint, OrbitBuilding, SimBuilding, SimLedger, SimRoute, SimShip, SimState, StarId } from '../core/types'
import { StarMapRenderComponent, planetStageOffset } from '../map/StarMapRenderComponent'
import { SolarCameraActor } from '../map/SolarCameraActor'
import { STAR_BLUEPRINTS, type StarBodyId } from '../map/StarActor'
import type { BuildCursor, DragState, MapFx, MapSelection } from '../map/StarMapRenderComponent'
import { SimStateComponent } from '../systems/SimStateComponent'
import { TransportComponent } from '../systems/TransportComponent'
import { EconomyComponent } from '../systems/EconomyComponent'
import { ResearchComponent } from '../systems/ResearchComponent'
import { RingBuildComponent } from '../systems/RingBuildComponent'
import { HazardsComponent } from '../systems/HazardsComponent'
import { BuildingsComponent } from '../systems/BuildingsComponent'
import { OrbitBuildComponent, isShipyardType, orbitBuildingDefOf } from '../systems/OrbitBuildComponent'
import { ActsComponent } from '../systems/ActsComponent'
import { SimulationComponent } from '../systems/SimulationComponent'
import { WarmCurrentPlayerController } from './WarmCurrentPlayerController'
import { WarmCurrentPawn } from './WarmCurrentPawn'
import { registerWarmCurrentAudio } from './audio'

/** 暂停菜单 widget 资产（Esc 呼出，动态 spawn/destroy） */
const PAUSE_MENU_WIDGET = 'asset/blueprints/ui/pause_menu.widget.json'

/** 视图切换加载遮罩（地球系/太阳系跃迁过渡，动态 spawn/destroy） */
const VIEW_LOADING_WIDGET = 'asset/blueprints/ui/view_loading.widget.json'

export const WARM_CURRENT_SCENE = 'WarmCurrentMap'
export const HUD_WIDGET = 'asset/blueprints/ui/hud.widget.json'

/** 地面建筑命中半径（地图px；buildingAt 选中与 nodeAt 拖线端点共用，改口径两处同步） */
const BUILDING_HIT_R = 26

function dist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y)
}

/** 星图天体中文名（资源星名走 stars 表，表外天体此处兜底；月球/木卫二/火星以表为准） */
const PLANET_NAMES: Record<string, string> = {
  earth: '地球', mercury: '水星', venus: '金星',
  jupiter: '木星', saturn: '土星', uranus: '天王星', neptune: '海王星',
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

// ─── HUD 视图模型（UI 行为脚本每帧消费） ───

export interface HudRouteInfo {
  name: string
  direction: 'forward' | 'reverse'
  ships: number
  net: number
  cycle: number
}

export interface HudBuildingInfo {
  id: number
  type: string
  /** 建筑名（building 表） */
  name: string
  /** 功能半径（护盾建筑 > 0；强化合成值） */
  radius: number
  /** 护盾保全容量（强化合成值） */
  cap: number
  /** 缓存物资/上限（非缓存建筑 cap=0；上限 = 强化合成值） */
  stock: number
  bufferCap: number
  canDemolish: boolean
}

/** 建筑详情浮层数据（building_detail.widget 消费；强化分支装拆流，玩家设计权扩展） */
export interface HudBuildingDetail {
  id: number
  type: string
  name: string
  /** 强化后有效数值摘要 */
  radius: number
  cap: number
  bufferCap: number
  stock: number
  /** 当前已装强化分支（null = 未强化） */
  upgrade: { id: string; name: string; desc: string } | null
  /** 强化分支行（building 表 upgrades 键序；installed = 当前已装） */
  branches: Array<{ id: string; name: string; desc: string; cost: number; installed: boolean; canInstall: boolean }>
  /** 拆强化费（当前分支造价 × upgradeDemolishCostPct；未强化 0） */
  removeFee: number
  canDemolish: boolean
}

/** 建造面板行（building 表驱动，build_panel.widget 消费） */
export interface HudBuildRow {
  /** 建筑类型 id（building 表行键；放置按钮参数） */
  id: string
  name: string
  desc: string
  /** 放置造价（H3） */
  cost: number
  /** 当前可放置（预算足 & 非耀斑 & 对局进行中） */
  canPlace: boolean
}

/** 运输面板船行（transport_panel.widget 消费，最多展示 SHIP_ROWS 行） */
export interface HudShipRow {
  id: number
  name: string
  state: import('../core/types').ShipState
  /** 位置描述（「基地待命」「去程 · 月球线」「冻毁」等） */
  place: string
  cargo: number
  materials: number
  /** 冻毁可重建 */
  canRebuild: boolean
}

/** 航线管理面板行（routes_panel.widget 消费，全部航线的紧凑视图） */
export interface HudRouteRow {
  id: number
  /** 行名（正向「月球线」，反向「供应线·木卫二」） */
  name: string
  direction: 'forward' | 'reverse'
  /** 在线配船数 */
  ships: number
  /** 单趟净补（正向 t）/ 单趟载建材（反向） */
  net: number
  /** 往返时长（秒，展示用） */
  cycle: number
}

/** 星球信息面板数据（planet_info.widget 消费；非航线编辑模式点星球打开） */
export interface HudPlanetInfo {
  /** 天体 id（B.map.nodes 行键；地球/资源星/卫星/装饰行星） */
  body: string
  name: string
  /** 类型标签（基地/资源星/卫星/行星） */
  kind: string
  /** 资源星是否已解锁（地球恒 true；装饰行星 true = 无解锁概念） */
  unlocked: boolean
  /** 解锁幕（资源星专用；地球/装饰行星 0） */
  unlockAct: number
  /** 资源星：单船满载（t，含卡加成；未解锁 0） */
  load: number
  /** 资源星：单程油耗（H3） */
  fuel: number
  /** 资源星：单程航时（s，标称速度） */
  legS: number
  /** 关联航线数（地球 = earth 端点线；资源星 = 该星线；装饰行星恒 0） */
  routes: number
  /** 关联航线配船合计 */
  ships: number
  /** 地球专用：储量 / 需求 / 净流 */
  earthH3: number
  demand: number
  netFlow: number
  /** 是否航线端点（地球或资源星）— 面板据此显示拖线引导 */
  routable: boolean
}

/** 轨道建设面板类型行（orbit_build.table 行投影） */
export interface HudOrbitBuildRow {
  /** 建筑类型 id（表行键；建造按钮参数） */
  id: string
  name: string
  desc: string
  /** 建造造价（H3） */
  cost: number
  /** 建造工期（秒） */
  buildTime: number
  /** 该天体轨道上此类型数量 / 上限 */
  count: number
  max: number
  /** 当前可建造（预算足 & 非耀斑 & 未超上限 & 对局进行中） */
  canBuild: boolean
}

/** 轨道建设面板在册设施行 */
export interface HudOrbitBuildingRow {
  id: number
  name: string
  /** 建造中百分比（0~100）或已建成 */
  built: boolean
  progressPct: number
  /** 建成且具造船能力：经此建筑造船的折后造价 */
  canBuildShip: boolean
  shipCost: number
}

/** 轨道建设面板数据（null = 收起；OrbitPanelScript 消费） */
export interface HudOrbitBuild {
  /** 轨道锚天体 id */
  anchor: string
  /** 天体名（面板标题「近地轨道 · 地球」） */
  anchorName: string
  /** 可建类型行（orbit_build.table 键序） */
  rows: HudOrbitBuildRow[]
  /** 该轨道在册设施（含在建） */
  buildings: HudOrbitBuildingRow[]
  /** 经建成船坞造船的折后造价（无建成船坞 = 基准价） */
  shipCost: number
  /** 是否有建成船坞（面板文案开关；折扣态判定在 GameMode，UI 不持规则） */
  hasShipyard: boolean
}

/** 船坞造船面板在造船卡片行（逐船一卡：队列每项一张卡片，2026-09-09 用户需求） */
export interface HudShipBuildCard {
  /** 队列序号（0 = 队首建造中） */
  idx: number
  /** 剩余秒（展示 ceil） */
  remainS: number
  /** 本艘总建造秒（入队时锁定） */
  totalS: number
  /** 建造进度 0..100（队首卡片进度条口径） */
  progressPct: number
}

/** 船坞造船面板船型行（ship_hull 表投影，三步流第 1 步） */
export interface HudHullRow {
  id: string
  name: string
  desc: string
  cost: number
}

/** 船坞造船面板模块行（ship_module 表投影，三步流第 2 步；allowed = 当前船型兼容） */
export interface HudModuleRow {
  id: string
  name: string
  desc: string
  cost: number
  /** 当前选中船型是否允许装载（false = 置灰） */
  allowed: boolean
}

/** 船坞造船面板数据（null = 收起；ShipyardPanelScript 消费） */
export interface HudShipyard {
  /** 承接船坞的轨道建筑 id */
  dockId: number
  /** 船坞名（面板标题「船坞 · 地球」） */
  name: string
  /** 轨道锚天体 id */
  anchor: string
  /** 天体名 */
  anchorName: string
  /** 是否建成（在建只显示建造进度，无造船按钮） */
  built: boolean
  /** 建造进度 0..100（在建展示口径） */
  progressPct: number
  /** 建成且具造船能力（造船按钮开关） */
  canBuildShip: boolean
  /** 船坞造价乘区（整单价 = 船体+Σ模块 × 此值；面板三步流总价同源计算） */
  costMult: number
  /** 船型行（ship_hull 表键序） */
  hulls: HudHullRow[]
  /** 模块行（ship_module 表键序） */
  modules: HudModuleRow[]
  /** 造船队列（逐船一卡，队首 = 建造中） */
  queue: HudShipBuildCard[]
  /** 船队总艘数 */
  fleetShips: number
  /** 排队艘数 */
  queueCount: number
  /** 飞船上限（聚能环等级口径） */
  cap: number
  /** 当前可再排一艘（能力 + 对局中 + cap 余量） */
  canQueue: boolean
}

export interface WarmCurrentVM {
  time: number
  act: 1 | 2 | 3
  /** 已建成环段槽位数（25 槽位制） */
  ringSlots: number
  /** 环段槽位总数（B.ringSlots） */
  ringSlotsTotal: number
  /** 环段建筑装入表（下标 = 槽位号；null = 空槽；槽位图/已装标记消费） */
  ringBuildings: (string | null)[]
  /** 拆除中的目标槽（null = 无；面板拆除进度弧 + 泵目标提示消费） */
  ringDemolish: { slot: number; progress: number; active: boolean } | null
  /** 聚能环等级（按已建成槽位数连续推导；level 25 = 全球组网） */
  ringLevel: RingLevelInfo
  /** 环建筑乘区摘要（详情面板展示口径；burnMult 含防爆地板） */
  ringMods: { burnMult: number; loadMult: number; shipCapAdd: number; buildPumpMult: number; researchMult: number; coolTimeMult: number; warmTimeMult: number }
  /** 环建筑安装行（ring_building 表键序；canInstall = 预算足 & 非耀斑 & 对局中） */
  ringInstallRows: Array<{ id: string; name: string; desc: string; cost: number; canInstall: boolean }>
  /** 堆心温度 0..100（100 = 满温；无燃料持续降温，归零 = 堆心熄灭 = 终结） */
  coreTemp: number
  /** 堆心状态：warming = 升温中（有燃料），cooling = 降温中（断环） */
  coreState: 'warming' | 'cooling'
  /** 燃料门：有燃料 running（焚烧/研究/建设照常），储量耗尽 decaying（停烧停建，堆心降温） */
  ring: 'running' | 'decaying'
  reserve: number
  demand: number
  /** 研究点数计费速率（H3/秒，四线合计；储量耗尽为 0） */
  researchCost: number
  netFlow: number
  danger: boolean
  windowPhase: 'idle' | 'warn' | 'active'
  windowRemain: number
  flarePhase: 'idle' | 'warn' | 'active'
  flareRemain: number
  /** 舰队维护费速率（H3/秒，按总船数查 fleet_maint 阶梯；从地球储备持续扣除）；cap = 聚能环等级飞船上限 */
  fleet: { total: number; idle: number; flying: number; frozen: number; building: number; buildRemain: number; maintPerS: number; cap: number }
  /** H3 收支账本（对局累计 + income/expense/net 合计，统计面板消费） */
  ledger: SimLedger & { income: number; expense: number; net: number }
  /** 四线研究行（points = 已分配点数，rate = 该线当前 H3 消耗速率） */
  research: Array<{ id: string; name: string; progress: number; points: number; rate: number }>
  /** 可用研究点（聚能环等级 − 已分配，科研面板 +/− 分配） */
  researchUnspent: number
  /** 聚能环建设（造价制：详情面板消费；ringBuildRate = 灌入速率 ÷ 本级造价，%/s 展示口径） */
  ringBuildPoints: number
  ringBuildProgress: number
  ringBuildCost: number
  ringBuildRate: number
  ringBuildMin: number
  pending: { lineName: string; cards: CardDef[] } | null
  routeInfo: HudRouteInfo | null
  buildingInfo: HudBuildingInfo | null
  /** 建造面板行（building 表顺序） */
  buildRows: HudBuildRow[]
  /** 建筑模式当前选型（building 表行键；null = 非建筑模式） */
  buildActive: string | null
  /** 运输面板船行（截断到面板行池容量，超出部分 UI 用「另有 N 艘」提示） */
  shipRows: HudShipRow[]
  /** 航线管理面板行（全部航线，RoutesPanelScript 消费） */
  routes: HudRouteRow[]
  /** 星球信息面板数据（null = 收起；PlanetInfoScript 消费） */
  planetInfo: HudPlanetInfo | null
  /** 轨道建设面板数据（null = 收起；OrbitPanelScript 消费） */
  orbitBuild: HudOrbitBuild | null
  /** 船坞造船面板数据（null = 收起；ShipyardPanelScript 消费，点船坞打开） */
  shipyard: HudShipyard | null
  /** 建筑详情浮层数据（null = 收起；BuildingDetailScript 消费，点建筑打开，强化装拆流） */
  buildingDetail: HudBuildingDetail | null
  /** 耀斑预警决策条（fleet_order_bar 消费；windowOpen = 预警期可下令） */
  fleetOrders: { windowOpen: boolean; selectedCount: number; canHold: boolean }
  /** 航线编辑模式（HUD「航线编辑」按钮高亮态） */
  routeEditMode: boolean
  /** 造船/重建造价（面板按钮标签用，配置表驱动防硬编码漂移） */
  shipRebuildCost: number
  /** 当前轨道锚是否有建成船坞（轨道建设面板文案开关；折扣态判定在 GameMode，UI 不持规则） */
  hasShipyard: boolean
  tutorial: boolean
  paused: boolean
  timeScale: number
  moduleState: 'locked' | 'available' | 'mission' | 'delivered'
  canStartMission: boolean
  outcome: 'playing' | 'victory' | 'defeat'
  sandbox: boolean
  stats: { delivered: number; frozen: number; buildings: number; cards: number }
}

export class WarmCurrentGameMode extends GameMode {
  /** 仿真子系统组件（对齐引擎 SpawnComponent/CameraComponent 惯例，挂在 GameMode 上） */
  readonly simState: SimStateComponent = this.addComponent(SimStateComponent)
  readonly transport: TransportComponent = this.addComponent(TransportComponent)
  readonly economy: EconomyComponent = this.addComponent(EconomyComponent)
  readonly research: ResearchComponent = this.addComponent(ResearchComponent)
  /** 聚能环建设（脱离科研的独立流：交点解锁/建设点数/计费） */
  readonly ringBuild: RingBuildComponent = this.addComponent(RingBuildComponent)
  readonly hazards: HazardsComponent = this.addComponent(HazardsComponent)
  /** 地图建筑（建造面板选型 → 星图自由放置） */
  readonly buildings: BuildingsComponent = this.addComponent(BuildingsComponent)
  /** 近地轨道建筑（点行星 → 轨道建设面板；船坞造船乘区） */
  readonly orbitBuild: OrbitBuildComponent = this.addComponent(OrbitBuildComponent)
  readonly acts: ActsComponent = this.addComponent(ActsComponent)
  /** 总控编排器（固定顺序驱动各子系统 tick） */
  readonly sim: SimulationComponent = this.addComponent(SimulationComponent)

  /** 太阳系云台相机（滚轮缩放 + 右键/边缘平移；群星式） */
  readonly cameraActor: SolarCameraActor
  /** 兼容旧引用（HUD/UI 脚本读 gameCamera.camera）：直接暴露云台上的 CameraComponent */
  readonly gameCamera: CameraComponent

  starMap: StarMapRenderComponent | null = null

  /** 星图天体蓝图 Actor（BeginPlay 经 Instantiate 生成，Tick 每帧 syncFrom；渲染组件经 provider 只读消费） */
  readonly starActors = new Map<StarBodyId, import('@/engine').Actor>()

  drag: DragState | null = null
  selection: MapSelection = null
  fx: MapFx = { pulses: [], floats: [] }

  /** 航线编辑模式（底部 HUD「航线编辑」进入；开启后星图节点才可拖线建航线，退出后点星球 = 信息面板） */
  routeEditMode = false
  /** 星球信息面板当前展示的天体（非编辑模式点星球打开；点空地/面板关闭按钮清空；null = 收起） */
  planetInfoSel: SolarBodyId | null = null
  /** 轨道建设面板当前锚天体（点星球信息面板「近地轨道建设」/ 点建成轨道设施打开；null = 收起） */
  orbitBuildSel: PlanetBodyId | null = null
  /** 船坞造船面板当前承接船坞 id（点船坞打开；null = 收起，ShipyardPanelScript 消费） */
  shipyardSel: number | null = null
  /** 建筑详情浮层当前建筑 id（点建筑打开：强化分支装拆流；null = 收起） */
  buildingDetailSel: number | null = null
  /** 耀斑预警框选的船 id 集（决策条下达对象；耀斑结束自动清空） */
  selectedShips: number[] = []
  /** 框选手势进行中矩形（画布系；仅耀斑预警期空处按下拖动 = 框选；null = 无） */
  boxDrag: { x0: number; y0: number; x1: number; y1: number } | null = null

  /** 建筑模式（建造面板选型后进入：星图网格线 + 吸附预览，点击落位 / Esc 取消） */
  buildMode: { typeId: string } | null = null
  /** 建筑模式光标（网格吸附后画布系坐标 + 合法性，渲染 ghost 消费） */
  buildCursor: BuildCursor | null = null

  paused = false
  timeScale: 1 | 2 = 1
  /** 星图视角模式：earth = 行星系跟随取景（聚焦 planetFocusBody，开局默认地球系），solar = 太阳系全景 */
  viewMode: 'earth' | 'solar' = 'earth'
  /** 行星系视角当前聚焦的行星（viewMode='earth' 时生效；太阳系全景忽略） */
  planetFocusBody: SolarBodyId = 'earth'
  /** 离开地球系时记录的月球相对相位（rad；null = 无待回拨），切回地球系时对齐用 */
  private moonAngleAtLeave: number | null = null
  /** 视图切换进行中（加载遮罩已上屏、镜头尚未跳转）：期间忽略重复切换（e2e 桥只读） */
  viewSwitching = false
  /** 当前加载遮罩面板（null = 无；e2e 断言切换收尾后必须归零） */
  viewLoadingPanel: import('@/engine').Actor | null = null

  /** 行星观察模式当前观察的天体（null = 未在观察；行星系内双击聚焦行星进入，Esc 退出） */
  observeBody: PlanetId | null = null


  /** 事件 toast 队列（HudScript 每帧消费渲染） */
  toasts: Array<{ text: string; color: string; age: number }> = []

  /** 暂停菜单面板（Esc 动态 spawn 的 UI Actor；null = 关闭） */
  pauseMenuPanel: import('@/engine').Actor | null = null

  /** HUD widget 资产（PC.ClientSetHUD 链自动创建，脚本挂根节点） */
  override HUDClass = HUD_WIDGET

  constructor() {
    super()
    // 太阳系云台相机（3D 标准）：fov 50，缩放边界随视图模式切换（applyViewMode：地球系 80~520 / 太阳系 60~12000）
    // 相机 Actor 构造但不托管：由 BeginPlay 的 spawnActor 交给 World（hoi4 同款）
    this.cameraActor = new SolarCameraActor(MAP_W, MAP_H)
    this.gameCamera = this.cameraActor.cameraComponent
  }

  override InitGame(): void {
    // 配置表覆盖默认值 + 重置仿真状态（改表重开一局即生效）
    refreshBalanceFromConfigs()
    this.simState.reset()
    super.InitGame()
    this.cameraManager.RegisterCamera(this.gameCamera)
    this.cameraActor.place()
    // 开局即地球系取景：只看地月小星系（其余星球未解锁，全景留给右下角视角切换）
    this.focusSolarSystem('earth')
    logger.info('[WarmCurrent] 开局取景：地球系（地月小星系）')
  }

  override spawnPlayerInternal() {
    const controller = new WarmCurrentPlayerController(this)
    // 装配期：相机云台接输入（滚轮缩放 + 右键拖拽平移；规范 §2.5 唯一例外现场，hoi4 同款）
    this.cameraActor.rig.bindInput(controller.inputComponent)
    // Esc：建筑模式中先取消放置（不误开暂停菜单），否则呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单）
    controller.inputComponent.BindAction('wc-pause-menu', 'Escape', 'pressed', () => {
      if (this.buildMode) {
        this.cancelBuildMode()
        return
      }
      // 行星观察模式：Esc 先退观察回行星系俯视（不误开暂停菜单）
      if (this.observeBody) {
        this.exitPlanetObserve()
        return
      }
      this.togglePauseMenu()
    })

    return { controller, pawn: new WarmCurrentPawn() }
  }

  override BeginPlay(): void {
    super.BeginPlay()
    if (!this.world) return
    // 太阳系云台相机交给 World 托管（构造期不托管；spawn 后 rig.BeginPlay 才能查到相机组件）
    this.world.actorMgr.SpawnActor(this.cameraActor)
    registerWarmCurrentAudio()
    // 天体蓝图 Actor 先生成（渲染组件 BeginPlay 即 buildNodes，需读 starActors 接管 mesh 引用）
    this.spawnStarActors()
    // 星图渲染组件挂到场景资产的 StarMap 节点（场景/蓝图资产化：节点由 warm_current.scene.json 布置）
    const node = this.world.findActorByName('StarMap')
    if (node) {
      this.starMap = node.addComponent(StarMapRenderComponent, this)
    } else {
      logger.warn('[WarmCurrent] 场景缺少 StarMap 节点，星图不可渲染')
    }
    logger.info('[WarmCurrent] BeginPlay 完成（拖一条线，延续人类）')
  }

  override Tick(dt: number): void {
    super.Tick(dt)
    const s = this.simState.state
    // 弹卡暂停：pendingCard 挂起期间仿真整体冻结（选卡即恢复，无跳过选项）
    if (!this.paused && !s.pendingCard && (s.outcome === 'playing' || s.sandbox)) {
      this.sim.runTick(dt * this.timeScale)
    }
    this.drainEvents()
    // 特效/toast 老化（真实时间）
    for (const p of this.fx.pulses) p.age += dt
    this.fx.pulses = this.fx.pulses.filter((p) => p.age < 0.6)
    for (const f of this.fx.floats) f.age += dt
    this.fx.floats = this.fx.floats.filter((f) => f.age < 1.4)
    for (const t of this.toasts) t.age += dt
    this.toasts = this.toasts.filter((t) => t.age < 3.6)
    // 天体位置自驱动（蓝图 Actor：位置 = hiddenActorIsolated 隔离点纯函数 + 自转；暂停时 dt=0 只保持位置）
    // 行星系视角：聚焦行星 + 卫星按真实相对位置绕舞台中心（聚焦行星钉在舞台），
    // 其余天体 Actor 本体移到远景隔离点（布局锚方位 × 12000）——渲染层本就将其
    // visible=false 隐藏，Actor 移远后点击判定（收口真实 Actor 位置）自然点不到
    const sdt = this.paused ? 0 : dt * this.timeScale
    const vm = this.viewMode
    const focus = this.planetFocusBody as PlanetId
    for (const sa of this.starActors.values()) (sa as import('../map/StarActor').StarActor).syncFrom(this.simState.state, sdt, vm, focus)
    // rig.target 已由 focusOn 一次性定到舞台中心（舞台静态：行星钉死），这里禁止逐帧复位：
    // rig.pan 成对移动 target 与相机，若只把 target 拉回舞台而相机留在原位，
    // 下次拖拽的 lookAt 会把镜头掰向舞台中心——右键平移退化成绕行星旋转
    this.starMap?.render(this.paused ? 0 : dt * this.timeScale, this.gameCamera.camera)
  }

  // ═══════════════════════════════════════════
  //  星图天体蓝图 Actor（外观资产化：.blueprint.json）
  // ═══════════════════════════════════════════

  /**
   * 生成 11 个天体蓝图 Actor；单张失败（未注册/lint 错）由渲染组件兜底建球，星图不缺星。
   * 贴图来源：蓝图 texture 资产字段（引擎 factory 装配）优先；仅蓝图未声明贴图的天体
   * （europa，SSS 无真贴图）走 starTextureFor 程序化 CanvasTexture 兜底。
   */
  private spawnStarActors(): void {
    if (!this.world) return
    for (const [body, path] of Object.entries(STAR_BLUEPRINTS) as Array<[StarBodyId, string]>) {
      const actor = Instantiate(path)
      if (actor) {
        const mesh = actor.getComponent(SphereMeshComponent)
        let texSource = ''
        if (mesh && !mesh.hasTextureMap) {
          const tex = starTextureFor(body)
          if (tex && mesh) {
            mesh.setTexture(tex)
            texSource = typeof tex === 'string' ? '（程序化兜底·真贴图 URL）' : '（程序化兜底·Canvas）'
          }
        }
        this.starActors.set(body, actor)
        logger.info(`[WarmCurrent] 天体生成 ${body} ← ${path}${mesh ? (mesh.hasTextureMap ? '（蓝图贴图资产）' : texSource || '（无贴图）') : '（缺 SphereMesh）'}`)
      } else {
        logger.error(`[WarmCurrent] 天体蓝图生成失败，该天体缺失（检查 assetLint）：${path}`)
      }
    }
  }

  // ═══════════════════════════════════════════
  //  事件 → 反馈（音效 + toast 队列）
  // ═══════════════════════════════════════════

  private drainEvents(): void {
    const sc = this.simState
    if (sc.events.length === 0) return
    let unloadSounds = 0
    for (const ev of sc.events) {
      switch (ev.type) {
        case 'unload':
          if (ev.x !== undefined && ev.y !== undefined) {
            this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
            this.fx.floats.push({ text: ev.value ? `+${ev.value}` : '', x: ev.x, y: ev.y - 30, age: 0 })
          }
          if (unloadSounds++ < 2) audioSys.play('wc.unload', { volume: 0.5 })
          break
        case 'route_built': audioSys.play('wc.ok'); break
        case 'slot_built':
          audioSys.play('wc.ok', { volume: 0.6 })
          this.toast(`第 ${ev.value ?? 0} 环段交付（毛坯空槽）— 可安装环建筑`, '#7fdcff')
          break
        case 'ring_installed':
          audioSys.play('wc.build')
          this.toast(`「${ev.text ?? '环建筑'}」已装入 ${ev.value !== undefined ? `第 ${ev.value + 1} 环段` : '环段'}`, '#7fdcff')
          break
        case 'ring_demolished':
          audioSys.play('wc.ok', { volume: 0.4 })
          this.toast(`环段建筑已拆除（${ev.text ?? ''}），槽位回空置可再装`, '#9fc4d8')
          break
        case 'route_deleted': audioSys.play('wc.bad', { volume: 0.5 }); break
        case 'ship_built': this.toast('新船下水，已入列空闲池', '#b8ffd8'); break
        case 'ship_rebuilt': this.toast('冻毁飞船已重建', '#b8ffd8'); break
        case 'hint':
          if (ev.text) { this.toast(ev.text, '#ff8f7a'); audioSys.play('wc.bad', { volume: 0.35 }) }
          break
        case 'card_pending':
          audioSys.play('wc.card')
          this.toast(`「${ev.text ?? ''}」节点达成 — 三选一（仿真暂停中）`, '#ffb03d')
          // 弹卡即暂停：选卡前仿真冻结（Tick 门 + drainEvents 双保险）
          this.paused = true
          break
        case 'card_chosen':
          this.toast(`已解锁「${ev.text ?? ''}」 · 环点亮新交点`, '#7fe0a0')
          break
        case 'window_warn': this.toast('引力窗口 10 秒后开启 — 准备发船', '#ffb03d'); break
        case 'window_open': this.toast('引力窗口开启：木卫二线 ×2 速 · 油耗减半', '#ffb03d'); audioSys.play('wc.ok'); break
        case 'window_close': this.toast('引力窗口关闭', '#6f8ba0'); break
        case 'flare_warn': this.toast('⚠ 事件预警：太阳耀斑 10 秒后来袭！', '#ff8f5a'); audioSys.play('wc.alarm'); break
        case 'flare_start':
          this.toast('☀ 太阳耀斑爆发：通讯中断，在途船失联', '#ff5a4a')
          audioSys.play('wc.flare')
          break
        case 'flare_end': this.toast('耀斑退去，幸存飞船恢复航行', '#9fc4d8'); break
        case 'frozen':
          this.toast(`${ev.value ?? 0} 艘飞船冻毁（150 H3 可重建）`, '#ff5a4a')
          audioSys.play('wc.bad')
          break
        case 'building_built':
          if (ev.x !== undefined && ev.y !== undefined) {
            this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
            this.fx.floats.push({ text: `-${ev.value}`, x: ev.x, y: ev.y - 30, age: 0 })
          }
          this.toast(`「${ev.text ?? '建筑'}」已放置 —— 可从星图拖线链接`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'orbit_building_built':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`「${ev.text ?? '轨道设施'}」已建成 —— 点它打开轨道建设面板`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'building_demolished':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`建筑拆除，返还 ${Math.round(ev.value ?? 0)} H3`, '#9fc4d8')
          break
        case 'upgrade_installed':
          this.toast(`「${ev.text ?? '强化'}」已装入建筑 #${ev.value ?? ''}`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'upgrade_removed':
          this.toast(`建筑强化「${ev.text ?? ''}」已拆除（费用不返还）`, '#9fc4d8')
          audioSys.play('wc.ok', { volume: 0.4 })
          break
        case 'act2':
          this.toast('第二幕 · 复苏：木卫二 / 引力窗口 / 极寒停航启用，需求暴涨！', '#ffb03d')
          audioSys.play('wc.alarm')
          break
        case 'act3':
        case 'module_available':
          this.toast('第三幕 · 质变：火星已解锁 —— 运回环扩展模块，点亮全球环网！', '#ffe9a8')
          break
        case 'victory': audioSys.play('wc.win'); break
        case 'defeat': audioSys.play('wc.lose'); break
        default: break
      }
    }
    sc.events.length = 0
  }

  private toast(text: string, color = '#cfe3ee'): void {
    this.toasts.push({ text, color, age: 0 })
    if (this.toasts.length > 5) this.toasts.shift()
  }

  // ═══════════════════════════════════════════
  //  太阳系取景（sol GM 命令 + 缩放相机）
  // ═══════════════════════════════════════════

  /** 地球系视图缩放范围（min/max 距离）：独立小星系取景（月球轨道 1200：特写 80 ~ 全景 5200） */
  private static readonly EARTH_VIEW_MIN_DIST = 80
  private static readonly EARTH_VIEW_MAX_DIST = 5200

  /** 聚焦指定天体：太阳 = 太阳系全景；行星 = 进入其行星系（跟随取景）。机位数学在 SolarCameraActor.focusOn */
  focusSolarSystem(body: SolarFocusBody): void {
    const toSolar = body === 'sun'
    // 月球相位对齐（仅地月系）：离开地月系时记录相位，切回地月系（含从其它行星系切回）时拨回
    const leavingEarthSys = this.viewMode === 'earth' && this.planetFocusBody === 'earth'
    const enteringEarthSys = !toSolar && body === 'earth'
    if (leavingEarthSys && !enteringEarthSys) this.moonAngleAtLeave = moonRelativeAngle(this.simState.state)
    if (enteringEarthSys && this.moonAngleAtLeave !== null) {
      alignMoonRelativeAngle(this.simState.state, this.moonAngleAtLeave)
      this.moonAngleAtLeave = null
    }
    if (!toSolar) this.planetFocusBody = body
    this.viewMode = toSolar ? 'solar' : 'earth'
    this.applyViewMode()
    // 取景距离随星体尺寸：太阳 1000（中景看内系统：水/金/地轨道入画），地球 3200（月球环 1200 全入画留边），其余行星 220
    const d = body === 'sun' ? 1000 : body === 'earth' ? 3200 : 220
    // 行星系取景目标 = 舞台中心（行星会被渲染钉在舞台中心，镜头只是切区）
    const off = this.viewMode === 'earth' ? planetStageOffset(this.planetFocusBody as PlanetId) : { x: 0, z: 0 }
    // 任何取景切换统一退出观察态（切太阳/切行星系/视角按钮都会走到这里）
    this.clearObserveState()
    this.cameraActor.focusOn(off.x, off.z, d)
    logger.info(`[WarmCurrent] 太阳系取景 → ${body} (dist=${d}, mode=${this.viewMode})`)
  }

  /** 清观察态（不做取景复位）：observeBody 归零 + 关轨道旋转 + 恢复边缘平移 + 复位特写增益。
   *  取景切换 / 重开 / 读档三条退出路径共用，保证清理不漏。 */
  private clearObserveState(): void {
    if (!this.observeBody) return
    this.observeBody = null
    this.cameraActor.rig.orbitMode = false
    this.cameraActor.rig.setEdgePanEnabled(true)
    this.resetObserveBoost()
  }


  /** 视图模式 → 相机缩放边界（视图隔离：地球系锁死地月尺度，滚轮拉远也只见地月） */
  private applyViewMode(): void {
    const solar = this.viewMode === 'solar'
    const rig = this.cameraActor.rig
    rig.minDistance = solar ? 60 : WarmCurrentGameMode.EARTH_VIEW_MIN_DIST
    rig.maxDistance = solar ? 12000 : WarmCurrentGameMode.EARTH_VIEW_MAX_DIST
    // 星图渲染分组同步切换（其它行星/轨道/太阳光晕显隐）
    this.starMap?.setViewMode(this.viewMode)
    logger.info(`[WarmCurrent] 视图隔离：${solar ? '太阳系全景（缩放 60~12000）' : `地球系小星系（缩放 ${WarmCurrentGameMode.EARTH_VIEW_MIN_DIST}~${WarmCurrentGameMode.EARTH_VIEW_MAX_DIST}，只见地月）`}`)
  }

  /** 视角切换（ViewToggle widget 按钮）：earth = 地球系（行星系），solar = 太阳系全景。
   *  ⚠ 按钮路径绕过 enterPlanetSystem 的观察 toggle：已在地球系 = 复位俯视取景，不进观察 */
  setViewMode(mode: 'earth' | 'solar'): void {
    if (this.viewSwitching) return
    if (mode === 'solar') {
      this.switchView('solar')
      return
    }
    if (this.viewMode === 'earth' && this.planetFocusBody === 'earth') {
      // 已在地球系：复位俯视取景（观察态由 focusSolarSystem 统一清理）
      this.focusSolarSystem('earth')
      return
    }
    this.switchView('earth')
  }



  /** 双击行星进入其行星系（加载遮罩过渡；已在同一行星系则切换行星观察视角） */
  enterPlanetSystem(body: SolarBodyId): void {
    // 切换进行中忽略（450ms 窗口内 toggle 会先观察再被延迟取景清掉，镜头闪跳）
    if (this.viewSwitching) return
    if (this.viewMode === 'earth' && this.planetFocusBody === body) {
      // 已在该行星系：双击 = 切换观察视角（未观察 → 进入环绕；观察中 → 退出回俯视）
      if (this.observeBody === body) this.exitPlanetObserve()
      else this.enterPlanetObserve(body as PlanetId)
      return
    }
    this.switchView(body)
  }


  /** 进入行星观察视角：斜对准行星（3D 环绕，左键/右键拖拽旋转，Esc 退出回俯视取景）。
   *  ⚠ 仅限当前行星系内：不在该行星系时忽略（跨系观察先双击进入行星系） */
  enterPlanetObserve(body: PlanetId): void {
    if (this.viewMode !== 'earth' || this.planetFocusBody !== body) return
    // 建筑/航线编辑模式与观察互斥（左键在观察中是环绕拖拽，不能同时落位/拖线）
    if (this.buildMode) this.cancelBuildMode()
    if (this.routeEditMode) this.toggleRouteEditMode()
    this.observeBody = body

    const rig = this.cameraActor.rig
    // 观察距离 = 节点半径 × 4（行星 r 11~46 → dist 44~184，近者被 minDistance 兜底到 80）
    const r = B.map.nodes[body].r
    // 定位用舞台偏移权威值（右键平移过地图时 rig.target 已偏离舞台，不可作锚点）
    const stage = planetStageOffset(body)
    // 边缘平移会拖走注视点破坏环绕，观察期间关闭（退出/切视图时恢复）
    rig.setEdgePanEnabled(false)
    this.cameraActor.observeFocus(stage.x, stage.z, r * 4)
    rig.orbitMode = true
    // 特写观感增强：被观察行星的大气提亮（组件在无此挂载的天体上自动跳过）
    this.applyObserveBoost(body)
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 行星观察：${PLANET_NAMES[body] ?? body}（拖拽环绕 · 滚轮缩放 · Esc/再双击退出）`)

  }

  /**
   * 行星观察特写增益：大气 ×1.8（上限 3）。基础值由组件快照持有，退出经 resetObserveBoost
   * 统一复位。云层增益随云层壳移除（2026-09-10，地球不再挂云，全仓无 CloudLayerComponent）。
   */
  private applyObserveBoost(body: PlanetId): void {
    for (const [id, actor] of this.starActors) {
      const on = id === body
      const atmo = actor.getComponent(AtmosphereComponent)
      if (atmo) atmo.intensity = on ? Math.min(3, atmo.baseIntensity * 1.8) : atmo.baseIntensity
    }
  }

  /** 复位全部天体的特写增益（退出观察/清理收口共用） */
  private resetObserveBoost(): void {
    for (const actor of this.starActors.values()) {
      const atmo = actor.getComponent(AtmosphereComponent)
      if (atmo) atmo.intensity = atmo.baseIntensity
    }
  }

  /** 退出行星观察视角：复位该行星系俯视取景（focusSolarSystem 顺带清观察状态与轨道开关） */
  exitPlanetObserve(): void {
    if (!this.observeBody) return
    this.focusSolarSystem(this.planetFocusBody)
    logger.info('[WarmCurrent] 行星观察退出（回行星系俯视）')
  }



  /** 统一视图切换：加载遮罩先上屏（盖住舞台搬移/镜头跳转防穿帮），下一拍再切 */
  private switchView(target: 'solar' | SolarBodyId): void {
    if (this.viewSwitching) return
    if (target === 'solar' && this.viewMode === 'solar') return
    this.viewSwitching = true
    const panel = this.world?.ui.spawnUIActor(VIEW_LOADING_WIDGET) ?? null
    this.viewLoadingPanel = panel
    if (!panel) logger.warn('[WarmCurrent] 视图切换加载遮罩生成失败，退化为硬切')
    window.setTimeout(() => {
      try {
        this.focusSolarSystem(target === 'solar' ? 'sun' : target)
      } finally {
        // 遮罩销毁失败不得卡死 viewSwitching（否则后续所有切换永久失灵）
        try { panel?.destroy() } catch (e) { logger.error(`[WarmCurrent] 加载遮罩销毁失败：${e}`) }
        this.viewLoadingPanel = null
        this.viewSwitching = false
      }
    }, 450)
  }

  override EndPlay(): void {
    // 相机 Actor 是 GameMode 自建自管的（非场景资产节点），销毁时走 Actor 统一销毁
    // （已托管 → World 销毁队列；未托管 → 本地 EndPlay，hoi4 同款）
    this.cameraActor.destroy()
    super.EndPlay()
  }

  // ═══════════════════════════════════════════
  //  建筑模式（建造面板选型 → 星图网格放置）
  // ═══════════════════════════════════════════

  /** 进入建筑模式（建造面板「放置」按钮；预算校验通过才进入；与航线编辑模式互斥） */
  enterBuildMode(typeId: string): boolean {
    const def = buildingDefOf(typeId)
    if (!def) return false
    const s = this.simState.state
    if (s.outcome !== 'playing' && !s.sandbox) return false
    if (s.earthH3 < def.cost) { this.simState.hint(`H3 不足（需 ${def.cost}）`); return false }
    this.buildMode = { typeId }
    this.buildCursor = null
    this.drag = null
    this.routeEditMode = false
    logger.info(`[WarmCurrent] 建筑模式：${def.name}（点击星图落位，Esc 取消）`)
    return true
  }

  /** 退出建筑模式（落位成功 / Esc / 面板关闭） */
  cancelBuildMode(): void {
    if (!this.buildMode) return
    this.buildMode = null
    this.buildCursor = null
    logger.info('[WarmCurrent] 建筑模式退出')
  }

  // ═══════════════════════════════════════════
  //  航线编辑模式（底部 HUD「航线编辑」开关）
  // ═══════════════════════════════════════════

  /** 切换航线编辑模式：开启 = 星图节点可拖线；关闭 = 点星球打开信息面板。与建筑模式互斥。 */
  toggleRouteEditMode(): void {
    if (this.routeEditMode) {
      this.routeEditMode = false
      this.drag = null
      this.toast('航线编辑已退出 — 点星球查看信息', '#9fc4d8')
      audioSys.play('wc.ok', { volume: 0.3 })
      logger.info('[WarmCurrent] 航线编辑模式退出')
      return
    }
    if (this.buildMode) this.cancelBuildMode()
    this.routeEditMode = true
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.toast('航线编辑：从星球拖线到地球即可建立航线（再点按钮退出）', '#7fdcff')
    audioSys.play('wc.ok', { volume: 0.5 })
    logger.info('[WarmCurrent] 航线编辑模式进入')
  }

  // ═══════════════════════════════════════════
  //  星图指针交互
  // ═══════════════════════════════════════════

  private buildingAt(p: { x: number; y: number }): SimBuilding | null {
    const s = this.simState.state
    for (const b of s.buildings) {
      // 入轨建筑按实时位置判定（放置静态落点会随公转漂移）
      const bp = buildingPos(s, b)
      if (dist(p.x, p.y, bp.x, bp.y) <= BUILDING_HIT_R + B.map.hitTolerance) return b
    }
    return null
  }

  /** 近地轨道设施命中（绕锚行星均布公转，实时位置同口径；点中 = 打开轨道建设面板） */
  private orbitBuildingAt(p: { x: number; y: number }): OrbitBuilding | null {
    const s = this.simState.state
    for (const ob of s.orbitBuildings) {
      const op = orbitBuildingPos(s, ob)
      if (dist(p.x, p.y, op.x, op.y) <= 24 + B.map.hitTolerance) return ob
    }
    return null
  }

  /** 功能范围命中（radius>0 建筑的示意范围，半径与赤道环渲染同值=表值 radius 地图px）；
   *  多建筑范围重叠取离核心最近者 */
  private buildingZoneAt(p: { x: number; y: number }): SimBuilding | null {
    const s = this.simState.state
    let best: SimBuilding | null = null
    let bestD = Infinity
    for (const b of s.buildings) {
      const def = buildingDefOf(b.type)
      if (!def || def.radius <= 0) continue
      const bp = buildingPos(s, b)
      const d = dist(p.x, p.y, bp.x, bp.y)
      if (d <= def.radius && d < bestD) { best = b; bestD = d }
    }
    return best
  }

  /** 太阳命中（点击聚焦取景，不参与航线端点/拖拽） */
  /**
   * 当前视图的世界位移（世界坐标 → 地图画布坐标须减去）：
   * 行星系视角 = 舞台位移（stage - 聚焦行星世界位置，与渲染 syncStage/StarActor.syncFrom
   * 同口径——聚焦行星在隔离口径下恒钉在舞台中心，两者恒等）；太阳系全景 = 0
   * （世界原点即地图中心）。PlayerController 指针拾取共用，改口径须两边同步。
   */
  viewStageOffset(): { x: number; z: number } {
    if (this.viewMode !== 'earth') return { x: 0, z: 0 }
    const stage = planetStageOffset(this.planetFocusBody as PlanetId)
    const f = starPosAt(this.simState.state, this.planetFocusBody)
    return { x: stage.x - toWX(f.x), z: stage.z - toWZ(f.y) }
  }

  /** 天体当前视图下是否可点（与渲染 visibleBodySet 同口径：行星系视角 = 聚焦行星 + 其卫星） */
  private starActorPickable(body: SolarBodyId): boolean {
    if (this.viewMode === 'solar') return true
    const focus = this.planetFocusBody as PlanetId
    if (body === focus) return true
    const mc = B.map.moons[body as keyof typeof B.map.moons]
    return !!mc && mc.parent === focus
  }

  /** 太阳命中（点击聚焦取景，不参与航线端点/拖拽）。
   *  ⚠ 判定收口：行星系视角下太阳本体被渲染隐藏（sunMesh.visible=false），
   *  Actor 虽钉在舞台锚（世界原点）但 pickable=false，不可点。 */
  private sunAt(p: { x: number; y: number }): boolean {
    if (!this.starActorPickable('sun')) return false
    const s0 = B.map.nodes.sun
    return dist(p.x, p.y, s0.x, s0.y) <= s0.r + B.map.hitTolerance
  }

  /** 双击判定状态（行星系入口）：最近一次点中的行星 + 时刻 */
  private lastPlanetClick: { body: PlanetId | null; t: number } = { body: null, t: 0 }

  /** 行星本体命中（含未解锁装饰行星；太阳与卫星不参与双击进入行星系）。
   *  ⚠ 判定收口到"真实 Actor 世界位置"（行星系视角下隐藏天体 Actor 已移远景，
   *  看不见 = 点不到；太阳系全景 Actor 全在公转位，渲染在哪就点哪）。 */
  private planetAt(p: { x: number; y: number }): PlanetId | null {
    for (const body of Object.keys(B.map.nodes) as Array<keyof typeof B.map.nodes>) {
      if (body === 'sun') continue
      if (B.map.moons[body as keyof typeof B.map.moons]) continue
      const pos = this.starActorWorldPos(body)
      if (!pos) continue
      if (dist(p.x, p.y, pos.x, pos.y) <= B.map.nodes[body].r + B.map.hitTolerance) return body as PlanetId
    }
    return null
  }

  /** 天体蓝图 Actor 的世界位置 → 星图画布坐标（Actor 不存在 = 蓝图生成失败，按同口径
   *  隔离计算兜底：hiddenActorIsolated → 画布系减舞台位移，与 Actor 主分支同构——
   *  行星系视角下隐藏天体兜底坐标同样远离地图画布 → 命中半径恒不覆盖）。 */
  private starActorWorldPos(body: keyof typeof B.map.nodes): { x: number; y: number } | null {
    const off = this.viewStageOffset()
    const actor = this.starActors.get(body as StarBodyId)
    if (!actor) {
      const iso = hiddenActorIsolated(this.simState.state, body as SolarBodyId, this.viewMode, this.planetFocusBody as PlanetId)
      return { x: iso.x + MAP_W / 2 - off.x, y: iso.z + MAP_H / 2 - off.z }
    }
    const root = actor.root
    return { x: root.position.x + MAP_W / 2 - off.x, y: root.position.z + MAP_H / 2 - off.z }
  }

  private nodeAt(p: { x: number; y: number }): Endpoint | null {
    const s = this.simState.state
    for (const star of Object.values(B.stars)) {
      if (!this.transport.starUnlocked(star.id)) continue
      const pos = this.starActorWorldPos(star.id)
      if (!pos) continue
      if (dist(p.x, p.y, pos.x, pos.y) <= B.map.nodes[star.id].r + B.map.hitTolerance) {
        return { kind: 'star', star: star.id }
      }
    }
    const e = this.starActorWorldPos('earth')
    if (e && dist(p.x, p.y, e.x, e.y) <= B.map.nodes.earth.r + B.map.hitTolerance) return { kind: 'earth' }
    // 可接航线建筑（中转站）= 补给线端点：hover/落点判定走这里；命中半径与 buildingAt 同口径
    for (const b of s.buildings) {
      if (!buildingDefOf(b.type)?.linkable) continue
      const bp = buildingPos(s, b)
      if (dist(p.x, p.y, bp.x, bp.y) <= BUILDING_HIT_R + B.map.hitTolerance) {
        return { kind: 'building', buildingId: b.id }
      }
    }
    return null
  }

  /** 任意天体命中（星球信息面板用：行星 + 卫星，含未解锁资源星；太阳走聚焦取景不进面板）。
   *  与 planetAt 的差异 = 含卫星（planetAt 专供双击进行星系，有意排除卫星），同收口真实 Actor 世界位置。 */
  private bodyAt(p: { x: number; y: number }): SolarBodyId | null {
    for (const body of Object.keys(B.map.nodes) as Array<SolarBodyId>) {
      if (body === 'sun') continue
      if (!this.starActorPickable(body)) continue
      const pos = this.starActorWorldPos(body)
      if (!pos) continue
      if (dist(p.x, p.y, pos.x, pos.y) <= B.map.nodes[body].r + B.map.hitTolerance) return body
    }
    return null
  }

  /** 打开星球信息面板（非航线编辑模式点星球 / 点不可拖天体；再点其它星球切换内容） */
  openPlanetInfo(body: SolarBodyId): void {
    this.planetInfoSel = body
    this.orbitBuildSel = null
    this.shipyardSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
  }

  /** 关闭星球信息面板（面板内 ✕ / 点空地） */
  closePlanetInfo(): void {
    this.planetInfoSel = null
  }

  /** 打开轨道建设面板（星球信息面板「近地轨道建设」按钮 / 点已建成轨道设施） */
  openOrbitBuild(anchor: PlanetBodyId): void {
    this.orbitBuildSel = anchor
    this.planetInfoSel = null
    this.shipyardSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 轨道建设面板：${anchor}`)
  }

  /** 关闭轨道建设面板（面板内 ✕ / 点空地） */
  closeOrbitBuild(): void {
    this.orbitBuildSel = null
  }

  /** 打开船坞造船面板（星图点船坞轨道设施；与轨道建设/星球信息面板互斥） */
  openShipyardPanel(dockId: number): void {
    this.shipyardSel = dockId
    this.planetInfoSel = null
    this.orbitBuildSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 船坞造船面板：dock ${dockId}`)
  }

  /** 关闭船坞造船面板（面板内 ✕ / 点空地） */
  closeShipyardPanel(): void {
    this.shipyardSel = null
  }

  /** 打开建筑详情浮层（点地图建筑：强化分支装拆流；与其它浮层并存不互斥——浮层贴选中建筑） */
  openBuildingDetail(id: number): void {
    this.buildingDetailSel = id
    audioSys.play('wc.draw', { volume: 0.3 })
  }

  /** 关闭建筑详情浮层（面板内 ✕ / 点空地 / 建筑被拆） */
  closeBuildingDetail(): void {
    this.buildingDetailSel = null
  }

  // ─── 耀斑预警框选指挥（玩家设计权扩展） ───

  /** 船命中（画布坐标；冻毁船不可选；命中半径与建筑同量级） */
  shipAt(p: { x: number; y: number }): SimShip | null {
    const s = this.simState.state
    for (const ship of s.ships) {
      if (ship.state === 'frozen') continue
      const pos = shipPos(s, ship)
      if (dist(p.x, p.y, pos.x, pos.y) <= 16 + B.map.hitTolerance) return ship
    }
    return null
  }

  /** 点击增减框选（预警期点船） */
  toggleShipSelection(shipId: number): void {
    const idx = this.selectedShips.indexOf(shipId)
    if (idx >= 0) this.selectedShips.splice(idx, 1)
    else this.selectedShips.push(shipId)
    audioSys.play('wc.draw', { volume: 0.25 })
  }

  /** 框选落点结算：矩形内全部在航船入选（替换式） */
  selectShipsInRect(x0: number, y0: number, x1: number, y1: number): number {
    const s = this.simState.state
    const left = Math.min(x0, x1), right = Math.max(x0, x1)
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1)
    const picked: number[] = []
    for (const ship of s.ships) {
      if (ship.state === 'frozen') continue
      const pos = shipPos(s, ship)
      if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) picked.push(ship.id)
    }
    this.selectedShips = picked
    return picked.length
  }

  clearShipSelection(): void {
    this.selectedShips = []
  }

  /** 对框选船下达耀斑决策（照跑/就近靠站/原地待命；窗口外拒绝） */
  orderSelectedShips(order: ShipOrder): number {
    if (!this.hazards.orderWindowOpen()) {
      this.simState.hint('仅在耀斑预警期可下令（需事件预警卡）')
      return 0
    }
    let ok = 0
    for (const id of [...this.selectedShips]) {
      if (this.hazards.setShipOrder(id, order)) ok++
    }
    if (ok > 0) audioSys.play('wc.ok', { volume: 0.4 })
    return ok
  }

  private routeAt(p: { x: number; y: number }): SimRoute | null {
    for (const route of this.simState.state.routes) {
      const a = endpointPos(this.simState.state, route.from)
      const b = endpointPos(this.simState.state, route.to)
      if (segDist(p, a, b) <= B.map.routeHitDistance) return route
    }
    return null
  }

  onMapPointerDown(p: { x: number; y: number }): void {
    // 建筑模式优先：点击 = 网格吸附落位（成功即退出模式，失败提示后留在模式中可换点）
    if (this.buildMode) {
      const snapped = snapToGrid(p.x, p.y)
      const ok = this.buildings.tryPlace(this.buildMode.typeId, snapped.x, snapped.y)
      if (ok) {
        audioSys.play('wc.build')
        this.cancelBuildMode()
      } else {
        audioSys.play('wc.bad', { volume: 0.5 })
      }
      return
    }
    // 行星观察模式：左键 = 环绕拖拽（相机层消费），星图点击判定冻结；
    // 仅保留双击当前行星 = 退出观察回俯视（toggle 入口）
    if (this.observeBody) {
      const planet = this.planetAt(p)
      const now = performance.now()
      if (planet === this.observeBody && this.lastPlanetClick.body === planet && now - this.lastPlanetClick.t < 350) {
        this.lastPlanetClick = { body: null, t: 0 }
        this.exitPlanetObserve()
      } else {
        this.lastPlanetClick = planet ? { body: planet, t: now } : { body: null, t: 0 }
      }
      return
    }

    // 双击行星 → 进入其行星系（加载遮罩过渡）
    // ⚠ 行星命中优先于太阳（历史教训：旧 AU×250 布局水星轨道 97 < 太阳命中半径 124，先判太阳会整颗吃掉水星；
    //   2026-09-13 内系统重排后为 水星轨道 170 > 太阳命中半径 92，顺序保留作防御，勿改回先判太阳）
    // ⚠ 视图切换不受败局/选卡冻结影响（pendingCard 挂起期间航线交互冻结，但镜头必须可用）
    const planet = this.planetAt(p)
    if (planet) {
      const now = performance.now()
      if (this.lastPlanetClick.body === planet && now - this.lastPlanetClick.t < 350) {
        this.lastPlanetClick = { body: null, t: 0 }
        this.orbitBuildSel = null
        this.enterPlanetSystem(planet)
        audioSys.play('wc.ok', { volume: 0.4 })
        return
      }
      this.lastPlanetClick = { body: planet, t: now }
      // 单击行星：不参与太阳聚焦，继续走建筑/节点/航线判定（行星也可能是资源星节点）
    }
    // 太阳：点击聚焦取景（不参与航线/选择）
    if (this.sunAt(p)) {
      this.focusSolarSystem('sun')
      audioSys.play('wc.ok', { volume: 0.4 })
      return
    }
    const s = this.simState.state
    if (s.outcome === 'defeat' || s.pendingCard) return
    // 耀斑预警期点船：增减框选（船优先于建筑/节点命中——船小且在航线附近移动）
    if (this.hazards.orderWindowOpen()) {
      const hitShip = this.shipAt(p)
      if (hitShip) { this.toggleShipSelection(hitShip.id); return }
    }
    const b = this.buildingAt(p)
    if (b) {
      // 航线编辑模式：可接航线建筑（中转站）优先作为拖线起点，点击选中留给非编辑态
      if (this.routeEditMode && buildingDefOf(b.type)?.linkable) {
        const ep: Endpoint = { kind: 'building', buildingId: b.id }
        const bp = endpointPos(s, ep)
        this.drag = {
          fromEp: ep, fromX: bp.x, fromY: bp.y,
          curX: p.x, curY: p.y, hoverEp: null, valid: false, label: '',
        }
        audioSys.play('wc.draw', { volume: 0.4 })
        return
      }
      this.selection = { type: 'building', id: b.id }
      this.openBuildingDetail(b.id)
      return
    }
    // 近地轨道设施：船坞 → 船坞造船面板（造船入口）；其它类型（含在建）→ 轨道建设面板
    const ob = this.orbitBuildingAt(p)
    if (ob) {
      if (isShipyardType(ob.type)) this.openShipyardPanel(ob.id)
      else this.openOrbitBuild(ob.anchor)
      return
    }
    const node = this.nodeAt(p)
    if (node) {
      // 未进入航线编辑模式：点星球 = 打开星球信息面板（拖线被门槛挡住）
      if (!this.routeEditMode) {
        this.openPlanetInfo(node.kind === 'star' ? node.star : 'earth')
        return
      }
      const pos = endpointPos(s, node)
      this.drag = {
        fromEp: node, fromX: pos.x, fromY: pos.y,
        curX: p.x, curY: p.y, hoverEp: null, valid: false, label: '',
      }
      audioSys.play('wc.draw', { volume: 0.4 })
      return
    }
    const route = this.routeAt(p)
    if (route) { this.selection = { type: 'route', id: route.id }; return }
    // 护盾气泡兜底：点功能示意范围（radius 内切圆）也选中发生器；
    // 排在节点/航线之后，范围罩住天体或航线时不吞拖线/选线交互
    const zone = this.buildingZoneAt(p)
    if (zone) { this.selection = { type: 'building', id: zone.id }; return }
    // 天体兜底（含卫星/未解锁资源星）：非编辑模式点任何星球都开信息面板；
    // 编辑模式下可拖节点已在上面分流，落到这里 = 点了不可拖天体，同样开面板
    const body = this.bodyAt(p)
    if (body) { this.openPlanetInfo(body); return }
    // 空处按下 + 耀斑预警期 = 开始框选手势（与相机右键平移不冲突；落点结算在 pointerUp）
    if (this.hazards.orderWindowOpen()) {
      this.boxDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      return
    }
    this.selection = null
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.shipyardSel = null
    this.buildingDetailSel = null
  }

  onMapPointerMove(p: { x: number; y: number }): void {
    // 框选手势：刷新矩形对角（渲染层画选框，落点结算在 pointerUp）
    if (this.boxDrag) {
      this.boxDrag.x1 = p.x
      this.boxDrag.y1 = p.y
      return
    }
    // 建筑模式：光标位置刷新网格吸附预览（渲染 ghost 消费）
    if (this.buildMode) {
      const snapped = snapToGrid(p.x, p.y)
      const def = buildingDefOf(this.buildMode.typeId)
      const issue = this.buildings.placementIssue(this.buildMode.typeId, snapped.x, snapped.y)
      this.buildCursor = {
        x: snapped.x, y: snapped.y,
        valid: issue === null,
        label: issue ?? (def ? `${def.name} · ${def.cost} H3` : ''),
      }
      return
    }
    const drag = this.drag
    if (!drag) return
    drag.curX = p.x
    drag.curY = p.y
    drag.hoverEp = this.nodeAt(p)
    drag.valid = drag.hoverEp ? this.dragValidity(drag.fromEp, drag.hoverEp) : false
    drag.label = drag.hoverEp ? this.dragLabel(drag.fromEp, drag.hoverEp, drag.valid) : ''
  }

  onMapPointerUp(p: { x: number; y: number }): void {
    // 框选结算：矩形内全部在航船入选（替换式）；无位移 = 空点（清空选择）
    const box = this.boxDrag
    if (box) {
      this.boxDrag = null
      const moved = Math.hypot(p.x - box.x0, p.y - box.y0) > 8
      if (moved) {
        const n = this.selectShipsInRect(box.x0, box.y0, p.x, p.y)
        if (n > 0) audioSys.play('wc.ok', { volume: 0.35 })
      } else {
        this.clearShipSelection()
      }
      return
    }
    const drag = this.drag
    if (!drag) return
    this.drag = null
    const hover = this.nodeAt(p)
    if (!hover) return
    const ok = this.transport.tryCreateRoute(drag.fromEp, hover)
    if (ok) {
      audioSys.play('wc.ok')
      const route = findRoute(this.simState.state, drag.fromEp, hover)
      if (route) this.selection = { type: 'route', id: route.id }
    } else {
      audioSys.play('wc.bad', { volume: 0.5 })
    }
  }

  /** 拖线视觉合法性（权威判定在 transport.tryCreateRoute） */
  private dragValidity(a: Endpoint, b: Endpoint): boolean {
    const s = this.simState.state
    const ka = a.kind, kb = b.kind
    if (ka === kb) return false
    if (s.tutorial) {
      // 引导端点取 core 单一数据源（权威判定在 transport.tryCreateRoute，此处只做视觉镜像）
      const [tutStar, tutPlanet] = TUTORIAL_TARGETS
      const starEp: Endpoint = { kind: 'star', star: tutStar }
      const planetEp: Endpoint = { kind: tutPlanet }
      return (this.epEq(a, starEp) && this.epEq(b, planetEp)) || (this.epEq(a, planetEp) && this.epEq(b, starEp))
    }
    if (ka === 'earth' && kb === 'star') return this.transport.starUnlocked((b as { star: StarId }).star)
    if (ka === 'star' && kb === 'earth') return this.transport.starUnlocked((a as { star: StarId }).star)
    if (ka === 'earth' && kb === 'building') return this.buildingLinkable(b)
    if (ka === 'building' && kb === 'earth') return this.buildingLinkable(a)
    return false
  }

  /** 建筑 endpoint 可接航线（预览镜像；权威判定在 transport.tryCreateRoute） */
  private buildingLinkable(e: Endpoint): boolean {
    const b = buildingByEndpoint(this.simState.state, e)
    return !!b && !!buildingDefOf(b.type)?.linkable
  }

  private epEq(a: Endpoint, b: Endpoint): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  private dragLabel(a: Endpoint, b: Endpoint, valid: boolean): string {
    if (!valid) {
      if (a.kind === b.kind) return a.kind === 'star' ? '星—星航线不合法' : '不合法'
      const starEp = a.kind === 'star' ? a : b.kind === 'star' ? b : null
      if (starEp && starEp.kind === 'star') {
        const def = B.stars[starEp.star]
        return this.transport.starUnlocked(starEp.star) ? '不合法' : `${def.name}第${def.unlockAct}幕解锁`
      }
      return '不合法'
    }
    if (a.kind === 'earth' && b.kind === 'star') return this.forwardLabel(b.star)
    if (a.kind === 'star' && b.kind === 'earth') return this.forwardLabel(a.star)
    // 地↔建筑补给线（建筑端点必有其一）
    const bEp = a.kind === 'building' ? a : b
    const bd = buildingByEndpoint(this.simState.state, bEp)
    if (!bd) return '不合法'
    const def = buildingDefOf(bd.type)
    if (!def?.linkable) return `${def?.name ?? '该建筑'}不能接入航线`
    const left = this.buildings.bufferLeft(bd)
    return `送建材入缓存 · 余量 ${left}/${def.bufferCap}`
  }

  private forwardLabel(star: StarId): string {
    const mods = this.simState.state.mods
    const load = Math.round(starLoad(mods, star))
    const fuel = Math.round(roundFuel(mods, B.stars[star].dist))
    return `单船 ${load}t · 油耗 ${fuel} · 净补 ${load - fuel}`
  }

  // ═══════════════════════════════════════════
  //  时间控制 / 重开
  // ═══════════════════════════════════════════

  togglePause(): void {
    this.paused = !this.paused
  }

  cycleSpeed(): void {
    this.timeScale = this.timeScale === 1 ? 2 : 1
  }

  // ═══════════════════════════════════════════
  //  暂停菜单（pause_menu.widget.json，Esc 呼出）
  // ═══════════════════════════════════════════

  /** Esc 切换暂停菜单 */
  togglePauseMenu(): boolean {
    if (this.pauseMenuPanel) {
      this.closePauseMenu()
      return false
    }
    this.openPauseMenu()
    return true
  }

  /** 打开暂停菜单（动态 spawn；强制暂停仿真，关闭时若非胜负终局恢复运行） */
  openPauseMenu(): void {
    const w = this.world
    if (!w || this.pauseMenuPanel) return
    const panel = w.ui.spawnUIActor(PAUSE_MENU_WIDGET)
    if (!panel) {
      logger.error('[WarmCurrent] 暂停菜单生成失败')
      return
    }
    this.pauseMenuPanel = panel
    this.paused = true
    logger.info('[WarmCurrent] 打开暂停菜单（仿真冻结）')
  }

  /** 关闭暂停菜单（继续按钮 / 再按 Esc / 读档成功后） */
  closePauseMenu(): void {
    if (!this.pauseMenuPanel) return
    this.pauseMenuPanel.destroy()
    this.pauseMenuPanel = null
    // 胜负终局时仿真仍保持冻结（结算弹窗接管）；仅正常暂停时恢复运行
    const s = this.simState.state
    if (s.outcome === 'playing' || s.sandbox) this.paused = false
    logger.info('[WarmCurrent] 关闭暂停菜单')
  }

  restart(): void {
    refreshBalanceFromConfigs()
    this.simState.reset()
    resetMoonPhaseAdj()
    this.moonAngleAtLeave = null
    this.clearObserveState()
    this.selection = null

    this.drag = null
    this.buildMode = null
    this.buildCursor = null
    this.routeEditMode = false
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.shipyardSel = null
    this.buildingDetailSel = null
    this.selectedShips = []
    this.boxDrag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
  }

  /**
   * 从存档恢复仿真状态（GameInstance.loadSlot 调用）。
   * 校验 + 深拷贝 + 按 seed 重放 rng；清理拖拽/选中残留；坏档拒绝并返回 false。
   */
  restoreFromSave(sim: import('../core/types').SimState): { state: import('../core/types').SimState; rng: () => number } | null {
    const pack = restoreSimState(sim)
    if (!pack) return null
    this.simState.state = pack.state
    this.simState.rng = pack.rng
    resetMoonPhaseAdj()
    this.moonAngleAtLeave = null
    this.clearObserveState()
    this.selection = null

    this.drag = null
    this.buildMode = null
    this.buildCursor = null
    this.routeEditMode = false
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.shipyardSel = null
    this.buildingDetailSel = null
    this.selectedShips = []
    this.boxDrag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
    // 恢复后按新档状态决定运行/冻结（与 closePauseMenu 同规则：playing/sandbox 恢复运行，胜负终局保持冻结）
    if (pack.state.outcome === 'playing' || pack.state.sandbox) this.paused = false
    logger.info(`[WarmCurrent] 存档恢复完成（act=${pack.state.act} time=${pack.state.time.toFixed(0)}s）`)
    return pack
  }

  /** 海克斯选卡（脚本按钮回调）：选卡决策完成 → 解除弹卡暂停恢复运行 */
  chooseCardByIndex(i: number): boolean {
    const pend = this.simState.state.pendingCard
    if (!pend) return false
    const ok = this.research.chooseCard(pend.choices[i])
    if (ok) {
      audioSys.play('wc.ok', { volume: 0.8 })
      // 此前未手动暂停的局恢复运行（胜负终局/暂停菜单各自维持原冻结态）
      const s = this.simState.state
      if (s.outcome === 'playing' || s.sandbox) this.paused = false
      logger.info('[WarmCurrent] 海克斯选卡完成，仿真恢复运行')
    }
    return ok
  }

  // ═══════════════════════════════════════════
  //  HUD 视图模型（UI 脚本每帧消费）
  // ═══════════════════════════════════════════

  buildViewModel(): WarmCurrentVM {
    const sc = this.simState
    const s = sc.state
    const fleet = {
      total: s.ships.length,
      idle: sc.idleShips,
      flying: sc.flyingShips,
      frozen: sc.frozenShips.length,
      building: s.buildQueue.length,
      buildRemain: s.buildQueue.length > 0 ? Math.ceil(s.buildQueue[0].remain) : 0,
      maintPerS: fleetMaintPerS(s.ships.length),
      cap: sc.shipCap,
    }
    const ledger = { ...s.ledger, ...ledgerTotals(s.ledger) }
    // pending 折算：弹卡即暂停且不再自动收纳，pendingCard 存在 = 弹窗可见
    const pending = s.pendingCard
      ? {
          lineName: s.research.find((l) => l.id === s.pendingCard!.line)?.name ?? '',
          cards: s.pendingCard.choices
            .map((id) => getCardDef(id))
            .filter((c): c is CardDef => !!c),
        }
      : null
    let routeInfo: HudRouteInfo | null = null
    if (this.selection?.type === 'route') {
      const route = s.routes.find((r) => r.id === this.selection!.id)
      if (route) {
        const star = starOfEndpoint(s, route.from) ?? starOfEndpoint(s, route.to)
        routeInfo = {
          name: route.direction === 'forward' ? `${star ? B.stars[star].name : '?'}线` : '中转站供应线',
          direction: route.direction,
          ships: route.shipIds.length,
          net: routeNetPerTrip(s, route),
          cycle: routeCycleSeconds(s, route),
        }
      }
    }
    let buildingInfo: HudBuildingInfo | null = null
    if (this.selection?.type === 'building') {
      const b = s.buildings.find((x) => x.id === this.selection!.id)
      const def = b ? buildingEffectiveDef(b) : null
      if (b && def) {
        buildingInfo = {
          id: b.id,
          type: b.type,
          name: def.name,
          radius: def.radius,
          cap: def.shipCap,
          stock: Math.floor(b.stock),
          bufferCap: def.bufferCap,
          canDemolish: s.flare.phase !== 'active',
        }
      }
    }
    const demand = sc.demand
    // 建造面板行：building 表顺序（表驱动，加建筑只改表）
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const buildRows: HudBuildRow[] = Object.entries(B.buildings).map(([id, def]) => ({
      id,
      name: def.name,
      desc: def.desc,
      cost: def.cost,
      canPlace: playable && s.earthH3 >= def.cost,
    }))
    // 航线管理面板行：全部航线紧凑视图（正向「月球线」/ 反向「供应线·中转站 N」，命名与运输面板 routeNameOf 同口径）
    const routeNameOf = (route: SimRoute): string => {
      if (route.direction === 'forward') {
        const star = starOfEndpoint(s, route.from)
        return `${star ? B.stars[star].name : '?'}线`
      }
      const b = buildingByEndpoint(s, route.to)
      const def = b ? buildingDefOf(b.type) : null
      return `供应线·${def?.name ?? '中转站'}${b ? ` ${b.id}` : ''}`
    }
    const nameOfRouteId = (routeId: number | null): string => {
      if (routeId === null) return ''
      const r = s.routes.find((x) => x.id === routeId)
      return r ? routeNameOf(r) : ''
    }
    const shipRows: HudShipRow[] = s.ships.slice(0, 10).map((ship) => ({
      id: ship.id,
      // 船型徽标并入行名（玩家设计权：船队可见差异化；模块缩写在航徽之后）
      name: `${ship.name} · ${shipHullDefOf(ship.hull)?.name ?? ship.hull}${ship.modules.length ? `+${ship.modules.length}` : ''}`,
      state: ship.state,
      place: ship.mission ? '火星任务'
        : ship.state === 'idle' ? '基地待命'
        : ship.state === 'frozen' ? '冻毁'
        : ship.state === 'loading' ? `装载中 · ${nameOfRouteId(ship.routeId)}`
        : ship.state === 'unloading' ? `卸载中 · ${nameOfRouteId(ship.routeId)}`
        : `${ship.leg === 'outbound' ? '去程' : '回程'} · ${nameOfRouteId(ship.routeId)}`,
      cargo: Math.round(ship.cargo),
      materials: Math.round(ship.materials),
      canRebuild: ship.state === 'frozen',
    }))
    const routes: HudRouteRow[] = s.routes.map((route) => ({
      id: route.id,
      name: routeNameOf(route),
      direction: route.direction,
      ships: route.shipIds.length,
      net: routeNetPerTrip(s, route),
      cycle: routeCycleSeconds(s, route),
    }))
    // 星球信息面板数据（planetInfoSel 为空 = 收起）
    const planetInfo = this.planetInfoSel ? this.buildPlanetInfo(this.planetInfoSel) : null
    // 轨道建设面板数据（orbitBuildSel 为空 = 收起）
    const orbitBuild = this.orbitBuildSel ? this.buildOrbitBuild(this.orbitBuildSel) : null
    // 船坞造船面板数据（shipyardSel 为空 = 收起；船坞被拆/不存在 → null 收起）
    const shipyard = this.shipyardSel !== null ? this.buildShipyardVM(this.shipyardSel) : null
    // 建筑详情浮层数据（buildingDetailSel 为空/建筑被拆 → null 收起）
    const buildingDetail = this.buildingDetailSel !== null ? this.buildBuildingDetail(this.buildingDetailSel) : null
    // 耀斑预警决策条（预警期 + 框选船非空 = 决策条上屏；canHold = 选中船全部未出发可待命）
    const selShips = this.selectedShips
      .map((id) => s.ships.find((x) => x.id === id))
      .filter((x): x is NonNullable<typeof x> => !!x && x.state !== 'frozen')
    const fleetOrders = {
      windowOpen: this.hazards.orderWindowOpen(),
      selectedCount: selShips.length,
      canHold: selShips.length > 0 && selShips.every((x) => x.state === 'loading'),
    }
    const ringMods = ringModsOf(s)
    const ringPlayable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const ringInstallRows: NonNullable<WarmCurrentVM['ringInstallRows']> = Object.entries(B.ringBuildings).map(([id, def]) => ({
      id,
      name: def.name,
      desc: def.desc,
      cost: def.cost,
      canInstall: ringPlayable && s.earthH3 >= def.cost,
    }))
    return {
      time: s.time,
      act: s.act,
      ringSlots: s.ringSlots,
      ringSlotsTotal: B.ringSlots,
      ringBuildings: s.ringBuildings,
      ringDemolish: s.ringDemolish,
      ringLevel: ringLevelOf(s.ringSlots, s.ringBuildProgress),
      ringMods: {
        burnMult: ringMods.burnMult,
        loadMult: ringMods.loadMult,
        shipCapAdd: ringMods.shipCapAdd,
        buildPumpMult: ringMods.buildPumpMult,
        researchMult: ringMods.researchMult,
        coolTimeMult: ringMods.coolTimeMult,
        warmTimeMult: ringMods.warmTimeMult,
      },
      ringInstallRows,
      coreTemp: s.coreTemp,
      coreState: s.earthH3 > 0 ? 'warming' : 'cooling',
      ring: s.ring,
      reserve: s.earthH3,
      demand,
      researchCost: sc.researchCost,
      netFlow: estimateNetFlow(s, demand),
      danger: s.earthH3 > 0 && demand > 0 && s.earthH3 < demand * B.dangerReserveSeconds,
      windowPhase: s.gravity.phase,
      windowRemain: Math.max(0, Math.ceil(s.gravity.timer)),
      flarePhase: s.flare.phase,
      flareRemain: s.flare.phase === 'active' ? Math.ceil(s.flare.timer) : Math.max(0, Math.ceil(s.flare.nextIn)),
      fleet,
      ledger,
      // 研究行：rate = 该线当前 H3 消耗速率（点数计费；储量耗尽为 0，点数加成同口径失效）
      research: s.research.map((l) => ({
        id: l.id, name: l.name, progress: l.progress, points: l.points,
        rate: s.earthH3 > 0 ? l.points * B.researchPointCostPerS : 0,
      })),
      researchUnspent: sc.unspentResearchPoints,
      // 聚能环建设（独立流）：点数/交点进度/计费/速率（面板 +/− 与进度条消费）
      ringBuildPoints: s.ringBuild.points,
      ringBuildProgress: s.ringBuildProgress,
      ringBuildCost: sc.ringBuildCost,
      ringBuildRate: ringBuildRateOf(s),
      ringBuildMin: B.ringBuild.minPoints,
      pending,
      routeInfo,
      buildingInfo,
      buildRows,
      buildActive: this.buildMode?.typeId ?? null,
      shipRows,
      routes,
      planetInfo,
      orbitBuild,
      shipyard,
      buildingDetail,
      fleetOrders,
      routeEditMode: this.routeEditMode,
      shipRebuildCost: B.shipRebuildCost,
      hasShipyard: !!this.orbitBuildSel && this.orbitBuild.shipyardMults(this.orbitBuildSel) !== null,
      tutorial: s.tutorial,
      paused: this.paused,
      timeScale: this.timeScale,
      moduleState: s.module.state,
      canStartMission: s.act >= 3 && s.module.state === 'available' && sc.idleShips > 0 && s.flare.phase !== 'active',
      outcome: s.outcome,
      sandbox: s.sandbox,
      stats: { delivered: s.stats.delivered, frozen: s.stats.frozenCount, buildings: s.stats.buildingsBuilt, cards: s.stats.cardsTaken },
    }
  }

  /** 星球信息面板数据装配（planetInfoSel → HudPlanetInfo；装饰行星无仿真数据，只给身份与类型） */
  private buildPlanetInfo(body: SolarBodyId): HudPlanetInfo {
    const s = this.simState.state
    const starDef = B.stars[body as StarId] ?? null
    const isEarth = body === 'earth'
    const moonCfg = (B.map.moons as Record<string, { parent: PlanetId } | undefined>)[body]
    const unlocked = isEarth || (!!starDef && this.transport.starUnlocked(starDef.id))
    const linked = s.routes.filter((r) => {
      if (isEarth) return r.from.kind === 'earth' || r.to.kind === 'earth'
      return starDef ? [r.from, r.to].some((e) => e.kind === 'star' && e.star === body) : false
    })
    return {
      body,
      name: starDef?.name ?? PLANET_NAMES[body] ?? body,
      kind: isEarth ? '基地' : starDef ? '资源星' : moonCfg ? '卫星' : '行星',
      unlocked,
      unlockAct: starDef?.unlockAct ?? 0,
      load: unlocked && starDef ? Math.round(starLoad(s.mods, starDef.id)) : 0,
      fuel: starDef ? Math.round(roundFuel(s.mods, starDef.dist)) : 0,
      legS: starDef ? legSeconds(starDef.dist, s.mods.speedMult) : 0,
      routes: linked.length,
      ships: linked.reduce((n, r) => n + r.shipIds.length, 0),
      earthH3: isEarth ? Math.floor(s.earthH3) : 0,
      demand: isEarth ? Math.round(this.simState.demand * 10) / 10 : 0,
      netFlow: isEarth ? Math.round(estimateNetFlow(s, this.simState.demand) * 10) / 10 : 0,
      routable: isEarth || !!starDef,
    }
  }

  /** 轨道建设面板数据装配（orbitBuildSel → HudOrbitBuild；表驱动类型行 + 在册设施行） */
  private buildOrbitBuild(anchor: PlanetBodyId): HudOrbitBuild {
    const s = this.simState.state
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const shipyard = this.orbitBuild.shipyardMults(anchor)
    const rows: HudOrbitBuildRow[] = Object.entries(B.orbitBuildings).map(([id, def]) => {
      const count = s.orbitBuildings.filter((x) => x.type === id && x.anchor === anchor).length
      return {
        id,
        name: def.name,
        desc: def.desc,
        cost: def.cost,
        buildTime: def.buildTime,
        count,
        max: B.orbitBuild.maxPerType,
        canBuild: playable && count < B.orbitBuild.maxPerType && s.earthH3 >= def.cost,
      }
    })
    const buildings: HudOrbitBuildingRow[] = s.orbitBuildings
      .filter((x) => x.anchor === anchor)
      .map((x) => {
        const def = orbitBuildingDefOf(x.type)
        const yard = x.built && isShipyardType(x.type)
        return {
          id: x.id,
          name: def?.name ?? x.type,
          built: x.built,
          progressPct: Math.round(x.progress * 100),
          canBuildShip: !!yard,
          shipCost: yard ? Math.round(B.shipBuildCost * (def?.shipBuildCostMult ?? 1)) : 0,
        }
      })
    return {
      anchor,
      anchorName: PLANET_NAMES[anchor] ?? B.stars[anchor as StarId]?.name ?? anchor,
      rows,
      buildings,
      shipCost: Math.round(B.shipBuildCost * (shipyard?.costMult ?? 1)),
      hasShipyard: shipyard !== null,
    }
  }

  /** 船坞造船面板数据装配（shipyardSel → HudShipyard；船型/模块表行 + 逐船一卡队列 + 船队/上限口径） */
  private buildShipyardVM(dockId: number): HudShipyard | null {
    const s = this.simState.state
    const dock = s.orbitBuildings.find((x) => x.id === dockId)
    if (!dock) return null
    const def = orbitBuildingDefOf(dock.type)
    const yard = dock.built && isShipyardType(dock.type)
    const costMult = def?.shipBuildCostMult ?? 1
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const total = s.ships.length + s.buildQueue.length
    const hulls: HudHullRow[] = Object.entries(B.shipHulls).map(([id, h]) => ({
      id,
      name: h.name,
      desc: h.desc,
      cost: h.cost,
    }))
    const modules: HudModuleRow[] = Object.entries(B.shipModules).map(([id, m]) => ({
      id,
      name: m.name,
      desc: m.desc,
      cost: m.cost,
      allowed: true, // 兼容性随面板选中船型变化（ShipyardPanelScript 按 ship_hull.allowed 本地过滤）
    }))
    return {
      dockId,
      name: def?.name ?? dock.type,
      anchor: dock.anchor,
      anchorName: PLANET_NAMES[dock.anchor] ?? B.stars[dock.anchor as StarId]?.name ?? dock.anchor,
      built: dock.built,
      progressPct: Math.round(dock.progress * 100),
      canBuildShip: yard,
      costMult,
      hulls,
      modules,
      queue: s.buildQueue.map((q, i) => ({
        idx: i,
        remainS: Math.ceil(q.remain),
        totalS: q.total,
        progressPct: Math.round(Math.max(0, Math.min(1, 1 - q.remain / Math.max(0.01, q.total))) * 100),
      })),
      fleetShips: s.ships.length,
      queueCount: s.buildQueue.length,
      cap: this.simState.shipCap,
      canQueue: yard && playable && total < this.simState.shipCap,
    }
  }

  /** 建筑详情浮层数据装配（buildingDetailSel → HudBuildingDetail；强化分支装拆流） */
  private buildBuildingDetail(id: number): HudBuildingDetail | null {
    const s = this.simState.state
    const b = s.buildings.find((x) => x.id === id)
    if (!b) return null
    const def = buildingEffectiveDef(b)
    if (!def) return null
    const base = buildingDefOf(b.type)
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const branches = Object.entries(base?.upgrades ?? {}).map(([uid, u]: [string, BuildingUpgradeDef]) => ({
      id: uid,
      name: u.name,
      desc: u.desc,
      cost: u.cost,
      installed: b.upgrade === uid,
      canInstall: playable && s.earthH3 >= u.cost,
    }))
    const cur = b.upgrade ? (base?.upgrades?.[b.upgrade] ?? null) : null
    return {
      id: b.id,
      type: b.type,
      name: def.name,
      radius: def.radius,
      cap: def.shipCap,
      bufferCap: def.bufferCap,
      stock: Math.floor(b.stock),
      upgrade: b.upgrade && cur ? { id: b.upgrade, name: cur.name, desc: cur.desc } : null,
      branches,
      removeFee: cur ? Math.round(cur.cost * B.upgradeDemolishCostPct) : 0,
      canDemolish: s.flare.phase !== 'active',
    }
  }
}
