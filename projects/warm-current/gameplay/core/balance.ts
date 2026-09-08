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
  fuelMult?: number; speedMult?: number; cargoMult?: number; burnMult?: number; recoverMult?: number
  moonLoadAdd?: number; otherLoadAdd?: number; bufferAdd?: number; gravityAdd?: number; fleetBonus?: number
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
  bufferSeconds: 24,
  continuityRecoverRate: 20,
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
  act2Nodes: 4,
  act3Nodes: 8,
  act3SurviveSeconds: 240,
  moduleLegSeconds: 36,
  moduleLoadSeconds: 3,
  moduleUnloadSeconds: 3,
  /** 海克斯三选一自动收纳（秒）：显示满 15s 未选 → 弹窗隐藏，待卡不弃可重开 */
  hexAutoCloseSeconds: 15,
  // 资源星
  stars: {
    moon: { id: 'moon', name: '月球', load: 200, dist: 1.0, unlockAct: 1 },
    europa: { id: 'europa', name: '木卫二', load: 600, dist: 3.0, unlockAct: 2 },
    mars: { id: 'mars', name: '火星', load: 1500, dist: 6.0, unlockAct: 3 },
  } as Record<StarId, StarBalance>,
  // 等级焚烧表（下标 = 聚能环等级 − 1）：等级提升 → H3 消耗指数增长
  // 指数曲线 burn(l) = 2.0 × (16/2)^((l-1)/24)：Lv1(开局1交点)=2.0 → Lv25(满级12交点全球组网)=16.0，每级 ≈ +9.05%
  levelBurn: [
    2, 2.18, 2.38, 2.59, 2.83, 3.08, 3.36, 3.67, 4, 4.36, 4.76, 5.19,
    5.66, 6.17, 6.73, 7.34, 8, 8.72, 9.51, 10.37, 11.31, 12.34, 13.45, 14.67, 16,
  ],
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
  },
  // 星图布局
  map: {
    hitTolerance: 28,
    routeHitDistance: 14,
    nodes: {
      // 太阳：恒星本体 + 聚能环圆心（非航线端点，仅取景/环布局用；可被 star_map 配置覆盖）
      // 布局圆心 = 画布中心（世界系原点），轨道圈以真实比例展开
      sun: { x: 960, y: 540, r: 96 },
      // 八大行星（水金地木土天海；t=0 初相位 = 方位角，ω ∝ 1/轨道半径；日心距单调递增）
      // 轨道半径 = 真实半长轴（AU）× 250px（地球 = 1 AU）：
      //   水 0.387→97 / 金 0.723→181 / 地 1→250 / 火 1.524→381 /
      //   木 5.203→1301 / 土 9.537→2384 / 天 19.19→4797 / 海 30.07→7517
      // 行星半径（显示）保持游戏化尺寸，未按真实比例（否则不可见）
      mercury: { x: 932, y: 447, r: 11 },
      venus: { x: 1131, y: 599, r: 17 },
      earth: { x: 960, y: 790, r: 38 },
      mars: { x: 1230, y: 271, r: 34 },
      jupiter: { x: -296, y: 877, r: 46 },
      saturn: { x: 3263, y: 1158, r: 40 },
      uranus: { x: -3674, y: -703, r: 24 },
      neptune: { x: 8418, y: -407, r: 23 },
      // 卫星布局锚点（相对 parent 布局点的初相位；距 parent 必须 = moons[id].radius）
      // moon/earth 与 europa/jupiter 随 parent 平移，相对方位与旧版一致（moon 东侧 / europa 正上）
      moon: { x: 1080, y: 790, r: 17 },
      europa: { x: -296, y: 801, r: 30 },
    } as Record<'sun' | PlanetId | 'moon' | 'europa', MapNodeCfg>,
    /** 卫星配置：parent（行星）+ 轨道半径（px）；布局锚点距 parent 必须 = radius（开局不脱环） */
    moons: {
      moon: { parent: 'earth', radius: 120 },
      europa: { parent: 'jupiter', radius: 76 },
    } as Record<'moon' | 'europa', { parent: PlanetId; radius: number }>,
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
  { id: 'ring_saving', name: '环节能', type: 'upgrade', line: 'ring', gain: '单节点消耗 −10%', cost: '环线下次生长 −15%', effects: { burnMult: 0.9, nextGrowth: { line: 'ring', mult: 0.85 } } },
  { id: 'reserve_expand', name: '储备扩容', type: 'upgrade', line: 'ring', gain: '缓冲衰减期 +5 秒（临终喘息更长）', cost: '单节点消耗 +4%', effects: { bufferAdd: 5, burnMult: 1.04 } },
  { id: 'thermal_redundancy', name: '恒温冗余', type: 'upgrade', line: 'ring', gain: '补燃料后延续度回升速度 ×2', cost: '单节点消耗 +3%', effects: { recoverMult: 2, burnMult: 1.03 } },
  { id: 'gravity_extend', name: '引力延长', type: 'upgrade', line: 'infra', gain: '引力窗口 +5 秒', cost: '单节点消耗 +2%', effects: { gravityAdd: 5, burnMult: 1.02 } },
  { id: 'growth_accel', name: '生长加速', type: 'upgrade', line: 'expand', gain: '本线下一个节点进度条提速 +50%', cost: '单节点消耗 +6%', effects: { nextGrowth: { line: 'self', mult: 1.5 }, burnMult: 1.06 } },
  { id: 'twin_node', name: '双生节点', type: 'upgrade', line: 'expand', gain: '本次节点额外 +1 覆盖段', cost: '本线下次生长 −20%', effects: { extraNodes: 2, nextGrowth: { line: 'self', mult: 0.8 } } },
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
    const g = ConfigRegistry.getConfig<Record<string, number>>('warm-current.global')
    assignNumeric(B as unknown as Record<string, unknown>, g, [
      'earthH3Start', 'baseBurnPerLeg', 'baseLegSeconds', 'loadSeconds', 'unloadSeconds',
      'dangerReserveSeconds', 'startNodes', 'researchNodeCap', 'totalNodes', 'ringLevels', 'nodeInterval',
      'runningRateBonus', 'researchPointRateAdd', 'researchPointCostPerS', 'bufferSeconds',
      'continuityRecoverRate', 'initialShips', 'shipBuildCost', 'shipBuildTime', 'cargoBase',
      'shipRebuildCost', 'materialH3PerUnit', 'act2Nodes', 'act3Nodes', 'act3SurviveSeconds',
      'moduleLegSeconds', 'moduleLoadSeconds', 'moduleUnloadSeconds', 'hexAutoCloseSeconds',
    ])
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

  try {
    const mp = ConfigRegistry.getConfig<{ hitTolerance?: number; routeHitDistance?: number; nodes?: Record<string, MapNodeCfg> }>('warm-current.star_map')
    if (mp) {
      if (mp.hitTolerance !== undefined) B.map.hitTolerance = mp.hitTolerance
      if (mp.routeHitDistance !== undefined) B.map.routeHitDistance = mp.routeHitDistance
      if (mp.nodes) {
        for (const [k, node] of Object.entries(mp.nodes)) {
          const cur = (B.map.nodes as Record<string, MapNodeCfg | undefined>)[k]
          if (cur && node) Object.assign(cur, node)
        }
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
