/**
 * Economy — 建造队列 / 生产线 / 资源结算（core 纯逻辑，plan §D5-P1）
 *
 * 全部函数以 (state, tables, map, tag) 为输入做确定性推进；
 * 数值出口全在 combat_params.config.json（civFactoryOutput 等）。
 */
import type { Hoi4State, CountryState, ConstructionItem, ProductionLine } from './types'
import type { Hoi4Tables } from './tables'
import type { MapData } from './MapData'

/** 某国钢铁/石油日收入（州资源求和 × 折算系数） */
export function resourceIncome(state: Hoi4State, map: MapData, tag: string): { steel: number; oil: number } {
  let steel = 0
  let oil = 0
  for (const s of map.statesOfTag(tag)) {
    if (state.provinceControl[s.capital] === tag) {
      steel += s.steel
      oil += s.oil
    }
  }
  return { steel: steel * 8, oil: oil * 4 }
}

/** 消费品占比（经济法 cg） */
export function consumerGoodsRatio(c: CountryState, tables: Hoi4Tables): number {
  return tables.laws.economy.find((l) => l.id === c.laws.economy)?.cg ?? 0.3
}

/** 有效民厂（扣除消费品） */
export function effectiveCivFactories(c: CountryState, tables: Hoi4Tables): number {
  return c.civFactories * (1 - consumerGoodsRatio(c, tables))
}

/** 经济法+贸易法+科技的工厂产出乘数 */
export function factoryOutputMod(c: CountryState, tables: Hoi4Tables): number {
  const eco = tables.laws.economy.find((l) => l.id === c.laws.economy)
  const trade = tables.laws.trade.find((l) => l.id === c.laws.trade)
  return (eco?.factoryOutputMod ?? 1) * (trade?.factoryOutputMod ?? 1) * (1 + c.modifiers.factoryOutput)
}

/** 建造速度乘数 */
export function constructionMod(c: CountryState, tables: Hoi4Tables): number {
  const eco = tables.laws.economy.find((l) => l.id === c.laws.economy)
  return (eco?.constrMod ?? 1) * (1 + c.modifiers.constructionSpeed)
}

/** 州内已建成建筑折算（全国计数平摊，用于建造落位上限粗判） */
export function countBuiltInState(c: CountryState, map: MapData, stateId: number): number {
  const s = map.state(stateId)
  if (!s) return 0
  const all = map.statesOfTag(s.owner).length || 1
  return Math.round((c.civFactories + c.milFactories) / all)
}

/** 排队建造（stateId < 0 = 自动选本国富余建筑位的州） */
export function queueConstruction(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string, building: string, stateId = -1): boolean {
  const c = state.countries[tag]
  const def = tables.buildings[building]
  if (!c || !def) return false
  let sid = stateId
  if (sid < 0) {
    const used = new Map<number, number>()
    for (const it of c.constructionQueue) if (it.stateId >= 0) used.set(it.stateId, (used.get(it.stateId) ?? 0) + 1)
    const target = map.statesOfTag(tag)
      .filter((s) => state.provinceControl[s.capital] === tag)
      .find((s) => (used.get(s.id) ?? 0) + countBuiltInState(c, map, s.id) < s.slots + 4)
    if (!target) return false
    sid = target.id
  }
  const item: ConstructionItem = { id: state.nextId++, building, stateId: sid, progress: 0, cost: def.cost }
  c.constructionQueue.push(item)
  return true
}

/** 每日建造推进：吞吐 = 有效民厂 × civFactoryOutput × constrMod，全部灌给队首项目 */
export function tickConstructionDaily(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string): void {
  const c = state.countries[tag]
  if (!c || c.constructionQueue.length === 0) return
  const throughput = effectiveCivFactories(c, tables) * tables.combat.civFactoryOutput * constructionMod(c, tables)
  const item = c.constructionQueue[0]
  item.progress += throughput
  if (item.progress >= item.cost) {
    c.constructionQueue.shift()
    if (item.building === 'civilian_factory') c.civFactories++
    else if (item.building === 'military_factory') c.milFactories++
    else if (item.building === 'infrastructure') {
      const s = map.state(item.stateId)
      if (s) s.slots++
    }
  }
}

/** 排生产线（同装备已有线则加厂，总量受军工厂约束） */
export function addProductionLine(state: Hoi4State, tables: Hoi4Tables, tag: string, equipment: string, factories: number): void {
  const c = state.countries[tag]
  if (!c || !tables.equipments[equipment]) return
  const existing = c.productionLines.find((l) => l.equipment === equipment)
  if (existing) existing.factories += factories
  else c.productionLines.push({ id: state.nextId++, equipment, factories, efficiency: tables.combat.efficiencyStart })
  rebalanceLines(c)
}

/** 生产线厂分配平滑：总厂不超军工厂（超了按序砍） */
export function rebalanceLines(c: CountryState): void {
  let total = c.productionLines.reduce((s, l) => s + l.factories, 0)
  for (const l of c.productionLines) {
    if (total <= c.milFactories) break
    const cut = Math.min(l.factories, total - c.milFactories)
    l.factories -= cut
    total -= cut
  }
}

/** 每日生产推进：产出 = 厂 × milFactoryOutput × eff × outputMod；钢材/石油缺口按比例降档 */
export function tickProductionDaily(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string): void {
  const c = state.countries[tag]
  if (!c || c.productionLines.length === 0) return
  const mod = factoryOutputMod(c, tables)
  const inc = resourceIncome(state, map, tag)
  let steelNeed = 0
  let oilNeed = 0
  const outputs = c.productionLines.map((l) => {
    const eq = tables.equipments[l.equipment]
    const out = l.factories * tables.combat.milFactoryOutput * l.efficiency * mod
    if (eq) {
      steelNeed += out * eq.steelPerUnit
      oilNeed += out * (eq.oilPerUnit ?? 0)
    }
    return out
  })
  const steelScale = steelNeed > 0 ? Math.min(1, inc.steel / steelNeed) : 1
  const oilScale = oilNeed > 0 ? Math.min(1, inc.oil / oilNeed) : 1
  const scale = Math.min(steelScale, oilScale)
  c.productionLines.forEach((l, i) => {
    // 效率爬坡（缺资源也继续爬：产线仍在运转）
    l.efficiency = Math.min(tables.combat.efficiencyMax, l.efficiency + tables.combat.efficiencyGainPerDay)
    c.equipmentStock[l.equipment] = (c.equipmentStock[l.equipment] ?? 0) + outputs[i] * scale
  })
}
