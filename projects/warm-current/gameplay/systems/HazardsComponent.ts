/**
 * HazardsComponent — 事件系统组件（模块 06/07）
 *
 * 引力弹弓窗口周期（木卫二线 ×2 速 ×0.5 耗）+ 太阳耀斑（通讯中断、
 * 在途船失联停滞、结束时护盾罩外冻毁；罩 = 面朝太阳的背日半圆）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import type { BuildingDef } from '../core/balance'
import { buildingDefOf, buildingPos, shipPos } from '../core/helpers'
import type { SimBuilding } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

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

  /** 耀斑结束：护盾罩内保全（限额 + 恢复延迟），其余冻毁。
   *  护盾源 = 磁场护盾发生器（radius>0 的建筑，配置表驱动；入轨建筑按实时位置判定）。
   *  罩体面朝太阳（与渲染同口径）：保护域 = 以建筑为圆心的背日半圆 ——
   *  距离 ≤ radius 且船位落在 (bp - sun) 方向一侧；朝阳侧半圆不在罩内。 */
  private resolveFlareDamage(): void {
    const s = this.sc.state
    const sun = B.map.nodes.sun
    const flying = s.ships.filter((x) => x.state === 'flying')
    const shields: Array<{ b: SimBuilding; def: BuildingDef; bp: { x: number; y: number }; ax: number; az: number }> = []
    for (const b of s.buildings) {
      const def = buildingDefOf(b.type)
      if (!def || def.radius <= 0) continue
      const bp = buildingPos(s, b)
      // 背日方向（未归一化，仅作点积定向）
      shields.push({ b, def, bp, ax: bp.x - sun.x, az: bp.y - sun.y })
    }
    const assigned = new Map<number, number>() // buildingId → 已占名额
    const saved = new Set<number>()
    for (const ship of flying) {
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
        ship.resumeDelay = buildingDefOf(best.type)?.resumeDelay ?? 0
        saved.add(ship.id)
      }
    }
    let frozen = 0
    for (const ship of flying) {
      if (saved.has(ship.id)) continue
      ship.state = 'frozen'
      ship.routeId = null
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
