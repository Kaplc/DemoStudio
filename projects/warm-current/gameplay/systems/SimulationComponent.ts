/**
 * SimulationComponent — 仿真总控组件（编排器）
 *
 * 不持有规则：按固定顺序驱动各子系统组件 tick（buildQueue → 引力窗口 → 耀斑
 * → 飞船 → 经济 → 研究 → 三幕 → 失败判定），与原 sim.tick 顺序一致。
 * 暂停/终局门由 GameMode.Tick 把守（胜利后沙盒继续跑）。
 * 海克斯自动收纳也在此计时：以仿真时间为准（暂停/选卡冻结时不误走）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
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
    // 海克斯三选一自动收纳：弹窗显示满 hexAutoCloseSeconds 未选 → 隐藏（待卡不弃，HUD 徽标可重开）
    // 语义（模块 03 设计约定）：冻结的只是"研究推进"，收纳压力倒逼玩家别在危机时挂机
    if (s.pendingCard) {
      if (s.hexHiddenAt === null && s.time >= s.pendingCard.since + B.hexAutoCloseSeconds) {
        s.hexHiddenAt = s.time
        sc.emit({ type: 'hint', text: `三选一已收纳 · 待选节点 +1（点 HUD 左上徽标随时继续）` })
      }
    } else if (s.hexHiddenAt !== null) {
      // 卡被选走/清空 → 复位，下一节点弹窗恢复自动显示
      s.hexHiddenAt = null
    }
    this.owner.transport.tickBuildQueue(dt)
    this.owner.hazards.tickGravity(dt)
    this.owner.hazards.tickFlare(dt)
    this.owner.transport.tickShips(dt)
    this.owner.economy.tickEconomy(dt)
    this.owner.research.tickResearch(dt)
    this.owner.acts.tickActs()
    sc.checkDefeat()
  }
}
