/**
 * EconomyComponent — 经济系统组件（模块 01/04）
 *
 * 地球储量焚烧（节点消耗 + 超频支出）、缓冲衰减（储量 ≤ 0 → 延续度缓降，
 * 补燃料即恢复）、延续度回升。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
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
      const cost = this.sc.demand * dt
      s.earthH3 -= cost
      if (s.earthH3 <= 0) {
        s.earthH3 = 0
        s.ring = 'decaying'
        s.bufferTotal = B.bufferSeconds + s.mods.bufferAdd
        s.bufferLeft = s.bufferTotal
        s.overclocked.length = 0
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
