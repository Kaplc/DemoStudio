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
  Endpoint, PlanetBodyId, PlanetId, ResearchLineId, SimEvent, SimRoute, SimShip, SimState, SimStation, StarId,
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

// ─── 太阳系公转（位置 = 仿真时间的纯函数：确定性、快照/重放安全） ───

/** 太阳系天体（太阳 + 地球 + 三资源星） */
export type SolarBodyId = 'sun' | PlanetBodyId

/** 行星公转角速度系数（rad/s × 半径px）：切向速度统一 ≈3.9px/s */
export const ORBIT_SPEED_COEFF = 3.9

/** 卫星角速度系数（相对行星）：切向速度统一 ≈3.3px/s（半径入 B.map.moons[id].radius） */
export const MOON_SPEED_COEFF = 3.3

/** 行星轨道半径（px，距太阳；布局坐标推导，渲染层画轨道圈共用） */
export function orbitRadiusPx(body: PlanetBodyId): number {
  const n = B.map.nodes[body]
  const s = B.map.nodes.sun
  return Math.hypot(n.x - s.x, n.y - s.y)
}

// ─── 首次引导（单一数据源：规则判定 / 渲染定位 / 测试 共用） ───

/**
 * 首次引导的航线端点（顺序即教学双环顺序）：月球 → 地球。
 *
 * ⚠ 权威在 TransportComponent.tryCreateRoute（引导只认 moon↔earth）。
 * 三方消费本常量，不得各自硬编码（改引导只改这一处）：
 *   1. TransportComponent.tryCreateRoute —— 建线规则判定
 *   2. WarmCurrentGameMode.dragValidity —— 拖线视觉合法性（规则镜像）
 *   3. StarMapRenderComponent.buildTutorial/syncTutorial —— 教学双环定位
 */
export const TUTORIAL_TARGETS = ['moon', 'earth'] as const satisfies ReadonlyArray<SolarBodyId>

export type TutorialBodyId = (typeof TUTORIAL_TARGETS)[number]

/** 教学环缩放半径 = 天体显示半径 + 边距（渲染层画环共用，保证环不贴星球边缘） */
export const TUTORIAL_RING_PAD = 12

export function tutorialRingRadius(body: TutorialBodyId): number {
  return B.map.nodes[body].r + TUTORIAL_RING_PAD
}

/** 行星角速度 ∝ 1/轨道半径（远轨道更慢，开普勒式观感）；地球再慢 30%（聚能环叙事：近"静止"） */
function orbitAngularSpeed(body: PlanetBodyId): number {
  return (ORBIT_SPEED_COEFF * (body === 'earth' ? 0.7 : 1)) / Math.max(120, orbitRadiusPx(body))
}

/** 行星初相位 = 初始布局方位角（改 star_map 配置即改初相位，布局即轨道锚点） */
function orbitPhase(body: PlanetBodyId): number {
  const n = B.map.nodes[body]
  const s = B.map.nodes.sun
  return Math.atan2(n.y - s.y, n.x - s.x)
}

/** 天体当前位置（地图画布系）：行星绕太阳公转，卫星绕 parent 行星（t = 仿真时间，太阳静态） */
export function starPosAt(state: SimState, body: SolarBodyId): { x: number; y: number } {
  if (body === 'sun') return B.map.nodes.sun
  // 卫星：轨道中心 = parent 实时位置（布局中的锚点 = 相对 parent 的初相位）
  const moonCfg = (B.map.moons as Record<string, { parent: PlanetId; radius: number } | undefined>)[body]
  if (moonCfg) {
    const p = starPosAt(state, moonCfg.parent)
    const m = B.map.nodes[body as SolarBodyId]
    const a = Math.atan2(m.y - B.map.nodes[moonCfg.parent].y, m.x - B.map.nodes[moonCfg.parent].x)
      + state.time * (MOON_SPEED_COEFF / moonCfg.radius)
    return { x: p.x + Math.cos(a) * moonCfg.radius, y: p.y + Math.sin(a) * moonCfg.radius }
  }
  const s = B.map.nodes.sun
  const r = orbitRadiusPx(body)
  const a = orbitPhase(body) + state.time * orbitAngularSpeed(body)
  return { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r }
}

/** 补给站锚点（依附正向航线，随行星公转实时漂移） */
export function stationAnchorPos(state: SimState, st: SimStation): { x: number; y: number } {
  const a = starPosAt(state, st.star)
  const b = starPosAt(state, 'earth')
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

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
    /** 海克斯自动收纳时刻（仿真秒）：null=弹窗可见；非 null=已收纳待重开（待卡不弃） */
    hexHiddenAt: null,
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
  if (e.kind === 'earth') return starPosAt(state, 'earth')
  if (e.kind === 'star') return starPosAt(state, e.star)
  const st = state.stations.find((s) => s.id === e.stationId)
  return st ? stationAnchorPos(state, st) : starPosAt(state, 'earth')
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
    const a = starPosAt(state, 'earth'), b = starPosAt(state, 'mars')
    const t = ship.leg === 'outbound' ? ship.progress : 1 - ship.progress
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  const route = state.routes.find((r) => r.id === ship.routeId)
  if (!route) return starPosAt(state, 'earth')
  const from = endpointPos(state, route.from), to = endpointPos(state, route.to)
  const t = ship.leg === 'outbound' ? ship.progress : 1 - ship.progress
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

export function deepSnapshot<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export type { CardDef, SimEvent, SimRoute, SimShip, SimState, SimStation, StarId, MAP_H, MAP_W }
