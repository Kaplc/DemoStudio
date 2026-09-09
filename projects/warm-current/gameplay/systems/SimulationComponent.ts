/**
 * SimulationComponent — 仿真总控组件（编排器）
 *
 * 不持有规则：按固定顺序驱动各子系统组件 tick（buildQueue → 引力窗口 → 耀斑
 * → 飞船 → 经济 → 研究 → 环建设 → 轨道建筑 → 三幕 → 失败判定），与原 sim.tick 顺序一致。
 * 暂停/终局门由 GameMode.Tick 把守（胜利后沙盒继续跑；海克斯弹卡暂停在 GameMode.Tick/drainEvents）。
 */
import { BObjectComponent } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class SimulationComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'SimulationComponent'
  }

  /** 固定步推进（e2e stepTicks 也走这里） */
  runTick(dt: number): void {
    const sc = this.owner.simState
    const s = sc.state
    if (s.outcome === 'defeat') return
    s.time += dt
    this.owner.transport.tickBuildQueue(dt)
    this.owner.hazards.tickGravity(dt)
    this.owner.hazards.tickFlare(dt)
    this.owner.transport.tickShips(dt)
    this.owner.economy.tickEconomy(dt)
    this.owner.research.tickResearch(dt)
    this.owner.ringBuild.tickBuild(dt)
    this.owner.orbitBuild.tickBuild(dt)
    this.owner.acts.tickActs()
    sc.checkDefeat()
  }
}
