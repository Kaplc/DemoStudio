/**
 * HazardsComponent — 事件系统组件（模块 06/07）
 *
 * 引力弹弓窗口周期（木卫二线 ×2 速 ×0.5 耗）+ 太阳耀斑（通讯中断、
 * 在途船失联停滞、结束时护盾罩外冻毁；罩 = 面朝太阳的背日半圆）。
 * 玩家设计权扩展（2026-09-11）：耀斑预警期框选飞船直接下达决策——照跑 / 就近靠站
 * （改道飞向最近罩内安全点，爆发前抵达=保全的赌性）/ 原地待命（未出发船取消本次出发）；
 * 爆发即通讯中断决策锁定，耀斑结束决策清空一切回到常规。船级防冻（guardian 内置 /
 * 加热器模块）罩外也存活。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { buildingEffectiveDef, buildingPos, endpointPos, shipMults, shipPos } from '../core/helpers'
import type { SimBuilding, SimShip, ShipOrder } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 靠站安全点半径缩进（罩半径 − 此值 = 安全点距罩建筑距离，保证几何判定必然入罩） */
const SHELTER_INSET = 4

export class HazardsComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'HazardsComponent'
  }

  private get sc() { return this.owner.simState }

  tickGravity(dt: number): void {
    const s = this.sc.state
    if (s.act < 2) return
    const g = s.gravity
    g.timer -= dt
    if (g.timer <= 0) {
      if (g.phase === 'idle') {
        g.phase = 'warn'; g.timer = B.gravity.warn
        this.sc.emit({ type: 'window_warn' })
      } else if (g.phase === 'warn') {
        g.phase = 'active'; g.timer = B.gravity.active + s.mods.gravityAdd
        this.sc.emit({ type: 'window_open' })
      } else {
        g.phase = 'idle'
        g.timer = B.gravity.period - B.gravity.warn - (B.gravity.active + s.mods.gravityAdd)
        this.sc.emit({ type: 'window_close' })
      }
    }
  }

  tickFlare(dt: number): void {
    const s = this.sc.state
    if (s.act < 2) return
    const f = s.flare
    if (f.phase === 'active') {
      f.timer -= dt
      if (f.timer <= 0) {
        f.phase = 'idle'
        f.nextIn = B.flare.minInterval + this.sc.rng() * (B.flare.maxInterval - B.flare.minInterval)
        this.resolveFlareDamage()
        this.clearOrders()
        this.sc.emit({ type: 'flare_end' })
      }
      return
    }
    // 预警（需事件预警卡）
    if (f.phase === 'idle' && s.mods.flareWarning && f.nextIn <= B.flare.warnLead) {
      f.phase = 'warn'
      this.sc.emit({ type: 'flare_warn' })
    }
    f.nextIn -= dt
    if (f.nextIn <= 0) {
      f.phase = 'active'
      f.timer = B.flare.duration
      this.sc.emit({ type: 'flare_start' })
    }
  }

  /** e2e/GM：立即触发耀斑 */
  triggerFlare(): void {
    const f = this.sc.state.flare
    f.phase = 'active'
    f.timer = B.flare.duration
  }

  /** e2e/GM：进入耀斑预警态（框选决策窗口，确定性验证用；不改 nextIn 调度） */
  beginFlareWarn(): void {
    const f = this.sc.state.flare
    if (f.phase === 'idle') {
      f.phase = 'warn'
      this.sc.emit({ type: 'flare_warn' })
    }
  }

  /** e2e/GM：立即开启引力窗口 */
  triggerWindow(): void {
    const g = this.sc.state.gravity
    g.phase = 'active'
    g.timer = B.gravity.active + this.sc.state.mods.gravityAdd
  }

  /** e2e：压制耀斑调度（确定性验证用） */
  suppressFlare(): void {
    const f = this.sc.state.flare
    f.phase = 'idle'
    f.nextIn = Number.POSITIVE_INFINITY
  }

  // ─── 耀斑预警决策（框选直接指挥，玩家设计权扩展） ───

  /** 预警期才可下令（爆发 = 通讯中断决策锁定；耀斑外无窗口） */
  orderWindowOpen(): boolean {
    const f = this.sc.state.flare
    return f.phase === 'warn'
  }

  /** 就近罩内安全点（背日半圆内、距罩建筑 radius−inset）；无护盾建筑 = null */
  shelterTarget(state: import('../core/types').SimState, from: { x: number; y: number }): { b: SimBuilding; x: number; y: number } | null {
    const sun = B.map.nodes.sun
    let best: SimBuilding | null = null
    let bestPos = { x: 0, y: 0 }
    let bestD = Infinity
    for (const b of state.buildings) {
      const def = buildingEffectiveDef(b)
      if (!def || def.radius <= SHELTER_INSET) continue
      const bp = buildingPos(state, b)
      // 安全点：船方位角向背日方向角收敛 ±(π/2 − margin)，保证点积背日判定恒成立
      const backAngle = Math.atan2(bp.y - sun.y, bp.x - sun.x)
      const shipAngle = Math.atan2(from.y - bp.y, from.x - bp.x)
      let d = shipAngle - backAngle
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      const margin = 0.2
      const clamped = Math.max(-Math.PI / 2 + margin, Math.min(Math.PI / 2 - margin, d))
      const a = backAngle + clamped
      const r = def.radius - SHELTER_INSET
      const p = { x: bp.x + Math.cos(a) * r, y: bp.y + Math.sin(a) * r }
      const dist = Math.hypot(p.x - from.x, p.y - from.y)
      if (dist < bestD) { bestD = dist; best = b; bestPos = p }
    }
    return best ? { b: best, x: bestPos.x, y: bestPos.y } : null
  }

  /**
   * 对单船下达耀斑决策。run = 照跑（清靠站段回航线插值）；shelter = 就近靠站
   * （以当前位置为新起点重插值飞向罩内安全点，legTime = 距离 ÷ 当前速率）；
   * hold = 原地待命（仅未出发的装货船；在途船不可选）。
   * @returns 是否受理（窗口外/无站可靠/在途待命 = 拒绝）
   */
  setShipOrder(shipId: number, order: ShipOrder): boolean {
    if (!this.orderWindowOpen()) return false
    const s = this.sc.state
    const ship = s.ships.find((x) => x.id === shipId)
    if (!ship) return false
    if (ship.state === 'frozen') return false
    if (order === 'hold' && ship.state !== 'loading') return false
    ship.order = order
    if (order === 'shelter') {
      const from = shipPos(s, ship)
      const target = this.shelterTarget(s, from)
      if (!target) { ship.order = undefined; return false } // 无站可靠
      const speed = Math.max(0.1, s.mods.speedMult * shipMults(ship).speedMult)
      const dist = Math.hypot(target.x - from.x, target.y - from.y)
      ship.shelter = { fx: from.x, fy: from.y, tx: target.x, ty: target.y }
      ship.progress = 0
      ship.legTime = dist / speed
    } else if (order === 'run') {
      this.endShelter(ship)
    }
    return true
  }

  /** 耀斑结束清决策：靠站船把当前位置投影回原航线段平滑续飞，其余船照常 */
  clearOrders(): void {
    const s = this.sc.state
    for (const ship of s.ships) {
      if (!ship.order && !ship.shelter) continue
      ship.order = undefined
      this.endShelter(ship)
    }
  }

  /** 清靠站段：当前位置投影回航线插值参数（路线外也取最近点，平滑接回原航线） */
  private endShelter(ship: SimShip): void {
    const s = this.sc.state
    if (!ship.shelter) return
    const pos = shipPos(s, ship) // 先取靠站插值下的当前位置
    ship.shelter = null
    if (ship.mission) { ship.progress = Math.min(1, Math.max(0, ship.progress)); return }
    const route = s.routes.find((r) => r.id === ship.routeId)
    if (!route) return
    const from = endpointPos(s, route.from)
    const to = endpointPos(s, route.to)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((pos.x - from.x) * dx + (pos.y - from.y) * dy) / len2)) : 0
    ship.progress = ship.leg === 'outbound' ? t : 1 - t
  }

  /** 耀斑结束：护盾罩内保全（限额 + 恢复延迟），其余冻毁（船级防冻免疫——罩外也存活）。
   *  护盾源 = 磁场护盾发生器（radius>0 的建筑，配置表驱动 + 强化修正；入轨建筑按实时位置判定）。
   *  罩体面朝太阳（与渲染同口径）：保护域 = 以建筑为圆心的背日半圆 ——
   *  距离 ≤ radius 且船位落在 (bp - sun) 方向一侧；朝阳侧半圆不在罩内。
   *  靠站船抵达罩内安全点后即被几何判定自然保全（安全点在罩内半径 −4px 处）。 */
  private resolveFlareDamage(): void {
    const s = this.sc.state
    const sun = B.map.nodes.sun
    const flying = s.ships.filter((x) => x.state === 'flying')
    const shields: Array<{ b: SimBuilding; def: import('../core/balance').BuildingDef; bp: { x: number; y: number }; ax: number; az: number }> = []
    for (const b of s.buildings) {
      const def = buildingEffectiveDef(b)
      if (!def || def.radius <= 0) continue
      const bp = buildingPos(s, b)
      // 背日方向（未归一化，仅作点积定向）
      shields.push({ b, def, bp, ax: bp.x - sun.x, az: bp.y - sun.y })
    }
    const assigned = new Map<number, number>() // buildingId → 已占名额
    const saved = new Set<number>()
    for (const ship of flying) {
      if (shipMults(ship).antiFreeze) continue // 船级防冻：冻毁免疫（罩外也存活，照常飞）
      const pos = shipPos(s, ship)
      let best: SimBuilding | null = null
      let bestD = Infinity
      for (const { b, def, bp, ax, az } of shields) {
        if ((assigned.get(b.id) ?? 0) >= def.shipCap) continue
        const dx = pos.x - bp.x
        const dy = pos.y - bp.y
        if (dx * ax + dy * az < 0) continue // 朝阳侧：罩外
        const d = Math.hypot(dx, dy)
        if (d <= def.radius && d < bestD) { best = b; bestD = d }
      }
      if (best) {
        assigned.set(best.id, (assigned.get(best.id) ?? 0) + 1)
        ship.resumeDelay = buildingEffectiveDef(best)?.resumeDelay ?? 0
        saved.add(ship.id)
      }
    }
    let frozen = 0
    for (const ship of flying) {
      if (saved.has(ship.id) || shipMults(ship).antiFreeze) continue
      ship.state = 'frozen'
      ship.routeId = null
      ship.order = undefined
      ship.shelter = null
      frozen++
      s.stats.frozenCount++
      if (ship.mission) {
        ship.mission = false
        if (s.module.shipId === ship.id) {
          s.module.state = 'available'
          s.module.shipId = null
        }
      }
    }
    // 航线清掉冻毁船
    for (const route of s.routes) {
      route.shipIds = route.shipIds.filter((id) => s.ships.find((x) => x.id === id)?.state !== 'frozen')
    }
    if (frozen > 0) this.sc.emit({ type: 'frozen', value: frozen })
  }
}
