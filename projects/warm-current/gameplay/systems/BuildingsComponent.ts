/**
 * BuildingsComponent — 地图建筑系统组件（建造面板选型 → 星图自由放置）
 *
 * 配置表驱动（building.table.json → B.buildings）：行键 = 建筑类型，加建筑只改表。
 *  - 中转站（relay）：可被航线链接（地球↔中转站补给线），反向航线运建材入缓存；
 *  - 磁场护盾发生器（shield）：耀斑期间保护背日半球罩内飞船（面朝太阳，容量限额，HazardsComponent 消费）。
 * 放置 = 建造：网格吸附坐标 + H3 造价即时结算；拆除按 refundPct 返还（造价+缓存物资折算）。
 * 放置合法性（placementIssue）为预览/放置共用单一口径（GameMode 建筑模式预览镜像）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { buildingDefOf, buildingPos, resolveBuildingOrbit } from '../core/helpers'
import type { SimBuilding } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class BuildingsComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'BuildingsComponent'
  }

  private get sc() { return this.owner.simState }

  /** 放置合法性（预览/放置共用口径）：null = 可放置，否则为原因文案 */
  placementIssue(typeId: string, x: number, y: number): string | null {
    const s = this.sc.state
    const def = buildingDefOf(typeId)
    if (!def) return '未知建筑类型'
    if (s.flare.phase === 'active') return '太阳耀斑 · 通讯中断，无法建造'
    if (s.earthH3 < def.cost) return `H3 不足（需 ${def.cost}）`
    const sun = B.map.nodes.sun
    if (Math.hypot(x - sun.x, y - sun.y) < sun.r + B.build.sunClearance) return '距太阳太近，无法放置'
    for (const b of s.buildings) {
      // 间距按实时位置判定（入轨建筑随公转移动，静态落点会失真）
      const p = buildingPos(s, b)
      if (Math.hypot(x - p.x, y - p.y) < B.build.minSpacing) return '与其他建筑距离过近'
    }
    return null
  }

  /** 放置建筑（画布系坐标，调用方负责网格吸附）；成功扣 H3 并入状态。
   *  靠近行星放置自动入轨（resolveBuildingOrbit 推导锚/半径/相位），远离行星静态放置。 */
  tryPlace(typeId: string, x: number, y: number): boolean {
    const s = this.sc.state
    const issue = this.placementIssue(typeId, x, y)
    if (issue) { this.sc.hint(issue); return false }
    const def = buildingDefOf(typeId)!
    s.earthH3 -= def.cost
    const b: SimBuilding = { id: maxBuildingId(s) + 1, type: typeId, x, y, stock: 0, invested: def.cost, ...resolveBuildingOrbit(s, x, y) }
    s.buildings.push(b)
    s.stats.buildingsBuilt++
    this.sc.emit({ type: 'building_built', text: def.name, value: def.cost, x, y })
    return true
  }

  /** 拆除返还（造价+缓存物资折算 × refundPct）；通往该建筑的航线一并删除（在途船就近返航） */
  tryDemolish(id: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('通讯中断，无法拆除'); return false }
    const idx = s.buildings.findIndex((x) => x.id === id)
    if (idx < 0) return false
    const b = s.buildings[idx]
    const def = buildingDefOf(b.type)
    const refund = def ? (b.invested + b.stock * B.materialH3PerUnit) * def.refundPct : 0
    s.earthH3 += refund
    s.ledger.demolishRefund += refund
    for (const route of [...s.routes]) {
      const hit = (route.from.kind === 'building' && route.from.buildingId === id)
        || (route.to.kind === 'building' && route.to.buildingId === id)
      if (hit) this.owner.transport.tryDeleteRoute(route.id)
    }
    s.buildings.splice(idx, 1)
    const p = buildingPos(this.sc.state, b)
    this.sc.emit({ type: 'building_demolished', value: refund, x: p.x, y: p.y })
    return true
  }

  /** 反向补给线卸货（Transport 调用）：建材入缓存（超容量截断） */
  onDelivery(b: SimBuilding, materials: number): void {
    const p = buildingPos(this.sc.state, b)
    this.sc.emit({ type: 'unload', value: Math.round(materials), x: p.x, y: p.y })
    const cap = buildingDefOf(b.type)?.bufferCap ?? 0
    if (cap <= 0) return
    b.stock = Math.min(cap, b.stock + materials)
  }

  /** 缓存余量（反向航线装货量上限；非缓存建筑恒 0 → 船等待不发） */
  bufferLeft(b: SimBuilding): number {
    const cap = buildingDefOf(b.type)?.bufferCap ?? 0
    return Math.max(0, cap - b.stock)
  }
}

function maxBuildingId(s: { buildings: SimBuilding[] }): number {
  return s.buildings.reduce((m, x) => Math.max(m, x.id), 0)
}
