/**
 * EconomyComponent — 经济系统组件（模块 01/04）
 *
 * 地球储量焚烧（节点消耗 + 研究点数计费）、缓冲衰减（储量 ≤ 0 → 延续度缓降，
 * 补燃料即恢复）、延续度回升。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { fleetMaintPerS } from '../core/helpers'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class EconomyComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'EconomyComponent'
  }

  private get sc() { return this.owner.simState }

  tickEconomy(dt: number): void {
    const s = this.sc.state
    if (s.ring === 'running') {
      // 舰队维护费：按总船数查 fleet_maint 阶梯（H3/秒），与环焚烧/研究计费同池争夺地球储备，
      // 储备归零同样触发缓冲衰减（维护费也是生存压力的一部分）
      const burn = this.sc.burnRate
      const rc = this.sc.researchCost
      const bc = this.sc.ringBuildCost
      const maint = fleetMaintPerS(s.ships.length)
      s.earthH3 -= (burn + rc + bc + maint) * dt
      // 收支账本（统计面板）：持续项按速率×时长累计
      const led = s.ledger
      led.ringBurn += burn * dt
      led.research += rc * dt
      led.ringBuild += bc * dt
      led.fleetMaint += maint * dt
      if (s.earthH3 <= 0) {
        s.earthH3 = 0
        s.ring = 'decaying'
        s.bufferTotal = B.bufferSeconds + s.mods.bufferAdd
        s.bufferLeft = s.bufferTotal
      }
      // 运转中延续度回满（缓冲后恢复期）
      if (s.continuity < 100) {
        s.continuity = Math.min(100, s.continuity + B.continuityRecoverRate * s.mods.recoverMult * dt)
      }
    } else {
      // 缓冲衰减：延续度随剩余缓冲线性下降；补入燃料即恢复运转
      s.bufferLeft -= dt
      s.continuity = Math.max(0, (s.bufferLeft / s.bufferTotal) * 100)
      if (s.earthH3 > 0) s.ring = 'running'
    }
  }
}
