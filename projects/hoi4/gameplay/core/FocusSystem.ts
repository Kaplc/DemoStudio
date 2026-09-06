/**
 * FocusSystem / TechSystem — 国策与科研（core 纯逻辑）
 * （合并单文件：两者结构对称——队列推进 + 效果 DSL 落账，拆文件反而碎）
 */
import type { Hoi4State, FocusEffect, EventEffect } from './types'
import type { Hoi4Tables } from './tables'
import type { MapData } from './MapData'

// ═══════════════ 国策 ═══════════════

/** 国策是否可选（未完成、前置齐、互斥未完成、tags 限定） */
export function focusAvailable(state: Hoi4State, tables: Hoi4Tables, tag: string, focusId: string): boolean {
  const c = state.countries[tag]
  const f = tables.focuses[focusId]
  if (!c || !f) return false
  if (c.focus.completed.includes(focusId)) return false
  if (c.focus.current === focusId) return false
  if (f.tags && f.tags.length > 0 && !f.tags.includes(tag)) return false
  if (c.focus.current) return false
  for (const p of f.prereq) if (!c.focus.completed.includes(p)) return false
  for (const m of f.mutuallyExclusive) if (c.focus.completed.includes(m)) return false
  return true
}

/** 挂国策 */
export function pickFocus(state: Hoi4State, tables: Hoi4Tables, tag: string, focusId: string): boolean {
  if (!focusAvailable(state, tables, tag, focusId)) return false
  const c = state.countries[tag]
  c.focus.current = focusId
  c.focus.daysLeft = tables.focuses[focusId].days
  return true
}

/** 每日推进：完成 → 效果落账 */
export function tickFocusDaily(state: Hoi4State, tables: Hoi4Tables, tag: string): void {
  const c = state.countries[tag]
  if (!c || !c.focus.current) return
  c.focus.daysLeft--
  if (c.focus.daysLeft <= 0) {
    const f = tables.focuses[c.focus.current]
    c.focus.completed.push(c.focus.current)
    c.focus.current = null
    if (f) applyEffects(state, tables, tag, f.effects)
  }
}

// ═══════════════ 科研 ═══════════════

/** 科研槽位（MVP 固定 3） */
export const RESEARCH_SLOTS = 3

export function techAvailable(state: Hoi4State, tables: Hoi4Tables, tag: string, techId: string): boolean {
  const c = state.countries[tag]
  const t = tables.techs[techId]
  if (!c || !t) return false
  if (c.techs.completed.includes(techId)) return false
  if (c.techs.researching.some((r) => r.id === techId)) return false
  for (const p of t.prereq) if (!c.techs.completed.includes(p)) return false
  for (const m of t.mutuallyExclusive ?? []) if (c.techs.completed.includes(m)) return false
  return true
}

export function startResearch(state: Hoi4State, tables: Hoi4Tables, tag: string, techId: string): boolean {
  if (!techAvailable(state, tables, tag, techId)) return false
  const c = state.countries[tag]
  if (c.techs.researching.length >= RESEARCH_SLOTS) return false
  const t = tables.techs[techId]
  // 提前惩罚（MVP：无前置完成进度奖励，天数恒定）；researchBonus 池按分类抵扣天数
  const bonusDays = Math.round(t.days * (c.researchBonus[t.category] ?? 0))
  c.techs.researching.push({ id: techId, daysLeft: Math.max(1, t.days - bonusDays) })
  c.researchBonus[t.category] = 0
  return true
}

/** 每日推进：天数按 researchMod 折减 */
export function tickResearchDaily(state: Hoi4State, tables: Hoi4Tables, tag: string): void {
  const c = state.countries[tag]
  if (!c) return
  const trade = tables.laws.trade.find((l) => l.id === c.laws.trade)
  const mod = (trade?.researchMod ?? 1) * (1 + c.modifiers.researchSpeed)
  for (const r of [...c.techs.researching]) {
    r.daysLeft -= mod
    if (r.daysLeft <= 0) {
      c.techs.researching.splice(c.techs.researching.indexOf(r), 1)
      c.techs.completed.push(r.id)
      applyTechEffect(state, tables, tag, r.id)
    }
  }
}

/** 科技效果落账 */
export function applyTechEffect(state: Hoi4State, tables: Hoi4Tables, tag: string, techId: string): void {
  const c = state.countries[tag]
  const t = tables.techs[techId]
  if (!c || !t) return
  const e = t.effect
  switch (e.type) {
    case 'stat_bonus': {
      const cat = e.category ?? ''
      if (e.softAttack) c.modifiers.catSoftAttack[cat] = (c.modifiers.catSoftAttack[cat] ?? 0) + e.softAttack
      if (e.hardAttack) c.modifiers.catHardAttack[cat] = (c.modifiers.catHardAttack[cat] ?? 0) + e.hardAttack
      if (e.defense) c.modifiers.catDefense[cat] = (c.modifiers.catDefense[cat] ?? 0) + e.defense
      if (e.breakthrough) c.modifiers.catBreakthrough[cat] = (c.modifiers.catBreakthrough[cat] ?? 0) + e.breakthrough
      if (e.org) c.modifiers.orgFlat += e.org
      break
    }
    case 'unlock_equipment':
      if (e.id && !c.unlockedEquipments.includes(e.id)) c.unlockedEquipments.push(e.id)
      break
    case 'unlock_battalion':
      if (e.id && !c.unlockedBattalions.includes(e.id)) c.unlockedBattalions.push(e.id)
      break
    case 'factory_output':
      c.modifiers.factoryOutput += e.bonus ?? 0
      break
    case 'construction_speed':
      c.modifiers.constructionSpeed += e.bonus ?? 0
      break
    default:
      break
  }
}

// ═══════════════ 效果 DSL（国策/事件共用，plan D5） ═══════════════

export function applyEffects(state: Hoi4State, tables: Hoi4Tables, tag: string, effects: ReadonlyArray<FocusEffect | EventEffect>): void {
  const c = state.countries[tag]
  if (!c) return
  for (const e of effects) {
    switch (e.type) {
      case 'pp': c.pp = Math.max(0, c.pp + e.amount); break
      case 'stability': c.stability = Math.min(100, Math.max(0, c.stability + e.amount)); break
      case 'war_support': c.warSupport = Math.min(100, Math.max(0, c.warSupport + e.amount)); break
      case 'factory':
        c.civFactories += e.civ ?? 0
        c.milFactories += e.mil ?? 0
        break
      case 'research_bonus':
        c.researchBonus[e.category] = (c.researchBonus[e.category] ?? 0) + e.amount
        break
      case 'equipment':
        c.equipmentStock[e.id] = (c.equipmentStock[e.id] ?? 0) + e.amount
        break
      case 'manpower':
        c.manpower += e.amount * 1000
        break
      case 'justification_speed':
        c.modifiers.justificationSpeed = Math.min(0.8, c.modifiers.justificationSpeed + (1 - e.mod))
        break
      case 'war_goal':
        if (!c.warGoals.includes(e.tag) && !c.wars.includes(e.tag)) c.warGoals.push(e.tag)
        break
    }
  }
  void state
  void tables
}
