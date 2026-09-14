/**
 * ActsComponent — 三幕进程组件（模块 08）
 *
 * 第一幕→第二幕：建成 ≥8 环段（解锁木卫二/引力窗口/极寒停航，需求暴涨）；
 * 第二幕→第三幕：存续满 240s 且建成 ≥16 环段（解锁火星 + 环扩展模块任务）。
 * 幕切换不回退；进入新幕时打幕入口快照（重试本幕）。
 *
 * 2026-09-13 供应链重构：每幕叠加「稳定供应」目标（供应链口径，与环段门槛并存不替换）——
 * 净流入连续 ≥ supplyStreakGoal 秒发一次性奖励（supplyStreakReward 吨）；断供 streak 归零，
 * 进新幕重置可再达成。三幕叙事统一为三条供应链的接力建设。
 */
import { BObjectComponent, logger } from '@/engine'
import { B } from '../core/balance'
import { estimateNetFlow } from '../core/helpers'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class ActsComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'ActsComponent'
  }

  private get sc() { return this.owner.simState }

  tickActs(dt = 0): void {
    const s = this.sc.state
    if (s.act === 1 && s.ringSlots >= B.act2Slots) {
      s.act = 2
      s.flare.nextIn = B.flare.firstDelay + this.sc.rng() * (B.flare.maxInterval - B.flare.minInterval)
      s.actSnapshots.act2 = JSON.stringify(this.sc.snapshot())
      this.resetSupplyStreak(s)
      this.sc.emit({ type: 'act2' })
    }
    if (s.act === 2 && s.time >= B.act3SurviveSeconds && s.ringSlots >= B.act3Slots) {
      s.act = 3
      s.module.state = 'available'
      s.actSnapshots.act3 = JSON.stringify(this.sc.snapshot())
      this.resetSupplyStreak(s)
      this.sc.emit({ type: 'act3' })
      this.sc.emit({ type: 'module_available' })
    }
    if (dt > 0) this.tickSupplyStreak(dt)
  }

  /** 幕入口重置稳供目标（新幕新考题：更高需求台阶下重新连稳） */
  private resetSupplyStreak(s: { supplyStreak: number; supplyAwarded: boolean }): void {
    s.supplyStreak = 0
    s.supplyAwarded = false
  }

  /** 稳供 streak（SimulationComponent 编排调用，传 dt）：净流入 ≥0 连续计时 → 达标一次性奖励 */
  private tickSupplyStreak(dt: number): void {
    const s = this.sc.state
    if (s.outcome !== 'playing' || s.pendingCard) return
    const net = estimateNetFlow(s, this.sc.demand)
    if (net >= 0) s.supplyStreak += dt
    else s.supplyStreak = 0
    if (!s.supplyAwarded && s.supplyStreak >= B.supplyStreakGoal) {
      s.supplyAwarded = true
      s.earthH3 += B.supplyStreakReward
      s.ledger.unload += B.supplyStreakReward
      this.sc.hint(`✔ 稳定供应达成：净流入连续 ${B.supplyStreakGoal}s 转正，战略储备 +${B.supplyStreakReward} t`)
      logger.info(`[Acts] 稳定供应达成（act${s.act}，净流 +${net.toFixed(1)}/s）`)
    }
  }
}
