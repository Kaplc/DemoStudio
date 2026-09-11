/**
 * EconomyComponent — 经济系统组件（模块 01/04）
 *
 * 地球储量焚烧（节点消耗 + 研究点数计费 + 建设计费 + 舰队维护）、堆心温度模型：
 * 储量耗尽（断环）→ 堆心持续降温（coreTemp 缓降，不再是一次性缓冲倒计时）；
 * 补入燃料 → 环恢复运转、堆心缓慢回温（coreWarmSeconds，不会瞬间回满）。
 * 堆心温度归零 = 堆心熄灭 = 终结。
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
    // 蓄热井乘区：降温时长 ×coolTimeMult（降得更慢）、回温时长 ×warmTimeMult（回得更快）
    const ring = this.sc.ringMods
    const coolPerS = 100 / Math.max(1, B.coreCoolSeconds * ring.coolTimeMult)
    const warmPerS = 100 / Math.max(1, B.coreWarmSeconds * ring.warmTimeMult)
    // 燃料门：储量 > 0 = 运转（焚烧/计费照常、堆心回温），耗尽 = 断环（停烧停建、堆心降温）。
    if (s.earthH3 <= 0) {
      s.ring = 'decaying'
      s.coreTemp = Math.max(0, s.coreTemp - coolPerS * dt)
      return
    }
    s.ring = 'running'
    // 舰队维护费：按总船数查 fleet_maint 阶梯（H3/秒），与环焚烧/研究计费同池争夺地球储备，
    // 储备归零同样触发断环降温（维护费也是生存压力的一部分）。
    // 建设计费不在本处：造价制下 RingBuildComponent.tickBuild 灌入即实扣（进度 = 投入/本级造价）
    const burn = this.sc.burnRate
    const rc = this.sc.researchCost
    const maint = fleetMaintPerS(s.ships.length)
    s.earthH3 -= (burn + rc + maint) * dt
    // 收支账本（统计面板）：持续项按速率×时长累计（ringBuild 由 RingBuildComponent 按实灌累计）
    const led = s.ledger
    led.ringBurn += burn * dt
    led.research += rc * dt
    led.fleetMaint += maint * dt
    if (s.earthH3 <= 0) {
      // 本帧烧空：立刻转断环并降温（不再有余温回升）
      s.earthH3 = 0
      s.ring = 'decaying'
      s.coreTemp = Math.max(0, s.coreTemp - coolPerS * dt)
      return
    }
    // 运转中堆心回温（补燃料后从低温慢慢升温，不瞬间回满）
    if (s.coreTemp < 100) {
      s.coreTemp = Math.min(100, s.coreTemp + warmPerS * dt)
    }
  }
}
