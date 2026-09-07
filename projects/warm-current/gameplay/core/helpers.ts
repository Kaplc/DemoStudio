/**
 * helpers — 纯逻辑工具（对 SimState 的纯函数 + 初始状态工厂）
 *
 * core 铁律：这里全部是无状态纯函数（或纯数据工厂），不依赖引擎对象，
 * 便于单测与快照。带 B 的数值读取（balance 运行时单例，配置表可覆盖）。
 */
import { B, MAP_H, MAP_W } from './balance'
import type { CardDef } from './balance'
import { DEFAULT_CARDS } from './balance'
import type {
  Endpoint, ResearchLineId, SimEvent, SimRoute, SimShip, SimState, SimStation, StarId,
} from './types'

// ─── 确定性随机（耀斑调度可复现） ───

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 研究线定义（初始进度错峰，避免首波五卡齐发） */
export const LINE_DEFS: Array<{ id: ResearchLineId; name: string; init: number }> = [
  { id: 'engine', name: '引擎线', init: 0.0 },
  { id: 'cargo', name: '货舱线', init: 0.12 },
  { id: 'ring', name: '环线', init: 0.24 },
  { id: 'infra', name: '基建线', init: 0.36 },
  { id: 'expand', name: '扩张线', init: 0.48 },
]

let nextRouteId = 1
let nextStationId = 1
let nextShipId = 1

export function resetIds(): void {
  nextRouteId = 1; nextStationId = 1; nextShipId = 1
}

export function makeShip(index: number): SimShip {
  return {
    id: nextShipId++, name: `船 ${index}`, state: 'idle', routeId: null,
    leg: 'outbound', progress: 0, legTime: 1, timer: 0,
    cargo: 0, materials: 0, roundFuel: 0, speedMult: 1,
    recalling: false, resumeDelay: 0, mission: false,
  }
}

export function freshMods(): SimState['mods'] {
  return {
    fuelMult: 1, speedMult: 1, cargoMult: 1, moonLoadAdd: 0, otherLoadAdd: 0,
    burnMult: 1, bufferAdd: 0, gravityAdd: 0, recoverMult: 1,
    flareWarning: false, stationUnlocked: false, fleetBonus: 0,
  }
}

export function createInitialState(seed: number): SimState {
  resetIds()
  const ships: SimShip[] = []
  for (let i = 0; i < B.initialShips; i++) ships.push(makeShip(i + 1))
  return {
    seed,
    time: 0,
    earthH3: B.earthH3Start,
    continuity: 100,
    ring: 'running',
    bufferLeft: 0,
    bufferTotal: B.bufferSeconds,
    act: 1,
    nodes: B.startNodes,
    ships,
    routes: [],
    stations: [],
    research: LINE_DEFS.map((d) => ({ id: d.id, name: d.name, progress: d.init, nextMult: 1 })),
    overclocked: [],
    pendingCard: null,
    cardQueue: [],
    gravity: { phase: 'idle', timer: B.gravity.period - B.gravity.warn - B.gravity.active },
    flare: { phase: 'idle', timer: 0, nextIn: Number.POSITIVE_INFINITY },
    module: { state: 'locked', shipId: null },
    buildQueue: [],
    mods: freshMods(),
    takenCards: [],
    tutorial: true,
    outcome: 'playing',
    sandbox: false,
    stats: { delivered: 0, frozenCount: 0, rebuiltCount: 0, stationsBuilt: 0, cardsTaken: 0 },
    actSnapshots: { act2: null, act3: null },
  }
}

// ─── 端点 ───

export function endpointKey(e: Endpoint): string {
  return e.kind === 'earth' ? 'earth' : e.kind === 'star' ? `star:${e.star}` : `st:${e.stationId}`
}

export function starOfEndpoint(state: SimState, e: Endpoint): StarId | null {
  if (e.kind === 'star') return e.star
  if (e.kind === 'station') return state.stations.find((s) => s.id === e.stationId)?.star ?? null
  return null
}

export function endpointPos(state: SimState, e: Endpoint): { x: number; y: number } {
  if (e.kind === 'earth') return B.map.nodes.earth
  if (e.kind === 'star') return B.map.nodes[e.star]
  const st = state.stations.find((s) => s.id === e.stationId)
  return st ? { x: st.x, y: st.y } : B.map.nodes.earth
}

export function endpointName(state: SimState, e: Endpoint): string {
  if (e.kind === 'earth') return '地球'
  if (e.kind === 'star') return B.stars[e.star].name
  const st = state.stations.find((s) => s.id === e.stationId)
  return st ? `补给站 ${st.id}${st.level > 0 ? ` Lv${st.level}` : '（站点）'}` : '补给站'
}

export function findRoute(state: SimState, a: Endpoint, b: Endpoint): SimRoute | undefined {
  const ka = endpointKey(a), kb = endpointKey(b)
  return state.routes.find((r) => {
    const ra = endpointKey(r.from), rb = endpointKey(r.to)
    return (ra === ka && rb === kb) || (ra === kb && rb === ka)
  })
}

// ─── 数值 ───

export function starLoad(mods: SimState['mods'], star: StarId): number {
  const def = B.stars[star]
  const add = star === 'moon' ? mods.moonLoadAdd : mods.otherLoadAdd
  return Math.max(10, (def.load + add) * mods.cargoMult)
}

export function cargoCap(mods: SimState['mods']): number {
  return B.cargoBase * mods.cargoMult
}

/** 航段秒数 = 距离系数 × T0 ÷ 航速倍率 */
export function legSeconds(distCoeff: number, speedMult: number): number {
  return (distCoeff * B.baseLegSeconds) / Math.max(0.1, speedMult)
}

/** 往返油耗 = 2 × 距离系数 × 基础油耗 × 油耗乘区（× 引力窗口折价） */
export function roundFuel(mods: SimState['mods'], distCoeff: number, windowMult = 1): number {
  return 2 * distCoeff * B.baseBurnPerLeg * mods.fuelMult * windowMult
}

/** 该航线是否受引力窗口影响（木卫二正向线 / 木卫二线中点补给站） */
export function windowAffected(state: SimState, route: SimRoute): boolean {
  return starOfEndpoint(state, route.from) === 'europa' || starOfEndpoint(state, route.to) === 'europa'
}

/** 航线单船净补/载建材（展示用） */
export function routeNetPerTrip(state: SimState, route: SimRoute): number {
  if (route.direction === 'forward') {
    const star = starOfEndpoint(state, route.from)!
    const load = starLoad(state.mods, star)
    const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.fuelMult : 1
    return load - roundFuel(state.mods, B.stars[star].dist, w)
  }
  return Math.round(cargoCap(state.mods))
}

export function stationByEndpoint(state: SimState, e: Endpoint): SimStation | null {
  return e.kind === 'station' ? state.stations.find((s) => s.id === e.stationId) ?? null : null
}

/** 航线往返时长（展示用，秒） */
export function routeCycleSeconds(state: SimState, route: SimRoute): number {
  if (route.direction === 'forward') {
    const star = starOfEndpoint(state, route.from)!
    const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.speedMult : 1
    const leg = legSeconds(B.stars[star].dist, state.mods.speedMult * w)
    return leg * 2 + B.loadSeconds + B.unloadSeconds
  }
  const st = stationByEndpoint(state, route.to)
  const dist = st ? B.stars[st.star].dist * 0.5 : 1
  const leg = legSeconds(dist, state.mods.speedMult)
  return leg * 2 + B.loadSeconds + B.unloadSeconds
}

/** 粗估净流（吨/秒，展示用）：卸货收入 − 反向支出 − 环焚烧 */
export function estimateNetFlow(state: SimState, demand: number): number {
  let income = 0
  for (const route of state.routes) {
    const n = route.shipIds.length
    if (n === 0) continue
    const cycle = Math.max(1, routeCycleSeconds(state, route))
    if (route.direction === 'forward') income += (n * routeNetPerTrip(state, route)) / cycle
    else {
      const st = stationByEndpoint(state, route.to)
      const dist = st ? B.stars[st.star].dist * 0.5 : 1
      income -= (n * (roundFuel(state.mods, dist) + Math.min(cargoCap(state.mods), st ? Math.max(0, st.need - st.stock) : 0) * B.materialH3PerUnit)) / cycle
    }
  }
  return income - demand
}

/** 船当前位置（星图画布坐标；耀斑护盾判定 / 渲染共用） */
export function shipPos(state: SimState, ship: SimShip): { x: number; y: number } {
  if (ship.mission) {
    const a = B.map.nodes.earth, b = B.map.nodes.mars
    const t = ship.leg === 'outbound' ? ship.progress : 1 - ship.progress
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  const route = state.routes.find((r) => r.id === ship.routeId)
  if (!route) return B.map.nodes.earth
  const from = endpointPos(state, route.from), to = endpointPos(state, route.to)
  const t = ship.leg === 'outbound' ? ship.progress : 1 - ship.progress
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

export function deepSnapshot<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export type { CardDef, SimEvent, SimRoute, SimShip, SimState, SimStation, StarId, MAP_H, MAP_W }
