/**
 * Military — 师训练/部署/移动/战斗收尾（core 纯逻辑，plan P2）
 */
import type { Hoi4State, Division, TemplateDef, CountryState } from './types'
import type { Hoi4Tables } from './tables'
import type { MapData } from './MapData'
import { divisionMaxOrg } from './Combat'

/** 模板解析：预置表优先，其次国家自定义模板 */
export function resolveTemplate(tables: Hoi4Tables, c: CountryState | undefined, templateId: string): TemplateDef | null {
  return tables.templates[templateId] ?? c?.customTemplates[templateId] ?? null
}

/** 模板装备需求合计 */
export function templateEquipmentNeed(tables: Hoi4Tables, template: TemplateDef): Record<string, number> {
  const need: Record<string, number> = {}
  for (const [bid, n] of Object.entries(template.battalions)) {
    const b = tables.battalions[bid]
    if (!b) continue
    for (const [eq, q] of Object.entries(b.equipment)) need[eq] = (need[eq] ?? 0) + q * n
  }
  for (const sid of template.supports) {
    const sp = tables.supports[sid]
    if (!sp) continue
    for (const [eq, q] of Object.entries(sp.equipment)) need[eq] = (need[eq] ?? 0) + q
  }
  return need
}

/** 模板人力需求 */
export function templateManpower(tables: Hoi4Tables, template: TemplateDef): number {
  let mp = 0
  for (const [bid, n] of Object.entries(template.battalions)) mp += (tables.battalions[bid]?.manpower ?? 0) * n
  for (const sid of template.supports) mp += tables.supports[sid]?.manpower ?? 0
  return mp
}

/** 模板是否已解锁（营装备全部解锁；自定义模板同规则） */
export function templateUnlocked(state: Hoi4State, tables: Hoi4Tables, tag: string, templateId: string): boolean {
  const c = state.countries[tag]
  const tpl = resolveTemplate(tables, c, templateId)
  if (!c || !tpl) return false
  for (const bid of Object.keys(tpl.battalions)) {
    const b = tables.battalions[bid]
    if (!b) continue
    for (const eq of Object.keys(b.equipment)) {
      // 步兵装备初始可用；其余需解锁科技
      if (eq !== 'infantry_equipment' && !hasEquipmentUnlocked(state, tables, tag, eq)) return false
    }
  }
  return true
}

/** 装备是否已解锁（步兵装备初始可用；其余看科技解锁表） */
export function hasEquipmentUnlocked(state: Hoi4State, _tables: Hoi4Tables, tag: string, eq: string): boolean {
  const c = state.countries[tag]
  if (!c) return false
  if (eq === 'infantry_equipment') return true
  return c.unlockedEquipments.includes(eq)
}

/** 排一个师的训练（预扣人力+装备；不足返回 false） */
export function queueTraining(state: Hoi4State, tables: Hoi4Tables, tag: string, templateId: string): boolean {
  const c = state.countries[tag]
  const tpl = resolveTemplate(tables, c, templateId)
  if (!c || !tpl) return false
  if (!templateUnlocked(state, tables, tag, templateId)) return false
  const need = templateEquipmentNeed(tables, tpl)
  for (const [eq, q] of Object.entries(need)) {
    if ((c.equipmentStock[eq] ?? 0) < q) return false
  }
  const mp = templateManpower(tables, tpl)
  if (c.manpower < mp) return false
  for (const [eq, q] of Object.entries(need)) c.equipmentStock[eq] -= q
  c.manpower -= mp
  c.trainingQueue.push({ id: state.nextId++, template: templateId, daysLeft: tables.combat.trainingDays })
  return true
}

/** 每日训练推进：完成 → 进部署池 */
export function tickTrainingDaily(state: Hoi4State, tag: string): void {
  const c = state.countries[tag]
  if (!c) return
  for (const item of [...c.trainingQueue]) {
    item.daysLeft--
    if (item.daysLeft <= 0) {
      c.trainingQueue.splice(c.trainingQueue.indexOf(item), 1)
      c.deployPool.push(item.template)
    }
  }
}

/** 从部署池部署一个师到省（省须为己方控制、陆地） */
export function deployDivision(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string, province: number): Division | null {
  const c = state.countries[tag]
  if (!c || c.deployPool.length === 0) return null
  const p = map.province(province)
  if (!p || p.sea) return null
  if (state.provinceControl[province] !== tag) return null
  if (Object.values(state.divisions).some((d) => d.province === province && d.battle !== 0 && d.owner !== tag)) return null
  const templateId = c.deployPool.shift()!
  const tpl = resolveTemplate(tables, c, templateId)
  const div: Division = {
    id: state.nextId++,
    owner: tag,
    template: templateId,
    name: `${tpl?.name ?? templateId} 第${c.deployedCount + 1}师`,
    province,
    org: 0,
    strength: 1,
    path: [],
    moveProgress: 0,
    stationaryHours: 0,
    supplied: true,
    battle: 0,
    training: 0.5,
  }
  div.org = divisionMaxOrg(div, tables, c.modifiers, c.customTemplates) * 0.5
  c.deployedCount++
  state.divisions[String(div.id)] = div
  return div
}

/** 编制设计器保存自定义模板（营数 1-25、营/支援须已解锁） */
export function saveCustomTemplate(state: Hoi4State, tables: Hoi4Tables, tag: string, name: string, battalions: Record<string, number>, supports: string[]): string | null {
  const c = state.countries[tag]
  if (!c) return null
  let count = 0
  for (const [bid, n] of Object.entries(battalions)) {
    if (n <= 0) continue
    if (!c.unlockedBattalions.includes(bid)) return null
    count += n
  }
  if (count < 1 || count > 25) return null
  for (const sid of supports) if (!tables.supports[sid]) return null
  const id = `custom_${c.customTemplateCount + 1}`
  c.customTemplateCount++
  c.customTemplates[id] = { name: `${name || '自定义师'}`, battalions, supports }
  return id
}

/** 下达移动/进攻令（沿 A* 路径；第一跳即触发战斗判定由移动 tick 处理） */
export function orderMove(state: Hoi4State, tables: Hoi4Tables, map: MapData, div: Division, target: number): boolean {
  if (div.battle !== 0) return false
  if (!map.isLand(target)) return false
  if (div.province === target) { div.path = []; return true }
  const path = map.findPath(div.province, target)
  if (!path || path.length < 2) return false
  path.shift() // 去掉当前省
  div.path = path
  div.moveProgress = 0
  div.stationaryHours = 0
  void tables
  return true
}

/** 每小时移动推进：到点进入下一省（敌占省有守军 → 开战由调用方处理） */
export function tickMovementHourly(state: Hoi4State, tables: Hoi4Tables, map: MapData, div: Division): void {
  if (div.battle !== 0 || div.path.length === 0) return
  const next = div.path[0]
  const need = map.moveHours(next)
  div.moveProgress += 1
  if (div.moveProgress >= need) {
    div.moveProgress = 0
    div.path.shift()
    enterProvince(state, tables, map, div, next, div.province)
  }
}

/** 师进入新省：敌占省有守军 → 开战（攻方留在 fromProvince）；已有同阵营战斗 → 加入攻方；无守军 → 占领 */
export function enterProvince(state: Hoi4State, tables: Hoi4Tables, map: MapData, div: Division, province: number, fromProvince: number): void {
  const controller = state.provinceControl[province] ?? map.stateOfProvince(province)?.owner ?? ''
  const defenders = Object.values(state.divisions).filter((d) => d.province === province && d.owner === controller && d.battle === 0 && d.owner !== div.owner)
  const atWar = controller !== div.owner && state.countries[div.owner]?.wars.includes(controller)
  // 该省已有同阵营为攻方的战斗 → 加入攻方（后继师汇聚）
  const ongoing = Object.values(state.battles).find((b) => b.province === province && b.attacker === div.owner)
  if (ongoing) {
    div.province = fromProvince
    div.battle = ongoing.id
    ongoing.attackers.push(div.id)
    div.path = []
    div.stationaryHours = 0
    return
  }
  div.province = province
  div.stationaryHours = 0
  if (atWar && defenders.length > 0) {
    // 开战：攻方师留在出发省（战斗在目标省头上打）
    div.province = fromProvince
    const id = state.nextId++
    state.battles[String(id)] = {
      id,
      province,
      attacker: div.owner,
      defender: controller,
      attackers: [div.id],
      defenders: defenders.map((d) => d.id),
      hours: 0,
      progress: 0,
    }
    div.battle = id
    for (const d of defenders) d.battle = id
    div.path = [] // 战后再说
  } else if (atWar) {
    // 无守军：占领
    state.provinceControl[province] = div.owner
  }
}

/**
 * 战斗收尾（tickBattleHourly 返回 ended 后调用）：
 * 败方组织度归零师撤退/被歼；胜方占领。
 */
export function resolveBattleEnd(state: Hoi4State, tables: Hoi4Tables, map: MapData, battleId: number, ended: 'attacker_won' | 'defender_won'): void {
  const battle = state.battles[String(battleId)]
  if (!battle) return
  const atkDivs = battle.attackers.map((id) => state.divisions[id]).filter(Boolean)
  const defDivs = battle.defenders.map((id) => state.divisions[id]).filter(Boolean)
  const losers = ended === 'attacker_won' ? defDivs : atkDivs
  const winners = ended === 'attacker_won' ? atkDivs : defDivs
  const loserTag = ended === 'attacker_won' ? battle.defender : battle.attacker
  const winnerTag = ended === 'attacker_won' ? battle.attacker : battle.defender

  // 败方撤退：本方控制的相邻省（无战斗的优先）；无处可退 = 被歼
  for (const d of losers) {
    const retreat = (map.adjacency.get(d.province) ?? []).find((nb) => {
      if (!map.isLand(nb)) return false
      if ((state.provinceControl[nb] ?? '') !== d.owner) return false
      if (Object.values(state.divisions).some((o) => o.province === nb && o.battle !== 0)) return false
      return true
    })
    if (retreat !== undefined) {
      d.province = retreat
      d.battle = 0
      d.path = []
      d.moveProgress = 0
      d.stationaryHours = 0
      const dc = state.countries[d.owner]
      d.org = divisionMaxOrg(d, tables, dc?.modifiers ?? emptyMods(), dc?.customTemplates) * 0.1
    } else {
      delete state.divisions[String(d.id)]
    }
  }
  // 胜方解锁并占省（守方胜则原地不动；攻方胜则进驻目标省）
  for (const d of winners) {
    d.battle = 0
    d.stationaryHours = 0
    d.moveProgress = 0
    d.path = []
  }
  if (ended === 'attacker_won') {
    state.provinceControl[battle.province] = winnerTag
    const first = winners[0]
    if (first) {
      first.province = battle.province
      // 败方若原驻此省已撤走；攻方其余师留在出发省
    }
  }
  delete state.battles[String(battleId)]
  void loserTag
}

function emptyMods() {
  return {
    factoryOutput: 0, constructionSpeed: 0, researchSpeed: 0, justificationSpeed: 0,
    catSoftAttack: {}, catHardAttack: {}, catDefense: {}, catBreakthrough: {}, orgFlat: 0,
  }
}
