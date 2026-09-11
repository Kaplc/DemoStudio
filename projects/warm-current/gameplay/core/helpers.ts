/**
 * helpers — 纯逻辑工具（对 SimState 的纯函数 + 初始状态工厂）
 *
 * core 铁律：这里全部是无状态纯函数（或纯数据工厂），不依赖引擎对象，
 * 便于单测与快照。带 B 的数值读取（balance 运行时单例，配置表可覆盖）。
 */
import { B, MAP_H, MAP_W, toWX, toWZ } from './balance'
import type { BuildingDef, BuildingUpgradeDef, CardDef, RingBuildingDef, RingModSet, ShipHullDef, ShipModuleDef } from './balance'
import { buildingEffectiveDef, ringModsOf, shipHullDefOf, shipModuleDefOf } from './balance'
import { DEFAULT_CARDS } from './balance'
import type {
  Endpoint, OrbitBuilding, PlanetBodyId, PlanetId, ResearchLineId, SimBuilding, SimEvent, SimLedger, SimResearchLine, SimRoute, SimShip, SimState, StarId,
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

/** 研究线定义（纯点数驱动：无初始进度，进度全由分配的研究点推进）；
 *  2026-09-08 环线移除（用户拍板）：聚能环建设/计费已独立成 RingBuildComponent，环线职责清空 */
export const LINE_DEFS: Array<{ id: ResearchLineId; name: string }> = [
  { id: 'engine', name: '引擎线' },
  { id: 'cargo', name: '货舱线' },
  { id: 'infra', name: '基建线' },
  { id: 'expand', name: '扩张线' },
]

// ─── 聚能环等级（25 槽位制：每建成一级交付一个空槽位，等级 = 已建成槽位数的连续阶梯） ───

export interface RingLevelInfo {
  /** 当前等级 1..maxLevel（连续阶梯：当前格灌入即缓慢爬升，槽位交付即跳升） */
  level: number
  /** 等级上限（B.ringLevels，默认 25；满级 = 全球组网） */
  maxLevel: number
  /** 等级名（Lv1..Lv25） */
  name: string
  /** 已满级（全球组网） */
  maxed: boolean
  /** 全球覆盖度 0..1（= 已建成槽位 / ringSlots，物理值随交付跳升） */
  coverage: number
  /** 升级进度 0..1（距下一级；当前格建设流进度驱动，满级恒 1） */
  progress: number
}

/**
 * 聚能环等级推导（25 槽位制标尺）：连续进度 raw = (已建成槽位−1 + 当前格建设进度)
 * ÷ (ringSlots−1)；当前格灌到一半等级条也在走，槽位交付（建设满 1，唯一来源）→
 * 等级跳升、覆盖度 +1/25。消费方（焚烧/船帽/研究点）口径零改动——同一推导式换标尺。
 */
export function ringLevelOf(builtSlots: number, nextSlotProgress = 1): RingLevelInfo {
  const total = Math.max(1, B.ringSlots)
  const maxLevel = Math.max(1, B.ringLevels)
  const built = Math.max(1, Math.min(total, Math.round(builtSlots)))
  const maxed = built >= total
  const next = Math.max(0, Math.min(1, nextSlotProgress))
  const raw = maxed ? 1 : Math.min(1, (built - 1 + next) / (total - 1))
  const level = Math.min(maxLevel, 1 + Math.floor(raw * (maxLevel - 1)))
  return {
    level,
    maxLevel,
    name: `Lv${level}`,
    maxed,
    coverage: built / total,
    progress: maxed ? 1 : (raw * (maxLevel - 1)) % 1,
  }
}

/**
 * 单线研究推进速率（进度/秒）：**纯点数驱动**（2026-09-08 用户拍板，废弃被动推进）：
 * 无点数速率为 0（研究完全靠分配点数，每点也是一份持续 H3 计费）；有点数时
 * 速率 = 基础 1/nodeInterval × 环运转加成 × 点数加成（每点 +researchPointRateAdd，加算）
 * × 环建筑研究乘区（研究馈能）× 生长修正（卡效果）；储量耗尽时点数加成失效（无 H3 支撑），速率为 0。
 */
export function researchRateOf(line: SimResearchLine, state: SimState): number {
  if (line.points <= 0) return 0
  if (state.earthH3 <= 0) return 0
  const runningBonus = B.runningRateBonus
  const pointMult = 1 + line.points * B.researchPointRateAdd
  const ring = ringModsOf(state)
  return (1 / B.nodeInterval) * runningBonus * pointMult * ring.researchMult * line.nextMult
}

/** 单线研究 H3 消耗速率（吨/秒，点数计费；储量耗尽不计费） */
export function researchCostOf(line: SimResearchLine, state: SimState): number {
  return state.earthH3 > 0 ? line.points * B.researchPointCostPerS : 0
}

// ─── 聚能环建设（脱离科研的独立流，模块 03 §5 物理层） ───

/**
 * 聚能环建设推进速率（槽位进度/秒，详情面板 %/s 展示口径）：造价制——
 * 灌入速率（建设点数 × costPerS × 环建筑泵速乘区，0 点/断环为 0，与 SimStateComponent.ringBuildCost 同式）
 * ÷ 本级有效造价（levelCost × ringBuildCostMult，卡折扣省总 H3）。
 * 实际扣费/账本在 RingBuildComponent.tickBuild（灌入即计费）。
 */
export function ringBuildRateOf(state: SimState): number {
  const base = B.ringBuild.levelCost[Math.min(state.ringSlots, B.ringBuild.levelCost.length - 1)]
  const cost = base * state.mods.ringBuildCostMult
  if (!(cost > 0)) return 0
  const ring = ringModsOf(state)
  const pump = state.earthH3 > 0 ? state.ringBuild.points * B.ringBuild.costPerS * ring.buildPumpMult : 0
  return pump / cost
}

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

// ─── 行星系子表查询（star_map systems：每系统一张表，系视角成员读表） ───

/**
 * 行星系视角成员清单 = 该行星子表的全部键（中心行星 + 其卫星，顺序=表内键序）；
 * 无子表的行星 → [自身]。隐藏隔离/系内容判定共用（子表增删即生效，无代码改动）。
 */
export function systemFamilyIds(focus: PlanetId): string[] {
  const out: string[] = [focus]
  for (const [sid, sys] of Object.entries(B.map.systems)) {
    if (sid === 'solar' || sys.center !== focus) continue
    for (const id of Object.keys(sys.nodes)) if (id !== focus) out.push(id)
  }
  return out
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

// ─── 月球相位校正（视图切换对齐） ───
// 唯一的非纯状态（打破 core 无状态铁律的受控例外）：切去太阳系期间仿真时间继续走，
// 切回地球系时月球相位已转走。GameMode 在离开地球系时记录月球相对地球的相位角，
// 切回时用 alignMoonRelativeAngle 把月球拨回该相位（地球系=独立小场景，来回切换月球不跳变）。
// 角度加在 moon 分支的 a 上，地球/太阳位置不受影响；restart/读档须 resetMoonPhaseAdj()。
let moonPhaseAdj = 0

/** 月球当前相对地球的相位角（rad，含校正量；渲染/记录共用同一口径） */
export function moonRelativeAngle(state: SimState): number {
  const mc = B.map.moons.moon
  const m = B.map.nodes.moon
  const p0 = B.map.nodes[mc.parent]
  return Math.atan2(m.y - p0.y, m.x - p0.x) + state.time * (MOON_SPEED_COEFF / mc.radius) + moonPhaseAdj
}

/** 校正相位：使月球当前相对地球的角度 = targetAngle（立即生效，星图/天体 Actor 下帧贴上） */
export function alignMoonRelativeAngle(state: SimState, targetAngle: number): void {
  moonPhaseAdj += targetAngle - moonRelativeAngle(state)
}

/** 重置校正（重开一局 / 读档：仿真时间归零，旧校正量失效） */
export function resetMoonPhaseAdj(): void {
  moonPhaseAdj = 0
}

/** 天体当前位置（地图画布系）：行星绕太阳公转，卫星绕 parent 行星（t = 仿真时间，太阳静态） */
export function starPosAt(state: SimState, body: SolarBodyId): { x: number; y: number } {
  if (body === 'sun') return B.map.nodes.sun
  // 卫星：轨道中心 = parent 实时位置（布局中的锚点 = 相对 parent 的初相位）
  const moonCfg = (B.map.moons as Record<string, { parent: PlanetId; radius: number } | undefined>)[body]
  if (moonCfg) {
    const p = starPosAt(state, moonCfg.parent)
    const m = B.map.nodes[body as SolarBodyId]
    // 月球走带校正量的口径（视图切换对齐）；其余卫星（木卫二）保持原纯函数口径
    const a = body === 'moon'
      ? moonRelativeAngle(state)
      : Math.atan2(m.y - B.map.nodes[moonCfg.parent].y, m.x - B.map.nodes[moonCfg.parent].x)
        + state.time * (MOON_SPEED_COEFF / moonCfg.radius)
    return { x: p.x + Math.cos(a) * moonCfg.radius, y: p.y + Math.sin(a) * moonCfg.radius }
  }
  const s = B.map.nodes.sun
  const r = orbitRadiusPx(body)
  const a = orbitPhase(body) + state.time * orbitAngularSpeed(body)
  return { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r }
}

/** 地球当前位置（建筑几何/补给线距离共用基准） */
export function earthPos(state: SimState): { x: number; y: number } {
  return starPosAt(state, 'earth')
}

// ─── 行星系视角隐藏天体 Actor 隔离（点击判定 = 真实 Actor 世界位置，隐藏 = 移远 = 点不到） ───

/**
 * 天体 Actor 的"隔离点"（每帧 syncFrom 的目标位置）：
 *  - 太阳系全景（solar）：世界系 = 地图系平移，返回 starPosAt 实时公转位置（世界系）
 *  - 行星系（聚焦某行星）：坐标系 = 舞台相对系（舞台 = 太阳位/世界原点，镜头钉死舞台，
 *    渲染 systemGroup 内容与指针拾取均按舞台系反算地图坐标）：
 *      聚焦行星 + 其子系表成员（star_map systems）→ 舞台相对位（聚焦行星钉在舞台中心，
 *        卫星按真实相对几何绕它转——与旧 ox/oz 舞台补偿数学完全等价）
 *      太阳 → 舞台锚点 (0,0)（渲染层隐藏 + 点击 pickable 拒绝，Actor 原地钉死防飞掠相机）
 *      其余隐藏天体 → 布局锚方位 × 隔离半径 12000（相机 panLimit 9000 拉不到，
 *        Actor 物理不可点；方向取布局锚相对太阳的方位，舞台系下方向不变）
 *
 * 纯函数（确定性/快照安全）：只读 B 与 state.time，不依赖引擎对象。
 */
export function hiddenActorIsolated(
  state: SimState,
  body: SolarBodyId,
  viewMode: 'solar' | 'earth',
  focus: PlanetId,
): { x: number; z: number } {
  if (viewMode === 'solar') {
    const p = starPosAt(state, body)
    return { x: toWX(p.x), z: toWZ(p.y) }
  }
  const fp = starPosAt(state, focus)
  const fx = toWX(fp.x)
  const fz = toWZ(fp.y)
  // 本系成员 = 聚焦行星子表全键（star_map systems，读表即得）
  const family = new Set<string>(systemFamilyIds(focus))
  if (family.has(body)) {
    // 本系成员：舞台相对位（聚焦行星钉在舞台中心，卫星按真实相对几何贴放）
    const p = starPosAt(state, body)
    return { x: toWX(p.x) - fx, z: toWZ(p.y) - fz }
  }
  // 太阳 = 舞台锚点（世界原点）：镜头钉死在舞台，太阳若甩远景会造飞掠相机，原地隐藏
  if (body === 'sun') return { x: 0, z: 0 }
  // 其余隐藏天体：布局锚（卫星用 parent）方位 × 隔离半径——各星向各自方位甩出，
  // 距舞台 12000 ≥ 相机 panLimit 9000 + 最大视野半径余量，行星系视角物理不可点
  const anchor = body in B.map.moons
    ? B.map.nodes[B.map.moons[body as keyof typeof B.map.moons].parent]
    : B.map.nodes[body as PlanetId]
  const dx = anchor.x - B.map.nodes.sun.x
  const dy = anchor.y - B.map.nodes.sun.y
  const len = Math.hypot(dx, dy) || 1
  const ISO_R = 12000
  return { x: (dx / len) * ISO_R, z: (dy / len) * ISO_R }
}

let nextRouteId = 1
let nextBuildingId = 1
let nextShipId = 1

export function resetIds(): void {
  nextRouteId = 1; nextBuildingId = 1; nextShipId = 1
}

export function makeShip(index: number, hull = 'standard', modules: string[] = []): SimShip {
  return {
    id: nextShipId++, name: `船 ${index}`, state: 'idle', routeId: null,
    leg: 'outbound', progress: 0, legTime: 1, timer: 0,
    cargo: 0, materials: 0, roundFuel: 0, speedMult: 1,
    recalling: false, resumeDelay: 0, mission: false,
    hull, modules,
  }
}

// ─── 船型模块（玩家设计权扩展：船队从同质单位变成玩家设计的舰队） ───

export interface ShipMults {
  /** 本船满载乘区 = 船型 × Σ模块（再叠全局 cargoMult / 环 loadMult 于 starLoad 内） */
  loadMult: number
  /** 本船油耗乘区（副油箱） */
  fuelMult: number
  /** 本船航速乘区 = 船型 × Σ模块（离子引擎） */
  speedMult: number
  /** 装卸时长乘区（快速货泵） */
  workMult: number
  /** 冻毁免疫（guardian 内置 / 防冻加热器，任一即免疫） */
  antiFreeze: boolean
}

/** 本船船型定义（未知船型兜底 standard 表行；表被清空时 null） */
export function shipHullOf(ship: Pick<SimShip, 'hull'>): ShipHullDef | null {
  return shipHullDefOf(ship.hull) ?? shipHullDefOf('standard')
}

/** 本船船型是否允许装该模块（allowed 含 '*' = 不限） */
export function hullAllowsModule(hullId: string, moduleId: string): boolean {
  const hull = shipHullDefOf(hullId) ?? shipHullDefOf('standard')
  if (!hull) return false
  return hull.allowed.includes('*') || hull.allowed.includes(moduleId)
}

/** 造船整单价（船体 + Σ模块，H3；船坞折扣由调用方乘） */
export function shipBuildPrice(hullId: string, modules: string[]): number {
  const hull = shipHullDefOf(hullId)
  if (!hull) return 0
  let total = hull.cost
  for (const id of modules) total += shipModuleDefOf(id)?.cost ?? 0
  return total
}

/** 本船乘数聚合（船型 × 各模块线性叠乘；纯函数，读态即得） */
export function shipMults(ship: Pick<SimShip, 'hull' | 'modules'>): ShipMults {
  const hull = shipHullOf(ship)
  const m: ShipMults = {
    loadMult: hull?.loadMult ?? 1,
    fuelMult: 1,
    speedMult: hull?.speedMult ?? 1,
    workMult: 1,
    antiFreeze: hull?.innate.includes('anti_freeze') ?? false,
  }
  for (const id of ship.modules ?? []) {
    const def: ShipModuleDef | null = shipModuleDefOf(id)
    if (!def) continue
    const e = def.mods
    if (e.loadMult !== undefined) m.loadMult *= e.loadMult
    if (e.fuelMult !== undefined) m.fuelMult *= e.fuelMult
    if (e.speedMult !== undefined) m.speedMult *= e.speedMult
    if (e.workMult !== undefined) m.workMult *= e.workMult
    if (e.antiFreeze) m.antiFreeze = true
  }
  return m
}

export function freshMods(): SimState['mods'] {
  return {
    fuelMult: 1, speedMult: 1, cargoMult: 1, moonLoadAdd: 0, otherLoadAdd: 0,
    burnMult: 1, ringBuildCostMult: 1, gravityAdd: 0,
    flareWarning: false, fleetBonus: 0,
  }
}

/** 全零账本（新局 / 旧存档兜底） */
export function freshLedger(): SimLedger {
  return {
    unload: 0, demolishRefund: 0, ringBurn: 0, ringBuild: 0, research: 0, fleetMaint: 0, orbitBuild: 0,
    shipBuild: 0, shipRebuild: 0, reverseFuel: 0, materials: 0, ringInstall: 0, buildingUpgrade: 0,
  }
}

/** 账本收支合计（旧档缺 ledger 字段时按零账本计） */
export function ledgerTotals(led: SimLedger | undefined): { income: number; expense: number; net: number } {
  const l = led ?? freshLedger()
  const income = l.unload + l.demolishRefund
  const expense = l.ringBurn + l.ringBuild + l.research + l.fleetMaint + l.orbitBuild + l.shipBuild + l.shipRebuild + l.reverseFuel + l.materials + l.ringInstall + l.buildingUpgrade
  return { income, expense, net: income - expense }
}

export function createInitialState(seed: number): SimState {
  resetIds()
  const ships: SimShip[] = []
  for (let i = 0; i < B.initialShips; i++) ships.push(makeShip(i + 1))
  return {
    seed,
    time: 0,
    earthH3: B.earthH3Start,
    coreTemp: 100,
    ring: 'running',
    act: 1,
    // 25 槽位制：开局 1 格已建成但空置（第一分钟引导完成第一次安装，教学即机制）
    ringSlots: B.startSlots,
    ringBuild: { points: B.ringBuild.defaultPoints },
    ringBuildProgress: 0,
    ringBuildings: Array.from({ length: Math.max(1, B.ringSlots) }, () => null),
    ringDemolish: null,
    ships,
    routes: [],
    buildings: [],
    orbitBuildings: [],
    research: LINE_DEFS.map((d) => ({ id: d.id, name: d.name, progress: 0, nextMult: 1, points: 0 })),
    pendingCard: null,
    cardQueue: [],
    gravity: { phase: 'idle', timer: B.gravity.period - B.gravity.warn - B.gravity.active },
    flare: { phase: 'idle', timer: 0, nextIn: Number.POSITIVE_INFINITY },
    module: { state: 'locked', shipId: null },
    // 造船队列（逐船一卡 SimShipBuild：remain 倒计时 / dockId 承接船坞 / hull+modules 船级配置）
    buildQueue: [],
    mods: freshMods(),
    takenCards: [],
    tutorial: true,
    outcome: 'playing',
    sandbox: false,
    stats: { delivered: 0, frozenCount: 0, rebuiltCount: 0, buildingsBuilt: 0, cardsTaken: 0 },
    ledger: freshLedger(),
    actSnapshots: { act2: null, act3: null },
  }
}

// ─── 端点 ───

export function endpointKey(e: Endpoint): string {
  return e.kind === 'earth' ? 'earth' : e.kind === 'star' ? `star:${e.star}` : `b:${e.buildingId}`
}

export function starOfEndpoint(state: SimState, e: Endpoint): StarId | null {
  return e.kind === 'star' ? e.star : null
}

export function endpointPos(state: SimState, e: Endpoint): { x: number; y: number } {
  if (e.kind === 'earth') return starPosAt(state, 'earth')
  if (e.kind === 'star') return starPosAt(state, e.star)
  const b = state.buildings.find((x) => x.id === e.buildingId)
  return b ? buildingPos(state, b) : starPosAt(state, 'earth')
}

export function endpointName(state: SimState, e: Endpoint): string {
  if (e.kind === 'earth') return '地球'
  if (e.kind === 'star') return B.stars[e.star].name
  const b = state.buildings.find((x) => x.id === e.buildingId)
  if (!b) return '建筑'
  return `${buildingDefOf(b.type)?.name ?? b.type} ${b.id}`
}

export function findRoute(state: SimState, a: Endpoint, b: Endpoint): SimRoute | undefined {
  const ka = endpointKey(a), kb = endpointKey(b)
  return state.routes.find((r) => {
    const ra = endpointKey(r.from), rb = endpointKey(r.to)
    return (ra === ka && rb === kb) || (ra === kb && rb === ka)
  })
}

// ─── 建筑 ───

/** 建筑定义查询（building 表行；未知类型返回 null） */
export function buildingDefOf(type: string): BuildingDef | null {
  return (B.buildings as Record<string, BuildingDef | undefined>)[type] ?? null
}

export function buildingByEndpoint(state: SimState, e: Endpoint): SimBuilding | null {
  return e.kind === 'building' ? state.buildings.find((x) => x.id === e.buildingId) ?? null : null
}

/**
 * 建筑入轨参数推导（放置时一次性计算，2026-09-08 拍板：建筑入轨绕行星公转）：
 *  - 锚 = orbitAttach 半径内最近的天体（八大行星+卫星；太阳不作锚，静态无公转意义）。
 *    卫星可作锚（2026-09-08 地月距 ×10：月球旁放置若仍锚 parent 会超 attach 半径 →
 *    无锚静态漂移，故绕月公转）；
 *    无候选 → null（静态放置，行为同旧版）
 *  - orbitR = 距锚中心距离，按「天体显示半径 + orbitMinPad」抬底（轨道不穿本体）
 *  - orbitA0 = 放置瞬时相位回推到 t=0（实时相位 = orbitA0 + ω·time，ω = orbitSpeed/orbitR；
 *    纯时间函数口径 → 无需 tick、快照/读档/重放天然确定）
 */
export function resolveBuildingOrbit(state: SimState, x: number, y: number): { anchor: PlanetBodyId; orbitR: number; orbitA0: number } | null {
  let best: PlanetBodyId | null = null
  let bestD = B.build.orbitAttach
  for (const key of Object.keys(B.map.nodes) as Array<keyof typeof B.map.nodes>) {
    if (key === 'sun') continue
    const p = starPosAt(state, key)
    const d = Math.hypot(x - p.x, y - p.y)
    if (d < bestD) { bestD = d; best = key as PlanetBodyId }
  }
  if (!best) return null
  const p = starPosAt(state, best)
  const orbitR = Math.max(B.map.nodes[best].r + B.build.orbitMinPad, Math.hypot(x - p.x, y - p.y))
  const w = B.build.orbitSpeed / Math.max(1, orbitR)
  return { anchor: best, orbitR, orbitA0: Math.atan2(y - p.y, x - p.x) - w * state.time }
}

/**
 * 建筑实时位置（画布系，渲染/拾取/航线/护盾判定的唯一口径）：
 * 入轨建筑 = 锚行星实时公转位 + 本征轨道极坐标（相位随仿真时间推进，建筑跟随行星绕日、
 * 同时自绕行星公转）；未入轨（旧档 / 远离行星放置）= 静态放置坐标。
 */
export function buildingPos(state: SimState, b: SimBuilding): { x: number; y: number } {
  if (!b.anchor || typeof b.orbitR !== 'number' || typeof b.orbitA0 !== 'number') return { x: b.x, y: b.y }
  const a = starPosAt(state, b.anchor)
  const ang = b.orbitA0 + (B.build.orbitSpeed / Math.max(1, b.orbitR)) * state.time
  return { x: a.x + Math.cos(ang) * b.orbitR, y: a.y + Math.sin(ang) * b.orbitR }
}

/** 建筑放置吸附（世界原点锚定的方格网，画布系进出；放置/预览/网格线同一口径） */
export function snapToGrid(mx: number, my: number): { x: number; y: number } {
  const g = Math.max(1, B.build.grid)
  return {
    x: MAP_W / 2 + Math.round((mx - MAP_W / 2) / g) * g,
    y: MAP_H / 2 + Math.round((my - MAP_H / 2) / g) * g,
  }
}

/** 反向补给线距离系数（几何：地→建筑实时位置画布距离 ÷ 1AU=250px，影响航段时长与油耗；入轨建筑随公转变化） */
export function supplyDistCoeff(state: SimState, e: Endpoint): number {
  const b = buildingByEndpoint(state, e)
  if (!b) return 1
  const p = buildingPos(state, b)
  const earth = earthPos(state)
  return Math.max(0.1, Math.hypot(p.x - earth.x, p.y - earth.y) / 250)
}

// ─── 近地轨道建筑（2026-09-09：点行星 → 轨道建设 → 建筑绕行星均布公转） ───

/** 轨道建筑实时位置（画布系，渲染/拾取的唯一口径）：
 *  绕锚行星固定环半径公转（ω = B.orbitBuild.orbitSpeed / ringRadius，与地图建筑入轨同口径，
 *  纯时间函数 → 无需 tick、快照/读档/重放天然确定） */
export function orbitBuildingPos(state: SimState, ob: Pick<OrbitBuilding, 'anchor' | 'a0'>): { x: number; y: number } {
  const a = starPosAt(state, ob.anchor)
  const ang = ob.a0 + (B.orbitBuild.orbitSpeed / Math.max(1, B.orbitBuild.ringRadius)) * state.time
  return { x: a.x + Math.cos(ang) * B.orbitBuild.ringRadius, y: a.y + Math.sin(ang) * B.orbitBuild.ringRadius }
}

// ─── 数值 ───

/**
 * 单船满载量（吨 H3）= 星表基础值 × 卡加成 × 全局 cargoMult × 环建筑 loadMult
 * × 船级满载乘区（船型 × 货舱扩容；ship 缺省 = 无船级口径，供展示估算）。
 */
export function starLoad(mods: SimState['mods'], star: StarId, ship?: Pick<SimShip, 'hull' | 'modules'>, ring?: RingModSet): number {
  const def = B.stars[star]
  const add = star === 'moon' ? mods.moonLoadAdd : mods.otherLoadAdd
  const ringLoad = ring?.loadMult ?? 1
  const hullMult = ship ? shipMults(ship).loadMult : 1
  return Math.max(10, (def.load + add) * mods.cargoMult * ringLoad * hullMult)
}

/** 货舱基准（反向建材装货上限口径；ship 缺省 = 全局估算） */
export function cargoCap(mods: SimState['mods'], ship?: Pick<SimShip, 'hull' | 'modules'>, ring?: RingModSet): number {
  const hullMult = ship ? shipMults(ship).loadMult : 1
  const ringLoad = ring?.loadMult ?? 1
  return B.cargoBase * mods.cargoMult * ringLoad * hullMult
}

/** 航段秒数 = 距离系数 × T0 ÷ 航速倍率 */
export function legSeconds(distCoeff: number, speedMult: number): number {
  return (distCoeff * B.baseLegSeconds) / Math.max(0.1, speedMult)
}

/** 往返油耗 = 2 × 距离系数 × 基础油耗 × 油耗乘区（× 引力窗口折价 × 船级油耗乘区） */
export function roundFuel(mods: SimState['mods'], distCoeff: number, windowMult = 1, ship?: Pick<SimShip, 'hull' | 'modules'>, ring?: RingModSet): number {
  const shipMult = ship ? shipMults(ship).fuelMult : 1
  return 2 * distCoeff * B.baseBurnPerLeg * mods.fuelMult * windowMult * shipMult
}

/**
 * 舰队维护费：按总船数查 B.fleetMaint 阶梯（升序，首档 ships ≥ 船数者命中，
 * 超出末档沿用末档）→ 维护费速率（H3/秒，全舰队合计；tickEconomy 持续扣地球储备）。
 */
export function fleetMaintPerS(fleetSize: number): number {
  const tiers = B.fleetMaint
  if (tiers.length === 0) return 0
  const hit = tiers.find((t) => fleetSize <= t.ships) ?? tiers[tiers.length - 1]
  return Math.max(0, hit.costPerS)
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

/** 航线往返时长（展示用，秒） */
export function routeCycleSeconds(state: SimState, route: SimRoute): number {
  if (route.direction === 'forward') {
    const star = starOfEndpoint(state, route.from)!
    const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.speedMult : 1
    const leg = legSeconds(B.stars[star].dist, state.mods.speedMult * w)
    return leg * 2 + B.loadSeconds + B.unloadSeconds
  }
  const leg = legSeconds(supplyDistCoeff(state, route.to), state.mods.speedMult)
  return leg * 2 + B.loadSeconds + B.unloadSeconds
}

/** 粗估净流（吨/秒，展示用）：卸货收入 − 反向支出 − 舰队维护费 − 环焚烧 */
export function estimateNetFlow(state: SimState, demand: number): number {
  let income = 0
  for (const route of state.routes) {
    const n = route.shipIds.length
    if (n === 0) continue
    const cycle = Math.max(1, routeCycleSeconds(state, route))
    if (route.direction === 'forward') income += (n * routeNetPerTrip(state, route)) / cycle
    else {
      const dist = supplyDistCoeff(state, route.to)
      const st = buildingByEndpoint(state, route.to)
      const cap = st ? buildingDefOf(st.type)?.bufferCap ?? 0 : 0
      const want = st ? Math.max(0, cap - st.stock) : 0
      income -= (n * (roundFuel(state.mods, dist) + Math.min(cargoCap(state.mods), want) * B.materialH3PerUnit)) / cycle
    }
  }
  return income - demand - fleetMaintPerS(state.ships.length)
}

/** 船当前位置（星图画布坐标；耀斑护盾判定 / 渲染共用）。
 *  靠站改道船（shelter 段存在）= 自定义插值段 from→to，与航线插值并行为两条口径。 */
export function shipPos(state: SimState, ship: SimShip): { x: number; y: number } {
  if (ship.shelter) {
    const { fx, fy, tx, ty } = ship.shelter
    return { x: fx + (tx - fx) * ship.progress, y: fy + (ty - fy) * ship.progress }
  }
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

export { buildingEffectiveDef, buildingHookMult, ringModsOf, freshRingMods, ringBuildingDefOf, shipHullDefOf, shipModuleDefOf } from './balance'
export type { BuildingDef, BuildingUpgradeDef, CardDef, RingBuildingDef, RingModSet, ShipHullDef, ShipModuleDef, SimBuilding, SimEvent, SimRoute, SimShip, SimState, StarId, MAP_H, MAP_W }
