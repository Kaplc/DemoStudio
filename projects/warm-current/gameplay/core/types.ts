/**
 * types — 《暖流计划》核心仿真数据类型
 *
 * 铁律：SimState 必须是可 structuredClone 的纯数据（无方法 / 无 Map / 无 THREE 引用），
 * 幕快照（重试本幕）依赖深拷贝。
 */
import type { CardId } from './balance'

export type StarId = 'moon' | 'europa' | 'mars'

/** 行星 id：八大行星（绕太阳；资源星 3 颗是行星的真子集，非资源行星纯装饰/取景） */
export type PlanetId = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

/** 卫星 id：绕行星旋转的天体（B.map.moons 配置驱动） */
export type MoonId = 'moon' | 'europa'

/** 行星或卫星（公转纯函数 starPosAt 的消费域） */
export type PlanetBodyId = PlanetId | MoonId

/** 航线端点：地球 / 资源星 / 补给站站点 */
export type Endpoint =
  | { kind: 'earth' }
  | { kind: 'star'; star: StarId }
  | { kind: 'station'; stationId: number }

export type RouteDirection = 'forward' | 'reverse'

/** 航线：同两端点唯一（重复画线 = 派 1 艘船） */
export interface SimRoute {
  id: number
  from: Endpoint
  to: Endpoint
  direction: RouteDirection
  /** 该航线上的船（光点 = 真船） */
  shipIds: number[]
}

export type ShipState = 'idle' | 'loading' | 'flying' | 'unloading' | 'frozen'

export interface SimShip {
  id: number
  name: string
  state: ShipState
  /** 所属航线（idle 时为 null） */
  routeId: number | null
  /** 去程（载货）/ 回程（空载） */
  leg: 'outbound' | 'return'
  /** 当前航段进度 0..1 */
  progress: number
  /** 当前航段总时长（秒，出发时锁定） */
  legTime: number
  /** 装卸倒计时（秒） */
  timer: number
  /** 舱内 H3（正向） */
  cargo: number
  /** 舱内建材（反向） */
  materials: number
  /** 本次往返油耗（出发时锁定，含引力窗口折价） */
  roundFuel: number
  /** 本次往返航速倍率（出发时锁定） */
  speedMult: number
  /** 卸货后召回（→ idle） */
  recalling: boolean
  /** 耀斑结束后恢复延迟（护盾内存活） */
  resumeDelay: number
  /** 火星环扩展模块任务船 */
  mission: boolean
}

export type StationLevel = 0 | 1 | 2 | 3

/** 无人补给站：level 0 = 站点（建材未达标），1..3 已建成 */
export interface SimStation {
  id: number
  /** 所依附的正向航线（月球/木卫二/火星线中点） */
  routeId: number
  star: StarId
  x: number
  y: number
  level: StationLevel
  /** 已运抵建材 */
  stock: number
  /** 当前目标所需建材（建站 300 / 升级见平衡表） */
  need: number
  /** 累计运抵建材（拆除返还计算用） */
  invested: number
}

export type ResearchLineId = 'engine' | 'cargo' | 'ring' | 'infra' | 'expand'

export interface SimResearchLine {
  id: ResearchLineId
  name: string
  /** 当前节点进度 0..1 */
  progress: number
  /** 下一节点推进倍率（卡 tradeoff / 生长加速 一次性修正，节点完成后复位 1） */
  nextMult: number
}

export interface PendingCard {
  line: ResearchLineId
  /** 卡生成时刻（仿真秒）：15s 自动收纳倒计时基准，重开不重置 */
  since: number
  choices: CardId[]
}

/** 火星环扩展模块任务（胜利前置） */
export interface MarsModule {
  state: 'locked' | 'available' | 'mission' | 'delivered'
  /** 执行任务的船 */
  shipId: number | null
}

export type SimOutcome = 'playing' | 'victory' | 'defeat'

export interface SimStats {
  /** 累计卸货 H3 */
  delivered: number
  /** 冻毁船数 */
  frozenCount: number
  /** 重建船数 */
  rebuiltCount: number
  /** 建成补给站数 */
  stationsBuilt: number
  /** 已选海克斯卡数 */
  cardsTaken: number
}

export type SimEventType =
  | 'route_built'
  | 'route_deleted'
  | 'ship_built'
  | 'ship_rebuilt'
  | 'unload'
  | 'card_pending'
  | 'card_chosen'
  | 'window_warn'
  | 'window_open'
  | 'window_close'
  | 'flare_warn'
  | 'flare_start'
  | 'flare_end'
  | 'frozen'
  | 'station_built'
  | 'station_upgraded'
  | 'station_demolished'
  | 'act2'
  | 'act3'
  | 'module_available'
  | 'victory'
  | 'defeat'
  | 'hint'

export interface SimEvent {
  type: SimEventType
  /** 附加数据（数量 / 提示文案等） */
  value?: number
  text?: string
  /** 世界位置（星图画布坐标，供脉冲特效） */
  x?: number
  y?: number
}

/** 模拟器可观测快照（重试本幕） */
export interface SimState {
  seed: number
  time: number
  earthH3: number
  /** 延续度 0..100 */
  continuity: number
  ring: 'running' | 'decaying'
  /** 缓冲衰减剩余（秒） */
  bufferLeft: number
  /** 本次缓冲衰减总时长（延续度 = bufferLeft/bufferTotal × 100） */
  bufferTotal: number
  act: 1 | 2 | 3
  /** 已解锁节点数 = 覆盖交点数 */
  nodes: number
  ships: SimShip[]
  routes: SimRoute[]
  stations: SimStation[]
  research: SimResearchLine[]
  overclocked: ResearchLineId[]
  pendingCard: PendingCard | null
  /** 海克斯自动收纳时刻（仿真秒）：null=弹窗可见；非 null=已收纳（待卡不弃，HUD 徽标重开） */
  hexHiddenAt: number | null
  /** 选卡排队（多线同时满进度） */
  cardQueue: ResearchLineId[]
  gravity: { phase: 'idle' | 'warn' | 'active'; timer: number }
  flare: { phase: 'idle' | 'warn' | 'active'; timer: number; nextIn: number }
  module: MarsModule
  buildQueue: number[]
  /** 卡片修正集中营（卡效果落地处） */
  mods: SimMods
  /** 已拿卡（解锁型不重复出现） */
  takenCards: CardId[]
  /** 首次画线引导（仅首局、无航线时） */
  tutorial: boolean
  outcome: SimOutcome
  /** 胜利后沙盒模式（无失败压力） */
  sandbox: boolean
  stats: SimStats
  /** 幕入口快照（重试本幕用） */
  actSnapshots: { act2: string | null; act3: string | null }
}

export interface SimMods {
  /** 油耗乘区（引擎超频 −15% / 航速 +8% / 扩容货舱 +10% 叠乘） */
  fuelMult: number
  /** 航速乘区 */
  speedMult: number
  /** 货舱乘区（扩容货舱 +20%） */
  cargoMult: number
  /** 月球满载加成（月球富集 +50） */
  moonLoadAdd: number
  /** 其他星满载加成（月球富集 −10） */
  otherLoadAdd: number
  /** 单节点消耗乘区（节能/tradeoff 叠乘） */
  burnMult: number
  /** 缓冲衰减加秒（储备扩容 +5s/张） */
  bufferAdd: number
  /** 引力窗口加秒（引力延长 +5s/张） */
  gravityAdd: number
  /** 延续度回升倍率（恒温冗余 ×2） */
  recoverMult: number
  /** 事件预警（耀斑提前 10s 预告） */
  flareWarning: boolean
  /** 补给站建造权限 */
  stationUnlocked: boolean
  /** 扩编船队 +1/张 */
  fleetBonus: number
}
