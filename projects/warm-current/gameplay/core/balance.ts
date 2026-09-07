/**
 * balance — 《暖流计划》数值中枢（默认值 + 配置表覆盖）
 *
 * 平衡方案 V1 全量数值的代码默认值在此；运行时经 refreshBalanceFromConfigs()
 * 用 asset/config/*.config.json / *.table.json 覆盖（GameMode.InitGame / restart 时刷新）。
 * 消费方一律读 B.*（可变单例），不要 import 旧常量。
 * 星图布局用画布坐标（1920×1080，y 向下），与渲染/拾取约定一致。
 */
import { ConfigRegistry } from '@/engine'
import type { ResearchLineId, StarId } from './types'

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

/** 卡 id（= cards.table.json 行键） */
export type CardId = string

export type CardType = 'unlock' | 'upgrade'

export interface CardEffects {
  fuelMult?: number; speedMult?: number; cargoMult?: number; burnMult?: number; recoverMult?: number
  moonLoadAdd?: number; otherLoadAdd?: number; bufferAdd?: number; gravityAdd?: number; fleetBonus?: number
  stationUnlock?: boolean; flareWarning?: boolean
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
  earthH3Start: 1000,
  baseBurnPerLeg: 20,
  baseLegSeconds: 6,
  loadSeconds: 2,
  unloadSeconds: 2,
  dangerReserveSeconds: 60,
  startNodes: 1,
  researchNodeCap: 11,
  totalNodes: 12,
  nodeInterval: 100,
  runningRateBonus: 1.25,
  overclockRateMult: 1.5,
  overclockCostPerS: 5,
  bufferSeconds: 30,
  continuityRecoverRate: 20,
  initialShips: 3,
  shipBuildCost: 150,
  shipBuildTime: 15,
  cargoBase: 200,
  shipRebuildCost: 150,
  materialH3PerUnit: 0.5,
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
  // 节点焚烧表（下标 = 已解锁节点数 − 1）
  nodeBurn: [2.0, 2.8, 3.8, 5.0, 6.5, 8.0, 9.5, 11.0, 12.3, 13.6, 14.8, 16.0],
  // 事件
  gravity: { period: 90, warn: 10, active: 20, speedMult: 2.0, fuelMult: 0.5 },
  flare: { minInterval: 120, maxInterval: 180, duration: 15, warnLead: 10, firstDelay: 60 },
  // 补给站
  station: {
    buildMaterials: 300,
    upgradeMaterials: [0, 0, 400, 500],
    radius: [0, 180, 320, 500],
    shipCap: [0, 2, 4, 8],
    resumeDelay: [0, 5, 2, 0],
    demolishRefund: 0.5,
  },
  // 星图布局
  map: {
    hitTolerance: 28,
    routeHitDistance: 14,
    nodes: {
      earth: { x: 960, y: 600, r: 52 },
      moon: { x: 1340, y: 430, r: 36 },
      europa: { x: 380, y: 300, r: 42 },
      mars: { x: 1750, y: 850, r: 48 },
    } as Record<'earth' | StarId, MapNodeCfg>,
  },
  // 卡库（refreshBalanceFromConfigs 时由 warm-current.cards 表覆盖；空表回退 DEFAULT_CARDS）
  cards: [] as CardDef[],
}

/** 代码内置默认卡库（cards.table.json 未加载时的兜底；与表内容保持同步） */
export const DEFAULT_CARDS: CardDef[] = [
  { id: 'station_unlock', name: '补给站解锁', type: 'unlock', line: 'infra', gain: '开启"无人补给站"建造权限（反向航线送建材建站）', cost: '单节点消耗 +3%', effects: { stationUnlock: true, burnMult: 1.03 } },
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
      'dangerReserveSeconds', 'startNodes', 'researchNodeCap', 'totalNodes', 'nodeInterval',
      'runningRateBonus', 'overclockRateMult', 'overclockCostPerS', 'bufferSeconds',
      'continuityRecoverRate', 'initialShips', 'shipBuildCost', 'shipBuildTime', 'cargoBase',
      'shipRebuildCost', 'materialH3PerUnit', 'act2Nodes', 'act3Nodes', 'act3SurviveSeconds',
      'moduleLegSeconds', 'moduleLoadSeconds', 'moduleUnloadSeconds',
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
    const table = ConfigRegistry.getTable<{ burn: number }>('warm-current.node_burn')
    if (table) {
      const burns: number[] = []
      const keys = table.getRowNames().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      for (const k of keys) burns.push(table.getRow(k)!.burn)
      if (burns.length > 0) B.nodeBurn = burns
    }
  } catch { /* 未注册 → 默认值 */ }

  try {
    const st = ConfigRegistry.getConfig<Record<string, unknown>>('warm-current.station')
    if (st) {
      if (st.buildMaterials !== undefined) B.station.buildMaterials = st.buildMaterials as number
      if (Array.isArray(st.upgradeMaterials)) B.station.upgradeMaterials = [...(st.upgradeMaterials as number[])]
      if (Array.isArray(st.radius)) B.station.radius = [...(st.radius as number[])]
      if (Array.isArray(st.shipCap)) B.station.shipCap = [...(st.shipCap as number[])]
      if (Array.isArray(st.resumeDelay)) B.station.resumeDelay = [...(st.resumeDelay as number[])]
      if (st.demolishRefund !== undefined) B.station.demolishRefund = st.demolishRefund as number
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
