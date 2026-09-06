/**
 * EventSystem / Diplomacy / PeaceSystem — 事件、外交与和平（core 纯逻辑，plan P3/P4）
 *
 * 事件：每日按触发器判定（玩家国进 pendingEvents 弹窗，AI 国自动选第一项）；
 * 外交 MVP：制造借口（天数）→ 战争目标 → 宣战；无阵营/租借。
 * 和平 MVP：一国所有 VP 州全部被敌方控制 → 投降，全部控制权移交最大占领国（吞并）。
 */
import type { Hoi4State, EventDef } from './types'
import type { Hoi4Tables } from './tables'
import type { MapData } from './MapData'
import { applyEffects } from './FocusSystem'

/** 制造借口基准天数 */
export const JUSTIFY_DAYS = 30

// ═══════════════ 事件 ═══════════════

/** 事件触发条件判定 */
export function eventTriggered(state: Hoi4State, tables: Hoi4Tables, tag: string, eventId: string, rng: () => number): boolean {
  const e = tables.events[eventId]
  const c = state.countries[tag]
  if (!e || !c) return false
  if (state.firedEvents.includes(`${eventId}:${tag}`)) return false
  const t = e.trigger
  if (t.minHour !== undefined && state.hour < t.minHour) return false
  if (t.tags && !t.tags.includes(tag)) return false
  if (t.atWar !== undefined && c.wars.length > 0 !== t.atWar) return false
  if (t.chance !== undefined && rng() > t.chance) return false
  return true
}

/** 每日事件判定（全事件 × 全国家；AI 国立即结算第一项） */
export function tickEventsDaily(state: Hoi4State, tables: Hoi4Tables, map: MapData, rng: () => number): void {
  for (const tag of Object.keys(state.countries)) {
    const c = state.countries[tag]
    if (c.capitulated) continue
    for (const eventId of Object.keys(tables.events)) {
      if (!eventTriggered(state, tables, tag, eventId, rng)) continue
      state.firedEvents.push(`${eventId}:${tag}`)
      if (c.isAI || state.playerTag !== tag) {
        // AI：选第一个选项立即结算
        const e = tables.events[eventId]
        if (e) applyEffects(state, tables, tag, e.options[0].effects)
      } else {
        state.pendingEvents.push({ tag, eventId })
      }
    }
  }
  void map
}

/** 玩家选择事件选项 */
export function resolveEvent(state: Hoi4State, tables: Hoi4Tables, tag: string, eventId: string, optionIndex: number): boolean {
  const idx = state.pendingEvents.findIndex((p) => p.tag === tag && p.eventId === eventId)
  if (idx < 0) return false
  const e: EventDef | undefined = tables.events[eventId]
  if (!e) { state.pendingEvents.splice(idx, 1); return false }
  const opt = e.options[Math.min(e.options.length - 1, Math.max(0, optionIndex))]
  state.pendingEvents.splice(idx, 1)
  applyEffects(state, tables, tag, opt.effects)
  return true
}

// ═══════════════ 外交 ═══════════════

/** 开始制造借口（已有战争目标/已在制造则拒绝） */
export function startJustify(state: Hoi4State, tag: string, target: string): boolean {
  const c = state.countries[tag]
  if (!c || c.capitulated) return false
  if (c.warGoals.includes(target) || c.wars.includes(target)) return false
  if (c.justifying[target]) return false
  c.justifying[target] = JUSTIFY_DAYS
  return true
}

/** 每日外交推进：借口倒计时 → 战争目标 */
export function tickDiplomacyDaily(state: Hoi4State, tag: string): void {
  const c = state.countries[tag]
  if (!c) return
  for (const [target, days] of Object.entries(c.justifying)) {
    const speed = 1 + c.modifiers.justificationSpeed
    const left = days - speed
    if (left <= 0) {
      delete c.justifying[target]
      if (!c.warGoals.includes(target)) c.warGoals.push(target)
    } else {
      c.justifying[target] = left
    }
  }
}

/** 宣战（需战争目标或已有借口完成；双向登记） */
export function declareWar(state: Hoi4State, tag: string, target: string): boolean {
  const a = state.countries[tag]
  const b = state.countries[target]
  if (!a || !b || a.capitulated || b.capitulated) return false
  if (tag === target) return false
  if (a.wars.includes(target)) return false
  if (!a.warGoals.includes(target)) return false
  a.warGoals = a.warGoals.filter((t) => t !== target)
  a.wars.push(target)
  b.wars.push(tag)
  return true
}

// ═══════════════ 和平（简化版：VP 全失 → 投降被吞并） ═══════════════

/** 某国是否仍控制自己全部带 VP 的州 */
export function isCapitulated(state: Hoi4State, map: MapData, tag: string): boolean {
  const c = state.countries[tag]
  if (!c || c.capitulated) return false
  const vpStates = map.statesOfTag(tag).filter((s) => s.vp > 0)
  if (vpStates.length === 0) {
    // 无 VP 州：首都州失守即降
    const cap = map.statesOfTag(tag).find((s) => s.provinces.includes(capitalOf(map, tag)))
    return cap ? state.provinceControl[cap.capital] !== tag : false
  }
  return vpStates.every((s) => state.provinceControl[s.capital] !== tag)
}

export function capitalOf(map: MapData, tag: string): number {
  return map.def.capitals[tag] ?? 0
}

/** 每日投降检查：投降 → 全部控制权移交最强占领国、师解除、战争结束 */
export function tickCapitulationDaily(state: Hoi4State, tables: Hoi4Tables, map: MapData): void {
  for (const tag of Object.keys(state.countries)) {
    if (!isCapitulated(state, map, tag)) continue
    const c = state.countries[tag]
    c.capitulated = true
    // 占领国计数（按其控制的该国省数）
    const occupiers = new Map<string, number>()
    for (const s of map.statesOfTag(tag)) {
      const ctrl = state.provinceControl[s.capital]
      if (ctrl && ctrl !== tag) occupiers.set(ctrl, (occupiers.get(ctrl) ?? 0) + 1)
    }
    let winner = ''
    let best = -1
    for (const [t, n] of occupiers) if (n > best) { best = n; winner = t }
    if (!winner) winner = Object.keys(state.countries).find((t) => t !== tag) ?? tag
    c.conqueredBy = winner
    // 全部省份控制权移交 + 师清除
    for (const pid of Object.keys(state.provinceControl)) {
      if (state.provinceControl[Number(pid)] === tag) state.provinceControl[Number(pid)] = winner
    }
    for (const [id, d] of Object.entries(state.divisions)) {
      if (d.owner === tag) delete state.divisions[id]
    }
    // 解除全部战争关系
    for (const enemy of [...c.wars]) {
      const e = state.countries[enemy]
      if (e) e.wars = e.wars.filter((t) => t !== tag)
    }
    c.wars = []
    c.justifying = {}
    c.warGoals = []
    void tables
  }
  // 胜负判定（玩家视角）
  const player = state.playerTag ? state.countries[state.playerTag] : null
  if (player?.capitulated) {
    state.result = 'defeat'
  } else if (player) {
    const enemies = player.wars.map((t) => state.countries[t]).filter(Boolean)
    if (enemies.length > 0 && enemies.every((e) => e.capitulated)) state.result = 'victory'
  }
}
