/**
 * Combat — 师属性合成 + 陆战解算（core 纯函数，plan §D4）
 *
 * 每战一实例（Battle），每小时推进一步 tickBattleHourly：
 *   width = baseWidth（多方向进攻加宽留参数）；
 *   攻方输出 = Σ(软攻×(1-守硬度) + 硬攻×守硬度) × 修正；
 *   防御缓解 = 守方防御 × 地形 × 堑壕 × 补给；溢出转组织度伤害，按比例转兵力损耗；
 *   组织度先归零一方撤退。
 */
import type { Hoi4State, Division, Battle, CountryState, TemplateStats, TemplateDef } from './types'
import type { Hoi4Tables } from './tables'
import { catMod } from './tables'
import type { MapData } from './MapData'

// ═══════════════ 师属性 ═══════════════

/** 模板 → 满编师属性（不吃兵力/训练折减） */
export function computeTemplateStats(template: TemplateDef, tables: Hoi4Tables, mods: CountryState['modifiers']): TemplateStats {
  const s: TemplateStats = {
    width: 0, manpower: 0, org: 0, hp: 0,
    softAttack: 0, hardAttack: 0, defense: 0, breakthrough: 0, armor: 0, hardness: 0,
    equipment: {}, battalionCount: 0,
  }
  let widthHardness = 0
  let maxOrg = 0
  for (const [bid, count] of Object.entries(template.battalions)) {
    const b = tables.battalions[bid]
    if (!b) continue
    const n = count
    s.battalionCount += n
    s.width += b.width * n
    s.manpower += b.manpower * n
    s.hp += b.hp * n
    maxOrg = Math.max(maxOrg, b.org)
    s.softAttack += b.softAttack * n * (1 + catMod(mods.catSoftAttack, b.category))
    s.hardAttack += b.hardAttack * n * (1 + catMod(mods.catHardAttack, b.category))
    s.defense += b.defense * n * (1 + catMod(mods.catDefense, b.category))
    s.breakthrough += b.breakthrough * n * (1 + catMod(mods.catBreakthrough, b.category))
    s.armor = Math.max(s.armor, b.armor)
    widthHardness += b.width * n * b.hardness
    for (const [eq, q] of Object.entries(b.equipment)) {
      s.equipment[eq] = (s.equipment[eq] ?? 0) + q * n
    }
  }
  for (const sid of template.supports) {
    const sp = tables.supports[sid]
    if (!sp) continue
    s.manpower += sp.manpower
    s.softAttack += sp.softAttack
    s.hardAttack += sp.hardAttack
    s.defense += sp.defense
    s.breakthrough += sp.breakthrough
    s.org += sp.org
    for (const [eq, q] of Object.entries(sp.equipment)) {
      s.equipment[eq] = (s.equipment[eq] ?? 0) + q
    }
  }
  // 学说全局加成（category='' 存放在 mods 的 '' 键）
  s.softAttack *= 1 + catMod(mods.catSoftAttack, '')
  s.hardAttack *= 1 + catMod(mods.catHardAttack, '')
  s.defense *= 1 + catMod(mods.catDefense, '')
  s.breakthrough *= 1 + catMod(mods.catBreakthrough, '')
  s.org = Math.max(10, maxOrg + s.org + mods.orgFlat)
  s.hardness = s.width > 0 ? widthHardness / s.width : 0
  return s
}

/** 单师实际战力（兵力×训练折减；custom = 该国自定义模板表，覆盖预置表） */
export function divisionCombatPower(div: Division, tables: Hoi4Tables, mods: CountryState['modifiers'], custom?: Record<string, TemplateDef>): TemplateStats {
  const tpl = custom?.[div.template] ?? tables.templates[div.template] ?? { name: div.template, battalions: { infantry: 6 }, supports: [] } as TemplateDef
  return scaleStats(computeTemplateStats(tpl, tables, mods), div)
}

export function divisionMaxOrg(div: Division, tables: Hoi4Tables, mods: CountryState['modifiers'], custom?: Record<string, TemplateDef>): number {
  const tpl = custom?.[div.template] ?? tables.templates[div.template] ?? { name: div.template, battalions: { infantry: 6 }, supports: [] } as TemplateDef
  return computeTemplateStats(tpl, tables, mods).org
}

function scaleStats(full: TemplateStats, div: Division): TemplateStats {
  const eff = div.strength * (0.55 + 0.45 * div.training)
  return {
    ...full,
    softAttack: full.softAttack * eff,
    hardAttack: full.hardAttack * eff,
    defense: full.defense * eff,
    breakthrough: full.breakthrough * eff,
    hp: full.hp * div.strength,
  }
}

// ═══════════════ 战斗推进 ═══════════════

export interface BattleOutcome {
  /** 本小时总伤害（对攻/守） */
  dmgToAttackers: number
  dmgToDefenders: number
  /** 结束方式：null=继续 */
  ended: 'attacker_won' | 'defender_won' | null
}

/**
 * 开战：攻方师从 fromProvince 进入有守军的敌省。返回新战斗 id（0 = 参数不合法）。
 * 攻方师就地锁定（留在原省参战）。
 */
export function startBattle(state: Hoi4State, tables: Hoi4Tables, map: MapData, attackers: Division[], province: number, fromProvince: number): number {
  if (attackers.length === 0) return 0
  const attackerTag = attackers[0].owner
  const controller = state.provinceControl[province]
  const defenders = Object.values(state.divisions).filter((d) => d.province === province && d.owner === controller && d.battle === 0)
  if (!controller || controller === attackerTag) return 0
  if (!state.countries[attackerTag].wars.includes(controller)) return 0
  const id = state.nextId++
  const battle: Battle = {
    id,
    province,
    attacker: attackerTag,
    defender: controller,
    attackers: attackers.map((d) => d.id),
    defenders: defenders.map((d) => d.id),
    hours: 0,
    progress: 0,
  }
  state.battles[id] = battle
  for (const d of attackers) {
    d.battle = id
    d.path = []
    d.province = fromProvince
    d.stationaryHours = 0
  }
  for (const d of defenders) d.battle = id
  void map
  return id
}

/** 战斗双方修正聚合 */
function sideScore(divs: Division[], state: Hoi4State, tables: Hoi4Tables, targetHardness: number, attacking: boolean): { score: number; mitigation: number; orgPool: number } {
  let score = 0
  let mitigation = 0
  let orgPool = 0
  for (const d of divs) {
    const c = state.countries[d.owner]
    if (!c) continue
    const st = divisionCombatPower(d, tables, c.modifiers, c.customTemplates)
    score += st.softAttack * (1 - targetHardness) + st.hardAttack * targetHardness
    // 攻方用突破做进攻缓解，守方用防御做防御缓解
    mitigation += attacking ? st.breakthrough : st.defense
    orgPool += Math.max(0, d.org)
  }
  return { score, mitigation, orgPool }
}

/**
 * 每小时战斗推进（纯计算 + 写回组织度/兵力；撤退与占省由 Military.resolveBattleEnd 处理，
 * 这里只返回结论避免跨模块循环）。
 */
export function tickBattleHourly(state: Hoi4State, tables: Hoi4Tables, map: MapData, battle: Battle): BattleOutcome {
  const atkDivs = battle.attackers.map((id) => state.divisions[id]).filter((d) => d && d.battle === battle.id)
  const defDivs = battle.defenders.map((id) => state.divisions[id]).filter((d) => d && d.battle === battle.id)
  if (atkDivs.length === 0 || defDivs.length === 0) {
    return { dmgToAttackers: 0, dmgToDefenders: 0, ended: defDivs.length === 0 ? 'attacker_won' : 'defender_won' }
  }
  battle.hours++
  const p = map.province(battle.province)
  const terrain = tables.terrains[p?.terrain ?? 'plains']
  const defTerrainMod = terrain?.defMod ?? 1

  // 硬度互查（对方平均硬度）
  const defHardness = avgHardness(defDivs, tables, state)
  const atkHardness = avgHardness(atkDivs, tables, state)
  const atk = sideScore(atkDivs, state, tables, defHardness, true)
  const def = sideScore(defDivs, state, tables, atkHardness, false)

  // 补给修正
  const atkSupply = atkDivs.every((d) => d.supplied) ? 1 : 0.5
  const defSupply = defDivs.every((d) => d.supplied) ? 1 : 0.7

  // 守方堑壕（取守方师的最大堑壕小时）
  const trench = Math.min(tables.combat.entrenchMax, Math.max(...defDivs.map((d) => d.stationaryHours * tables.combat.entrenchPerHour)))
  const trenchMod = 1 + trench * tables.combat.entrenchDefensePerPoint

  const atkScore = atk.score * atkSupply
  const defScore = def.score * defSupply
  const atkMit = Math.max(1, atk.mitigation)
  const defMit = Math.max(1, def.mitigation * defTerrainMod * trenchMod)

  const coef = tables.combat.orgDamageCoef
  const dmgToDefenders = (atkScore * coef * 100) / (100 + defMit)
  const dmgToAttackers = (defScore * coef * 100) / (100 + atkMit)

  // 组织度伤害 + 溢出转兵力损耗
  applyDamage(state, tables, defDivs, dmgToDefenders)
  applyDamage(state, tables, atkDivs, dmgToAttackers)

  // 战斗内微恢复 + 攻方进度条（按守方组织度池衰减比例）
  const defOrgMax = defDivs.reduce((s, d) => s + divisionMaxOrg(d, tables, state.countries[d.owner]?.modifiers ?? emptyMods(), state.countries[d.owner]?.customTemplates), 0)
  const defOrgNow = defDivs.reduce((s, d) => s + Math.max(0, d.org), 0)
  battle.progress = defOrgMax > 0 ? Math.min(100, Math.max(0, (1 - defOrgNow / defOrgMax) * 100)) : 100

  let ended: BattleOutcome['ended'] = null
  if (atkDivs.every((d) => d.org <= 0)) ended = 'defender_won'
  else if (defDivs.every((d) => d.org <= 0)) ended = 'attacker_won'
  return { dmgToAttackers, dmgToDefenders, ended }
}

function avgHardness(divs: Division[], tables: Hoi4Tables, state: Hoi4State): number {
  if (divs.length === 0) return 0
  let w = 0
  let h = 0
  for (const d of divs) {
    const c = state.countries[d.owner]
    const st = divisionCombatPower(d, tables, c?.modifiers ?? emptyMods(), c?.customTemplates)
    w += st.width
    h += st.width * st.hardness
  }
  return w > 0 ? h / w : 0
}

function applyDamage(state: Hoi4State, tables: Hoi4Tables, divs: Division[], dmg: number): void {
  if (divs.length === 0 || dmg <= 0) return
  const per = dmg / divs.length
  for (const d of divs) {
    d.org = Math.max(0, d.org - per)
    // 兵力损耗：本小时伤害 × 系数折算到 hp 池占比
    const c = state.countries[d.owner]
    if (!c) continue
    const st = divisionCombatPower(d, tables, c.modifiers, c.customTemplates)
    if (st.hp > 0) {
      d.strength = Math.max(0.05, d.strength - (per * tables.combat.strengthDamageCoef) / st.hp)
    }
    // 战斗内微量恢复；已击溃（org 归零）不再恢复——保证战斗可分出胜负
    if (d.org <= 0) continue
    d.org = Math.min(divisionMaxOrg(d, tables, c.modifiers, c.customTemplates), d.org + tables.combat.orgRegenInBattlePerHour)
  }
}

function emptyMods() {
  return {
    factoryOutput: 0, constructionSpeed: 0, researchSpeed: 0, justificationSpeed: 0,
    catSoftAttack: {}, catHardAttack: {}, catDefense: {}, catBreakthrough: {},
  }
}
