/**
 * Hoi4State — 整局状态初始化 + tick 编排 + 序列化（core 纯逻辑）
 *
 * 时间分层结算（plan §D3）：
 *   时结算 = 移动、战斗、堑壕/组织恢复；
 *   日结算 = 经济、国策/科研/训练、事件、AI、补给、投降检查。
 * 确定性：随机只走 state.seed 派生的 mulberry32；core 内禁墙钟。
 */
import type { Hoi4State, CountryState } from './types'
import type { Hoi4Tables } from './tables'
import type { MapData } from './MapData'
import { mulberry32 } from './rng'
import { tickConstructionDaily, tickProductionDaily } from './Economy'
import { tickFocusDaily, tickResearchDaily } from './FocusSystem'
import { tickBattleHourly, divisionMaxOrg } from './Combat'
import { tickMovementHourly, tickTrainingDaily, resolveBattleEnd } from './Military'
import { tickEventsDaily, tickDiplomacyDaily, tickCapitulationDaily } from './Diplomacy'
import { aiThink } from './CountryAI'
import { findLaw } from './tables'

export const STATE_VERSION = 1

/** 初始装备库存（各国；支援装备随步兵师工兵连从开局就需要） */
const INITIAL_STOCK: Record<string, number> = {
  infantry_equipment: 6000,
  support_equipment: 400,
  artillery: 0,
  light_tank: 0,
  medium_tank: 0,
  motorized: 0,
}

/** 单国初始状态 */
export function createCountryState(tag: string, tables: Hoi4Tables, map: MapData, isAI: boolean): CountryState {
  const def = tables.countries[tag]
  const stateCount = map.statesOfTag(tag).length
  return {
    tag,
    pp: def?.pp ?? 50,
    manpower: (def?.manpower ?? 300) * 1000,
    stability: def?.stability ?? 60,
    warSupport: def?.warSupport ?? 30,
    civFactories: 4 + stateCount * 2,
    milFactories: 1 + Math.floor(stateCount / 2),
    laws: { economy: 'civilian_economy', conscription: 'voluntary', trade: 'free_trade' },
    constructionQueue: [],
    productionLines: [],
    equipmentStock: { ...INITIAL_STOCK },
    researchBonus: {},
    techs: { researching: [], completed: [] },
    focus: { current: null, daysLeft: 0, completed: [] },
    trainingQueue: [],
    deployPool: [],
    deployedCount: 0,
    unlockedEquipments: ['infantry_equipment', 'support_equipment', 'artillery'],
    unlockedBattalions: ['infantry', 'cavalry', 'artillery', 'light_armor', 'motorized'],
    customTemplates: {},
    customTemplateCount: 0,
    justifying: {},
    warGoals: [],
    wars: [],
    capitulated: false,
    conqueredBy: null,
    modifiers: {
      factoryOutput: 0, constructionSpeed: 0, researchSpeed: 0, justificationSpeed: 0,
      catSoftAttack: {}, catHardAttack: {}, catDefense: {}, catBreakthrough: {}, orgFlat: 0,
    },
    isAI,
  }
}

/** 整局初始状态（allAI=true 时无玩家，供挂机测试） */
export function createInitialState(tables: Hoi4Tables, map: MapData, seed = 1, playerTag: string | null = null): Hoi4State {
  const countries: Record<string, CountryState> = {}
  for (const tag of Object.keys(tables.countries)) {
    countries[tag] = createCountryState(tag, tables, map, tag !== playerTag)
  }
  const provinceControl: Record<number, string> = {}
  for (const [pid, p] of map.provinces) {
    if (p.sea) continue
    const s = map.state(p.state)
    if (s) provinceControl[pid] = s.owner
  }
  const state: Hoi4State = {
    version: STATE_VERSION,
    hour: 0,
    speed: 2,
    paused: true,
    seed,
    playerTag,
    countries,
    provinceControl,
    divisions: {},
    battles: {},
    pendingEvents: [],
    firedEvents: [],
    result: null,
    nextId: 1,
  }
  return state
}

/** 补给重算（每日）：首都 BFS 经己方控制省，可达则 supplied */
export function recomputeSupply(state: Hoi4State, map: MapData): void {
  for (const tag of Object.keys(state.countries)) {
    const c = state.countries[tag]
    if (c.capitulated) continue
    const capital = map.def.capitals[tag]
    const reachable = new Set<number>()
    if (capital && state.provinceControl[capital] === tag) {
      const queue = [capital]
      reachable.add(capital)
      while (queue.length) {
        const cur = queue.shift()!
        for (const nb of map.adjacency.get(cur) ?? []) {
          if (reachable.has(nb) || !map.isLand(nb)) continue
          if (state.provinceControl[nb] !== tag) continue
          reachable.add(nb)
          queue.push(nb)
        }
      }
    }
    for (const d of Object.values(state.divisions)) {
      if (d.owner === tag) d.supplied = reachable.has(d.province)
    }
  }
}

/** 时结算 */
export function tickHourly(state: Hoi4State, tables: Hoi4Tables, map: MapData): void {
  // 移动
  for (const d of Object.values(state.divisions)) {
    tickMovementHourly(state, tables, map, d)
  }
  // 战斗
  for (const battle of Object.values(state.battles)) {
    const outcome = tickBattleHourly(state, tables, map, battle)
    if (outcome.ended) resolveBattleEnd(state, tables, map, battle.id, outcome.ended)
  }
  // 堑壕 + 组织恢复（非战斗师）
  for (const d of Object.values(state.divisions)) {
    if (d.battle !== 0) continue
    if (d.path.length === 0) {
      d.stationaryHours++
      const c = state.countries[d.owner]
      if (c) {
        const max = divisionMaxOrg(d, tables, c.modifiers, c.customTemplates)
        const regen = tables.combat.orgRegenPerHour * (d.supplied ? 1 : 0.4)
        d.org = Math.min(max, d.org + regen)
        // 训练度缓慢提升到 1
        d.training = Math.min(1, d.training + 0.0002)
      }
    } else {
      d.stationaryHours = 0
    }
    // 断补给损耗（每 24 小时 1%）
    if (!d.supplied && state.hour % 24 === 0) d.strength = Math.max(0.05, d.strength - 0.01)
  }
}

/** 日结算 */
export function tickDaily(state: Hoi4State, tables: Hoi4Tables, map: MapData): void {
  const rng = mulberry32(state.seed + state.hour)
  for (const tag of Object.keys(state.countries)) {
    const c = state.countries[tag]
    if (c.capitulated) continue
    // 政治点 + 人力
    c.pp += tables.combat.ppPerDay
    const cons = findLaw(tables.laws.conscription, c.laws.conscription)
    const pop = map.statesOfTag(tag).reduce((s, st) => state.provinceControl[st.capital] === tag ? s + st.pop : s, 0)
    c.manpower += pop * tables.combat.manpowerPerDayPerState * (cons?.manpowerMod ?? 1)
    // 经济
    tickConstructionDaily(state, tables, map, tag)
    tickProductionDaily(state, tables, map, tag)
    // 内政
    tickFocusDaily(state, tables, tag)
    tickResearchDaily(state, tables, tag)
    tickTrainingDaily(state, tag)
    tickDiplomacyDaily(state, tag)
    // AI
    aiThink(state, tables, map, tag)
  }
  recomputeSupply(state, map)
  tickEventsDaily(state, tables, map, rng)
  tickCapitulationDaily(state, tables, map)
}

// ═══════════════ 序列化 ═══════════════

export function serializeState(state: Hoi4State): Hoi4State {
  return JSON.parse(JSON.stringify(state)) as Hoi4State
}

export function deserializeState(json: unknown): Hoi4State | null {
  const s = json as Hoi4State
  if (!s || s.version !== STATE_VERSION || !s.countries || !s.provinceControl) return null
  return JSON.parse(JSON.stringify(s)) as Hoi4State
}
