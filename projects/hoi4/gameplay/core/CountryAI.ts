/**
 * CountryAI — AI 国家每日决策器（core 纯逻辑，plan §D6）
 *
 * 单文件带权重决策：科研 → 建造 → 生产配比 → 训练 → 部署 → 前线分配。
 * 全部查 ai_weights.config.json；目标"会玩、不犯法"，不追求原作水平。
 */
import type { Hoi4State, Division } from './types'
import type { Hoi4Tables } from './tables'
import type { MapData } from './MapData'
import { queueConstruction, addProductionLine, resourceIncome } from './Economy'
import { techAvailable, startResearch } from './FocusSystem'
import { queueTraining, deployDivision, orderMove, templateUnlocked } from './Military'
import { startJustify, declareWar } from './Diplomacy'
import { divisionCombatPower } from './Combat'

/** AI 每日一思考（各国在 onDay 顺序调用；数量级 ~10 国，单帧无压力） */
export function aiThink(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string): void {
  const c = state.countries[tag]
  if (!c || c.isAI === false || c.capitulated) return
  const w = tables.aiWeights

  aiResearch(state, tables, tag)
  aiConstruction(state, tables, map, tag, w.civMilRatio)
  aiProduction(state, tables, map, tag)
  aiTraining(state, tables, tag, w.trainEquipmentBuffer)
  aiDeploy(state, tables, map, tag)
  aiFrontline(state, tables, map, tag, w.attackAdvantage, w.defendRatio)
  aiDiplomacy(state, tables, map, tag)
  aiFocus(state, tables, tag)
}

function aiResearch(state: Hoi4State, tables: Hoi4Tables, tag: string): void {
  const c = state.countries[tag]
  while (c.techs.researching.length < 3) {
    const options = Object.keys(tables.techs)
      .filter((id) => techAvailable(state, tables, tag, id))
      .map((id) => ({ id, w: tables.techs[id].aiWillDo }))
      .filter((o) => o.w > 0)
      .sort((a, b) => b.w - a.w)
    if (options.length === 0) break
    if (!startResearch(state, tables, tag, options[0].id)) break
  }
}

function aiConstruction(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string, civMilRatio: number): void {
  const c = state.countries[tag]
  if (c.constructionQueue.length >= 3) return
  // 民厂/军厂比低于目标 → 优先民厂（开局各自预置已有底子）
  const building = c.civFactories / Math.max(1, c.milFactories) < civMilRatio ? 'civilian_factory' : 'military_factory'
  queueConstruction(state, tables, map, tag, building, -1)
}

function aiProduction(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string): void {
  const c = state.countries[tag]
  if (c.milFactories <= 0) return
  const inc = resourceIncome(state, map, tag)
  // 兵步装备线常备（占 60% 兵力）
  const infLine = c.productionLines.find((l) => l.equipment === 'infantry_equipment')
  const infTarget = Math.max(1, Math.floor(c.milFactories * 0.6))
  if (!infLine) addProductionLine(state, tables, tag, 'infantry_equipment', Math.min(infTarget, c.milFactories))
  else if (infLine.factories < infTarget) addProductionLine(state, tables, tag, 'infantry_equipment', infTarget - infLine.factories)
  // 火炮线（有资源富余才开）
  if (inc.steel > 12) {
    const artLine = c.productionLines.find((l) => l.equipment === 'artillery')
    if (!artLine && c.unlockedEquipments.includes('artillery')) {
      addProductionLine(state, tables, tag, 'artillery', 2)
    }
  }
  // 坦克线（科技达标且资源充裕）
  if (inc.steel > 20 && c.unlockedEquipments.includes('light_tank')) {
    const tankLine = c.productionLines.find((l) => l.equipment === 'light_tank')
    if (!tankLine) addProductionLine(state, tables, tag, 'light_tank', 2)
  }
}

function aiTraining(state: Hoi4State, tables: Hoi4Tables, tag: string, buffer: number): void {
  const c = state.countries[tag]
  if (c.trainingQueue.length >= 4) return
  // 依优先级找可训模板：步兵 → 大步兵师（有炮） → 装甲（有坦）
  const candidates = ['inf_1', 'inf_2', 'arm_1'].filter((t) => templateUnlocked(state, tables, tag, t))
  for (const tplId of candidates) {
    const tpl = tables.templates[tplId]
    if (!tpl) continue
    // 库存 ≥ 需求 × buffer 才排
    const need: Record<string, number> = {}
    for (const [bid, n] of Object.entries(tpl.battalions)) {
      for (const [eq, q] of Object.entries(tables.battalions[bid]?.equipment ?? {})) {
        need[eq] = (need[eq] ?? 0) + q * n
      }
    }
    const ok = Object.entries(need).every(([eq, q]) => (c.equipmentStock[eq] ?? 0) >= q * buffer)
    if (ok && c.manpower > 30000) {
      queueTraining(state, tables, tag, tplId)
      return
    }
  }
}

function aiDeploy(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string): void {
  const c = state.countries[tag]
  while (c.deployPool.length > 0) {
    // 战时部署到边境省，平时首都
    const target = aiDeploymentProvince(state, map, tag)
    if (target < 0) return
    if (!deployDivision(state, tables, map, tag, target)) return
  }
}

function aiDeploymentProvince(state: Hoi4State, map: MapData, tag: string): number {
  const c = state.countries[tag]
  const capital = map.def.capitals[tag]
  if (c.wars.length === 0 || !capital) return capital
  // 找一个己方控制的边境省（有敌国相邻）
  const border = map.statesOfTag(tag)
    .flatMap((s) => s.provinces)
    .filter((pid) => state.provinceControl[pid] === tag)
    .filter((pid) => (map.adjacency.get(pid) ?? []).some((nb) => {
      const ctrl = state.provinceControl[nb]
      return ctrl && ctrl !== tag && c.wars.includes(ctrl)
    }))
  return border[0] ?? capital
}

function aiFrontline(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string, attackAdvantage: number, defendRatio: number): void {
  const c = state.countries[tag]
  if (c.wars.length === 0) return
  const myDivs = Object.values(state.divisions).filter((d) => d.owner === tag && d.battle === 0 && d.path.length === 0)
  const idle = myDivs.filter((d) => d.strength > 0.5)
  if (idle.length === 0) return

  // 边境省（己方控制、邻接敌控）与内陆省
  const isEnemyAdjacent = (pid: number) => (map.adjacency.get(pid) ?? []).some((nb) => {
    const ctrl = state.provinceControl[nb]
    return ctrl && ctrl !== tag && c.wars.includes(ctrl)
  })
  const enemyProvincesOf = (pid: number) => (map.adjacency.get(pid) ?? []).filter((nb) => {
    const ctrl = state.provinceControl[nb]
    return ctrl && ctrl !== tag && c.wars.includes(ctrl)
  })

  const byProvince = new Map<number, Division[]>()
  for (const d of idle) {
    const arr = byProvince.get(d.province) ?? []
    arr.push(d)
    byProvince.set(d.province, arr)
  }

  for (const [pid, divs] of byProvince) {
    const enemies = enemyProvincesOf(pid)
    if (enemies.length === 0) continue
    // 按防守比例留守，其余找最弱邻省进攻
    const keep = Math.max(1, Math.round(divs.length * defendRatio))
    const attackers = divs.slice(keep)
    if (attackers.length === 0) continue
    // 最弱目标：守军战力最低
    let bestTarget = -1
    let bestScore = Infinity
    for (const t of enemies) {
      const defenders = Object.values(state.divisions).filter((d) => d.province === t && d.battle === 0)
      const defPow = defenders.reduce((s, d) => {
        const m = state.countries[d.owner]?.modifiers
        return s + (m ? divisionCombatPower(d, tables, m).defense : 0)
      }, 0)
      const atkPow = attackers.reduce((s, d) => s + divisionCombatPower(d, tables, c.modifiers).softAttack + divisionCombatPower(d, tables, c.modifiers).hardAttack, 0)
      const ratio = atkPow / Math.max(1, defPow)
      if (ratio >= attackAdvantage && defPow < bestScore) {
        bestScore = defPow
        bestTarget = t
      }
    }
    if (bestTarget >= 0) {
      for (const d of attackers) orderMove(state, tables, map, d, bestTarget)
    }
  }
}

function aiDiplomacy(state: Hoi4State, tables: Hoi4Tables, map: MapData, tag: string): void {
  const c = state.countries[tag]
  // 有战争目标就宣战
  for (const target of [...c.warGoals]) {
    const b = state.countries[target]
    if (b && !b.capitulated) declareWar(state, tag, target)
  }
  // 激进 AI：邻国弱于自己且无开战理由时制造借口（低频）
  const aggressive = tables.countries[tag]?.ai?.aggressive ?? 0.3
  if (aggressive > 0.5 && c.wars.length === 0 && Object.keys(c.justifying).length === 0 && c.warGoals.length === 0) {
    if (state.hour % 720 === 0) {
      const myPow = Object.values(state.divisions).filter((d) => d.owner === tag).length
      const neighbors = new Set<string>()
      for (const pid of map.statesOfTag(tag).flatMap((s) => s.provinces)) {
        for (const nb of map.adjacency.get(pid) ?? []) {
          const ctrl = state.provinceControl[nb]
          if (ctrl && ctrl !== tag) neighbors.add(ctrl)
        }
      }
      for (const nb of neighbors) {
        const n = state.countries[nb]
        if (!n || n.capitulated) continue
        const nbPow = Object.values(state.divisions).filter((d) => d.owner === nb).length
        if (myPow > nbPow * 2 && aggressive > 0.6) {
          startJustify(state, tag, nb)
          break
        }
      }
    }
  }
  void tables
}

function aiFocus(state: Hoi4State, tables: Hoi4Tables, tag: string): void {
  const c = state.countries[tag]
  if (c.focus.current) return
  const options = Object.keys(tables.focuses)
    .filter((id) => {
      const f = tables.focuses[id]
      if (f.tags && f.tags.length > 0 && !f.tags.includes(tag)) return false
      if (c.focus.completed.includes(id)) return false
      if (f.mutuallyExclusive.some((m) => c.focus.completed.includes(m))) return false
      return f.prereq.every((p) => c.focus.completed.includes(p))
    })
    .map((id) => ({ id, w: tables.focuses[id].aiWillDo }))
    .sort((a, b) => b.w - a.w)
  if (options.length === 0) return
  const c2 = state.countries[tag]
  c2.focus.current = options[0].id
  c2.focus.daysLeft = tables.focuses[options[0].id].days
}
