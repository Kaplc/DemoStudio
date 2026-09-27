/**
 * ViewModelComponent — HUD 视图模型装配组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode.buildViewModel 与星球信息/轨道建设/空间站/建筑详情
 * 各 build*VM 投影方法，及全部 Hud 系列与 WarmCurrentVM 视图模型类型，原样迁入）：
 *  - buildViewModel()：仿真状态 + 各域组件状态 → WarmCurrentVM 单一投影，
 *    HUD 主脚本 8Hz 差分同步消费，各面板脚本各取所需字段；
 *  - 跨域子面板投影（船坞/设计工坊/全息）由各自归属处出，此处经
 *    owner.buildXxxVM() 聚合（后续各域下沉为组件后调用点不变）；
 *  - 类型消费兼容：WarmCurrentGameMode.ts 对本文件 re-export 全部类型，
 *    既有 import 路径（'../base/WarmCurrentGameMode'）不受影响。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import type { BuildingUpgradeDef } from '../core/balance'
import {
  buildingByEndpoint, buildingDefOf, buildingEffectiveDef, estimateNetFlow,
  fleetMaintPerS, ledgerTotals, legSeconds, pendingRingNodeCount, placedRingNodes,
  ringBuildRateOf, ringLevelOf, ringModsOf, roundFuel, routeCycleSeconds, routeNetPerTrip,
  shipHullDefOf, shipModuleDefOf, shipTrialOf, shipsNeededFor, starLoad, starOfEndpoint,
  starMiningRate, starStockCapOf, starStockOf, supplyRateOf,
} from '../core/helpers'
import type { RingLevelInfo, SolarBodyId } from '../core/helpers'
import { depositLeft, depositsOf, mineDefOf } from './MiningComponent'
import { getCardDef } from '../core/cards'
import type { CardDef } from '../core/balance'
import { isShipyardType, orbitBuildingDefOf } from './OrbitBuildComponent'
import { PLANET_NAMES } from '../core/planetNames'
import type { PlanetBodyId, PlanetId, SimLedger, SimRoute, StarId } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

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
  /** 航线编辑模式（2026-09-29 起为轨道蓝图台合并态；HUD「航线编辑」按钮高亮态） */
  routeEditMode: boolean
  /** 轨道蓝图台上下文提示（随子状态切换：放置/轨道编辑/拖线；蓝图态 TutText 接管显示） */
  blueprintHint: string
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

export class ViewModelComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'ViewModelComponent'
  }

  // ═══════════════════════════════════════════
  //  HUD 视图模型（UI 脚本每帧消费）
  // ═══════════════════════════════════════════

  buildViewModel(): WarmCurrentVM {
    const sc = this.owner.simState
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
    if (this.owner.selection?.type === 'route') {
      const route = s.routes.find((r) => r.id === this.owner.selection!.id)
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
    if (this.owner.selection?.type === 'building') {
      const b = s.buildings.find((x) => x.id === this.owner.selection!.id)
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
    const planetInfo = this.owner.planetInfoSel ? this.buildPlanetInfo(this.owner.planetInfoSel) : null
    // 全息勘探面板数据（hologramSel 为空 = 收起）
    const hologram = this.owner.hologramSel ? this.owner.buildHologram(this.owner.hologramSel) : null
    // 轨道建设面板数据（orbitBuildSel 为空 = 收起）
    const orbitBuild = this.owner.orbitBuildSel ? this.buildOrbitBuild(this.owner.orbitBuildSel) : null
    // 船坞造船面板数据（shipyardSel 为空 = 收起；船坞被拆/不存在 → null 收起）
    const shipyard = this.owner.shipyardSel !== null ? this.owner.buildShipyardVM(this.owner.shipyardSel) : null
    // 火箭设计面板数据（底部 HUD 入口；不依赖船坞，无坞也能设计）
    const shipDesign = this.owner.designOpen ? this.owner.buildShipDesignVM() : null
    // 荷载/燃料/引擎合成页数据（2026-09-20 并入火箭设计工坊导航页；面板开着即出，随部位页签过滤）
    const payloadDesign = this.owner.designOpen ? this.owner.buildPayloadDesignVM() : null
    // 建筑详情浮层数据（buildingDetailSel 为空/建筑被拆 → null 收起）
    const buildingDetail = this.owner.buildingDetailSel !== null ? this.buildBuildingDetail(this.owner.buildingDetailSel) : null
    // 耀斑预警决策条（预警期 + 框选船非空 = 决策条上屏；canHold = 选中船全部未出发可待命）
    const selShips = this.owner.selectedShips
      .map((id) => s.ships.find((x) => x.id === id))
      .filter((x): x is NonNullable<typeof x> => !!x && x.state !== 'frozen')
    const fleetOrders = {
      windowOpen: this.owner.hazards.orderWindowOpen(),
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
      buildActive: this.owner.buildMode?.typeId ?? null,
      shipRows,
      routes,
      planetInfo,
      hologram,
      orbitBuild,
      shipyard,
      station: this.owner.stationSel ? this.buildStation(this.owner.stationSel) : null,
      shipDesign,
      payloadDesign,
      buildingDetail,
      fleetOrders,
      routeEditMode: this.owner.routeEditMode,
      blueprintHint: this.owner.blueprint.hint(),
      shipRebuildCost: B.shipRebuildCost,
      hasShipyard: !!this.owner.orbitBuildSel && this.owner.orbitBuild.shipyardMults(this.owner.orbitBuildSel) !== null,
      tutorial: s.tutorial,
      paused: this.owner.paused,
      timeScale: this.owner.timeScale,
      moduleState: s.module.state,
      canStartMission: s.act >= 3 && s.module.state === 'available' && sc.idleShips > 0 && s.flare.phase !== 'active',
      outcome: s.outcome,
      sandbox: s.sandbox,
      stats: { delivered: s.stats.delivered, frozen: s.stats.frozenCount, buildings: s.stats.buildingsBuilt, cards: s.stats.cardsTaken },
    }
  }

  /** 星球信息面板数据装配（planetInfoSel → HudPlanetInfo；装饰行星无仿真数据，只给身份与类型） */
  private buildPlanetInfo(body: SolarBodyId): HudPlanetInfo {
    const s = this.owner.simState.state
    const starDef = B.stars[body as StarId] ?? null
    const isEarth = body === 'earth'
    const moonCfg = (B.map.moons as Record<string, { parent: PlanetId } | undefined>)[body]
    const unlocked = isEarth || (!!starDef && this.owner.transport.starUnlocked(starDef.id))
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
      demand: isEarth ? Math.round(this.owner.simState.demand * 10) / 10 : 0,
      netFlow: isEarth ? Math.round(estimateNetFlow(s, this.owner.simState.demand) * 10) / 10 : 0,
      routable: isEarth || !!starDef,
      hasDeposits: depositsOf(body).length > 0,
      stockyard: starDef
        ? { stock: Math.floor(starStockOf(s, body)), cap: B.starStockCap[body as StarId], miningRate: Math.round(starMiningRate(s, body, ringModsOf(s)) * 10) / 10 }
        : null,
    }
  }

  /** 轨道建筑类型行投影（orbit_build 表驱动；轨道建设面板与全息地球「轨道建筑」分类共用） */
  orbitBuildTypeRows(anchor: PlanetBodyId): HudOrbitBuildRow[] {
    const s = this.owner.simState.state
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
    const s = this.owner.simState.state
    const shipyard = this.owner.orbitBuild.shipyardMults(anchor)
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
    const s = this.owner.simState.state
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
  /** 建筑详情浮层数据装配（buildingDetailSel → HudBuildingDetail；强化分支装拆流） */
  private buildBuildingDetail(id: number): HudBuildingDetail | null {
    const s = this.owner.simState.state
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
