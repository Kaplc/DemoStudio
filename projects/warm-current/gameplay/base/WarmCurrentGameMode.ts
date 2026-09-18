/**
 * WarmCurrentGameMode — 游戏规则胶水（hoi4 base/ 架构位）
 *
 * 仿真子系统全部做成 GameMode 上的引擎组件（对齐 SpawnComponent/CameraComponent 惯例）：
 * simState（状态+快照）/ transport（航线飞船）/ economy（焚烧衰减）/ research（研究海克斯）
 * / hazards（引力窗口+耀斑）/ buildings（地图建筑：建造面板选型→星图网格放置）/ acts（三幕）+ sim（总控编排器）。
 * HUD 不在此构建（HUDClass 指向 hud.widget.json，由 gameplay/ui/*.script.ts 消费 buildViewModel）。
 * 指针事件经 WarmCurrentPlayerController 进来后做节点/航线几何命中，转成组件指令；
 * 建筑模式（buildMode）下指针变为放置：网格吸附预览 + 点击落位（Esc 取消，优先于暂停菜单）。
 * 太阳系取景：SolarCameraActor 云台（滚轮缩放；行星系聚焦 = 右键环绕 + 滚轮缩放，
 * 太阳系全景 = 右键/边缘平移）+ 双击天体聚焦观察（行星/卫星）+ sol GM 命令聚焦天体。
 * Esc：togglePauseMenu 呼出/关闭暂停菜单（存档槽 + 继续 + 回主菜单），打开时强制暂停。
 * 海克斯三选一：节点达成弹卡即整体暂停仿真（paused=true），选卡后恢复运行（2026-09-08 拍板）。
 */
import { CameraComponent, GameMode, Instantiate, SphereMeshComponent, audioSys, logger, AtmosphereComponent, LoadingSettle } from '@/engine'
import * as THREE from 'three'
import { starTextureFor, skyTextureUrl } from '../map/starTextures'
import { B, MAP_H, MAP_W, toWX, toWZ, refreshBalanceFromConfigs } from '../core/balance'
import type { BuildingDef, BuildingUpgradeDef, OrbitBuildingDef, RingBuildingDef, ShipHullDef, ShipModuleDef, SolarFocusBody } from '../core/balance'
import type { CardDef } from '../core/balance'
import type { PlanetId, MoonId, PlanetBodyId, ShipOrder } from '../core/types'
import type { SolarBodyId } from '../core/helpers'
import { getCardDef } from '../core/cards'
import { restoreSimState } from '../core/save'
import {
  alignMoonRelativeAngle, buildingByEndpoint, buildingDefOf, buildingEffectiveDef, buildingPos, estimateNetFlow, endpointPos, findRoute, ledgerTotals,
  fleetMaintPerS, hiddenActorIsolated, legSeconds, moonRelativeAngle, orbitBuildingPos, pendingRingNodeCount, placedRingNodes, resetMoonPhaseAdj, ringBuildRateOf, ringLevelOf, ringModsOf, roundFuel, routeCycleSeconds, snapToGrid,
  routeNetPerTrip, shipHullDefOf, shipModuleDefOf, shipPos, starLoad, starOfEndpoint, starPosAt,
  supplyRateOf, starStockOf, starStockCapOf, starMiningRate, shipTrialOf, shipsNeededFor,
  hullSlotCapacity, modulesSlotUsage, hullHasSlotFor, hullAllowsModule, SLOT_ROLE_KEY, SLOT_TYPE_NAMES, shipBuildPrice,
  nextPayloadUid, payloadDesignDefsOf, payloadDesignModuleDef, setDynamicShipModules, shipModuleEntries, isDynamicShipModule,
  TUTORIAL_TARGETS,
} from '../core/helpers'
import type { RingLevelInfo, SimPayloadDesign } from '../core/helpers'
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
import { MiningComponent, mineDefOf, depositDefOf, depositsOf, depositLeft } from '../systems/MiningComponent'
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

/** 天空全景 LoadingSettle 任务序号（多局/重入保证任务 id 唯一，对齐 starTextures 惯例） */
let skySettleSeq = 0

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
  direction: import('../core/types').RouteDirection
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
  /** 行名（正向「月球线」，反向「供应线·木卫二」，中转链「月球→站 3」「站 3→地球」） */
  name: string
  direction: import('../core/types').RouteDirection
  /** 在线配船数 */
  ships: number
  /** 单趟净补（正向/出站 t）/ 单趟载建材（反向）/ 单趟入站（relay_in） */
  net: number
  /** 往返时长（秒，展示用） */
  cycle: number
  /** 线路评级统计（完成趟数/累计装载/累计冻毁；旧档缺省全 0） */
  stats: { trips: number; loaded: number; frozen: number }
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
  /** 是否有已探明矿产（全息勘探入口按钮开关；表驱动） */
  hasDeposits: boolean
  /** 资源星堆场水位（stock/cap 吨 + 满负荷矿建产量 t/s；地球/装饰行星 null） */
  stockyard: { stock: number; cap: number; miningRate: number } | null
}

/** 全息勘探面板矿点行（mineral_deposit 表投影 + 矿建状态） */
export interface HudHoloDepositRow {
  /** 矿点 id（表行键；选中态/定位参数） */
  id: string
  /** 矿种名（mineral_type.name） */
  typeName: string
  /** 矿种表现色（面板色点 + 选中描边） */
  color: string
  /** 总储量（吨） */
  reserve: number
  /** 余量（吨；reserve − Σ已采出，枯竭 0） */
  left: number
  /** 状态文案（未开发 / 建造中 x% / 开采中 · 剩余 N / 已枯竭） */
  status: string
  /** 该矿点矿建类型（mine_building 行键；未开发 null） */
  mineType: string | null
  /** 建造进度 0..1（未开发 0） */
  progress: number
  /** 是否选中（面板行高亮 + 全息标记外环） */
  selected: boolean
}

/** 全息勘探面板建造区行（mine_building 表投影） */
export interface HudHoloBuildRow {
  id: string
  name: string
  desc: string
  cost: number
  buildTime: number
  /** 产出速率展示（吨/秒） */
  yieldPerS: number
  /** 当前可建造（有选中矿点 & 预算足 & 非耀斑 & 无占用 & 矿种匹配 & 对局中） */
  canBuild: boolean
}

/** 全息地球面板内容分类（底部资源/地表建筑/轨道建筑按钮驱动；ring = 环节点工具视图） */
export type HoloTab = 'ring' | 'resources' | 'surface' | 'orbit'

/** 全息地球建造工具行（ring = 环节点落位 / building 表行键 = 地表建筑） */
export interface HudHoloToolRow {
  /** 工具 id（'ring' 或 building 表行键） */
  id: string
  name: string
  desc: string
  /** 选中态（当前放置工具） */
  selected: boolean
  /** 可选用（预算/对局/有待落位节点） */
  canUse: boolean
}

/** 全息地球态（仅 body==='earth' 非空；面板分类 + 节点统计 + 建造工具行 + 轨道建筑行 + ghost 提示） */
export interface HudHoloEarth {
  /** 面板内容分类（底部资源/地表建筑/轨道建筑/环节点按钮选中态，HologramPanelScript 按此切换内容组） */
  tab: HoloTab
  /** 待落位节点数（已交付槽位未落位） */
  pendingNodes: number
  /** 已落位节点数 */
  placedNodes: number
  /** 已建成环段数（节点来源） */
  builtSlots: number
  /** 单节点融冰角半径（度） */
  meltRadiusDeg: number
  /** 建造工具行（ring + building 表键序） */
  tools: HudHoloToolRow[]
  /** 轨道建筑类型行（orbit_build 表投影，anchor=earth；轨道分类内容组，2026-09-18 底部分类改版） */
  orbitRows: HudOrbitBuildRow[]
  /** 轨道分类船坞引导行（船坞就绪口径与轨道建设面板 FleetText 同源） */
  orbitIntro: string
  /** 是否有激活的放置工具 */
  toolActive: boolean
  /** 指针落点校验文案（ghost；空 = 指针不在球面/无工具） */
  ghostLabel: string
}

/** 全息勘探面板数据（null = 收起；HologramPanelScript 消费） */
export interface HudHologram {
  /** 勘探目标天体 id */
  body: string
  /** 天体名（面板标题「全息勘探 · 月球」） */
  bodyName: string
  /** 矿点行（mineral_deposit 表序过滤本天体） */
  deposits: HudHoloDepositRow[]
  /** 建造区行（mine_building 表键序） */
  buildRows: HudHoloBuildRow[]
  /** 当前选中矿点 id（null = 未选中） */
  selectedId: string | null
  /** 选中矿点详情（多行文案；未选中给操作引导） */
  detail: string
  /** 该天体堆场水位（null = 非资源星/地球；头部行展示「堆场 X/Y t · 产量 Z/s」） */
  stockyard: { stock: number; cap: number; miningRate: number } | null
  /** 全息地球态（仅 body==='earth'；节点统计 + 建造工具行） */
  earth: HudHoloEarth | null
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

/** 空间站舱段面板模块行（station_module 表投影；2026-09-16 空间站模块） */
export interface HudStationModuleRow {
  id: string
  name: string
  desc: string
  /** 安装造价（H3；已装行展示「已装入」） */
  cost: number
  /** 本站已装该舱段 */
  installed: boolean
  /** 可点击（未装且预算足；已装行 = 可卸下恒可点） */
  canToggle: boolean
}

/** 空间站舱段面板数据（null = 收起；StationPanelScript 消费） */
export interface HudStation {
  /** 空间站设施 id（OrbitBuilding.id） */
  id: number
  /** 站名 + 编号（标题「空间站 1」） */
  name: string
  /** 锚定天体名（副标题「月球轨道」） */
  anchorName: string
  built: boolean
  /** 建造中百分比（0~100） */
  progressPct: number
  /** 当前布局舱段数 / 池容量 */
  moduleCount: number
  /** 舱段模块池（station_module 表键序） */
  modules: HudStationModuleRow[]
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
  /** 槽位类型（ship_hull.slots 行键；null = 不占槽） */
  slotType: string | null
  /** 当前选择下该槽型是否已满（满槽 = 置灰不可再选） */
  slotFull: boolean
  /** 槽位占用展示（「货舱 1/2」；null = 不占槽） */
  slotLabel: string | null
  /** 设计工坊部位选件制：该件是否装在当前选中部位实例上（勾选态；缺省 = 非部位清单行） */
  here?: boolean
}

/** 荷载设计模板行（payloadDesigns 投影；2026-09-13 荷载设计工坊） */
export interface HudPayloadRow {
  idx: number
  /** 合成件 id（uid，如 pd1） */
  uid: string
  name: string
  /** 合成描述（主体 + 附件顿号串） */
  summary: string
  /** 合成造价（含组装溢价） */
  cost: number
}

/** 荷载设计工坊面板数据（null = 收起；PayloadDesignScript 消费。
 *  编辑区选主体/勾附件 → 合成预览（效果/造价）→ 存为荷载模板；
 *  模板在火箭设计工坊的「荷载」槽位部位清单里可选装） */
export interface HudPayloadDesign {
  /** 部位页签（payload/fuel/engine 固定三页；2026-09-14 三部位工坊） */
  tabs: Array<{ type: string; name: string }>
  /** 当前页签（payload/fuel/engine） */
  selTab: string
  /** 当前页主体行（按部位角色过滤 payloadRole/fuelRole/engineRole='chassis'，表序） */
  chassis: HudModuleRow[]
  /** 改装件池行（attachment 行，跨部位通用，表序；勾选多选） */
  attachments: HudModuleRow[]
  /** 编辑区当前选中主体 id */
  selChassis: string
  /** 编辑区当前勾选的附件 id 清单 */
  selAttachments: string[]
  /** 合成预览：名称 / 效果描述 / 造价（含组装溢价） */
  synthName: string
  synthDesc: string
  synthCost: number
  /** 已存荷载设计模板（payloadDesigns 键序） */
  designs: HudPayloadRow[]
  canSave: boolean
}

/** 试航行（船坞面板试航卡：船级配置 × 目标星一条往返账；2026-09-13 船队设计工坊） */export interface HudTrialRow {
  star: string
  starName: string
  /** 是否已解锁（未解锁仅展示第 X 幕） */
  unlocked: boolean
  unlockAct: number
  /** 单船满载（吨） */
  load: number
  /** 往返轮时（秒） */
  cycleS: number
  /** 往返油耗（吨） */
  fuel: number
  /** 单趟净赚（吨） */
  net: number
  /** 单线吞吐率（吨/秒） */
  throughput: number
  /** 线路反推：补当前供应缺口需几艘（0 = 缺口已满足；未解锁 = -1） */
  shipsForGap: number
}

/** 船型设计模板行（shipDesigns 投影；2026-09-13 船队设计工坊） */
export interface HudDesignRow {
  idx: number
  name: string
  hullName: string
  /** 模块名顿号串（空 = 裸船） */
  modules: string
}

/** 装配台槽位格（火箭设计面板；ship_hull.slots 表序展开，每格 = 槽型 + 已装模块） */
export interface HudDesignSlotCell {
  type: string
  typeName: string
  /** 同槽型实例序（0 起；点部位选件 = (type, slotIdx) 二元定位） */
  slotIdx: number
  /** 已装模块名（空 = 空槽） */
  module: string
  filled: boolean
  /** 是否为当前选中部位（高亮） */
  sel: boolean
}

/**
 * 装配台堆叠行（2026-09-17 堆叠式装配台：《缺氧》火箭编辑器形态——
 * 垂直箭体+部位实例行，每部位尾随一行加号，点击加号装新件，玩家自由组合） */
export interface HudStackRow {
  /** 行定位键：'__hull__' | '__add__<type>' | '<type>#<idx>' */
  rowId: string
  /** hull = 箭体行（点击无效）；module = 已装/空实例行；add = 加号行 */
  kind: 'hull' | 'module' | 'add'
  /** 所属部位（hull 行 = ''） */
  type: string
  typeName: string
  /** 同槽型实例序（module/add 行有效） */
  idx: number
  /** 已装模块名（hull 行 = 船型名；空行/加号行 = ''） */
  moduleName: string
  filled: boolean
  /** 当前选中部位（module 行） */
  sel: boolean
  /** 加号行可点（空实例存在 = 未满）；满槽 = false 占位 */
  addable: boolean
  /** 实例行可快捷移除（已装件） */
  removable: boolean
  /** 引导短句（加号行/空行提示；其余 = ''） */
  hint: string
}

/** 装配台「+ 加号」部位选择小面板（2026-09-17 三轮口径：点 + → 用户选部位，不默认荷载） */
export interface HudShipAddMenu {
  /** 面板开合（GameMode.shipyardAddMenuOpen 投影） */
  open: boolean
  /** 部位选项（船型槽型表键序：荷载/燃料/引擎；empty = 该部位无空位则置灰） */
  parts: Array<{ type: string; name: string; empty: boolean }>
}

/** 可下单船坞行（火箭设计面板下水区；canOrder = 建成 + 对局中 + cap 余量） */
export interface HudDesignDock {
  id: number
  name: string
  anchorName: string
  costMult: number
  canOrder: boolean
}

/** 火箭设计面板数据（null = 收起；ShipDesignScript 消费。
 *  设计字段与 HudShipyard 同源（同一选择态/校验口径），下单走 orderFromDesign(dockId)） */
export interface HudShipDesign {
  /** 船型行（ship_hull 表键序） */
  hulls: HudHullRow[]
  /** 当前选中部位（null = 未选：② 区出引导文案不出清单） */
  selSlot: { type: string; typeName: string; idx: number; used: number; cap: number } | null
  /** 选中部位的部件清单（ship_module 同 slotType 行，表序 = 低档在前；here = 已装本实例） */
  slotOptions: HudModuleRow[]
  /** 装配台槽位格（slots 表序展开） */
  slotCells: HudDesignSlotCell[]
  /** 装配台堆叠行（2026-09-17 堆叠式：箭体行 + 部位实例行 + 尾随加号行，缺氧火箭编辑器形态） */
  stackRows: HudStackRow[]
  /** 「+ 加号」部位选择小面板（2026-09-17 三轮口径：点 + → 选荷载/燃料/引擎；open=false 收起） */
  addMenu: HudShipAddMenu
  /** 槽位占用行（「货舱 1/2」） */
  slotRows: Array<{ name: string; used: number; cap: number }>
  /** 试航行（三星口径 + 线路反推） */
  trials: HudTrialRow[]
  /** 设计模板 */
  designs: HudDesignRow[]
  canSaveDesign: boolean
  /** 可下单船坞（建成船坞；空 = 只能设计不能下水） */
  docks: HudDesignDock[]
  /** 整单价（船体+Σ模块 × 首坞折扣；无坞原价） */
  price: number
  fleetShips: number
  queueCount: number
  cap: number
  /** 有可下单船坞 */
  canQueue: boolean
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
  /** 当前选中部位（部位选件制；null = 未选：② 区出引导文案不出清单） */
  selSlot: { type: string; typeName: string; idx: number; used: number; cap: number } | null
  /** 选中部位的部件清单（ship_module 同 slotType 行，表序 = 低档在前；here = 已装本实例） */
  slotOptions: HudModuleRow[]
  /** 装配台槽位格（slots 表序展开，与设计面板同源） */
  slotCells: HudDesignSlotCell[]
  /** 装配台堆叠行（2026-09-17 堆叠式，与设计面板同源投影） */
  stackRows: HudStackRow[]
  /** 「+ 加号」部位选择小面板（与设计面板同源投影） */
  addMenu: HudShipAddMenu
  /** 当前船型槽位占用行（slots 表键序；「货舱 1/2」展示口径） */
  slotRows: Array<{ name: string; used: number; cap: number }>
  /** 试航行（三星口径；未解锁星标幕数） */
  trials: HudTrialRow[]
  /** 船型设计模板（保存/载入/删除） */
  designs: HudDesignRow[]
  /** 当前选择是否为有效可存配置（有船型即可存） */
  canSaveDesign: boolean
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
  ringMods: { burnMult: number; loadMult: number; miningMult: number; shipCapAdd: number; buildPumpMult: number; researchMult: number; coolTimeMult: number; warmTimeMult: number }
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
  /** 当前满负荷到手供应速率（吨/秒，Σ各正向/出站线吞吐；收支与稳供口径） */
  supplyRate: number
  /** 预计断环倒计时（秒 = 储量 ÷ 净流出速率；净流为正 = null） */
  reserveSeconds: number | null
  /** 「稳定供应」幕目标进度（秒；goal/reward 见 B） */
  supplyStreak: number
  supplyGoal: number
  supplyReward: number
  /** 星球堆场水位（星图水位条/面板消费：键 = 资源星 id） */
  starStocks: Record<string, { stock: number; cap: number; miningRate: number }>
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
  /** 全息勘探面板数据（null = 收起；HologramPanelScript 消费，星球信息面板「全息勘探」打开） */
  hologram: HudHologram | null
  /** 轨道建设面板数据（null = 收起；OrbitPanelScript 消费） */
  orbitBuild: HudOrbitBuild | null
  /** 船坞造船面板数据（null = 收起；ShipyardPanelScript 消费，点船坞打开） */
  shipyard: HudShipyard | null
  /** 空间站舱段面板数据（null = 收起；StationPanelScript 消费，点空间站打开；2026-09-16 空间站模块） */
  station: HudStation | null
  /** 火箭设计面板数据（null = 收起；ShipDesignScript 消费，底部 HUD「火箭设计」打开） */
  shipDesign: HudShipDesign | null
  /** 荷载设计工坊面板数据（null = 收起；2026-09-13 荷载设计） */
  payloadDesign: HudPayloadDesign | null
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
  /** 矿产开发（全息勘探 → 矿点造矿建 → 持续产出 H3） */
  readonly mining: MiningComponent = this.addComponent(MiningComponent)
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
  /** 全息勘探目标天体（星球信息面板「全息勘探」打开；null = 收起。与观察模式互斥同款相机语义） */
  hologramSel: PlanetBodyId | null = null
  /** 全息勘探当前选中矿点（mineral_deposit 行键；点 3D 矿点/面板行设置，null = 未选中） */
  holoDepositSel: string | null = null
  /** 全息地球放置工具（null = 未选；ring = 落位环节点，building = 放置地表建筑） */
  holoPlaceTool: { kind: 'ring' } | { kind: 'building'; typeId: string } | null = null
  /** 全息地球面板内容分类（底部资源/地表建筑/轨道建筑按钮；开全息重置为 resources，2026-09-18 改版） */
  holoTab: HoloTab = 'resources'
  /** 全息地球放置预览（指针球面交点 + 校验结果；渲染 ghost 与面板提示消费，null = 无工具/未悬停） */
  holoGhost: { lat: number; lon: number; valid: boolean; label: string } | null = null
  /** 全息地球当前工具种类（渲染 ghost 预览圈半径口径；MapViewProvider 消费） */
  get holoToolKind(): 'ring' | 'building' | null {
    return this.holoPlaceTool?.kind ?? null
  }
  /** 卫星全息跟随：上一帧卫星 Actor 世界位（pan 增量 = 公转漂移补偿） */
  private holoLastTarget: { x: number; z: number } | null = null
  /** 船坞造船面板当前承接船坞 id（点船坞打开；null = 收起，ShipyardPanelScript 消费） */
  shipyardSel: number | null = null
  /** 空间站舱段面板当前空间站 id（2026-09-16 空间站模块：点空间站打开；null = 收起，StationPanelScript 消费） */
  stationSel: number | null = null
  /** 船坞面板三步流选择（2026-09-13 从面板脚本迁入 GameMode：试航卡/槽位校验需要权威读态） */
  shipyardSelHull = 'standard'
  shipyardSelModules: string[] = []
  /** 设计工坊当前选中的装配台部位（槽型 + 同型实例序；null = 未选，② 区不出部件清单。
   *  2026-09-13 部位选件制：点部位 → 该槽型多档部件挑选，换装/卸下都以实例为单位） */
  shipyardSelSlot: { type: string; idx: number } | null = null
  /** 装配台「+ 加号」部位选择小面板（2026-09-17 三轮口径：点 + → 用户选荷载/燃料/引擎；false = 收起） */
  shipyardAddMenuOpen = false
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

  /** 行星观察模式当前观察的天体（null = 未在观察；行星系内双击聚焦进入，Esc 退出。
   *  2026-09-15 聚焦环绕改版：卫星（月球）也可双击聚焦观察，类型放宽到 MoonId） */
  observeBody: PlanetId | MoonId | null = null
  /** 卫星观察逐帧跟随的上一帧位置（null = 无跟随； observeBody 为卫星时每帧把注视点
   *  rig.target.x/z 拉向卫星实时位（原地转头，相机不动），跟随卫星公转漂移） */
  private observeFollowLast: { x: number; z: number } | null = null


  /** 事件 toast 队列（HudScript 每帧消费渲染） */
  toasts: Array<{ text: string; color: string; age: number }> = []

  /** 暂停菜单面板（Esc 动态 spawn 的 UI Actor；null = 关闭） */
  pauseMenuPanel: import('@/engine').Actor | null = null

  /** HUD widget 资产（PC.ClientSetHUD 链自动创建，脚本挂根节点） */
  override HUDClass = HUD_WIDGET

  constructor() {
    super()
    // 太阳系云台相机（3D 标准）：fov 50，缩放边界随视图模式切换（applyViewMode：拉远上限地球系 5200 / 太阳系 12000，
    // 拉近下限 = 聚焦天体半径 ×1.15 动态贴合——相机可一路滚到近乎贴着星球表面）
    // 相机 Actor 构造但不托管：由 BeginPlay 的 spawnActor 交给 World（hoi4 同款）
    this.cameraActor = new SolarCameraActor(MAP_W, MAP_H)
    this.gameCamera = this.cameraActor.cameraComponent
    // （2026-09-15 三版）平滑聚焦补间已退役：聚焦=只切瞄准点，镜头交给玩家滚轮，
    // 不再挂 onManualCameraInput → cancelFlyTo 钩子
  }

  override InitGame(): void {
    // 配置表覆盖默认值 + 重置仿真状态（改表重开一局即生效）
    refreshBalanceFromConfigs()
    this.simState.reset()
    this.syncDynamicPayloadModules()
    super.InitGame()
    this.cameraManager.RegisterCamera(this.gameCamera)
    this.cameraActor.place()
    // 开局即地球系取景：只看地月小星系（2026-09-14 视角锁定地球系，太阳系/其它行星系切换入口已全部移除）
    this.focusSolarSystem('earth')
    // 银河全景天空（SSS equirect → scene.background）：异步解码不阻塞取景，失败走纯黑兜底
    this.applySkyTexture()
    logger.info('[WarmCurrent] 开局取景：地球系（地月小星系）')
  }

  /**
   * 星空全景天空装配（SSS 银河全景 equirect → scene.background 天空盒渲染）：
   * Image 异步解码后经 SceneComponent.setBackgroundTexture 上屏（引擎统一设置
   * mapping/colorSpace）。加载失败静默保持纯黑背景（2026-09-07 拍板的兜底口径；
   * 2026-09-14 起为唯一兜底——程序化星空瓦片已整体移除）。登记 LoadingSettle
   * 供 loading 面板等待（对齐 Earth 海洋粗糙度贴图惯例；id 带序号防重入提前 settle）。
   * 无 DOM 环境（单测）直接返回。
   */
  /** 当前装配的天空背景纹理（替换/EndPlay 时 dispose，防同 World 多局累积泄漏） */
  private skyTex: THREE.Texture | null = null

  private applySkyTexture(): void {
    const url = skyTextureUrl()
    if (!url || typeof Image === 'undefined') return
    const world = this.world
    if (!world) {
      logger.warn('[WarmCurrent] 银河全景天空跳过：InitGame 阶段 World 未就绪')
      return
    }
    const finishSettle = LoadingSettle.task('scene-enter', `warm-sky-panorama#${++skySettleSeq}`)
    const img = new Image()
    img.onload = () => {
      try {
        // 旧天空纹理（上一局装配的）先行释放，再挂新纹理
        this.skyTex?.dispose()
        const tex = new THREE.Texture(img)
        tex.needsUpdate = true
        this.skyTex = tex
        world.sceneComp.setBackgroundTexture(tex)
        logger.info('[WarmCurrent] 银河全景天空装配完成（SSS equirect → scene.background）')
      } catch (err) {
        logger.warn(`[WarmCurrent] 银河全景天空装配失败（保持纯黑兜底）: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        finishSettle()
      }
    }
    img.onerror = () => {
      logger.warn('[WarmCurrent] 银河全景贴图加载失败，保持纯黑兜底')
      finishSettle()
    }
    img.src = url
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
      // 全息勘探模式：Esc 先清放置工具，再退全息回俯视（不误开暂停菜单）
      if (this.hologramSel) {
        if (this.holoPlaceTool) {
          this.setHoloTool(null)
          return
        }
        this.closeHologram()
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
    // 卫星全息跟随：rig.pan 同步平移 target+camera（保持环绕几何），镜头锚住公转中的卫星。
    // 全息地球不参与（行星钉在舞台中心静态，2026-09-15 起原地包络，无需 pan 跟随）
    if (this.hologramSel && this.hologramSel !== 'earth') {
      const holoActor = this.starActors.get(this.hologramSel)
      if (holoActor) {
        const p = holoActor.root.position
        if (this.holoLastTarget) {
          this.cameraActor.rig.pan(p.x - this.holoLastTarget.x, p.z - this.holoLastTarget.z)
        }
        this.holoLastTarget = { x: p.x, z: p.z }
      }
    }
    // 卫星观察跟随（2026-09-15 五版·原地转头口径）：双击聚焦卫星后逐帧把注视点
    // rig.target 拉向卫星实时位（lookAt 随之摆动，相机位置不动——位置归玩家），
    // 与全息卫星跟随（pan 口径，保持环绕几何）刻意不同。观察行星不参与
    // （舞台钉扎静态，注视点恒在舞台中心）。
    if (this.observeBody) {
      const mc = B.map.moons[this.observeBody as keyof typeof B.map.moons]
      const actor = mc ? this.starActors.get(this.observeBody as StarBodyId) : undefined
      if (actor) {
        const p = actor.root.position
        // 滑移进行中不写 target：aimAt 锚点闭包每帧取卫星实时位，滑移自身跟踪公转（双重移动会打架）
        if (this.observeFollowLast && !this.cameraActor.isAiming()) {
          this.cameraActor.rig.target.set(p.x, this.cameraActor.rig.target.y, p.z)
          this.cameraActor.SyncCameraLook()
        }
        this.observeFollowLast = { x: p.x, z: p.z }
      }
    }
    // rig.target 已由取景（observeFocus）一次性定到舞台中心（舞台静态：行星钉死），这里禁止逐帧复位：
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
          this.toast(`第 ${ev.value ?? 0} 环段交付（毛坯空槽）— 全息地球可落位环节点 / 环面板可装建筑`, '#7fdcff')
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
        case 'mine_built':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`「${ev.text ?? '矿建'}」建成投产 —— 矿产直采入地球储备`, '#7fdcff')
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

  /** 地球系视图拉远上限（距离）：独立小星系取景（月球轨道 1200：全景 5200 全入画留边）。
   *  拉近下限不设静态值：applyViewMode 按聚焦天体半径动态贴合（applyZoomFloor ×1.15）。 */
  private static readonly EARTH_VIEW_MAX_DIST = 5200

  /** 聚焦指定天体（内部机制保留供 e2e/开发直调；玩家入口已于 2026-09-14 全部屏蔽）：
   *  太阳 = 太阳系全景；行星 = 进入其行星系（跟随取景）。机位数学在 SolarCameraActor.observeFocus（恒斜视角）。 */
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
    // 恒斜视角取景（2026-09-14 移除垂直俯视）：地球 3200 斜视地月系，太阳 1000 斜视内系统
    this.cameraActor.observeFocus(off.x, off.z, d)
    // 相机交互语义随视图收敛（2026-09-15 聚焦环绕改版）：行星系聚焦 = 环绕，太阳系全景 = 自由平移
    this.applyFocusCameraMode(toSolar)
    logger.info(`[WarmCurrent] 太阳系取景 → ${body} (dist=${d}, mode=${this.viewMode}，斜视角)`)
  }

  /** 行星系聚焦默认相机交互语义（2026-09-15 聚焦环绕改版）：
   *  行星系聚焦态（body ≠ sun）：右键拖拽 = 绕聚焦天体环绕（orbitMode），滚轮缩放不变；
   *  屏蔽空间自由平移——右键平移被环绕取代，边缘平移关闭（防拖走注视点破坏聚焦）；
   *  左键环绕关闭（leftOrbitEnabled=false），左键留给地图交互（耀斑框选/拖线仍可用）。
   *  太阳系全景：保持历史自由平移（右键平移 + 边缘平移；玩家入口已屏蔽，仅内部/e2e 可达）。
   *  观察态（enterPlanetObserve/enterMoonObserve/openHologram）在取景后自行开左键环绕。 */
  private applyFocusCameraMode(solar: boolean): void {
    const rig = this.cameraActor.rig
    rig.orbitMode = !solar
    rig.leftOrbitEnabled = false
    rig.setEdgePanEnabled(solar)
    logger.info(`[WarmCurrent] 聚焦相机语义：${solar ? '太阳系全景（右键/边缘自由平移）' : '行星系聚焦环绕（右键环绕 · 滚轮缩放 · 边缘平移关 · 左键留地图交互）'}`)
  }

  /** 清观察态（不做取景复位）：observeBody 归零 + 相机交互回落视图默认语义
   *  （applyFocusCameraMode：行星系 = 聚焦环绕，太阳系 = 自由平移）+ 复位特写增益。
   *  全息勘探/卫星观察同语义互斥收口（hologramSel 归零共用）。
   *  取景切换 / 重开 / 读档三条退出路径共用，保证清理不漏。 */
  private clearObserveState(): void {
    if (!this.observeBody && !this.hologramSel) return
    this.observeBody = null
    this.hologramSel = null
    this.pendingObserveClick = null
    this.holoDepositSel = null
    this.holoPlaceTool = null
    this.holoGhost = null
    this.holoLastTarget = null
    this.observeFollowLast = null
    this.applyFocusCameraMode(this.viewMode === 'solar')
    this.resetObserveBoost()
  }


  /** 缩放下限贴球心（2026-09-15 贴地缩放）：min 距离 = 天体显示半径 × 1.15。
   *  注视点抬到球心高度（StarActor 球心 y = r×0.55）后，任意环绕俯仰角相机到球面
   *  都保有 ≥15% 半径余量——滚轮可一路贴近星球表面而不穿入球体。下限 24 防小微天体过近。 */
  private applyZoomFloor(bodyR: number): void {
    this.cameraActor.rig.minDistance = Math.max(24, bodyR * 1.15)
  }

  /** 视图模式 → 相机缩放边界（视图隔离：地球系锁死地月尺度，滚轮拉远也只见地月；
   *  拉近下限 = 聚焦天体半径动态贴合，贴地特写） */
  private applyViewMode(): void {
    const solar = this.viewMode === 'solar'
    const rig = this.cameraActor.rig
    const focusR = solar ? B.map.nodes.sun.r : B.map.nodes[this.planetFocusBody as PlanetId].r
    this.applyZoomFloor(focusR)
    rig.maxDistance = solar ? 12000 : WarmCurrentGameMode.EARTH_VIEW_MAX_DIST
    // 星图渲染分组同步切换（其它行星/轨道/太阳光晕显隐）
    this.starMap?.setViewMode(this.viewMode)
    logger.info(`[WarmCurrent] 视图隔离：${solar ? `太阳系全景（缩放 ${this.cameraActor.rig.minDistance.toFixed(0)}~12000）` : `地球系小星系（缩放 ${this.cameraActor.rig.minDistance.toFixed(0)}~${WarmCurrentGameMode.EARTH_VIEW_MAX_DIST}，只见地月）`}`)
  }

  // ─── 滚轮聚焦吸附（2026-09-15：拉近滚动时光标附近有天体 → 聚焦切换到该天体） ───

  /** 滚轮聚焦吸附：拉近滚动（delta < 0）时吸附聚焦——以光标为圆心画 focusSnapTolerance 圈，
   *  圈内离光标最近的本系天体为聚焦目标；圈外无命中且未观察态全屏兜底聚焦本系天体。
   *  （复用双击聚焦入口 enterPlanetObserve/enterMoonObserve：环绕语义 + 公转跟随 + 缩放下限贴合一体生效）。
   *  （2026-09-15 四版）聚焦只换"看向"不换"看多远"：镜头 lerp 滑向目标（距离/姿态保持），
   *  不自动取景；已聚焦该天体时不重复吸附。
   *  只在本行星系视角生效（跨系聚焦已被视角锁定屏蔽）；建筑落位/拖线/全息中滚轮只缩放不切换。 */
  tryScrollFocusAt(screenX: number, screenY: number): void {
    if (this.viewMode !== 'earth' || this.viewSwitching) return
    if (this.buildMode || this.routeEditMode || this.hologramSel) return
    const body = this.bodyNearScreen(screenX, screenY)
      ?? (this.observeBody ? null : this.planetFocusBody as StarBodyId)
    if (!body || body === this.observeBody) return
    logger.info(`[WarmCurrent] 滚轮聚焦吸附（镜头看向不跳变） → ${PLANET_NAMES[body] ?? body}（光标 ${screenX.toFixed(0)},${screenY.toFixed(0)}）`)
    if (body === this.planetFocusBody) this.enterPlanetObserve(body as PlanetId)
    else this.enterMoonObserve(body as MoonId)
  }

  /** 光标附近天体拾取（屏幕空间·固定像素圈口径）：以光标为圆心画 focusSnapTolerance（固定 px）圈，
   *  本系成员（聚焦行星 + 其卫星）中"被圈碰到"的天体里取离光标最近者；圈外无命中返回 null
   *  （tryScrollFocusAt 走全屏兜底）。命中 = 光标距投影中心 ≤ tol（圈盖住中心）
   *  或光标落在本体投影圆盘内（≤ screenR，大天体盘内任意点可拾）；二者取像素距离近者胜。
   *  判定范围与缩放无关：tol 是固定像素，不随天体投影半径/镜头远近膨胀（2026-09-15 五版，用户口径）。
   *  屏幕半径用球心 + 相机右轴偏移 r 的差分投影求取（免推 fov/距离换算，任意焦距精确）。 */
  private bodyNearScreen(screenX: number, screenY: number): StarBodyId | null {
    const el = this.world?.gameRenderer?.uiLayer
    const cam = this.gameCamera.camera
    if (!el || !cam) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const focus = this.planetFocusBody as PlanetId
    const members: StarBodyId[] = [focus]
    for (const [id, mc] of Object.entries(B.map.moons)) {
      if (mc.parent === focus) members.push(id as MoonId)
    }
    cam.updateMatrixWorld()
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const v = new THREE.Vector3()
    const tol = B.map.focusSnapTolerance
    let best: StarBodyId | null = null
    let bestDist = Infinity
    for (const id of members) {
      const actor = this.starActors.get(id)
      if (!actor) continue
      v.copy(actor.root.position).project(cam)
      // NDC z 出 [-1,1] = 球心在相机前/后界之外（背面/被裁剪），像素坐标不可信
      if (v.z < -1 || v.z > 1) continue
      const cx = rect.left + ((v.x + 1) / 2) * rect.width
      const cy = rect.top + ((1 - v.y) / 2) * rect.height
      const ex = v.copy(actor.root.position).addScaledVector(right, B.map.nodes[id].r).project(cam)
      const px = rect.left + ((ex.x + 1) / 2) * rect.width
      const py = rect.top + ((1 - ex.y) / 2) * rect.height
      const screenR = Math.hypot(px - cx, py - cy)
      const d = Math.hypot(screenX - cx, screenY - cy)
      // 固定像素圈：中心入圈（d ≤ tol）或光标在本体盘内（d ≤ screenR）；不做盘缘外扩
      if (d <= tol || d <= screenR) {
        const score = Math.min(d, screenR)
        if (score < bestDist) {
          bestDist = score
          best = id
        }
      }
    }
    return best
  }

  /** 视角切换（历史 ViewToggle widget 按钮路径；2026-09-14 起 widget 已下架，仅存作兼容入口）：
   *  solar = 已屏蔽（视角锁定地球系）；earth = 回地球系默认取景。
   *  ⚠ 按钮路径绕过 enterPlanetSystem 的观察 toggle：已在地球系 = 复位默认斜视取景，不进观察 */
  setViewMode(mode: 'earth' | 'solar'): void {
    if (this.viewSwitching) return
    if (mode === 'solar') {
      logger.warn('[WarmCurrent] 太阳系全景视角已屏蔽（2026-09-14 锁定地球视角），忽略 setViewMode(\'solar\')')
      return
    }
    if (this.viewMode === 'earth' && this.planetFocusBody === 'earth') {
      // 已在地球系：复位默认斜视取景（观察态由 focusSolarSystem 统一清理）
      this.focusSolarSystem('earth')
      return
    }
    this.switchView('earth')
  }



  /** 双击行星（2026-09-14 视角锁定地球系：仅地球响应——双击地球 = 切换行星观察视角；
   *  双击其它行星不再切换行星系，仅提示）。 */
  enterPlanetSystem(body: SolarBodyId): void {
    if (body !== 'earth') {
      logger.warn(`[WarmCurrent] 行星系切换已屏蔽（2026-09-14 锁定地球视角），忽略双击 → ${body}`)
      return
    }
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
   *  （2026-09-15 三版）聚焦只切瞄准点不飞镜头：保持玩家当前距离与姿态，滚轮控制远近。
   *  ⚠ 仅限当前行星系内：不在该行星系时忽略（跨系观察先双击进入行星系） */
  enterPlanetObserve(body: PlanetId): void {
    if (this.viewMode !== 'earth' || this.planetFocusBody !== body) return
    // 与全息勘探互斥：全息中先退出（保持相机原位不重新取景，随后观察重新取景）
    if (this.hologramSel) this.closeHologram()
    // 建筑/航线编辑模式与观察互斥（左键在观察中是环绕拖拽，不能同时落位/拖线）
    if (this.buildMode) this.cancelBuildMode()
    if (this.routeEditMode) this.toggleRouteEditMode()
    this.observeBody = body

    const rig = this.cameraActor.rig
    // 观察距离 = 节点半径 × 4；缩放下限贴球心（可滚到近乎贴着行星表面）
    const r = B.map.nodes[body].r
    // 定位用舞台偏移权威值（右键平移过地图时 rig.target 已偏离舞台，不可作锚点）
    const stage = planetStageOffset(body)
    // 边缘平移会拖走注视点破坏环绕，观察期间关闭（退出/切视图时恢复）
    rig.setEdgePanEnabled(false)
    // 注视点 = 球心高度（StarActor 球心 y = r×0.55）：特写行星屏幕居中，缩放下限以球心计量
    this.applyZoomFloor(r)
    // 聚焦看向（2026-09-15 七版·群星式滚动吸附）：边转头边把距离收拢到取景距离（r×4），
    // 行星舞台钉扎静态 → 锚点闭包直接返回固定点
    this.cameraActor.aimAt(() => new THREE.Vector3(stage.x, r * 0.55, stage.z), r * 4)
    rig.orbitMode = true
    // 观察态星图点击判定冻结，左键空闲 → 左键拖拽也环绕（双键环绕，历史交互不变）
    rig.leftOrbitEnabled = true
    // 行星钉在舞台中心（静态），无公转跟随
    this.observeFollowLast = null
    // 特写观感增强：被观察行星的大气提亮（组件在无此挂载的天体上自动跳过）
    this.applyObserveBoost(body)
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 行星观察：${PLANET_NAMES[body] ?? body}（拖拽环绕 · 滚轮缩放 · Esc/再双击退出）`)

  }

  /** 进入卫星观察视角（2026-09-15 聚焦环绕改版）：双击卫星（月球）聚焦，镜头转头看向卫星，
   *  并在 Tick 逐帧把注视点拉向卫星（原地转头跟随公转漂移，相机位置不动）；
   *  Esc/再双击退出回行星系默认聚焦取景。卫星无大气壳，进入时统一复位特写增益
   *  （从行星观察切换过来时清掉该行星的 ×1.8 增益）。
   *  （2026-09-15 三版）聚焦只切瞄准点不飞镜头：保持玩家当前距离与姿态，滚轮控制远近。
   *  ⚠ 仅限卫星母星系视角（月球须在地月系：公转跟随依赖本系舞台钉扎口径）。 */
  enterMoonObserve(body: MoonId): void {
    const mc = B.map.moons[body]
    if (!mc || this.viewMode !== 'earth' || this.planetFocusBody !== mc.parent) return
    // 与全息勘探互斥：全息中先退出（保持相机原位不重新取景，随后观察重新取景）
    if (this.hologramSel) this.closeHologram()
    // 建筑/航线编辑模式与观察互斥（左键在观察中是环绕拖拽，不能同时落位/拖线）
    if (this.buildMode) this.cancelBuildMode()
    if (this.routeEditMode) this.toggleRouteEditMode()
    this.observeBody = body
    // 观察距离 = 卫星半径 × 4；缩放下限贴球心（卫星特写可滚到近乎贴着表面）
    const r = B.map.nodes[body].r
    // 取景锚 = 卫星真实位置（ Actor root 权威值；卫星不在舞台中心，随公转走）
    const actor = this.starActors.get(body as StarBodyId)
    const wx = actor ? actor.root.position.x : 0
    const wz = actor ? actor.root.position.z : 0
    const rig = this.cameraActor.rig
    rig.setEdgePanEnabled(false)
    // 注视点 = 球心高度：特写卫星屏幕居中，缩放下限以球心计量
    this.applyZoomFloor(r)
    // 聚焦看向（2026-09-15 七版·群星式滚动吸附）：边转头看向卫星实时位边把距离收拢到
    // 取景距离（r×4），锚点闭包每帧取卫星 root.position → 滑移期间自动跟踪公转漂移
    this.cameraActor.aimAt(() => new THREE.Vector3(
      (this.starActors.get(body)?.root.position.x ?? wx),
      r * 0.55,
      (this.starActors.get(body)?.root.position.z ?? wz),
    ), r * 4)
    rig.orbitMode = true
    rig.leftOrbitEnabled = true
    this.observeFollowLast = { x: wx, z: wz }
    this.resetObserveBoost()
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 卫星观察：${PLANET_NAMES[body] ?? body}（环绕跟随公转 · 滚轮缩放 · Esc/再双击退出）`)
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

  /** 退出行星/卫星观察视角：复位该行星系默认聚焦取景（斜视 + 聚焦环绕语义，
   *  focusSolarSystem 顺带清观察状态与相机交互开关） */
  exitPlanetObserve(): void {
    if (!this.observeBody) return
    this.focusSolarSystem(this.planetFocusBody)
    logger.info('[WarmCurrent] 行星观察退出（回行星系斜视取景）')
  }



  /** 统一视图切换：加载遮罩先上屏（盖住舞台搬移/镜头跳转防穿帮），下一拍再切。
   *  2026-09-14 视角锁定地球系：solar 目标已屏蔽（防御性兜底，玩家入口均已封）。 */
  private switchView(target: 'solar' | SolarBodyId): void {
    if (this.viewSwitching) return
    if (target === 'solar') {
      logger.warn('[WarmCurrent] 太阳系全景视角已屏蔽（2026-09-14 锁定地球视角），忽略 switchView(\'solar\')')
      return
    }
    // solar 已在上方屏蔽返回；此处 target 收窄为 SolarBodyId
    this.viewSwitching = true
    const panel = this.world?.ui.spawnUIActor(VIEW_LOADING_WIDGET) ?? null
    this.viewLoadingPanel = panel
    if (!panel) logger.warn('[WarmCurrent] 视图切换加载遮罩生成失败，退化为硬切')
    window.setTimeout(() => {
      try {
        this.focusSolarSystem(target)
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
    // 天空背景纹理 GameMode 持引用装配（不在 factory 追踪体系），EndPlay 统一释放
    this.skyTex?.dispose()
    this.skyTex = null
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

  /** 双击判定状态（聚焦入口）：最近一次点中的天体（行星/卫星）+ 时刻 */
  private lastPlanetClick: { body: PlanetId | MoonId | null; t: number } = { body: null, t: 0 }

  /** 观察态按下快照（2026-09-15 单击解冻）：按下时记画布坐标，抬起按位移 ≤ 8px 结算为单击
   *  （走 resolveMapClick 星图点击判定尾段）或 > 8px 归环绕拖拽（相机层消费）。退出观察/
   *  视图切换统一清理，跨态残留抬起不误结算。 */
  private pendingObserveClick: { x: number; y: number } | null = null

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

  /** 任意天体命中（双击聚焦 + 星球信息面板共用：行星 + 卫星，含未解锁资源星；
   *  太阳走聚焦取景不进面板）。2026-09-15 起双击聚焦也走本判定（原 planetAt 排除卫星
   *  的旧口径随"月球可双击聚焦"移除，判定统一收口此处）。
   *  ⚠ 判定收口到"真实 Actor 世界位置"（行星系视角下隐藏天体 Actor 已移远景，
   *  看不见 = 点不到；太阳系全景 Actor 全在公转位，渲染在哪就点哪）。 */
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
    if (this.hologramSel) this.closeHologram()
    this.planetInfoSel = body
    this.orbitBuildSel = null
    this.shipyardSel = null
    this.stationSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 星球信息面板：${PLANET_NAMES[body] ?? body}`)
  }

  /** 关闭星球信息面板（面板内 ✕ / 点空地） */
  closePlanetInfo(): void {
    this.planetInfoSel = null
  }

  /** 打开轨道建设面板（星球信息面板「近地轨道建设」按钮 / 点已建成轨道设施） */
  openOrbitBuild(anchor: PlanetBodyId): void {
    if (this.hologramSel) this.closeHologram()
    this.orbitBuildSel = anchor
    this.planetInfoSel = null
    this.shipyardSel = null
    this.stationSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 轨道建设面板：${anchor}`)
  }

  /** 关闭轨道建设面板（面板内 ✕ / 点空地） */
  closeOrbitBuild(): void {
    this.orbitBuildSel = null
  }

  /** 打开船坞造船面板（星图点船坞轨道设施；与轨道建设/空间站/星球信息面板互斥） */
  openShipyardPanel(dockId: number): void {
    if (this.hologramSel) this.closeHologram()
    this.shipyardSel = dockId
    this.shipyardSelHull = 'standard'
    this.shipyardSelModules = []
    this.shipyardSelSlot = null
    this.shipyardAddMenuOpen = false
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.stationSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 船坞造船面板：dock ${dockId}`)
  }

  /** 关闭船坞造船面板（面板内 ✕ / 点空地） */
  closeShipyardPanel(): void {
    this.shipyardSel = null
  }

  // ─── 空间站舱段面板（2026-09-16 空间站模块：点空间站打开，插配布局） ───

  /** 打开空间站舱段面板（星图点空间站轨道设施；与船坞/轨道建设/星球信息面板互斥） */
  openStationPanel(obId: number): void {
    if (this.hologramSel) this.closeHologram()
    this.stationSel = obId
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.shipyardSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 空间站舱段面板：station ${obId}`)
  }

  /** 关闭空间站舱段面板（面板内 ✕ / 点空地） */
  closeStationPanel(): void {
    this.stationSel = null
  }

  // ─── 火箭设计工坊（2026-09-13：底部 HUD 入口的独立设计面板，不依赖船坞） ───

  /** 火箭设计面板开合（null = 收起；ShipDesignScript 消费） */
  designOpen = false

  /** 打开火箭设计面板（底部 HUD「火箭设计」按钮；选择态与船坞面板共享——
   *  船坞里配到一半的方案来这里接着调，反之亦然） */
  openShipDesign(): void {
    if (this.hologramSel) this.closeHologram()
    this.designOpen = true
    this.payloadDesignOpen = false
    this.planetInfoSel = null
    this.shipyardSel = null
    this.shipyardAddMenuOpen = false
    this.stationSel = null
    this.orbitBuildSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info('[WarmCurrent] 火箭设计工坊：打开')
  }

  /** 关闭火箭设计面板 */
  closeShipDesign(): void {
    this.designOpen = false
  }

  // ─── 荷载设计工坊（2026-09-13：火箭三部位改版——荷载单独设计，主体+附件合成一件自定义荷载） ───

  /** 荷载设计面板开合（null 语义 = 收起；PayloadDesignScript 消费，与火箭设计居中互斥） */
  payloadDesignOpen = false

  /** 设计工坊当前部位页签（payload/fuel/engine；三部位统一设计流，2026-09-14 泛化） */
  payloadEdTab: 'payload' | 'fuel' | 'engine' = 'payload'

  /** 荷载编辑区当前选中主体（chassis 模块 id；默认固体货仓） */
  payloadEdChassis = 'cargo_hold'

  /** 荷载编辑区当前勾选附件（attachment 模块 id 清单；单设计同件至多一件） */
  payloadEdAttachments: string[] = []

  /** 改装件是否契合部位（2026-09-14 用户口径：附件要契合当前选择的主体——
   *  表行 fits 声明可搭部位清单，缺省 = 通用件；合成宽放行、编辑区严收敛，同一谓词） */
  private fitsAttachment(moduleId: string, slotType: 'payload' | 'fuel' | 'engine'): boolean {
    const fits = shipModuleDefOf(moduleId)?.fits
    return !Array.isArray(fits) || fits.length === 0 || fits.includes(slotType)
  }

  /** 打开荷载设计面板（火箭设计工坊「荷载设计」按钮；与火箭设计互斥开合） */
  openPayloadDesign(): void {
    this.payloadDesignOpen = true
    this.payloadEdTab = 'payload'
    this.designOpen = false
    this.planetInfoSel = null
    this.shipyardSel = null
    this.stationSel = null
    this.orbitBuildSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info('[WarmCurrent] 荷载设计工坊：打开')
  }

  /** 关闭荷载设计面板 */
  closePayloadDesign(): void {
    this.payloadDesignOpen = false
  }

  /** 切换设计工坊部位页签（payload/fuel/engine；主体跨页保持，附件按 fits 契合收敛） */
  selectPayloadTab(tab: 'payload' | 'fuel' | 'engine'): void {
    if (tab !== 'payload' && tab !== 'fuel' && tab !== 'engine') return
    this.payloadEdTab = tab
    // 改装件契合主体：切页自动剔除不适配已勾件（保证「勾选清单 = 可保存清单」）
    this.payloadEdAttachments = this.payloadEdAttachments.filter((id) => this.fitsAttachment(id, tab))
  }

  /** 荷载编辑区选主体（单选；非法 id 忽略；角色键 = SLOT_ROLE_KEY 单一数据源） */
  selectPayloadChassis(moduleId: string): void {
    const roleKey = SLOT_ROLE_KEY[this.payloadEdTab] ?? 'payloadRole'
    if ((shipModuleDefOf(moduleId) as unknown as Record<string, unknown> | null)?.[roleKey] !== 'chassis') return
    this.payloadEdChassis = moduleId
  }

  /** 荷载编辑区勾/取消附件（多选；非法 id 忽略；不契合当前部位的新勾拒绝） */
  togglePayloadAttachment(moduleId: string): void {
    if (shipModuleDefOf(moduleId)?.payloadRole !== 'attachment') return
    const at = this.payloadEdAttachments.indexOf(moduleId)
    // 已勾件恒可取消（保证能移除）；新勾须契合当前部位（fits 缺省 = 通用件）
    if (at < 0 && !this.fitsAttachment(moduleId, this.payloadEdTab)) return
    if (at >= 0) this.payloadEdAttachments.splice(at, 1)
    else this.payloadEdAttachments.push(moduleId)
  }

  /** 保存当前编辑区为设计模板（部位 = 当前页签；uid 前缀随部位递增不复用，随档走） */
  savePayloadDesign(): boolean {
    const s = this.simState.state
    const slotType = this.payloadEdTab
    const def = payloadDesignModuleDef({ uid: '', name: '', slotType, chassis: this.payloadEdChassis, attachments: [...this.payloadEdAttachments] })
    if (!def) {
      // 跨页签选件保持下主体与部位错配是常态（如荷载页选的货仓切到燃料页）：显式引导而非静默失败
      const partName = SLOT_TYPE_NAMES[slotType] ?? '荷载'
      this.simState.hint(`请先选择${partName}主体再保存`)
      logger.warn(`[WarmCurrent] 设计保存失败：${slotType} 部位主体无效 chassis=${this.payloadEdChassis}`)
      return false
    }
    const uid = nextPayloadUid(s.payloadDesigns, slotType)
    const name = `自定义${SLOT_TYPE_NAMES[slotType] ?? '荷载'} ${s.payloadDesigns.filter((d) => (d.slotType ?? 'payload') === slotType).length + 1}`
    s.payloadDesigns.push({ uid, name, slotType, chassis: this.payloadEdChassis, attachments: [...this.payloadEdAttachments] })
    this.syncDynamicPayloadModules()
    this.simState.hint(`已保存「${name}」（${def.cost} H3）`)
    logger.info(`[WarmCurrent] 设计保存：${uid} ${name} slotType=${slotType} chassis=${this.payloadEdChassis} attachments=${this.payloadEdAttachments.join(',')}`)
    return true
  }

  /**
   * 删除荷载设计模板（引用保护：舰队在船 / 船型模板 / 当前装配选择引用该 uid 时拒绝——
   * 合成件定义随模板删除，引用船会静默丢效果，宁可让玩家先解除引用）。
   */
  deletePayloadDesign(idx: number): boolean {
    const s = this.simState.state
    if (idx < 0 || idx >= s.payloadDesigns.length) return false
    const uid = s.payloadDesigns[idx].uid
    const refs: string[] = []
    if (s.ships.some((sh) => sh.modules?.includes(uid))) refs.push('现役飞船')
    if (s.shipDesigns.some((d) => d.modules.includes(uid))) refs.push('船型模板')
    if (this.shipyardSelModules.includes(uid)) refs.push('当前装配')
    if (refs.length > 0) {
      this.simState.hint(`「${s.payloadDesigns[idx].name}」正被${refs.join('、')}引用，先解除引用再删除`)
      return false
    }
    const [gone] = s.payloadDesigns.splice(idx, 1)
    this.syncDynamicPayloadModules()
    this.simState.hint(`已删除「${gone.name}」`)
    logger.info(`[WarmCurrent] 荷载设计删除：${gone.uid} ${gone.name}`)
    return true
  }

  /** 载入设计模板 → 编辑区（按模板部位切页签；返回是否成功；script 据此刷新勾选态） */
  loadPayloadDesign(idx: number): boolean {
    const s = this.simState.state
    const d = s.payloadDesigns[idx]
    if (!d) return false
    const slot = (d.slotType ?? 'payload') as 'payload' | 'fuel' | 'engine'
    const roleKey = SLOT_ROLE_KEY[slot] ?? 'payloadRole'
    if ((shipModuleDefOf(d.chassis) as unknown as Record<string, unknown> | null)?.[roleKey] !== 'chassis') return false
    this.payloadEdTab = slot
    this.payloadEdChassis = d.chassis
    this.payloadEdAttachments = d.attachments.filter((id) => shipModuleDefOf(id)?.payloadRole === 'attachment' && this.fitsAttachment(id, slot))
    this.simState.hint(`已载入「${d.name}」`)
    logger.info(`[WarmCurrent] 设计载入：${d.uid} ${d.name} → 编辑区（${slot} 页）`)
    return true
  }

  /** 自定义荷载注册表同步（payloadDesigns → 合成模块投影；开关面板零成本幂等） */
  private syncDynamicPayloadModules(): void {
    setDynamicShipModules(payloadDesignDefsOf(this.simState.state.payloadDesigns ?? []))
  }

  /** 荷载设计工坊面板数据（payloadDesignOpen = false 时不出；三部位页签制） */
  private buildPayloadDesignVM(): HudPayloadDesign {
    const s = this.simState.state
    const slotType = this.payloadEdTab
    const roleKey = SLOT_ROLE_KEY[slotType] ?? 'payloadRole'
    const partName = SLOT_TYPE_NAMES[slotType] ?? '荷载'
    const tabs = (['payload', 'fuel', 'engine'] as const).map((type) => ({ type, name: SLOT_TYPE_NAMES[type] ?? type }))
    const chassis: HudModuleRow[] = []
    const attachments: HudModuleRow[] = []
    // 已勾件恒入清单（保证不适配的已勾件在面板上可见可取消），新行按 fits 契合过滤
    for (const [id, m] of shipModuleEntries()) {
      const known = m.payloadRole === 'attachment' && (this.fitsAttachment(id, slotType) || this.payloadEdAttachments.includes(id))
      const row: HudModuleRow = {
        id,
        name: m.name,
        desc: m.desc,
        cost: m.cost,
        allowed: true,
        slotType: m.slotType ?? null,
        slotFull: false,
        slotLabel: null,
      }
      if ((m as unknown as Record<string, unknown>)[roleKey] === 'chassis') chassis.push(row)
      else if (known) attachments.push(row)
    }
    const draft: SimPayloadDesign = { uid: '', name: '', slotType, chassis: this.payloadEdChassis, attachments: [...this.payloadEdAttachments] }
    const synth = payloadDesignModuleDef(draft)
    // 预览效果行 = 主体/附件各自的表文案（表驱动，不在此复述数值）
    const effectParts: string[] = []
    const chassisDef = shipModuleDefOf(this.payloadEdChassis)
    if (chassisDef) effectParts.push(chassisDef.desc)
    for (const id of this.payloadEdAttachments) {
      const def = shipModuleDefOf(id)
      if (def) effectParts.push(def.desc)
    }
    const designs: HudPayloadRow[] = s.payloadDesigns.map((d, idx) => {
      const def = payloadDesignModuleDef({ ...d, slotType: d.slotType ?? 'payload' })
      return { idx, uid: d.uid, name: d.name, summary: def?.desc ?? d.chassis, cost: def?.cost ?? 0 }
    })
    return {
      tabs,
      chassis,
      attachments,
      selTab: slotType,
      selChassis: this.payloadEdChassis,
      selAttachments: [...this.payloadEdAttachments],
      synthName: `预览：自定义${partName} ${s.payloadDesigns.filter((d) => (d.slotType ?? 'payload') === slotType).length + 1}`,
      synthDesc: synth ? `${synth.desc}\n${effectParts.join(' · ')}` : '',
      synthCost: synth?.cost ?? 0,
      designs,
      canSave: !!synth,
    }
  }

  /** 槽位制选择收敛（船坞面板/设计面板共用：切船型后不兼容/满槽模块剔除） */
  private normalizeShipyardSelection(): { usage: Record<string, number>; capacity: Record<string, number> } {
    this.shipyardSelModules = this.shipyardSelModules.filter((id) =>
      hullHasSlotFor(this.shipyardSelHull, this.shipyardSelModules.filter((x) => x !== id), id))
    const usage = modulesSlotUsage(this.shipyardSelHull, this.shipyardSelModules)
    const capacity = hullSlotCapacity(this.shipyardSelHull)
    return { usage, capacity }
  }

  /** 可下单船坞清单（建成船坞，id 升序；下单入口在设计面板/船坞面板） */
  private availableDocks(): OrbitBuilding[] {
    const s = this.simState.state
    return s.orbitBuildings
      .filter((x) => x.built && isShipyardType(x.type))
      .sort((a, b) => a.id - b.id)
  }

  /** 装配台槽位格 + 选中部位（设计/船坞两面板共用；切船型后槽型表失配 = 视为未选） */
  private buildSlotCells(
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): {
    sel: { type: string; typeName: string; idx: number; used: number; cap: number } | null
    slotCells: HudDesignSlotCell[]
  } {
    const raw = this.shipyardSelSlot
    const sel = raw && (capacity[raw.type] ?? 0) > raw.idx ? raw : null
    // 装配台槽位格（ship_hull.slots 表序展开；每格 = 槽型 + 同型实例序 + 已装模块名 + 选中态）
    const slotCells: HudDesignSlotCell[] = []
    for (const [type, cap] of Object.entries(capacity)) {
      const typeMods = this.shipyardSelModules.filter((id) => shipModuleDefOf(id)?.slotType === type)
      for (let i = 0; i < cap; i++) {
        const mid = typeMods[i]
        slotCells.push({
          type,
          typeName: SLOT_TYPE_NAMES[type] ?? type,
          slotIdx: i,
          module: mid ? shipModuleDefOf(mid)?.name ?? mid : '',
          filled: !!mid,
          sel: !!sel && sel.type === type && sel.idx === i,
        })
      }
    }
    const selSlot = sel
      ? {
          type: sel.type,
          typeName: SLOT_TYPE_NAMES[sel.type] ?? sel.type,
          idx: sel.idx,
          used: usage[sel.type] ?? 0,
          cap: capacity[sel.type] ?? 0,
        }
      : null
    return { sel: selSlot, slotCells }
  }

  /**
   * 装配台堆叠行（2026-09-17 二轮反馈精简：缺氧火箭「从底部往上堆」口径）：
   *  - 不再展开预定空槽位行，只列「已装实例行」——玩家看到的就是装了的东西；
   *  - 全装配台只有一枚加号行（固定在末尾，始终可点）：点击 = 顺序定位第一个
   *    有空位的部位（荷载→燃料→引擎），② 区出该部位部件清单；满员 = 提示船型已满；
   *  - 已装行点击 = 选中该实例换装/卸下（原口径不变）。
   * 设计面板/船坞面板同源共用此投影，选择态权威仍在 shipyardSelSlot/shipyardSelModules。
   */
  private buildStackRows(
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): HudStackRow[] {
    const rows: HudStackRow[] = []
    for (const [type, cap] of Object.entries(capacity)) {
      const typeName = SLOT_TYPE_NAMES[type] ?? type
      const typeMods = this.shipyardSelModules.filter((id) => shipModuleDefOf(id)?.slotType === type)
      for (let i = 0; i < typeMods.length; i++) {
        const mid = typeMods[i]
        rows.push({
          rowId: `${type}#${i}`,
          kind: 'module',
          type,
          typeName,
          idx: i,
          moduleName: mid ? shipModuleDefOf(mid)?.name ?? mid : '',
          filled: true,
          sel: !!this.shipyardSelSlot && this.shipyardSelSlot.type === type && this.shipyardSelSlot.idx === i,
          addable: false,
          removable: true,
          hint: '',
        })
      }
    }
    // 单一加号行：点击 = 弹出部位选择小面板（用户指定装什么，不默认荷载）
    const types = Object.keys(capacity)
    const firstOpen = types.find((t) => (usage[t] ?? 0) < (capacity[t] ?? 0)) ?? ''
    const addType = firstOpen || types[0] || ''
    const used = usage[addType] ?? 0
    rows.push({
      rowId: '__add__',
      kind: 'add',
      type: addType,
      typeName: SLOT_TYPE_NAMES[addType] ?? addType,
      idx: used,
      moduleName: '',
      filled: false,
      sel: false,
      addable: !!firstOpen,
      removable: false,
      hint: firstOpen ? '选择要加装的部位' : `${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}槽位已满`,
    })
    return rows
  }

  /** 「+ 加号」部位选择小面板投影（船型槽型表键序；empty = 该部位无空位置灰） */
  private buildAddMenu(
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): HudShipAddMenu {
    const parts = Object.keys(capacity).map((type) => ({
      type,
      name: SLOT_TYPE_NAMES[type] ?? type,
      empty: (usage[type] ?? 0) < (capacity[type] ?? 0),
    }))
    return { open: this.shipyardAddMenuOpen, parts }
  }

  /** 部位选件清单（选中槽型的 ship_module 行，表序 = 低档在前；here = 本实例当前所装件） */
  private buildSlotOptions(
    sel: { type: string; idx: number } | null,
    usage: Record<string, number>,
    capacity: Record<string, number>,
  ): HudModuleRow[] {
    if (!sel) return []
    const hereId = this.shipyardSelModules
      .filter((id) => shipModuleDefOf(id)?.slotType === sel.type)[sel.idx]
    // 静态表 + 自定义设计注册表合成条目（部位选件清单：现货件在前，玩家设计追加在后）
    // 三部位统一收口（2026-09-14 用户口径：部位清单显示玩家保存后的设计）：
    // payload/fuel/engine 槽现货档位件（货舱/油箱/引擎档/泵/加热器/舱内附件）不再直接可选装——
    // 它们是设计工坊的合成原料，清单只出玩家保存的设计（payloadDesigns 投影，键序）；
    // 无设计 = 空清单（面板出引导文案）。
    // 谓词：动态设计件恒放行；现货件无任何部位角色（chassis/attachment）才放行——
    // 现存 16 件现货件全部带角色，第二析取支是给未来"无角色新件"留的安全阀。
    return shipModuleEntries()
      .filter(([, m]) => m.slotType === sel.type)
      .filter(([id, m]) => sel.type === 'payload' || sel.type === 'fuel' || sel.type === 'engine' ? isDynamicShipModule(id) || (m.payloadRole !== 'chassis' && m.payloadRole !== 'attachment' && m.fuelRole !== 'chassis' && m.engineRole !== 'chassis') : true)
      .map(([id, m]) => ({
        id,
        name: m.name,
        desc: m.desc,
        cost: m.cost,
        allowed: hullAllowsModule(this.shipyardSelHull, id),
        slotType: m.slotType ?? null,
        // 部位选件制无「满槽置灰」：同槽异件 = 原位换装，选择校验在 pickShipyardSlotModule
        slotFull: false,
        slotLabel: `${SLOT_TYPE_NAMES[sel.type] ?? sel.type} ${usage[sel.type] ?? 0}/${capacity[sel.type] ?? 0}`,
        here: hereId === id,
      }))
  }

  private buildShipDesignVM(): HudShipDesign {
    const s = this.simState.state
    const { usage, capacity } = this.normalizeShipyardSelection()
    const hulls: HudHullRow[] = Object.entries(B.shipHulls).map(([id, h]) => ({
      id, name: h.name, desc: h.desc, cost: h.cost,
    }))
    const { sel: selSlot, slotCells } = this.buildSlotCells(usage, capacity)
    const stackRows = this.buildStackRows(usage, capacity)
    const addMenu = this.buildAddMenu(usage, capacity)
    const slotOptions = this.buildSlotOptions(selSlot, usage, capacity)
    const slotRows = Object.entries(capacity).map(([type, cap]) => ({
      name: SLOT_TYPE_NAMES[type] ?? type,
      used: usage[type] ?? 0,
      cap,
    }))
    // 试航行 + 反推（与船坞面板同口径）
    const gap = Math.max(0, this.simState.demand - supplyRateOf(s))
    const trials: HudTrialRow[] = (['moon', 'europa', 'mars'] as StarId[]).map((star) => {
      const trial = shipTrialOf(s, this.shipyardSelHull, this.shipyardSelModules, star, ringModsOf(s))
      const unlocked = this.transport.starUnlocked(star)
      return {
        star,
        starName: B.stars[star].name,
        unlocked,
        unlockAct: B.stars[star].unlockAct,
        load: Math.round(trial?.load ?? 0),
        cycleS: Math.round(trial?.cycleS ?? 0),
        fuel: Math.round(trial?.fuel ?? 0),
        net: Math.round(trial?.net ?? 0),
        throughput: Math.round((trial?.throughput ?? 0) * 10) / 10,
        shipsForGap: unlocked ? shipsNeededFor(trial, gap) : -1,
      }
    })
    const designs: HudDesignRow[] = s.shipDesigns.map((d, idx) => ({
      idx,
      name: d.name,
      hullName: shipHullDefOf(d.hull)?.name ?? d.hull,
      modules: d.modules.map((id) => shipModuleDefOf(id)?.name ?? id).join('、'),
    }))
    // 可下单船坞（价格乘区取首坞；无坞 = 只能设计不能下水）
    const docks = this.availableDocks().map((d) => {
      const def = orbitBuildingDefOf(d.type)
      return {
        id: d.id,
        name: def?.name ?? d.type,
        anchorName: PLANET_NAMES[d.anchor] ?? B.stars[d.anchor as StarId]?.name ?? d.anchor,
        costMult: def?.shipBuildCostMult ?? 1,
        canOrder: s.ships.length + s.buildQueue.length < this.simState.shipCap
          && (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active',
      }
    })
    const priceMult = docks[0]?.costMult ?? 1
    const price = Math.round(shipBuildPrice(this.shipyardSelHull, this.shipyardSelModules) * priceMult)
    return {
      hulls,
      selSlot,
      slotOptions,
      slotCells,
      stackRows,
      addMenu,
      slotRows,
      trials,
      designs,
      canSaveDesign: true,
      docks,
      price,
      fleetShips: s.ships.length,
      queueCount: s.buildQueue.length,
      cap: this.simState.shipCap,
      canQueue: docks.some((d) => d.canOrder),
    }
  }

  /** 设计面板下单（指定承接船坞；校验/计费口径在 transport.tryBuildShip） */
  orderFromDesign(dockId: number): boolean {
    return this.transport.tryBuildShip(this.shipyardSelHull, this.shipyardSelModules, dockId)
  }

  // ─── 全息勘探（2026-09-12：矿点检视 + 矿建落位） ───

  /** 打开全息勘探（星球信息面板按钮）。
   *  Earth = 全息地球建造场景（2026-09-12 立项；2026-09-15 起与矿点勘探同口径原地包络，
   *  勘探期间真球隐藏）：HUD 进建造模式，环节点球面落位 + 融化区内放地表建筑；无需矿点门槛。
   *  其他天体 = 矿点勘探（必须有矿点）。
   *  相机语义与行星观察同款：斜视角环绕 + 关边缘平移；退出保持当前视角（closeHologram 不重新取景）。
   *  卫星随母星系判定（地月系内可全息月球）；取景收口真实 Actor 位置（卫星不在舞台中心，
   *  Tick 逐帧 rig.pan 跟随公转漂移）。
   *  ⚠ 仅限本行星系视角（太阳系全景行星公转漂移，镜头锚不住）。 */
  openHologram(body: PlanetBodyId): void {
    const mc = B.map.moons[body as keyof typeof B.map.moons]
    const systemRoot = mc ? mc.parent : body
    if (this.viewMode !== 'earth' || this.planetFocusBody !== systemRoot) {
      this.simState.hint('需进入该行星系（双击行星）后可全息勘探')
      return
    }
    const isEarth = body === 'earth'
    if (!isEarth && depositsOf(body).length === 0) {
      this.simState.hint('该天体无已探明矿产')
      return
    }
    // 与观察模式互斥：观察中先退出（复位俯视，随后全息重新取景）
    if (this.observeBody) this.exitPlanetObserve()
    this.hologramSel = body
    this.holoDepositSel = null
    this.holoLastTarget = null
    this.holoPlaceTool = null
    this.holoGhost = null
    this.holoTab = 'resources'
    const r = B.map.nodes[body].r
    const actor = this.starActors.get(body as StarBodyId)
    // 取景锚 = 天体真实位置（行星钉在舞台中心 = 原点；卫星用实时公转位），注视高度 = 球心
    const wx = actor ? actor.root.position.x : 0
    const wz = actor ? actor.root.position.z : 0
    this.cameraActor.rig.setEdgePanEnabled(false)
    // 全息统一原地包络取景（2026-09-15 用户定案：地球不再远处独立投影，与月球同口径；
    // 球面落位/建筑操作空间 = B.holo.pickRadius 拾取半径 + 环绕边缘平移保障）
    this.applyZoomFloor(r)
    this.cameraActor.observeFocus(wx, wz, r * 4.5, THREE.MathUtils.degToRad(35), r * 0.55)
    if (isEarth) this.toast('全息地球已展开 — 右侧选建造工具，点球面落位', '#7fdcff')
    this.cameraActor.rig.orbitMode = true
    // 全息态星图点击判定冻结（放置工具走屏幕空间拾取），左键空闲 → 左键也环绕（历史交互不变）
    this.cameraActor.rig.leftOrbitEnabled = true
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 全息${isEarth ? '地球建造' : '勘探'}：${PLANET_NAMES[body] ?? body}（拖拽环绕 · Esc 退出）`)
  }

  /** 关闭全息勘探（面板 ✕ / Esc）：保持当前相机位置（2026-09-15 用户定案：关闭不重新取景，
   *  玩家环绕/缩放出的视角原样保留）。字段与相机交互清理交由 clearObserveState
   *  （hologramSel/orbitMode/边缘平移/特写增益一并回落视图默认语义），不飞镜头；
   *  缩放下限回落聚焦天体口径（全息期间可能贴合过更小的卫星球面）。 */
  closeHologram(): void {
    if (!this.hologramSel) return
    this.clearObserveState()
    this.applyZoomFloor(B.map.nodes[this.planetFocusBody as PlanetId].r)
    logger.info('[WarmCurrent] 全息勘探关闭（保持当前相机位置）')
  }

  /** 选中矿点（面板行点击；id 须属当前勘探天体） */
  selectHoloDeposit(id: string | null): void {
    if (id && depositDefOf(id)?.planet !== this.hologramSel) return
    this.holoDepositSel = id
    if (id) audioSys.play('wc.draw', { volume: 0.25 })
  }

  // ─── 全息地球建造（环节点落位 / 地表建筑放置） ───

  /** 切换面板内容分类（底部资源/地表建筑/轨道建筑按钮；同值重复点击幂等忽略） */
  setHoloTab(tab: HoloTab): void {
    if (this.holoTab === tab) return
    this.holoTab = tab
    audioSys.play('wc.draw', { volume: 0.2 })
    logger.info(`[WarmCurrent] 全息面板切换分类：${tab}`)
  }

  /** 选择放置工具（面板行点击；kind=null 清除。建筑 typeId 非法忽略） */
  setHoloTool(kind: 'ring' | 'building' | null, typeId?: string): void {
    if (kind === null || (this.holoPlaceTool?.kind === kind && (kind !== 'building' || (this.holoPlaceTool as { typeId: string }).typeId === typeId))) {
      // 再点同工具 = 取消
      this.holoPlaceTool = null
      this.holoGhost = null
      return
    }
    if (kind === 'ring') {
      this.holoPlaceTool = { kind: 'ring' }
    } else {
      if (!buildingDefOf(typeId ?? '')) return
      this.holoPlaceTool = { kind: 'building', typeId: typeId! }
    }
    audioSys.play('wc.draw', { volume: 0.25 })
  }

  /** 环节点落位合法性（null = 可落位）：须有待落位的已交付槽位 */
  private holoRingNodeIssue(): string | null {
    const s = this.simState.state
    if (s.flare.phase === 'active') return '太阳耀斑 · 通讯中断，无法落位'
    if (pendingRingNodeCount(s) <= 0) return '无待落位节点（建设泵交付新环段后可落位）'
    return null
  }

  /** 全息视图左键轻点（Controller 派发）：放置工具激活 = 球面落位；否则 = 矿点拾取 */
  onHologramTap(screenX: number, screenY: number): void {
    if (!this.hologramSel) return
    if (this.holoPlaceTool && this.hologramSel === 'earth') {
      this.applyHoloToolAt(screenX, screenY)
      return
    }
    const id = this.starMap?.pickHoloDeposit(screenX, screenY) ?? null
    this.selectHoloDeposit(id)
  }

  /** 工具落位（轻点处球面交点）：环节点连续落位不退工具；地表建筑一次一放 */
  private applyHoloToolAt(screenX: number, screenY: number): void {
    const hit = this.starMap?.pickHoloSurface(screenX, screenY)
    if (!hit) return
    const tool = this.holoPlaceTool!
    if (tool.kind === 'ring') {
      const issue = this.placeRingNodeAt(hit.lat, hit.lon)
      if (issue) {
        this.simState.hint(issue)
        audioSys.play('wc.bad', { volume: 0.4 })
        return
      }
      audioSys.play('wc.build')
      this.toast(`环节点已落位（${Math.round(hit.lat)}°, ${Math.round(hit.lon)}°）— 周边冰雪开始消融`, '#7fe0a0')
      return
    }
    const ok = this.buildings.tryPlaceSurface(tool.typeId, hit.lat, hit.lon)
    if (ok) {
      audioSys.play('wc.build')
      this.setHoloTool(null)
    } else {
      audioSys.play('wc.bad', { volume: 0.5 })
    }
  }

  /** 环节点直落（屏幕落位/GM 共用校验链；返回 null = 成功，否则为拒绝原因） */
  placeRingNodeAt(lat: number, lon: number): string | null {
    const issue = this.holoRingNodeIssue()
    if (issue) return issue
    const s = this.simState.state
    const idx = s.ringNodes.findIndex((n, i) => i < s.ringSlots && !n)
    if (idx < 0) return '无待落位槽位'
    s.ringNodes[idx] = { lat, lon }
    return null
  }

  /** 全息地球指针悬停（Controller 移动派发）：更新放置预览（渲染 ghost + 面板校验文案） */
  onHologramHover(screenX: number, screenY: number): void {
    if (!this.hologramSel || this.hologramSel !== 'earth' || !this.holoPlaceTool) {
      this.holoGhost = null
      return
    }
    const hit = this.starMap?.pickHoloSurface(screenX, screenY)
    if (!hit) {
      this.holoGhost = null
      return
    }
    const tool = this.holoPlaceTool
    if (tool.kind === 'ring') {
      const issue = this.holoRingNodeIssue()
      this.holoGhost = {
        ...hit,
        valid: !issue,
        label: issue ?? `环节点 · 融冰半径 ${B.holoEarth.meltRadiusDeg}°（点击落位）`,
      }
      return
    }
    const def = buildingDefOf(tool.typeId)
    const issue = this.buildings.surfacePlacementIssue(tool.typeId, hit.lat, hit.lon)
    this.holoGhost = {
      ...hit,
      valid: !issue,
      label: issue ?? `${def?.name ?? tool.typeId} · ${def?.cost ?? 0} H3（点击放置）`,
    }
  }

  /** 环节点标记的屏幕坐标（e2e/引导探针；null = 全息未开/未落位该槽） */
  holoNodeScreenPos(slot: number): { x: number; y: number } | null {
    return this.starMap?.holoNodeScreenPos(slot) ?? null
  }

  /** 目标 lat/lon 球面点的屏幕坐标（e2e 真实点击测试用；含当前自转相位） */
  holoLatLonScreenPos(lat: number, lon: number): { x: number; y: number } | null {
    return this.starMap?.holoLatLonScreenPos(lat, lon) ?? null
  }

  /** 矿点标记的屏幕坐标（e2e 真实点击测试用；null = 全息未开/无此矿点） */
  holoMarkerScreenPos(depositId: string): { x: number; y: number } | null {
    return this.starMap?.holoMarkerScreenPos(depositId) ?? null
  }

  /** 全息勘探面板数据装配（hologramSel → HudHologram；矿点行/建造行全表驱动） */
  private buildHologram(body: PlanetBodyId): HudHologram {
    const s = this.simState.state
    const types = B.mineralTypes as Record<string, { name: string; desc: string; color: string } | undefined>
    const deposits: HudHoloDepositRow[] = depositsOf(body).map(({ id, def }) => {
      const t = types[def.type]
      const mine = this.mining.mineAt(id)
      const left = depositLeft(s, id)
      let status: string
      if (mine && !mine.built) status = `建造中 ${Math.floor(mine.progress * 100)}%`
      else if (mine && left <= 0) status = '已枯竭'
      else if (mine) status = `开采中 · 余 ${Math.round(left)} t`
      else status = '未开发'
      return {
        id,
        typeName: t?.name ?? def.type,
        color: t?.color ?? '#4fd8ff',
        reserve: def.reserve,
        left,
        status,
        mineType: mine?.type ?? null,
        progress: mine?.progress ?? 0,
        selected: this.holoDepositSel === id,
      }
    })
    const selDef = this.holoDepositSel ? depositDefOf(this.holoDepositSel) : null
    let detail = '点矿点或列表行选中矿点'
    if (selDef) {
      const t = types[selDef.type]
      const mine = this.mining.mineAt(this.holoDepositSel!)
      const left = depositLeft(s, this.holoDepositSel!)
      const lines = [
        `${t?.name ?? selDef.type}（${t?.desc ?? ''}）`,
        `储量 ${Math.round(left)} / ${selDef.reserve} t`,
      ]
      if (mine && !mine.built) {
        const md = mineDefOf(mine.type)
        lines.push(`${md?.name ?? mine.type} 建造中 ${Math.floor(mine.progress * 100)}%`)
      } else if (mine) {
        const md = mineDefOf(mine.type)
        lines.push(left > 0
          ? `${md?.name ?? mine.type} 运转中 · 产出 ${md?.yieldPerS ?? 0}/s`
          : '矿点已枯竭 · 设施停摆')
      }
      detail = lines.join('\n')
    }
    const playable = s.outcome === 'playing' || s.sandbox
    const buildRows: HudHoloBuildRow[] = Object.entries(B.mineBuildings).map(([id, def]) => {
      const issue = this.holoDepositSel ? this.mining.placementIssue(this.holoDepositSel, id) : '未选中矿点'
      return {
        id, name: def.name, desc: def.desc, cost: def.cost,
        buildTime: def.buildTime, yieldPerS: def.yieldPerS,
        canBuild: playable && !issue,
      }
    })
    // 全息地球态（仅 Earth）：节点统计 + 建造工具行（ring + building 表键序）+ ghost 提示
    let earth: HudHoloEarth | null = null
    if (body === 'earth') {
      const pending = pendingRingNodeCount(s)
      const placed = placedRingNodes(s)
      const tools: HudHoloToolRow[] = [
        {
          id: 'ring',
          name: '⚡ 环节点',
          desc: `点球面落位待建节点 · 融冰 ${B.holoEarth.meltRadiusDeg}°`,
          selected: this.holoPlaceTool?.kind === 'ring',
          canUse: playable && pending > 0,
        },
        ...Object.entries(B.buildings).map(([id, def]) => ({
          id,
          name: def.name,
          desc: `地表建筑 · 需融化区 · ${def.cost} H3`,
          selected: this.holoPlaceTool?.kind === 'building' && (this.holoPlaceTool as { typeId: string }).typeId === id,
          canUse: playable && s.earthH3 >= def.cost,
        })),
      ]
      const earthYard = this.orbitBuild.shipyardMults('earth')
      const earthShipCost = Math.round(B.shipBuildCost * (earthYard?.costMult ?? 1))
      earth = {
        tab: this.holoTab,
        pendingNodes: pending,
        placedNodes: placed.length,
        builtSlots: s.ringSlots,
        meltRadiusDeg: B.holoEarth.meltRadiusDeg,
        tools,
        orbitRows: this.orbitBuildTypeRows('earth'),
        orbitIntro: earthYard
          ? `船坞就绪 · 点轨道上的船坞打开造船面板（${earthShipCost} H3/艘）`
          : `造船 ${earthShipCost} H3（建船坞解锁 · 点船坞造船）`,
        toolActive: !!this.holoPlaceTool,
        ghostLabel: this.holoGhost?.label ?? '',
      }
    }
    return {
      body,
      bodyName: B.stars[body as StarId]?.name ?? PLANET_NAMES[body] ?? body,
      deposits,
      buildRows,
      selectedId: this.holoDepositSel,
      detail,
      stockyard: (B.starStockCap as Record<string, number | undefined>)[body] !== undefined
        ? { stock: Math.floor(starStockOf(s, body)), cap: (B.starStockCap as Record<string, number>)[body], miningRate: Math.round(starMiningRate(s, body) * 10) / 10 }
        : null,
      earth,
    }
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
    // 全息勘探模式：左键 = 环绕拖拽（相机层消费），矿点点选走 Controller 屏幕空间拾取，
    // 星图点击判定全部冻结（面板行也可选中矿点）
    if (this.hologramSel) return
    // 行星观察模式：左键 = 环绕拖拽（相机层消费）；星图点击不再整体冻结（2026-09-15 定案）——
    // 按下记快照、抬起结算：位移 ≤ 8px = 单击（走星图点击判定尾段，点星球开信息面板），
    // 位移 > 8px = 纯环绕拖拽（相机层消费，GameMode 不结算）。
    // 双击当前观察天体 = 退出回默认聚焦；双击另一可观察天体 = 切换聚焦（地球 ↔ 月球，
    // 2026-09-15 聚焦环绕改版）。双击判定不受败局/选卡冻结影响（pendingCard 挂起期间镜头必须可用）。
    // 命中收口 bodyAt（行星 + 卫星；非本系天体已隔离远景 → 点不到）。
    if (this.observeBody) {
      const hit = this.bodyAt(p)
      const now = performance.now()
      if (hit && this.lastPlanetClick.body === hit && now - this.lastPlanetClick.t < 350) {
        this.lastPlanetClick = { body: null, t: 0 }
        if (hit === this.observeBody) {
          this.exitPlanetObserve()
        } else if (B.map.moons[hit as keyof typeof B.map.moons]) {
          this.enterMoonObserve(hit as MoonId)
        } else {
          this.enterPlanetObserve(hit as PlanetId)
        }
        this.pendingObserveClick = null
        return
      }
      // 单击不再冻结（2026-09-15 定案）：按下记快照，抬起按位移结算（见 onMapPointerUp）
      this.pendingObserveClick = { x: p.x, y: p.y }
      this.lastPlanetClick = hit ? { body: hit as PlanetId | MoonId, t: now } : { body: null, t: 0 }
      return
    }

    // 双击天体 → 聚焦观察（2026-09-15 聚焦环绕改版：月球可双击聚焦观察）：
    // 行星走 enterPlanetSystem（视角锁定下仅 earth 响应），卫星走 enterMoonObserve。
    // 命中收口 bodyAt（行星 + 卫星，真实 Actor 世界位置；行星系视角下非本系天体已隔离
    // 远景 12000 → 点不到，本系内可命中 = 聚焦行星 + 其卫星）。
    // ⚠ 双击判定不受败局/选卡冻结影响（pendingCard 挂起期间镜头必须可用）
    // 双击聚焦 + 单击星图判定统一收口 resolveMapClick（allowDouble=true：双击聚焦语义属俯视路径）
    // ⚠ 单击天体不 return：继续走建筑/节点/航线判定（行星/卫星也可能是资源星节点/拖线端点）
    this.resolveMapClick(p, true)
  }

  /** 星图点击判定尾段（俯视态单击与观察态单击共用；2026-09-15 提取）：
   *  建筑 → 轨道设施 → 节点（非编辑态点星球开面板）→ 航线 → 护盾气泡 → 天体兜底 → 空处清选。
   *  @param allowDouble 天体双击段（观察态双击切换）已由上游处理时传 false，防止观察态单击
   *  二次消费 lastPlanetClick 被误判为双击（双击聚焦语义只属俯视路径） */
  private resolveMapClick(p: { x: number; y: number }, allowDouble: boolean): void {
    const s = this.simState.state
    if (allowDouble) {
      const dbl = this.bodyAt(p)
      if (dbl) {
        const now = performance.now()
        if (this.lastPlanetClick.body === dbl && now - this.lastPlanetClick.t < 350) {
          this.lastPlanetClick = { body: null, t: 0 }
          this.orbitBuildSel = null
          if (B.map.moons[dbl as keyof typeof B.map.moons]) this.enterMoonObserve(dbl as MoonId)
          else this.enterPlanetSystem(dbl as PlanetId)
          audioSys.play('wc.ok', { volume: 0.4 })
          return
        }
        this.lastPlanetClick = { body: dbl as PlanetId | MoonId, t: now }
      }
    }
    // 太阳：2026-09-14 视角锁定地球系，点击太阳不再切太阳系全景（仅提示）
    if (this.sunAt(p)) {
      this.simState.hint('太阳系全景已屏蔽（当前锁定地球视角）')
      logger.warn('[WarmCurrent] 点击太阳忽略：太阳系全景视角已屏蔽')
      return
    }
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
    // 近地轨道设施：船坞 → 船坞造船面板（造船入口）；空间站 → 舱段面板（布局设计）；
    // 其它类型（含在建）→ 轨道建设面板
    const ob = this.orbitBuildingAt(p)
    if (ob) {
      if (isShipyardType(ob.type)) this.openShipyardPanel(ob.id)
      else if (ob.type === 'station') this.openStationPanel(ob.id)
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
    this.stationSel = null
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
    // 观察态单击结算（2026-09-15 单击解冻）：按下快照 + 抬起位移 ≤ 8px = 单击，
    // 走星图点击判定尾段（allowDouble=false：观察态双击已在 pointerDown 消费，
    // 防单击二次消费 lastPlanetClick 被误判双击）；位移 > 8px = 环绕拖拽，相机层已消费。
    const pend = this.pendingObserveClick
    if (pend) {
      this.pendingObserveClick = null
      const dpx = Math.hypot(p.x - pend.x, p.y - pend.y)
      if (dpx <= 8) {
        logger.info(`[WarmCurrent] 观察态单击结算（位移 ${dpx.toFixed(1)}px ≤ 8）`)
        this.resolveMapClick(p, false)
      } else {
        logger.info(`[WarmCurrent] 观察态拖拽不结算（位移 ${dpx.toFixed(1)}px > 8，环绕归相机层）`)
      }
      return
    }
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

  /** 拖线视觉合法性（权威判定在 transport.tryCreateRoute；2026-09-13 镜像中转链组合） */
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
    // 中转链星段（星↔中转站，relay_in）
    if ((ka === 'star' && kb === 'building') || (ka === 'building' && kb === 'star')) {
      const star = ka === 'star' ? (a as { star: StarId }).star : (b as { star: StarId }).star
      return this.transport.starUnlocked(star) && (ka === 'building' ? this.buildingLinkable(a) : this.buildingLinkable(b))
    }
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
    this.syncDynamicPayloadModules()
    this.payloadDesignOpen = false
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
    this.stationSel = null
    this.buildingDetailSel = null
    this.selectedShips = []
    this.boxDrag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
    // 取景复位：重开 = 新的一局，镜头回地球系初始取景
    // （clearObserveState 只清观察态不动镜头——从全息地球/行星观察态重开时相机须显式归位）
    this.focusSolarSystem('earth')
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
    this.syncDynamicPayloadModules()
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
    this.stationSel = null
    this.buildingDetailSel = null
    this.selectedShips = []
    this.boxDrag = null
    this.fx.pulses.length = 0
    this.fx.floats.length = 0
    this.toasts.length = 0
    // 恢复后按新档状态决定运行/冻结（与 closePauseMenu 同规则：playing/sandbox 恢复运行，胜负终局保持冻结）
    if (pack.state.outcome === 'playing' || pack.state.sandbox) this.paused = false
    // 取景复位：视图不入存档，读档统一回地球系初始取景（镜头从全息地球/观察态归位）
    this.focusSolarSystem('earth')
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
        const starName = star ? B.stars[star].name : '?'
        const bName = (id: number) => {
          const b = s.buildings.find((x) => x.id === id)
          return b ? `${buildingDefOf(b.type)?.name ?? '站'} ${b.id}` : '站'
        }
        routeInfo = {
          name: route.direction === 'forward' ? `${starName}线`
            : route.direction === 'relay_in' ? `${starName} → ${bName(route.to.kind === 'building' ? route.to.buildingId : 0)}`
            : route.direction === 'relay_out' ? `${bName(route.from.kind === 'building' ? route.from.buildingId : 0)} → 地球`
            : '中转站供应线',
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
    // 航线管理面板行：全部航线紧凑视图（正向「月球线」/ 反向「供应线·中转站 N」/
    // 中转链「月球 → 站 N」「站 N → 地球」，与运输面板 routeNameOf 同口径）
    const routeNameOf = (route: SimRoute): string => {
      if (route.direction === 'forward') {
        const star = starOfEndpoint(s, route.from)
        return `${star ? B.stars[star].name : '?'}线`
      }
      const bName = (id: number) => {
        const b = s.buildings.find((x) => x.id === id)
        return b ? `${buildingDefOf(b.type)?.name ?? '站'} ${b.id}` : '站'
      }
      if (route.direction === 'relay_in') {
        const star = starOfEndpoint(s, route.from)
        return `${star ? B.stars[star].name : '?'} → ${bName(route.to.kind === 'building' ? route.to.buildingId : 0)}`
      }
      if (route.direction === 'relay_out') {
        return `${bName(route.from.kind === 'building' ? route.from.buildingId : 0)} → 地球`
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
      stats: route.stats ?? { trips: 0, loaded: 0, frozen: 0 },
    }))
    // 星球信息面板数据（planetInfoSel 为空 = 收起）
    const planetInfo = this.planetInfoSel ? this.buildPlanetInfo(this.planetInfoSel) : null
    // 全息勘探面板数据（hologramSel 为空 = 收起）
    const hologram = this.hologramSel ? this.buildHologram(this.hologramSel) : null
    // 轨道建设面板数据（orbitBuildSel 为空 = 收起）
    const orbitBuild = this.orbitBuildSel ? this.buildOrbitBuild(this.orbitBuildSel) : null
    // 船坞造船面板数据（shipyardSel 为空 = 收起；船坞被拆/不存在 → null 收起）
    const shipyard = this.shipyardSel !== null ? this.buildShipyardVM(this.shipyardSel) : null
    // 火箭设计面板数据（底部 HUD 入口；不依赖船坞，无坞也能设计）
    const shipDesign = this.designOpen ? this.buildShipDesignVM() : null
    // 荷载设计面板数据（火箭设计工坊「荷载设计」入口；与火箭设计互斥开合）
    const payloadDesign = this.payloadDesignOpen ? this.buildPayloadDesignVM() : null
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
        miningMult: ringMods.miningMult,
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
      // 供应链口径：满负荷到手速率 + 断环倒计时（净流出时储量可烧秒数）+ 稳供幕目标进度
      supplyRate: supplyRateOf(s),
      reserveSeconds: demand > supplyRateOf(s)
        ? s.earthH3 / Math.max(0.01, demand - supplyRateOf(s))
        : null,
      supplyStreak: s.supplyStreak,
      supplyGoal: B.supplyStreakGoal,
      supplyReward: B.supplyStreakReward,
      starStocks: Object.fromEntries((['moon', 'europa', 'mars'] as StarId[]).map((star) => [star, {
        stock: starStockOf(s, star),
        cap: B.starStockCap[star],
        miningRate: starMiningRate(s, star, ringMods),
      }])),
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
      hologram,
      orbitBuild,
      shipyard,
      station: this.stationSel ? this.buildStation(this.stationSel) : null,
      shipDesign,
      payloadDesign,
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
      hasDeposits: depositsOf(body).length > 0,
      stockyard: starDef
        ? { stock: Math.floor(starStockOf(s, body)), cap: B.starStockCap[body as StarId], miningRate: Math.round(starMiningRate(s, body, ringModsOf(s)) * 10) / 10 }
        : null,
    }
  }

  /** 轨道建筑类型行投影（orbit_build 表驱动；轨道建设面板与全息地球「轨道建筑」分类共用） */
  private orbitBuildTypeRows(anchor: PlanetBodyId): HudOrbitBuildRow[] {
    const s = this.simState.state
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    return Object.entries(B.orbitBuildings).map(([id, def]) => {
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
  }

  /** 轨道建设面板数据装配（orbitBuildSel → HudOrbitBuild；表驱动类型行 + 在册设施行） */
  private buildOrbitBuild(anchor: PlanetBodyId): HudOrbitBuild {
    const s = this.simState.state
    const shipyard = this.orbitBuild.shipyardMults(anchor)
    const rows = this.orbitBuildTypeRows(anchor)
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

  /** 空间站舱段面板数据装配（stationSel → HudStation；station_module 表键序模块池 + 已装态） */
  private buildStation(obId: number): HudStation | null {
    const s = this.simState.state
    const ob = s.orbitBuildings.find((x) => x.id === obId && x.type === 'station')
    if (!ob) return null
    const def = orbitBuildingDefOf('station')
    const playable = (s.outcome === 'playing' || s.sandbox) && s.flare.phase !== 'active'
    const mods = ob.modules ?? []
    return {
      id: ob.id,
      name: `${def?.name ?? '空间站'} ${ob.id}`,
      anchorName: `${PLANET_NAMES[ob.anchor] ?? B.stars[ob.anchor as StarId]?.name ?? ob.anchor}轨道`,
      built: ob.built,
      progressPct: Math.round(ob.progress * 100),
      moduleCount: mods.length,
      modules: Object.entries(B.stationModules).map(([id, m]) => {
        const installed = mods.includes(id)
        return {
          id,
          name: m.name,
          desc: m.desc,
          cost: m.cost,
          installed,
          canToggle: installed || (playable && s.earthH3 >= m.cost),
        }
      }),
    }
  }

  /** 船坞造船面板数据装配（shipyardSel → HudShipyard；船型/模块表行 + 槽位占用 + 三星试航 + 设计模板 + 逐船一卡队列） */
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
    // 槽位口径：切换船型后不兼容/满槽模块剔除（就地修正，与面板显示一致）
    this.shipyardSelModules = this.shipyardSelModules.filter((id) => hullHasSlotFor(this.shipyardSelHull, this.shipyardSelModules.filter((x) => x !== id), id))
    const usage = modulesSlotUsage(this.shipyardSelHull, this.shipyardSelModules)
    const capacity = hullSlotCapacity(this.shipyardSelHull)
    // 部位选件制（2026-09-13）：与设计面板同源——点槽位格出该槽型多档部件
    const { sel: selSlot, slotCells } = this.buildSlotCells(usage, capacity)
    const stackRows = this.buildStackRows(usage, capacity)
    const addMenu = this.buildAddMenu(usage, capacity)
    const slotOptions = this.buildSlotOptions(selSlot, usage, capacity)
    // 槽位占用行（ship_hull.slots 表键序）
    const slotRows = Object.entries(capacity).map(([type, cap]) => ({
      name: SLOT_TYPE_NAMES[type] ?? type,
      used: usage[type] ?? 0,
      cap,
    }))
    // 试航行（三星口径）+ 线路反推（补当前供应缺口）
    const gap = Math.max(0, this.simState.demand - supplyRateOf(s))
    const trials: HudTrialRow[] = (['moon', 'europa', 'mars'] as StarId[]).map((star) => {
      const trial = shipTrialOf(s, this.shipyardSelHull, this.shipyardSelModules, star, ringModsOf(s))
      const unlocked = this.transport.starUnlocked(star)
      return {
        star,
        starName: B.stars[star].name,
        unlocked,
        unlockAct: B.stars[star].unlockAct,
        load: Math.round(trial?.load ?? 0),
        cycleS: Math.round(trial?.cycleS ?? 0),
        fuel: Math.round(trial?.fuel ?? 0),
        net: Math.round(trial?.net ?? 0),
        throughput: Math.round((trial?.throughput ?? 0) * 10) / 10,
        shipsForGap: unlocked ? shipsNeededFor(trial, gap) : -1,
      }
    })
    const designs: HudDesignRow[] = s.shipDesigns.map((d, idx) => ({
      idx,
      name: d.name,
      hullName: shipHullDefOf(d.hull)?.name ?? d.hull,
      modules: d.modules.map((id) => shipModuleDefOf(id)?.name ?? id).join('、'),
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
      selSlot,
      slotOptions,
      slotCells,
      stackRows,
      addMenu,
      slotRows,
      trials,
      designs,
      canSaveDesign: yard,
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

  // ─── 船型设计模板 + 一键推荐（2026-09-13 船队设计工坊；面板按钮调用） ───

  /** 船坞面板：选船型（不兼容/满槽模块自动剔除；槽型表随船型变 → 部位选中失效） */
  setShipyardHull(hullId: string): void {
    if (!shipHullDefOf(hullId)) return
    this.shipyardSelHull = hullId
    this.shipyardSelModules = this.shipyardSelModules.filter((id) => hullAllowsModule(hullId, id))
    this.shipyardSelSlot = null
    this.shipyardAddMenuOpen = false
  }

  /** 船坞面板：勾选/取消模块（槽位校验：hullHasSlotFor 单一口径；单船同模块一件） */
  toggleShipyardModule(moduleId: string): void {
    if (!shipModuleDefOf(moduleId)) return
    const mods = this.shipyardSelModules
    const at = mods.indexOf(moduleId)
    if (at >= 0) {
      mods.splice(at, 1)
      return
    }
    if (!hullHasSlotFor(this.shipyardSelHull, mods, moduleId)) {
      this.simState.hint(`${shipModuleDefOf(moduleId)!.name}槽位已满（${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}）`)
      return
    }
    mods.push(moduleId)
  }

  // ─── 部位选件制（2026-09-13 设计工坊：点部位 → 同功能多档部件挑数值） ───

  /** 装配台点部位（槽型 + 同型实例序；② 区据选出该槽型部件清单） */
  selectShipyardSlot(type: string, idx: number): void {
    const cap = hullSlotCapacity(this.shipyardSelHull)[type] ?? 0
    if (idx < 0 || idx >= cap) return
    this.shipyardSelSlot = { type, idx }
  }

  /**
   * 装配台点「+ 加号」（2026-09-17 三轮口径：用户指定部位，不默认荷载）：
   * 打开装配台内的小面板让用户选「荷载 / 燃料 / 引擎」；选了部位 =
   * selectShipyardSlot(type, 该部位下一空实例)。船型无任何空位时按钮置灰本就进不来。
   */
  openShipyardAddMenu(): void {
    const cap = hullSlotCapacity(this.shipyardSelHull)
    const usage = modulesSlotUsage(this.shipyardSelHull, this.shipyardSelModules)
    const open = Object.keys(cap).filter((t) => (usage[t] ?? 0) < (cap[t] ?? 0))
    if (open.length === 0) return
    this.shipyardAddMenuOpen = true
    logger.info(`[WarmCurrent] 装配台加号 → 部位选择（空位部位：${open.join('/')}）`)
  }

  /** 部位选择小面板：选部位（type 非法/该部位无空位忽略；选定即关面板） */
  pickShipyardAddPart(type: string): void {
    if (!this.shipyardAddMenuOpen) return
    this.shipyardAddMenuOpen = false
    const cap = hullSlotCapacity(this.shipyardSelHull)[type] ?? 0
    if (cap <= 0) return
    const used = this.shipyardSelModules.filter((id) => shipModuleDefOf(id)?.slotType === type).length
    if (used >= cap) return
    this.selectShipyardSlot(type, used)
    audioSys.play('wc.draw', { volume: 0.25 })
  }

  /** 部位选择小面板：关闭（再点加号行 = 重开） */
  closeShipyardAddMenu(): void {
    this.shipyardAddMenuOpen = false
  }

  /**
   * 部位选件（(type, idx) 定位实例；模块清单点击入口）：
   *  再点已装本实例的件 = 卸下；本实例已有他件 = 原位换装（其余实例不动）；
   *  目标件已装同级另一实例 = 两实例对调；空实例 = 装入（单船同模块一件约束保留）。
   *  实例 ↔ 模块的对应由 shipyardSelModules 表序派生（同槽型过滤后按下标），无需独立存储；
   *  卸下后同型实例左移补位（模块清单是唯一权威，同类槽位互换、聚合数值不变）。
   */
  pickShipyardSlotModule(type: string, idx: number, moduleId: string): void {
    const def = shipModuleDefOf(moduleId)
    if (!def || def.slotType !== type) return
    if (!hullAllowsModule(this.shipyardSelHull, moduleId)) {
      this.simState.hint(`${def.name}与${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}不兼容`)
      return
    }
    const mods = this.shipyardSelModules
    const typeIdxs = mods
      .map((id, i) => (shipModuleDefOf(id)?.slotType === type ? i : -1))
      .filter((i) => i >= 0)
    const hereAt = typeIdxs[idx] ?? -1
    if (hereAt >= 0) {
      if (mods[hereAt] === moduleId) {
        mods.splice(hereAt, 1) // 再点 = 卸下
        return
      }
      const otherAt = mods.indexOf(moduleId)
      if (otherAt >= 0 && otherAt !== hereAt) {
        // 目标件已装同级另一实例 → 两实例互换（单船同模块一件口径不破）
        const moved = mods[hereAt]
        mods[hereAt] = moduleId
        mods[otherAt] = moved
        this.simState.hint(`已对调：${def.name} ↔ ${shipModuleDefOf(moved)?.name ?? moved}`)
        return
      }
      const old = mods[hereAt]
      mods[hereAt] = moduleId // 原位换装
      this.simState.hint(`已换装：${shipModuleDefOf(old)?.name ?? old} → ${def.name}`)
      return
    }
    if (mods.includes(moduleId)) {
      mods.splice(mods.indexOf(moduleId), 1) // 同模块单件：该件在别的实例上 → 点选 = 卸下
      return
    }
    const used = mods.filter((id) => shipModuleDefOf(id)?.slotType === type).length
    const cap = hullSlotCapacity(this.shipyardSelHull)[type] ?? 0
    if (used >= cap) return // 防御（空实例时 used < cap 恒成立）
    mods.push(moduleId)
  }

  /** 保存当前面板选择为设计模板（名字自动编号；存进 SimState 随档走） */
  saveShipDesign(): boolean {
    const s = this.simState.state
    const name = `配置 ${s.shipDesigns.length + 1}`
    s.shipDesigns.push({ name, hull: this.shipyardSelHull, modules: [...this.shipyardSelModules] })
    this.simState.hint(`已保存「${name}」（${shipHullDefOf(this.shipyardSelHull)?.name ?? this.shipyardSelHull}）`)
    return true
  }

  /** 删除设计模板 */
  deleteShipDesign(idx: number): boolean {
    const s = this.simState.state
    if (idx < 0 || idx >= s.shipDesigns.length) return false
    const [gone] = s.shipDesigns.splice(idx, 1)
    this.simState.hint(`已删除「${gone.name}」`)
    return true
  }

  /** 载入设计模板 → 面板选择（返回是否成功；script 据此刷新勾选态） */
  loadShipDesign(idx: number): boolean {
    const s = this.simState.state
    const d = s.shipDesigns[idx]
    if (!d || !shipHullDefOf(d.hull)) return false
    this.shipyardSelHull = d.hull
    this.shipyardSelModules = d.modules.filter((id) => hullAllowsModule(d.hull, id))
    this.shipyardSelSlot = null
    this.shipyardAddMenuOpen = false
    this.simState.hint(`已载入「${d.name}」`)
    return true
  }

  /**
   * 一键推荐配置（能过关但非最优——《火箭工坊》同款兜底）：
   * 启发式 = 重载型双货舱 + 货泵（当级性价比最高的运量配置）；耀斑期倾向防务型防冻。
   * 2026-09-14 荷载口径收口：现货舱内件不可直接选装后，推荐不再含泵——货泵类效果
   * 走荷载设计工坊合成（自产合成件 id 因人而异，推荐只落静态表通用件）。
   */
  recommendShipDesign(): { hull: string; modules: string[] } {
    const flareRisk = this.simState.state.flare.phase !== 'idle'
    if (flareRisk) return { hull: 'guardian', modules: ['cargo_hold'] }
    return { hull: 'hauler', modules: ['cargo_hold'] }
  }

  /** 一键推荐并应用到面板选择（shipyard_panel「⚙ 一键推荐配置」按钮） */
  applyShipyardRecommend(): void {
    const rec = this.recommendShipDesign()
    this.setShipyardHull(rec.hull)
    this.shipyardSelModules = []
    for (const id of rec.modules) this.toggleShipyardModule(id)
    this.simState.hint('已填入推荐配置（能过关但非最优，按需微调；货舱为现货件，不在「荷载」部位清单展示）')
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
