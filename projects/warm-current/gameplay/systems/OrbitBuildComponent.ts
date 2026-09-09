/**
 * OrbitBuildComponent — 近地轨道建筑系统组件（2026-09-09：点行星 → 轨道建设 → 绕行星均布公转）
 *
 * 配置表驱动（orbit_build.table.json → B.orbitBuildings）：行键 = 建筑类型，加建筑只改表。
 *  - 船坞（dock）：建成后本行星轨道造船享造价折扣/提速（表值乘区，造船入口收口到这里）。
 * 建造 = 选型落位（一次性扣全款 + 同锚均布相位）→ tickBuild 按工期灌进度 → 满格建成。
 * 落位合法性（placementIssue）为预览/落位共用单一口径。
 * 轨道位置：orbitBuildingPos 纯时间函数（渲染/拾取/相机无 tick 同步）。
 */
import { BObjectComponent, logger } from '@/engine'
import { B, type OrbitBuildingDef } from '../core/balance'
import { orbitBuildingPos } from '../core/helpers'
import type { OrbitBuilding, PlanetBodyId, SimState } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 轨道建筑类型定义查询（未知类型 null） */
export function orbitBuildingDefOf(type: string): OrbitBuildingDef | null {
  return (B.orbitBuildings as Record<string, OrbitBuildingDef | undefined>)[type] ?? null
}

/** 同锚轨道建筑的均布相位（2π/n 重排；第 n 座落位时对全环重排，环上永远均匀）。
 *  单一权威：新座 a0 先置 0，由 syncRingPhases 统一赋相位（不在落位处二次计算） */
function syncRingPhases(state: SimState, anchor: PlanetBodyId): void {
  const ring = state.orbitBuildings.filter((x) => x.anchor === anchor)
  ring.forEach((ob, i) => {
    ob.a0 = (2 * Math.PI * i) / ring.length
  })
}

/** 建筑类型是否具备造船能力（表值任一乘区偏离基准 = 有造船能力；未来新能力建筑在表加乘区字段扩展） */
export function isShipyardType(type: string): boolean {
  const def = orbitBuildingDefOf(type)
  return !!def && (def.shipBuildCostMult !== 1 || def.shipBuildSpeedMult !== 1)
}

export class OrbitBuildComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'OrbitBuildComponent'
  }

  private get sc() { return this.owner.simState }

  /** 落位合法性（预览/落位共用口径）：null = 可建，否则为原因文案 */
  placementIssue(typeId: string, anchor: PlanetBodyId): string | null {
    const s = this.sc.state
    const def = orbitBuildingDefOf(typeId)
    if (!def) return '未知建筑类型'
    if (s.flare.phase === 'active') return '太阳耀斑 · 通讯中断，无法建造'
    const sameType = s.orbitBuildings.filter((x) => x.type === typeId && x.anchor === anchor)
    if (sameType.length >= B.orbitBuild.maxPerType) return `该轨道${def.name}已达上限 ${B.orbitBuild.maxPerType} 座`
    if (s.earthH3 < def.cost) return `H3 不足（需 ${def.cost}）`
    return null
  }

  /** 落位轨道建筑（同锚第 n 座均布 2π/n 相位；成功扣全款并入状态） */
  tryPlace(typeId: string, anchor: PlanetBodyId): boolean {
    const issue = this.placementIssue(typeId, anchor)
    if (issue) { this.sc.hint(issue); return false }
    const s = this.sc.state
    const def = orbitBuildingDefOf(typeId)!
    const ob: OrbitBuilding = {
      id: maxOrbitId(s) + 1,
      type: typeId,
      anchor,
      a0: 0,
      progress: 0,
      built: false,
    }
    s.orbitBuildings.push(ob)
    syncRingPhases(s, anchor)
    s.earthH3 -= def.cost
    s.ledger.orbitBuild += def.cost
    logger.info(`[OrbitBuild] 落位 ${def.name}#${ob.id} @${anchor}（${def.cost} H3，工期 ${def.buildTime}s）`)
    return true
  }

  /** 建造推进（SimulationComponent 编排调用）：按工期灌进度，满 1 → 建成发事件。
   *  燃料门：断环（储量耗尽 decaying）停建 —— 与 SimState.ring 注释「停烧停建」口径一致
   *  （落位已一次性扣全款，建造过程不再耗 H3，停建是文明断电的叙事口径而非经济口径） */
  tickBuild(dt: number): void {
    const s = this.sc.state
    if (s.ring === 'decaying') return
    for (const ob of s.orbitBuildings) {
      if (ob.built) continue
      const def = orbitBuildingDefOf(ob.type)
      if (!def || def.buildTime <= 0) { ob.built = true; ob.progress = 1; continue }
      ob.progress = Math.min(1, ob.progress + dt / def.buildTime)
      if (ob.progress >= 1) {
        ob.built = true
        const p = orbitBuildingPos(s, ob)
        this.sc.emit({ type: 'orbit_building_built', text: def.name, x: p.x, y: p.y })
        logger.info(`[OrbitBuild] 建成 ${def.name}#${ob.id} @${ob.anchor}`)
      }
    }
  }

  /** 某天体轨道上已建成的造船建筑（造船乘区取第一座建成船坞；无 → null） */
  builtShipyardAt(anchor: PlanetBodyId): OrbitBuilding | null {
    return this.sc.state.orbitBuildings.find((x) => x.anchor === anchor && x.built && isShipyardType(x.type)) ?? null
  }

  /** 造船乘区（建成船坞的表值乘区；无 → null = 原价原时长） */
  shipyardMults(anchor: PlanetBodyId): { costMult: number; speedMult: number } | null {
    const ob = this.builtShipyardAt(anchor)
    if (!ob) return null
    const def = orbitBuildingDefOf(ob.type)
    if (!def) return null
    return { costMult: def.shipBuildCostMult, speedMult: def.shipBuildSpeedMult }
  }
}

function maxOrbitId(s: { orbitBuildings: OrbitBuilding[] }): number {
  return s.orbitBuildings.reduce((m, x) => Math.max(m, x.id), 0)
}
