/**
 * HazardsComponent — 事件系统组件（模块 06/07）
 *
 * 引力弹弓窗口周期（木卫二线 ×2 速 ×0.5 耗）+ 太阳耀斑（通讯中断、
 * 在途船失联停滞、结束时护盾气泡外冻毁）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { shipPos } from '../core/helpers'
import type { SimStation } from '../core/types'
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

  /** 耀斑结束：护盾气泡内保全（限额 + 恢复延迟），其余冻毁 */
  private resolveFlareDamage(): void {
    const s = this.sc.state
    const flying = s.ships.filter((x) => x.state === 'flying')
    const stations = s.stations.filter((st) => st.level >= 1)
    const assigned = new Map<number, number>() // stationId → 已占名额
    const saved = new Set<number>()
    for (const ship of flying) {
      const pos = shipPos(s, ship)
      let best: SimStation | null = null
      let bestD = Infinity
      for (const st of stations) {
        const cap = B.station.shipCap[st.level]
        if ((assigned.get(st.id) ?? 0) >= cap) continue
        const d = Math.hypot(pos.x - st.x, pos.y - st.y)
        if (d <= B.station.radius[st.level] && d < bestD) { best = st; bestD = d }
      }
      if (best) {
        assigned.set(best.id, (assigned.get(best.id) ?? 0) + 1)
        ship.resumeDelay = B.station.resumeDelay[best.level]
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
