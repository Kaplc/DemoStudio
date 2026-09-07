/**
 * ActsComponent — 三幕进程组件（模块 08）
 *
 * 第一幕→第二幕：覆盖 ≥4 交点（解锁木卫二/引力窗口/极寒停航，需求暴涨）；
 * 第二幕→第三幕：存续满 240s 且覆盖 ≥8 交点（解锁火星 + 环扩展模块任务）。
 * 幕切换不回退；进入新幕时打幕入口快照（重试本幕）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class ActsComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'ActsComponent'
  }

  private get sc() { return this.owner.simState }

  tickActs(): void {
    const s = this.sc.state
    if (s.act === 1 && s.nodes >= B.act2Nodes) {
      s.act = 2
      s.flare.nextIn = B.flare.firstDelay + this.sc.rng() * (B.flare.maxInterval - B.flare.minInterval)
      s.actSnapshots.act2 = JSON.stringify(this.sc.snapshot())
      this.sc.emit({ type: 'act2' })
    }
    if (s.act === 2 && s.time >= B.act3SurviveSeconds && s.nodes >= B.act3Nodes) {
      s.act = 3
      s.module.state = 'available'
      s.actSnapshots.act3 = JSON.stringify(this.sc.snapshot())
      this.sc.emit({ type: 'act3' })
      this.sc.emit({ type: 'module_available' })
    }
  }
}
