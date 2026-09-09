/**
 * balance — 《暖流计划》数值中枢（默认值 + 配置表覆盖）
 *
 * 平衡方案 V1 全量数值的代码默认值在此；运行时经 refreshBalanceFromConfigs()
 * 用 asset/config/*.config.json / *.table.json 覆盖（GameMode.InitGame / restart 时刷新）。
 * 消费方一律读 B.*（可变单例），不要 import 旧常量。
 * 星图布局用画布坐标（1920×1080，y 向下），与渲染/拾取约定一致。
 */
import { ConfigRegistry } from '@/engine'
import type { PlanetId, ResearchLineId, StarId } from './types'

// ─── 类型 ───

export interface StarBalance {
  id: StarId
  name: string
  /** 单船满载量（吨 H3） */
  load: number
  /** 距离系数（影响单程时间与油耗） */
  dist: number
  /** 解锁幕 */
  unlockAct: 1 | 2 | 3
}

export interface MapNodeCfg { x: number; y: number; r: number }

/**
 * 行星系子表（star_map.config.json systems 键，每系统一张表）：
 * center=本系中心天体（solar=sun，子系=行星）；nodes=本系成员布局（本系局部画布
 * 1920×1080，中心天体放 (960,540)，成员方位=初相位、距中心距离=轨道半径）。
 */
export interface MapSystemCfg { center: string; nodes: Record<string, MapNodeCfg> }

/** 舰队维护费阶梯行：ships = 船队规模上限（含），costPerS = 维护费速率（H3/秒，全舰队合计） */
export interface FleetMaintTier { ships: number; costPerS: number }

/** 建筑定义（= building.table.json 行，行键 = SimBuilding.type） */
export interface BuildingDef {
  name: string
  desc: string
  /** 放置造价（H3） */
  cost: number
  /** 功能半径（地图 px；护盾气泡等，0 = 无半径功能） */
  radius: number
  /** 缓存物资上限（中转站） */
  bufferCap: number
  /** 护盾保全容量（耀斑结算名额） */
  shipCap: number
  /** 耀斑结束护盾内存活船恢复延迟（秒） */
  resumeDelay: number
  /** 拆除返还比例（按造价+缓存物资折算 H3） */
  refundPct: number
  /** 可否被航线链接（地球↔建筑 补给线） */
  linkable: boolean
}

/** 卡 id（= cards.table.json 行键） */
export type CardId = string

export type CardType = 'unlock' | 'upgrade'

export interface CardEffects {
  fuelMult?: number; speedMult?: number; cargoMult?: number; burnMult?: number
  /** 聚能环建设计费乘区（环网扩容 0.75，叠乘） */
  ringBuildCostMult?: number
  moonLoadAdd?: number; otherLoadAdd?: number; gravityAdd?: number; fleetBonus?: number
  flareWarning?: boolean
  /** 本次点亮交点数（双生节点=2，缺省 1） */
  extraNodes?: number
  /** 该线（self=触发线）下一节点生长倍率（一次性，节点完成后复位 1） */
  nextGrowth?: { line: 'self' | ResearchLineId; mult: number }
}

export interface CardDef {
  id: CardId
  name: string
  type: CardType
  line: ResearchLineId
  /** 得（绿字文案） */
  gain: string
  /** 失（红字文案） */
  cost: string
  effects: CardEffects
}

// ─── 画布常量（美术约定，非配置） ───

export const MAP_W = 1920
export const MAP_H = 1080

/** 地图系 → 世界系（XZ 地面；渲染/拾取/相机/GM 共用换算） */
export const toWX = (mx: number): number => mx - MAP_W / 2
export const toWZ = (my: number): number => my - MAP_H / 2

/** 太阳系取景天体清单（sol GM 命令与 focusSolarSystem 共用，天体增减只改此处；行星均可进入行星系视角） */
export const SOLAR_FOCUS_BODIES = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'europa', 'saturn', 'uranus', 'neptune'] as const
export type SolarFocusBody = (typeof SOLAR_FOCUS_BODIES)[number]

/** 配色（模块 10 §2） */
export const COLORS = {
  bg0: '#0a1822',
  bg1: '#0e2a3a',
  panel: '#1a1f26',
  orange: '#ff6a3d',
  amber: '#ffb03d',
  ice: '#bfe9ff',
  blue: '#3fa9f5',
  green: '#43d17c',
  red: '#e84545',
  dim: '#5a707f',
} as const

// ─── 星图布局（每行星系一张子表；扁平 nodes/moons 由 flattenMapSystems 派生） ───

/** 代码内置默认星图子表（star_map.config.json 未加载时兜底；与表内容保持同步） */
export const DEFAULT_MAP_SYSTEMS = {
  solar: {
    center: 'sun',
    nodes: {
      sun: { x: 960, y: 540, r: 96 },
      mercury: { x: 932, y: 447, r: 11 },
      venus: { x: 1131, y: 599, r: 17 },
      earth: { x: 960, y: 790, r: 38 },
      mars: { x: 1230, y: 271, r: 34 },
      jupiter: { x: -296, y: 877, r: 46 },
      saturn: { x: 3263, y: 1158, r: 40 },
      uranus: { x: -3674, y: -703, r: 24 },
      neptune: { x: 8418, y: -407, r: 23 },
    },
  },
  earth: {
    center: 'earth',
    nodes: {
      earth: { x: 960, y: 540, r: 38 },
      moon: { x: 2160, y: 540, r: 17 },
    },
  },
  jupiter: {
    center: 'jupiter',
    nodes: {
      jupiter: { x: 960, y: 540, r: 46 },
      europa: { x: 960, y: 464, r: 30 },
    },
  },
} as Record<string, MapSystemCfg>

/**
 * 子表展开 → 全局扁平布局（B.map.nodes / B.map.moons，8 处消费文件的兼容接口）：
 * solar 表节点直落全局画布；子系表按"中心天体贴 solar 表同名锚点"整体平移，
 * 成员距中心距离 = 卫星轨道半径、方位 = 初相位（moons 由子系表自动派生，不再手写）。
 * 纯函数：改子表后重开一局由 refreshBalanceFromConfigs 重展开。
 */
export function flattenMapSystems(systems: Record<string, MapSystemCfg>): {
  nodes: Record<string, MapNodeCfg>
  moons: Record<string, { parent: string; radius: number }>
} {
  const nodes: Record<string, MapNodeCfg> = {}
  const moons: Record<string, { parent: string; radius: number }> = {}
  const solar = systems.solar
  if (solar) for (const [id, n] of Object.entries(solar.nodes)) nodes[id] = { ...n }
  for (const sys of Object.values(systems)) {
    if (!sys || sys === solar) continue
    const c = sys.nodes[sys.center]
    if (!c) continue
    // 子系中心锚点 = solar 表同名天体（其显示半径 r 亦以 solar 表为准）
    const anchor = nodes[sys.center] ?? { x: c.x, y: c.y, r: c.r }
    for (const [id, n] of Object.entries(sys.nodes)) {
      if (id === sys.center) continue
      nodes[id] = { x: anchor.x + (n.x - c.x), y: anchor.y + (n.y - c.y), r: n.r }
      moons[id] = { parent: sys.center, radius: Math.hypot(n.x - c.x, n.y - c.y) }
    }
  }
  return { nodes, moons }
}

/** 用当前 B.map.systems 重展开扁平 nodes/moons（配置覆盖后调用） */
function applyMapSystems(): void {
  const flat = flattenMapSystems(B.map.systems)
  B.map.nodes = flat.nodes as Record<'sun' | PlanetId | 'moon' | 'europa', MapNodeCfg>
  B.map.moons = flat.moons as Record<'moon' | 'europa', { parent: PlanetId; radius: number }>
}

/** 默认子表的初始扁平派生（B 字面量初始化用；展开语义见 flattenMapSystems） */
const DEFAULT_MAP_FLAT = flattenMapSystems(DEFAULT_MAP_SYSTEMS)

// ─── 运行时数值单例（默认值 = 平衡方案 V1） ───

export const B = {
  // 全局
  earthH3Start: 800,
  baseBurnPerLeg: 20,
  baseLegSeconds: 6,
  loadSeconds: 2,
  unloadSeconds: 2,
  dangerReserveSeconds: 60,
  startNodes: 1,
  researchNodeCap: 11,
  totalNodes: 12,
  /** 聚能环等级阶梯级数（满级 = 覆盖 100% 全球组网；25 级 × 2.5h 局时长 ≈ 每级 6 分钟） */
  ringLevels: 25,
  nodeInterval: 130,
  runningRateBonus: 1.25,
  /** 研究点数加成：每点对所在线推进速率的加算倍率（速率 = 基础 × (1 + 点数×此值)） */
  researchPointRateAdd: 0.5,
  /** 研究点数计费：每点每秒消耗 H3（吨/秒/点；断环或储量耗尽不计费不加成） */
  researchPointCostPerS: 3,
  /** 聚能环建设（造价制，2026-09-08 拍板：每级交点独立 H3 造价，进度 = 已投入 ÷ 本级造价。
   *  ring_build.config.json（标量）+ level_cost.table.json（逐级造价）可覆盖：
   *  defaultPoints = 开局建设点数；minPoints = 最低保留点数（回收封底，0 = 可清空暂停建设）；
   *  costPerS = 每点每秒灌入 H3（吨/秒/点，灌入即计费；全局速度杠杆，速度 = costPerS × 点数 ÷ 本级造价）；
   *  levelCost = 第 n 个交点的总造价（吨；灌满 → 交点点亮；运行时 × ringBuildCostMult 卡折扣）。
   *  点数 0 或断环（=储量耗尽）停建，断环还停费，无衰减乘区。原 rateAdd/nodeInterval 随造价制移除
   *  （提速调 costPerS，节奏调表造价）。 */
  ringBuild: {
    defaultPoints: 1,
    minPoints: 0,
    costPerS: 2,
    levelCost: [107, 107, 107, 107, 107, 107, 107, 107, 107, 107, 107, 107],
  },
  /** 堆心温度降温时长（秒）：储量耗尽（断环）期间堆心从满温缓降到 0 = 堆心熄灭 */
  coreCoolSeconds: 30,
  /** 堆心温度升温时长（秒）：补入燃料后堆心从 0 缓慢回满（不会瞬间回满） */
  coreWarmSeconds: 10,
  initialShips: 3,
  shipBuildCost: 180,
  shipBuildTime: 15,
  cargoBase: 200,
  shipRebuildCost: 150,
  materialH3PerUnit: 0.5,
  // 舰队维护费阶梯（按总船数升序查档：船越多维护费越高 → H3/秒 从地球储备持续扣除）
  fleetMaint: [
    { ships: 3, costPerS: 0 },
    { ships: 5, costPerS: 1 },
    { ships: 8, costPerS: 2 },
    { ships: 12, costPerS: 3.5 },
    { ships: 99, costPerS: 5 },
  ] as FleetMaintTier[],
  // 飞船数量上限（按聚能环等级查 ship_cap 表 l1..l25；只挡主动造船，卡片/GM 加船可越限）。
  // 曲线 2+⌈0.4×等级⌉：Lv1=3（开局满编，升环解锁造船）→ Lv25=12（与 fleetMaint 顶档对齐）
  shipCap: [3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 12],
  act2Nodes: 4,
  act3Nodes: 8,
  act3SurviveSeconds: 240,
  moduleLegSeconds: 36,
  moduleLoadSeconds: 3,
  moduleUnloadSeconds: 3,
  // 资源星
  stars: {
    moon: { id: 'moon', name: '月球', load: 200, dist: 1.0, unlockAct: 1 },
    europa: { id: 'europa', name: '木卫二', load: 600, dist: 3.0, unlockAct: 2 },
    mars: { id: 'mars', name: '火星', load: 1500, dist: 6.0, unlockAct: 3 },
  } as Record<StarId, StarBalance>,
  // 等级焚烧表（下标 = 聚能环等级 − 1）：等级提升 → H3 消耗每一级翻倍
  // 指数曲线 burn(l) = 2^l：Lv1(开局1交点)=2 → Lv25(满级12交点全球组网)=2^25，每一级都是上一级的翻倍（×2）
  // 与 asset/config/level_burn.table.json 双写同步（tests/warm_level_burn.test.ts 锁定）
  levelBurn: Array.from({ length: 25 }, (_, i) => 2 ** (i + 1)),
  // 事件
  gravity: { period: 90, warn: 10, active: 20, speedMult: 2.0, fuelMult: 0.5 },
  flare: { minInterval: 100, maxInterval: 150, duration: 20, warnLead: 10, firstDelay: 60 },
  // 地图建筑（building.table.json 覆盖；行键 = SimBuilding.type，建造面板行序 = 键序）
  buildings: {
    relay: { name: '中转站', desc: '被航线链接 · 缓存物资', cost: 150, radius: 0, bufferCap: 800, shipCap: 0, resumeDelay: 0, refundPct: 0.5, linkable: true },
    shield: { name: '磁场护盾发生器', desc: '耀斑护盾 · 半径内保全飞船', cost: 220, radius: 220, bufferCap: 0, shipCap: 2, resumeDelay: 3, refundPct: 0.5, linkable: false },
  } as Record<string, BuildingDef>,
  // 建筑放置（建造模式）
  build: {
    /** 网格间距（地图 px；放置吸附 + 网格线） */
    grid: 40,
    /** 建筑间最小间距（地图 px） */
    minSpacing: 44,
    /** 距太阳最小净空（太阳半径 + 该值内不可放） */
    sunClearance: 24,
    /** 建筑入轨：本征轨道切向公转速度（px/s；角速度 = orbitSpeed / orbitR，离行星越近转越快） */
    orbitSpeed: 1.5,
    /** 建筑入轨吸附半径（放置点距行星中心 ≤ 此值自动入轨绕其公转，否则静态放置） */
    orbitAttach: 400,
    /** 轨道半径抬底（入轨半径下限 = 行星显示半径 + 此值，避免轨道穿进行星本体） */
    orbitMinPad: 30,
  },
  // 星图布局（权威 = systems，每行星系一张子表，结构见 MapSystemCfg / star_map.config.json；
  // nodes/moons 为子表展开的扁平缓存：行星轨道圈/卫星环/系视角成员等消费接口不变）
  map: {
    hitTolerance: 28,
    routeHitDistance: 14,
    systems: DEFAULT_MAP_SYSTEMS,
    nodes: DEFAULT_MAP_FLAT.nodes as Record<'sun' | PlanetId | 'moon' | 'europa', MapNodeCfg>,
    moons: DEFAULT_MAP_FLAT.moons as Record<'moon' | 'europa', { parent: PlanetId; radius: number }>,
  },
  // 卡库（refreshBalanceFromConfigs 时由 warm-current.cards 表覆盖；空表回退 DEFAULT_CARDS）
  cards: [] as CardDef[],
}

/** 代码内置默认卡库（cards.table.json 未加载时的兜底；与表内容保持同步） */
export const DEFAULT_CARDS: CardDef[] = [
  { id: 'event_warning', name: '事件预警', type: 'unlock', line: 'infra', gain: '极寒停航提前 10 秒预告', cost: '该线下次生长 −10%', effects: { flareWarning: true, nextGrowth: { line: 'self', mult: 0.9 } } },
  { id: 'engine_overdrive', name: '引擎超频', type: 'upgrade', line: 'engine', gain: '所有航线油耗 −15%', cost: '航速 −5%', effects: { fuelMult: 0.85, speedMult: 0.95 } },
  { id: 'speed_up', name: '航速提升', type: 'upgrade', line: 'engine', gain: '飞行速度 +20%', cost: '油耗 +8%', effects: { speedMult: 1.2, fuelMult: 1.08 } },
  { id: 'moon_enrich', name: '月球富集', type: 'upgrade', line: 'engine', gain: '月球单船满载 +50', cost: '其他星满载 −10', effects: { moonLoadAdd: 50, otherLoadAdd: -10 } },
  { id: 'cargo_expand', name: '扩容货舱', type: 'upgrade', line: 'cargo', gain: '单船货舱 +20%', cost: '单船油耗 +10%', effects: { cargoMult: 1.2, fuelMult: 1.1 } },
  { id: 'fleet_expand', name: '扩编船队', type: 'upgrade', line: 'cargo', gain: '飞船 +1（立即入列空闲池）', cost: '单节点消耗 +5%', effects: { fleetBonus: 1, burnMult: 1.05 } },
  // 2026-09-08 环线移除：环线卡（ring_saving/reserve_expand/thermal_redundancy）下线
  { id: 'gravity_extend', name: '引力延长', type: 'upgrade', line: 'infra', gain: '引力窗口 +5 秒', cost: '单节点消耗 +2%', effects: { gravityAdd: 5, burnMult: 1.02 } },
  { id: 'growth_accel', name: '生长加速', type: 'upgrade', line: 'expand', gain: '本线下一个节点进度条提速 +50%', cost: '单节点消耗 +6%', effects: { nextGrowth: { line: 'self', mult: 1.5 }, burnMult: 1.06 } },
  { id: 'twin_node', name: '环网扩容', type: 'upgrade', line: 'expand', gain: '聚能环建设计费 −25%（施工更省 H3）', cost: '本线下次生长 −20%', effects: { ringBuildCostMult: 0.75, nextGrowth: { line: 'self', mult: 0.8 } } },
]

// ─── 配置覆盖 ───

function assignNumeric(target: Record<string, unknown>, src: Record<string, unknown> | undefined, keys: string[]): void {
  if (!src) return
  for (const k of keys) {
    if (src[k] !== undefined) target[k] = src[k]
  }
}

/**
 * 从 ConfigRegistry 读取 warm-current.* 配置覆盖默认值。
 * GameMode.InitGame / sim.restart 时调用（改表后重开一局即生效）。
 * 配置未注册（单测/独立预览）时静默保留代码默认值。
 */
export function refreshBalanceFromConfigs(): void {
  try {
    const g = ConfigRegistry.getConfig<Record<string, unknown>>('warm-current.global')
    assignNumeric(B as unknown as Record<string, unknown>, g, [
      'earthH3Start', 'baseBurnPerLeg', 'baseLegSeconds', 'loadSeconds', 'unloadSeconds',
      'dangerReserveSeconds', 'startNodes', 'researchNodeCap', 'totalNodes', 'ringLevels', 'nodeInterval',
      'runningRateBonus', 'researchPointRateAdd', 'researchPointCostPerS', 'coreCoolSeconds', 'coreWarmSeconds', 'initialShips', 'shipBuildCost', 'shipBuildTime', 'cargoBase',
      'shipRebuildCost', 'materialH3PerUnit', 'act2Nodes', 'act3Nodes', 'act3SurviveSeconds',
      'moduleLegSeconds', 'moduleLoadSeconds', 'moduleUnloadSeconds',
    ])
  // 聚能环建设参数（独立配置 warm-current.ring_build；字段级覆盖，未配置字段保留 B 兜底。
  // 注：文件内容包在 "ringBuild" 键下，getConfig 返回顶层 → 取 rbCfg.ringBuild 解包）
  try {
    const rbRaw = ConfigRegistry.getConfig<Record<string, unknown>>('warm-current.ring_build')
    const rbCfg = (rbRaw?.ringBuild ?? rbRaw) as Record<string, number>
    if (rbCfg) {
      for (const k of ['defaultPoints', 'minPoints', 'costPerS'] as const) {
        if (typeof rbCfg[k] === 'number') (B.ringBuild as unknown as Record<string, number>)[k] = rbCfg[k]
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 聚能环交点造价表（level_cost.table.json：n1..n12 行 → B.ringBuild.levelCost 按序覆盖）
  try {
    const costTable = ConfigRegistry.getTable<{ cost: number }>('warm-current.level_cost')
    if (costTable) {
      const costs: number[] = []
      const keys = costTable.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) costs.push(costTable.getRow(k)!.cost)
      if (costs.length > 0) B.ringBuild.levelCost = costs
    }
  } catch { /* 未注册 → 默认值 */ }

  // 飞船数量上限表（ship_cap.table.json：l1..l25 行 → B.shipCap 按序覆盖）
  try {
    const capTable = ConfigRegistry.getTable<{ cap: number }>('warm-current.ship_cap')
    if (capTable) {
      const caps: number[] = []
      const keys = capTable.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) caps.push(capTable.getRow(k)!.cap)
      if (caps.length > 0) B.shipCap = caps
    }
  } catch { /* 未注册 → 默认值 */ }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<{ name: string; load: number; dist: number; unlockAct: number }>('warm-current.stars')
    if (table) {
      for (const key of table.getRowNames()) {
        const star = B.stars[key as StarId]
        const row = table.getRow(key)
        if (star && row) Object.assign(star, row, { id: key })
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<{ burn: number }>('warm-current.level_burn')
    if (table) {
      const burns: number[] = []
      const keys = table.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) burns.push(table.getRow(k)!.burn)
      if (burns.length > 0) B.levelBurn = burns
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<FleetMaintTier>('warm-current.fleet_maint')
    if (table) {
      const tiers = table.getRowNames()
        .map((k) => table.getRow(k))
        .filter((r): r is FleetMaintTier => !!r && typeof r.ships === 'number' && typeof r.costPerS === 'number')
        .sort((a, b) => a.ships - b.ships)
      if (tiers.length > 0) B.fleetMaint = tiers
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const table = ConfigRegistry.getTable<Partial<BuildingDef>>('warm-current.building')
    if (table) {
      for (const key of table.getRowNames()) {
        const row = table.getRow(key)
        const def = (B.buildings as Record<string, BuildingDef | undefined>)[key]
        if (def && row) Object.assign(def, row)
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const ev = ConfigRegistry.getConfig<{ gravity?: Record<string, number>; flare?: Record<string, number> }>('warm-current.events')
    if (ev?.gravity) Object.assign(B.gravity, ev.gravity)
    if (ev?.flare) Object.assign(B.flare, ev.flare)
  } catch { /* 未注册 → 默认值 */ }

  // 星图布局：systems 子表逐系逐节点合并（默认值兜底；config 新子表可直接追加），合并后重展开扁平 nodes/moons
  try {
    const mp = ConfigRegistry.getConfig<{ hitTolerance?: number; routeHitDistance?: number; systems?: Record<string, Partial<MapSystemCfg>> }>('warm-current.star_map')
    if (mp) {
      if (mp.hitTolerance !== undefined) B.map.hitTolerance = mp.hitTolerance
      if (mp.routeHitDistance !== undefined) B.map.routeHitDistance = mp.routeHitDistance
      if (mp.systems) {
        for (const [sid, sys] of Object.entries(mp.systems)) {
          if (!sys) continue
          let cur = B.map.systems[sid]
          if (!cur) { cur = { center: '', nodes: {} }; B.map.systems[sid] = cur }
          if (sys.center !== undefined) cur.center = sys.center
          for (const [k, node] of Object.entries(sys.nodes ?? {})) {
            const cn = cur.nodes[k]
            if (cn && node) Object.assign(cn, node)
            else if (node) cur.nodes[k] = { ...node }
          }
        }
        applyMapSystems()
      }
    }
  } catch { /* 未注册 → 默认值 */ }

  // 卡库：表优先，空/未注册回退内置默认
  B.cards = DEFAULT_CARDS
  try {
    const table = ConfigRegistry.getTable<{ name: string; type: string; line: ResearchLineId; gain: string; cost: string; effects?: CardEffects }>('warm-current.cards')
    if (table && table.getRowNames().length > 0) {
      B.cards = table.getRowNames().map((id) => {
        const row = table.getRow(id)!
        return {
          id, name: row.name, type: row.type as CardDef['type'], line: row.line,
          gain: row.gain, cost: row.cost, effects: row.effects ?? {},
        }
      })
    }
  } catch { /* 未注册 → 默认值 */ }
}
