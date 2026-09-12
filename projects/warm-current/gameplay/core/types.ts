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

/** 航线端点：地球 / 资源星 / 地图建筑（中转站可接航线） */
export type Endpoint =
  | { kind: 'earth' }
  | { kind: 'star'; star: StarId }
  | { kind: 'building'; buildingId: number }

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

/** 耀斑预警期临时决策（玩家设计权：框选直接指挥；耀斑结束清空） */
export type ShipOrder = 'run' | 'shelter' | 'hold'

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
  /** 船型（ship_hull 表行键；造船时定型，建成后不可改装、冻毁重建保留） */
  hull: string
  /** 选配模块（ship_module 表行键；仅造船时选配，单船生效） */
  modules: string[]
  /** 耀斑预警决策（run=照跑 / shelter=就近靠站 / hold=原地待命；耀斑结束清空） */
  order?: ShipOrder
  /** 靠站改道插值段（画布系 from→to；存在时 shipPos 用此段插值，耀斑结束清空） */
  shelter?: { fx: number; fy: number; tx: number; ty: number } | null
}

/** 造船队列项（逐船一卡：2026-09-09 用户需求——船坞面板每艘在造船一张卡片排队展示） */
export interface SimShipBuild {
  /** 剩余建造秒数（tickBuildQueue 递减） */
  remain: number
  /** 本艘总建造秒（入队时锁定，进度分母 = 1 − remain/total） */
  total: number
  /** 承接船坞的轨道建筑 id（全游戏唯一造船队列的归属记录；GM/桥无参路径 = 0 无船坞归属） */
  dockId: number
  /** 船型（ship_hull 表行键；下线时注入新船） */
  hull: string
  /** 选配模块（ship_module 表行键；下线时注入新船） */
  modules: string[]
}

/** 近地轨道建筑（2026-09-09 用户需求：点行星 → 轨道建设 → 建筑绕行星均布公转；表驱动类型） */
export interface OrbitBuilding {
  id: number
  /** 建筑类型（orbit_build.table.json 行键，B.orbitBuildings 查数值） */
  type: string
  /** 轨道锚定天体（行星或卫星；环绕其公转） */
  anchor: PlanetBodyId
  /** t=0 相位角（rad）；同锚建筑按落位顺序均布 2π/n */
  a0: number
  /** 建造进度 0..1（落位 0 起步，tickBuild 灌进） */
  progress: number
  /** 是否建成（false = 在建；造船等能力需 built=true） */
  built: boolean
}

/** 行星矿产开发设施（2026-09-12 用户需求：全息勘探 → 矿点上造矿建 → 持续产出 H3） */
export interface SimMine {
  /** 矿点 id（mineral_deposit 表行键；一矿点至多一座矿建） */
  depositId: string
  /** 矿建类型（mine_building 表行键，B.mineBuildings 查数值） */
  type: string
  /** 建造进度 0..1（落位 0 起步，tickMines 灌进） */
  progress: number
  /** 是否建成（false = 在建；建成才开始产出） */
  built: boolean
  /** 该矿点已采出累计（吨；矿点余量 = 表 reserve − Σ同点 extracted） */
  extracted: number
}

export type BuildingTypeId = 'relay' | 'shield'/** 地图建筑（建造面板选型 → 星图自由放置；type = building 表行键）。
 *  中转站（relay）：可被航线链接，反向补给线送建材入缓存；
 *  磁场护盾发生器（shield）：耀斑期间保护半径内飞船（容量限额）。
 *  入轨（2026-09-08 拍板）：靠近行星放置的建筑自动锚定该行星入轨绕其公转
 *  （渲染/航线/护盾判定一律走 buildingPos 实时位置）；远离行星 = 静态放置。 */
export interface SimBuilding {
  id: number
  /** 建筑类型（building.table.json 行键，B.buildings 查数值） */
  type: string
  /** 放置落点（画布系；入轨建筑仅作放置记录，实时位置走 buildingPos） */
  x: number
  y: number
  /** 缓存物资（中转站：反向补给线运抵的建材，上限 B.buildings[type].bufferCap） */
  stock: number
  /** 建造投入 H3（拆除返还折算用；强化投入并入 → 返还公式自动折算） */
  invested: number
  /** 已装强化分支（building.table.json upgrades 行键；null/缺失 = 未强化；一槽二选一） */
  upgrade?: string | null
  /** 轨道锚定天体（行星或卫星；缺失 = 未入轨静态建筑，旧档兼容口径） */
  anchor?: PlanetBodyId
  /** 轨道半径（px，距锚行星中心；放置过近按行星显示半径+pad 抬底） */
  orbitR?: number
  /** t=0 相位角（rad）：实时相位 = orbitA0 + ω·time，ω = orbitSpeed/orbitR（纯时间函数） */
  orbitA0?: number
}

/** 研究线 id（2026-09-08 环线移除：聚能环建设独立成 RingBuildComponent，科研四线） */
export type ResearchLineId = 'engine' | 'cargo' | 'infra' | 'expand'

export interface SimResearchLine {
  id: ResearchLineId
  name: string
  /** 当前节点进度 0..1 */
  progress: number
  /** 下一节点推进倍率（卡 tradeoff / 生长加速 一次性修正，节点完成后复位 1） */
  nextMult: number
  /** 已分配研究点数（聚能环每升 1 级得 1 点；点数提速同时按点计 H3 消耗） */
  points: number
}

export interface PendingCard {
  line: ResearchLineId
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
  /** 建成建筑数 */
  buildingsBuilt: number
  /** 已选海克斯卡数 */
  cardsTaken: number
}

/**
 * H3 收支账本（对局累计，吨；统计面板消费）。
 * 收入项：unload / demolishRefund；支出项：其余。每一项都对应 earthH3 的一个真实变动点。
 */
export interface SimLedger {
  /** 航线卸货净收入（正向到港 net = 满载 − 油耗） */
  unload: number
  /** 拆除补给站返还（按投入建材折算 H3） */
  demolishRefund: number
  /** 聚能环焚烧（持续） */
  ringBurn: number
  /** 聚能环建设计费（持续，按建设点数 × 每点每秒单价；脱离科研的独立流） */
  ringBuild: number
  /** 研究点数计费（持续，按各线已分配点数合计 × 每点每秒单价） */
  research: number
  /** 舰队维护费（持续，按船队规模查 fleet_maint 阶梯） */
  fleetMaint: number
  /** 近地轨道建筑建造（一次性：落位全款） */
  orbitBuild: number
  /** 矿建建造（一次性：落位全款） */
  mineBuild: number
  /** 矿建产出（持续：建成矿建按 yieldPerS 采出，吨） */
  mining: number
  /** 造船 */
  shipBuild: number
  /** 冻毁船重建 */
  shipRebuild: number
  /** 反向航线油耗（送建材往返） */
  reverseFuel: number
  /** 反向航线建材折算 H3 */
  materials: number
  /** 环段建筑安装费 + 拆除费（一次性；环构筑经济池） */
  ringInstall: number
  /** 地图建筑强化：安装费（拆除费不返还也不计账——纯损耗） */
  buildingUpgrade: number
}

export type SimEventType =
  | 'route_built'
  | 'route_deleted'
  | 'slot_built'
  | 'ring_installed'
  | 'ring_demolished'
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
  | 'building_built'
  | 'orbit_building_built'
  | 'mine_built'
  | 'building_demolished'
  | 'upgrade_installed'
  | 'upgrade_removed'
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
  /** 堆心温度 0..100（100 = 满温运转；无燃料持续降温，归零 = 堆心熄灭 = 终结） */
  coreTemp: number
  /** 燃料门：有燃料 running（焚烧/研究/建设照常），储量耗尽 decaying（停烧停建，堆心降温） */
  ring: 'running' | 'decaying'
  act: 1 | 2 | 3
  /** 已建成环段槽位数（25 槽位制：等级 = 已建成槽位数的连续推导；开局 1 格建成但空置） */
  ringSlots: number
  /** 聚能环建设（脱离科研的独立流）：建设点数（默认 1、最低 1，ring_build 配置表可调） */
  ringBuild: { points: number }
  /** 聚能环建设进度 0..1（当前槽位；满 1 → 槽位 +1 归零） */
  ringBuildProgress: number
  /** 环段建筑装入表（下标 = 槽位号 0..ringSlotsTotal−1；null = 已建成空槽） */
  ringBuildings: (string | null)[]
  /** 拆除中的目标槽（active = 泵灌拆除中；false = 暂停保留进度），null = 无拆除目标 */
  ringDemolish: { slot: number; progress: number; active: boolean } | null
  ships: SimShip[]
  routes: SimRoute[]
  /** 地图建筑（自由放置） */
  buildings: SimBuilding[]
  /** 近地轨道建筑（点行星 → 轨道建设面板；绕锚行星均布公转） */
  orbitBuildings: OrbitBuilding[]
  /** 矿产开发设施（全息勘探 → 矿点造矿建；一矿点一座） */
  mines: SimMine[]
  research: SimResearchLine[]
  pendingCard: PendingCard | null
  /** 选卡排队（多线同时满进度） */
  cardQueue: ResearchLineId[]
  gravity: { phase: 'idle' | 'warn' | 'active'; timer: number }
  flare: { phase: 'idle' | 'warn' | 'active'; timer: number; nextIn: number }
  module: MarsModule
  /** 造船队列（逐船一卡：每项一艘在造船，remain 倒计时 / dockId 承接船坞） */
  buildQueue: SimShipBuild[]
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
  /** H3 收支账本（对局累计，统计面板消费；结构化克隆安全） */
  ledger: SimLedger
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
  /** 聚能环建设计费乘区（环网扩容卡 −25%，叠乘） */
  ringBuildCostMult: number
  /** 引力窗口加秒（引力延长 +5s/张） */
  gravityAdd: number
  /** 事件预警（耀斑提前 10s 预告） */
  flareWarning: boolean
  /** 扩编船队 +1/张 */
  fleetBonus: number
}
