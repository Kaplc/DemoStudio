/**
 * helpers — 纯逻辑工具（对 SimState 的纯函数 + 初始状态工厂）
 *
 * core 铁律：这里全部是无状态纯函数（或纯数据工厂），不依赖引擎对象，
 * 便于单测与快照。带 B 的数值读取（balance 运行时单例，配置表可覆盖）。
 */
import { B, MAP_H, MAP_W, PAYLOAD_ASSEMBLY_MULT, toWX, toWZ } from './balance'
import type { BuildingDef, BuildingUpgradeDef, CardDef, RingBuildingDef, RingModSet, ShipHullDef, ShipModuleDef } from './balance'
import { buildingEffectiveDef, isDynamicShipModule, ringBuildingDefOf, ringModsOf, shipHullDefOf, shipModuleDefOf } from './balance'
import { DEFAULT_CARDS } from './balance'
import type {
  Endpoint, OrbitBuilding, PlanetBodyId, PlanetId, ResearchLineId, SimBuilding, SimEvent, SimLedger, SimPayloadDesign, SimResearchLine, SimRoute, SimShip, SimState, StarId,
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
  /** 挂靠中转站时该站 H3 缓存上限乘区（低温中转罐；缺省 1） */
  bufferCapMult: number
  /** 引力窗口内油耗折价加深乘区（引力弹弓计算器；缺省 1，窗外不生效） */
  windowFuelMult: number
  /** 耀斑冻毁货物损失乘区（货损保险舱；缺省 1） */
  flareLossMult: number
  /** 耀斑自动规避（耀斑规避程序；任一件即真） */
  autoEvade: boolean
  /** 舰队维护费分摊乘区（维护无人机架；缺省 1） */
  maintMult: number
}

/** 本船船型定义（未知船型兜底 standard 表行；表被清空时 null） */
export function shipHullOf(ship: Pick<SimShip, 'hull'>): ShipHullDef | null {
  return shipHullDefOf(ship.hull) ?? shipHullDefOf('standard')
}

/**
 * 本船船型是否允许装该模块（'*' = 不限；slots 存在时还需槽位余量，见 hullHasSlotFor）。
 * 2026-09-13 荷载设计工坊：自定义合成荷载旁路 allowed 白名单（专精船型的白名单按现货件圈定，
 * 玩家自设计荷载是"自己的件"），只受槽位闸约束——courier 无荷载槽自然装不上。
 */
export function hullAllowsModule(hullId: string, moduleId: string): boolean {
  const hull = shipHullDefOf(hullId) ?? shipHullDefOf('standard')
  if (!hull) return false
  if (isDynamicShipModule(moduleId)) return true
  return hull.allowed.includes('*') || hull.allowed.includes(moduleId)
}

/**
 * 船型槽位容量（槽位类型 → 数量；缺省 slots = 空 —— 模块只受 allowed 约束）。
 * 2026-09-13 船队设计工坊：装船校验 = allowed 兼容 ∧ slotType 有对应槽 ∧ 同槽型未满。
 */
export function hullSlotCapacity(hullId: string): Record<string, number> {
  const hull = shipHullDefOf(hullId) ?? shipHullDefOf('standard')
  return { ...(hull?.slots ?? {}) }
}

/** 已选模块集对船型各槽型的占用计数（槽位类型 → 已装数） */
export function modulesSlotUsage(hullId: string, modules: string[]): Record<string, number> {
  const used: Record<string, number> = {}
  for (const id of modules) {
    const t = shipModuleDefOf(id)?.slotType
    if (!t) continue
    used[t] = (used[t] ?? 0) + 1
  }
  return used
}

/** 该模块能否再装一件（兼容 + 槽位余量；单船同模块仍只装一件的规则在调用方去重） */
export function hullHasSlotFor(hullId: string, modules: string[], moduleId: string): boolean {
  if (!hullAllowsModule(hullId, moduleId)) return false
  const type = shipModuleDefOf(moduleId)?.slotType
  if (!type) return true // 不占槽的模块只受 allowed 约束
  const cap = hullSlotCapacity(hullId)[type] ?? 0
  const used = modulesSlotUsage(hullId, modules)[type] ?? 0
  return used < cap
}

/** 装船合法性总口径（预览/入队共用）：每件模块都过 allowed + 槽位闸 */
export function modulesFitHull(hullId: string, modules: string[]): boolean {
  for (let i = 0; i < modules.length; i++) {
    const partial = modules.filter((_, j) => j !== i)
    if (!hullHasSlotFor(hullId, partial, modules[i])) return false
  }
  return true
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
    bufferCapMult: 1,
    windowFuelMult: 1,
    flareLossMult: 1,
    autoEvade: false,
    maintMult: 1,
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
    if (e.bufferCapMult !== undefined) m.bufferCapMult *= e.bufferCapMult
    if (e.windowFuelMult !== undefined) m.windowFuelMult *= e.windowFuelMult
    if (e.flareLossMult !== undefined) m.flareLossMult *= e.flareLossMult
    if (e.autoEvade) m.autoEvade = true
    if (e.maintMult !== undefined) m.maintMult *= e.maintMult
  }
  return m
}

export function freshMods(): SimState['mods'] {
  return {
    fuelMult: 1, speedMult: 1, cargoMult: 1, moonLoadAdd: 0, otherLoadAdd: 0,
    burnMult: 1, ringBuildCostMult: 1, gravityAdd: 0, miningMult: 1,
    flareWarning: false, fleetBonus: 0,
  }
}

/** 全零账本（新局 / 旧存档兜底） */
export function freshLedger(): SimLedger {
  return {
    unload: 0, demolishRefund: 0, ringBurn: 0, ringBuild: 0, research: 0, fleetMaint: 0, orbitBuild: 0,
    shipBuild: 0, shipRebuild: 0, reverseFuel: 0, materials: 0, ringInstall: 0, buildingUpgrade: 0,
    mineBuild: 0, mining: 0, insuranceRecover: 0,
  }
}

/** 账本收支合计（旧档缺 ledger 字段时按零账本计） */
export function ledgerTotals(led: SimLedger | undefined): { income: number; expense: number; net: number } {
  const l = led ?? freshLedger()
  const income = l.unload + l.demolishRefund + l.mining + (l.insuranceRecover ?? 0)
  const expense = l.ringBurn + l.ringBuild + l.research + l.fleetMaint + l.orbitBuild + l.mineBuild + l.shipBuild + l.shipRebuild + l.reverseFuel + l.materials + l.ringInstall + l.buildingUpgrade
  return { income, expense, net: income - expense }
}

export function createInitialState(seed: number): SimState {
  resetIds()
  const ships: SimShip[] = []
  for (let i = 0; i < B.initialShips; i++) ships.push(makeShip(i + 1))
  // 星球堆场：开局旧文明储备散货（月球 600 ≈ 3 船满载，教学期缓冲；资源星矿建产出续填）
  const starStock: Record<string, number> = {}
  for (const [star, cap] of Object.entries(B.starStockCap)) {
    const init = (B.starStockInitial as Record<string, number>)[star] ?? 0
    starStock[star] = Math.min(init, cap)
  }
  return {
    seed,
    time: 0,
    earthH3: B.earthH3Start,
    starStock,
    supplyStreak: 0,
    supplyAwarded: false,
    shipDesigns: [],
    payloadDesigns: [],
    coreTemp: 100,
    ring: 'running',
    act: 1,
    // 25 槽位制：开局 1 格已建成但空置（第一分钟引导完成第一次安装，教学即机制）
    ringSlots: B.startSlots,
    ringBuild: { points: B.ringBuild.defaultPoints },
    ringBuildProgress: 0,
    ringBuildings: Array.from({ length: Math.max(1, B.ringSlots) }, () => null),
    // 全息地球节点落位表（开局 1 格已交付待落位，玩家在全息地球点球面落位）
    ringNodes: Array.from({ length: Math.max(1, B.ringSlots) }, () => null),
    ringDemolish: null,
    ships,
    routes: [],
    buildings: [],
    orbitBuildings: [],
    mines: [],
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

// ─── 星球堆场（2026-09-13 供应链重构：产量层 → 堆场缓冲 → 运力层） ───

/** 星球堆场上限（吨；非资源星/未知天体 = Infinity——普通行星矿建直采不走堆场） */
export function starStockCapOf(body: string): number {
  return (B.starStockCap as Record<string, number | undefined>)[body] ?? Infinity
}

/** 星球堆场当前库存（吨；未解锁/旧档缺键 = 0） */
export function starStockOf(state: SimState, body: string): number {
  return state.starStock?.[body] ?? 0
}

/**
 * 该天体矿建总产量速率（吨/秒，试航卡/堆场水位展示用）：
 * Σ建成矿建 yieldPerS × 环采矿乘区 × 卡 miningMult（余量门控是 tick 时点态，这里给满负荷口径）。
 */
export function starMiningRate(state: SimState, body: string, ring?: RingModSet): number {
  const miningMult = (ring?.miningMult ?? 1) * state.mods.miningMult
  let rate = 0
  for (const mine of state.mines) {
    if (!mine.built) continue
    const dep = depositOfSafe(mine.depositId)
    if (dep !== body) continue
    const def = (B.mineBuildings as Record<string, { yieldPerS: number } | undefined>)[mine.type]
    rate += def?.yieldPerS ?? 0
  }
  return rate * miningMult
}

/** 矿点 → 所在天体（未知矿点 ''；避免 helpers ↔ MiningComponent 循环依赖的本地查询） */
function depositOfSafe(depositId: string): string {
  return (B.mineralDeposits as Record<string, { planet: string } | undefined>)[depositId]?.planet ?? ''
}

// ─── 船队设计工坊（2026-09-13：试航预估 + 线路反推，纯函数供面板与单测共用） ───

/** 槽位类型显示名（面板槽位行/模块行共用；加槽位类型 = 加一行）。
 *  2026-09-13 火箭三部位改版（用户需求）：cargo→payload（荷载）、tank→fuel（燃料），功能槽下线 */
export const SLOT_TYPE_NAMES: Record<string, string> = {
  payload: '荷载',
  fuel: '燃料',
  engine: '引擎',
}

// ─── 荷载设计工坊（2026-09-13：主体+附件合成一件自定义荷载，纯函数供 GameMode/面板共用） ───

// ─── 设计工坊合成器（2026-09-14 三部位泛化：荷载/燃料/引擎皆可设计） ───

/** 部位 → 主体角色字段名（ship_module 表行上的 role 键；设计工坊/装配台/合成器共用，改口径只改此处） */
export const SLOT_ROLE_KEY: Record<string, string> = {
  payload: 'payloadRole',
  fuel: 'fuelRole',
  engine: 'engineRole',
}

/** 设计部位（SimPayloadDesign.slotType）→ 合成件槽型（同部位直通；旧档未知值兜底 payload） */
function designSlotType(slotType: string): string {
  return slotType in SLOT_ROLE_KEY ? slotType : 'payload'
}

/**
 * 设计 → 合成模块定义（三部位通用，纯函数读静态表）：
 *  - 部位由 d.slotType 决定（payload/fuel/engine；旧档缺省 payload），合成件 slotType 随部位——
 *    多附件并一件占对应槽位，槽位效率是 15% 溢价买来的核心价值；
 *  - 主体校验 = 该部位角色键（payloadRole/fuelRole/engineRole）=== 'chassis'（部位选错 = null）；
 *  - 附件合成不拒部位（payloadRole='attachment' 的改装件，旧档跨部位设计宽容；工坊编辑区勾选按 fits 契合收敛），乘算叠乘，
 *    antiFreeze/autoEvade 一票即真；
 *  - 造价 = (主体 + Σ附件) × 组装溢价（5 取整）。
 */
export function payloadDesignModuleDef(d: SimPayloadDesign): ShipModuleDef | null {
  const slot = designSlotType(d.slotType)
  const chassis = shipModuleDefOf(d.chassis)
  if (!chassis || (chassis as unknown as Record<string, unknown>)[SLOT_ROLE_KEY[slot]] !== 'chassis') return null
  const mods: ShipModuleDef['mods'] = { ...chassis.mods }
  let cost = chassis.cost
  const parts: string[] = []
  for (const id of d.attachments) {
    const def = shipModuleDefOf(id)
    if (!def || def.payloadRole !== 'attachment') continue
    for (const key of ['loadMult', 'fuelMult', 'speedMult', 'workMult', 'bufferCapMult', 'windowFuelMult', 'flareLossMult', 'maintMult'] as const) {
      const a = mods[key]
      const b = def.mods[key]
      if (a !== undefined || b !== undefined) mods[key] = (a ?? 1) * (b ?? 1)
    }
    if (def.mods.antiFreeze) mods.antiFreeze = true
    if (def.mods.autoEvade) mods.autoEvade = true
    cost += def.cost
    parts.push(def.name)
  }
  return {
    name: d.name,
    desc: `${chassis.name}${parts.length ? ` + ${parts.join(' + ')}` : ''}`,
    cost: Math.round((cost * PAYLOAD_ASSEMBLY_MULT) / 5) * 5,
    slotType: slot,
    mods,
  }
}

/** 荷载设计清单 → 自定义模块注册表投影（setDynamicShipModules 入参；无效设计跳过，旧档缺 slotType 按荷载部位） */
export function payloadDesignDefsOf(designs: SimPayloadDesign[]): Record<string, ShipModuleDef> {
  const out: Record<string, ShipModuleDef> = {}
  for (const d of designs) {
    const def = payloadDesignModuleDef({ ...d, slotType: d.slotType ?? 'payload' })
    if (def) out[d.uid] = def
  }
  return out
}

/** 下一个设计 uid（部位前缀 pd/fd/ed + 现存最大 N+1；删除后不复用，存档引用永不断链） */
export function nextPayloadUid(designs: SimPayloadDesign[], slotType: string): string {
  const prefix = slotType === 'fuel' ? 'fd' : slotType === 'engine' ? 'ed' : 'pd'
  let max = 0
  for (const d of designs) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(d.uid)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${max + 1}`
}

/** 试航预估结果（给定船级配置 × 目标星的一条往返账；读态即得，不改状态） */
export interface ShipTrial {
  /** 单船满载（吨；含卡/环/船级乘区） */
  load: number
  /** 单程航时（秒） */
  legS: number
  /** 往返轮时（秒，= 2×leg + 装 + 卸） */
  cycleS: number
  /** 往返油耗（吨） */
  fuel: number
  /** 单趟净赚（吨 = 载 − 油耗） */
  net: number
  /** 单线吞吐率（吨/秒 = net ÷ cycle） */
  throughput: number
}

/**
 * 试航预估（船坞面板试航卡 / 线路反推共用口径）：
 * 满载 = starLoad（星基础 × 卡 × 环 × 船级），轮时 = legSeconds×2 + 装卸×workMult，
 * 油耗 = roundFuel（×船级油乘），吞吐 = 净赚 ÷ 轮时。未知星返回 null。
 */
export function shipTrialOf(state: SimState, hullId: string, modules: string[], star: StarId, ring?: RingModSet): ShipTrial | null {
  const def = B.stars[star]
  if (!def) return null
  const shipLike = { hull: hullId, modules }
  const m = shipMults(shipLike)
  const load = starLoad(state.mods, star, shipLike, ring)
  const leg = legSeconds(def.dist, state.mods.speedMult * m.speedMult)
  const cycle = leg * 2 + B.loadSeconds * m.workMult + B.unloadSeconds * m.workMult
  const fuel = roundFuel(state.mods, def.dist, 1, shipLike, ring)
  const net = Math.max(0, load - fuel)
  return { load, legS: leg, cycleS: cycle, fuel, net, throughput: net / Math.max(0.1, cycle) }
}

/**
 * 线路反推（试航卡旁行）：要补上缺口 gap（吨/秒），用该配置船需要几艘。
 * 返回向上取整船数（0 = 缺口已满足或吞吐为 0）。
 */
export function shipsNeededFor(trial: ShipTrial | null, gap: number): number {
  if (!trial || trial.throughput <= 0 || gap <= 0) return 0
  return Math.ceil(gap / trial.throughput)
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

/**
 * 同两端点查航线（重复画线 = 派 1 艘船）。dirs 传定时只匹配指定流向
 * （2026-09-13 中转链：地球↔中转站允许 reverse 建材线与 relay_out H3 线共存）。
 */
export function findRoute(state: SimState, a: Endpoint, b: Endpoint, dirs?: SimRoute['direction'][]): SimRoute | undefined {
  const ka = endpointKey(a), kb = endpointKey(b)
  return state.routes.find((r) => {
    const ra = endpointKey(r.from), rb = endpointKey(r.to)
    const geo = (ra === ka && rb === kb) || (ra === kb && rb === ka)
    if (!geo) return false
    return !dirs || dirs.includes(r.direction)
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
  // 全息地球地表建筑：星图位 = 地球实时位 + 经度方位投影（半径 = 地球显示半径 × 全息球倍率，
  // 与全息球面点的星图投影同径——全息图上建筑贴在哪，星图就在地球周围同方位）
  if (b.surface) return surfaceBuildingPos(state, b.surface.lat, b.surface.lon)
  if (!b.anchor || typeof b.orbitR !== 'number' || typeof b.orbitA0 !== 'number') return { x: b.x, y: b.y }
  const a = starPosAt(state, b.anchor)
  const ang = b.orbitA0 + (B.build.orbitSpeed / Math.max(1, b.orbitR)) * state.time
  return { x: a.x + Math.cos(ang) * b.orbitR, y: a.y + Math.sin(ang) * b.orbitR }
}

// ─── 全息地球（2026-09-12：环节点空间落位 + 冰雪融化 + 地表建筑放置门槛） ───

/** 度 → 弧度（球面参数全用度出入，弧度只做中间量） */
const DEG = Math.PI / 180

/**
 * lat/lon（度）→ 单位球向量（+Y = 北极；与渲染 latLonToLocal 同式）。
 * x = cos(lat)cos(lon) / y = sin(lat) / z = cos(lat)sin(lon)
 */
export function latLonToVec(latDeg: number, lonDeg: number): { x: number; y: number; z: number } {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon) }
}

/** 单位球向量 → lat/lon（度；latLonToVec 逆变换） */
export function vecToLatLon(v: { x: number; y: number; z: number }): { lat: number; lon: number } {
  return { lat: Math.asin(Math.max(-1, Math.min(1, v.y))) / DEG, lon: Math.atan2(v.z, v.x) / DEG }
}

/** 两球面点角距（度；弦长换算，0~180） */
export function angularDistDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = latLonToVec(lat1, lon1)
  const b = latLonToVec(lat2, lon2)
  const chord = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  return 2 * Math.asin(Math.min(1, chord / 2)) / DEG
}

/** 环节点融冰半径（度）：安装的环建筑可带 meltRadiusDeg 覆盖，默认全局 B.holoEarth.meltRadiusDeg */
export function ringNodeMeltRadiusDeg(state: Pick<SimState, 'ringBuildings'>, slot: number): number {
  const id = state.ringBuildings?.[slot]
  const override = id ? ringBuildingDefOf(id)?.meltRadiusDeg : undefined
  return override ?? B.holoEarth.meltRadiusDeg
}

/** 已落位环节点清单（读态聚合：下标 = 槽位号；空数组 = 全部待落位） */
export function placedRingNodes(state: Pick<SimState, 'ringSlots' | 'ringNodes' | 'ringBuildings'>): Array<{ slot: number; lat: number; lon: number; rDeg: number }> {
  const out: Array<{ slot: number; lat: number; lon: number; rDeg: number }> = []
  const nodes = state.ringNodes ?? []
  for (let i = 0; i < state.ringSlots && i < nodes.length; i++) {
    const n = nodes[i]
    if (n) out.push({ slot: i, lat: n.lat, lon: n.lon, rDeg: ringNodeMeltRadiusDeg(state as Pick<SimState, 'ringBuildings'>, i) })
  }
  return out
}

/** 待落位节点数（已交付槽位中位置为 null 的；全息面板/HUD 提示消费） */
export function pendingRingNodeCount(state: Pick<SimState, 'ringSlots' | 'ringNodes'>): number {
  const nodes = state.ringNodes ?? []
  let n = 0
  for (let i = 0; i < state.ringSlots && i < nodes.length; i++) if (!nodes[i]) n++
  return n
}

/** 球面点是否已融化（任一环节点融冰圈内 = 地表建筑可放置） */
export function isMeltedAt(state: Pick<SimState, 'ringSlots' | 'ringNodes' | 'ringBuildings'>, lat: number, lon: number): boolean {
  for (const n of placedRingNodes(state)) {
    if (angularDistDeg(lat, lon, n.lat, n.lon) <= n.rDeg) return true
  }
  return false
}

/**
 * 全息地球地表建筑星图投影（画布系）：地球实时位 + 方位角 = 经度、离盘心距离 =
 * 地球显示半径 × 全息球倍率（纬度只决定全息图上的高度，星图俯视投影退化为方位点）。
 * 渲染/拾取/航线/护盾判定统一走 buildingPos → 此函数（无独立口径）。
 */
export function surfaceBuildingPos(state: SimState, lat: number, lon: number): { x: number; y: number } {
  const e = earthPos(state)
  const R = B.map.nodes.earth.r * B.holoEarth.radiusMult
  const v = latLonToVec(lat, lon)
  return { x: e.x + v.x * R, y: e.y + v.z * R }
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

/** 往返油耗 = 2 × 距离系数 × 基础油耗 × 油耗乘区（× 引力窗口折价 × 船级油耗乘区；
 *  2026-09-14 舱内附件二批：引力弹弓计算器在窗口内再加深 ×windowFuelMult，B.convoyFuelFloor 封底——
 *  地板 = 基础油耗 × floor（默认 0.2），窗口折价与加深叠乘不得击穿） */
export function roundFuel(mods: SimState['mods'], distCoeff: number, windowMult = 1, ship?: Pick<SimShip, 'hull' | 'modules'>, ring?: RingModSet): number {
  const shipMult = ship ? shipMults(ship) : null
  let windowed = windowMult
  if (windowMult !== 1 && shipMult) {
    windowed = Math.max(B.convoyFuelFloor, windowMult * shipMult.windowFuelMult)
  }
  return 2 * distCoeff * B.baseBurnPerLeg * mods.fuelMult * windowed * (shipMult?.fuelMult ?? 1)
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

/** 该航线是否受引力窗口影响（木卫二相关线：正向星端 / 中转链星段） */
export function windowAffected(state: SimState, route: SimRoute): boolean {
  return starOfEndpoint(state, route.from) === 'europa' || starOfEndpoint(state, route.to) === 'europa'
}

/** 星 ↔ 建筑距离系数（中转链星段航时/油耗口径：画布距离 ÷ 1AU=250px） */
export function relayLegDistCoeff(state: SimState, star: StarId, buildingId: number): number {
  const b = state.buildings.find((x) => x.id === buildingId)
  if (!b) return 1
  const p = buildingPos(state, b)
  const sp = starPosAt(state, star)
  return Math.max(0.1, Math.hypot(p.x - sp.x, p.y - sp.y) / 250)
}

/** 航线单船净补/载建材（展示用；relay_out = 单趟回运吨，relay_in = 单趟入站吨） */
export function routeNetPerTrip(state: SimState, route: SimRoute): number {
  if (route.direction === 'forward') {
    const star = starOfEndpoint(state, route.from)!
    const load = starLoad(state.mods, star)
    const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.fuelMult : 1
    return load - roundFuel(state.mods, B.stars[star].dist, w)
  }
  if (route.direction === 'relay_in') {
    const star = starOfEndpoint(state, route.from)!
    const dist = relayLegDistCoeff(state, star, route.to.kind === 'building' ? route.to.buildingId : 0)
    const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.fuelMult : 1
    return starLoad(state.mods, star) - roundFuel(state.mods, dist, w)
  }
  if (route.direction === 'relay_out') {
    const b = buildingByEndpoint(state, route.from)
    const dist = b ? supplyDistCoeff(state, { kind: 'building', buildingId: b.id }) : 1
    const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.fuelMult : 1
    return cargoCap(state.mods) - roundFuel(state.mods, dist, w)
  }
  return Math.round(cargoCap(state.mods))
}

/** 航线往返时长（展示用，秒） */
export function routeCycleSeconds(state: SimState, route: SimRoute): number {
  const w = state.gravity.phase === 'active' && windowAffected(state, route) ? B.gravity.speedMult : 1
  if (route.direction === 'forward') {
    const star = starOfEndpoint(state, route.from)!
    const leg = legSeconds(B.stars[star].dist, state.mods.speedMult * w)
    return leg * 2 + B.loadSeconds + B.unloadSeconds
  }
  if (route.direction === 'relay_in') {
    const star = starOfEndpoint(state, route.from)!
    const dist = relayLegDistCoeff(state, star, route.to.kind === 'building' ? route.to.buildingId : 0)
    const leg = legSeconds(dist, state.mods.speedMult * w)
    return leg * 2 + B.loadSeconds + B.unloadSeconds
  }
  if (route.direction === 'relay_out') {
    const b = buildingByEndpoint(state, route.from)
    const dist = b ? supplyDistCoeff(state, { kind: 'building', buildingId: b.id }) : 1
    const leg = legSeconds(dist, state.mods.speedMult * w)
    return leg * 2 + B.loadSeconds + B.unloadSeconds
  }
  const leg = legSeconds(supplyDistCoeff(state, route.to), state.mods.speedMult)
  return leg * 2 + B.loadSeconds + B.unloadSeconds
}

/**
 * 当前总到手供应速率（吨/秒，2026-09-13 供应链重构：Acts 稳供 streak / HUD 收支消费）：
 * Σ各线（正向/中转出站）配船 × 单趟净 ÷ 往返时长。堆场缺货等点态约束不在此口径
 * （这里是满负荷吞吐上限，实际到手见 ledger.unload 累计）。
 */
export function supplyRateOf(state: SimState): number {
  let rate = 0
  for (const route of state.routes) {
    const n = route.shipIds.length
    if (n === 0) continue
    if (route.direction !== 'forward' && route.direction !== 'relay_out') continue
    const cycle = Math.max(1, routeCycleSeconds(state, route))
    rate += (n * Math.max(0, routeNetPerTrip(state, route))) / cycle
  }
  return rate
}

/** 粗估净流（吨/秒，展示用）：卸货收入 − 反向支出 − 舰队维护费 − 环焚烧 */
export function estimateNetFlow(state: SimState, demand: number): number {
  let income = 0
  for (const route of state.routes) {
    const n = route.shipIds.length
    if (n === 0) continue
    const cycle = Math.max(1, routeCycleSeconds(state, route))
    if (route.direction === 'forward' || route.direction === 'relay_out') {
      income += (n * routeNetPerTrip(state, route)) / cycle
    } else if (route.direction === 'relay_in') {
      // 中转链星段不入地球：只计油耗成本（转运的变现看 relay_out 段）
      const star = starOfEndpoint(state, route.from)
      const dist = star
        ? relayLegDistCoeff(state, star, route.to.kind === 'building' ? route.to.buildingId : 0)
        : 1
      income -= (n * roundFuel(state.mods, dist)) / cycle
    } else {
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

export { buildingEffectiveDef, buildingHookMult, ringModsOf, freshRingMods, ringBuildingDefOf, shipHullDefOf, shipModuleDefOf, isDynamicShipModule, setDynamicShipModules, shipModuleEntries, PAYLOAD_ASSEMBLY_MULT } from './balance'
export type { BuildingDef, BuildingUpgradeDef, CardDef, RingBuildingDef, RingModSet, ShipHullDef, ShipModuleDef, SimBuilding, SimEvent, SimPayloadDesign, SimRoute, SimShip, SimState, StarId, MAP_H, MAP_W }
