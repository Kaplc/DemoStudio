/**
 * RingBuildComponent — 聚能环建设组件（脱离科研的独立流，2026-09-08 用户拍板）
 *
 * 职责边界（模块 03 §5 物理层）：交点解锁双流叠加——研究线选卡恒 +1（保底解锁），
 * 本组件建设进度独立持续推进（点数控制速度）；twin_node 的 extraNodes 批量效果已废弃，
 * 交点速率主推手 = 建设流（2026-09-08 建设脱离科研改版）。
 * 建设点数：默认 1 点、最低 1 点（面板 +/− 调节，配置表 ring_build.config.json）。
 * 计费：每点每秒 B.ringBuild.costPerS（卡效果 ringBuildCostMult 叠乘；储量耗尽停建停费）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { ringBuildRateOf } from '../core/helpers'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 建设点数上限（读 B.totalNodes 同源：交点全解锁也不需要更多） */
const maxBuildPoints = (): number => Math.max(1, B.totalNodes)

export class RingBuildComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'RingBuildComponent'
  }

  private get sc() { return this.owner.simState }

  /** 建设点数分配/回收（详情面板 +/−；min 封底不可拆光，max 防御封顶） */
  allocateBuildPoints(delta: 1 | -1): boolean {
    const s = this.sc.state
    if (delta > 0) {
      if (s.ringBuild.points >= maxBuildPoints()) return false
      s.ringBuild.points++
    } else {
      if (s.ringBuild.points <= B.ringBuild.minPoints) {
        this.sc.hint(`建设点数最低保留 ${B.ringBuild.minPoints} 点（聚能环建设不停工）`)
        return false
      }
      s.ringBuild.points--
    }
    return true
  }

  /** 建设推进（交点进度）：满 1 → 交点 +1（满级 12 封顶），无选卡无暂停 */
  tickBuild(dt: number): void {
    const s = this.sc.state
    if (s.nodes >= B.totalNodes) return
    s.ringBuildProgress = Math.min(1, (s.ringBuildProgress ?? 0) + ringBuildRateOf(s) * dt)
    if (s.ringBuildProgress >= 1) {
      s.ringBuildProgress = 0
      s.nodes = Math.min(B.totalNodes, s.nodes + 1)
      this.sc.emit({ type: 'node_built', value: s.nodes })
    }
  }

  /** 当前交点建设进度（0..1；详情面板进度条消费） */
  get buildProgress(): number {
    return this.sc.state.ringBuildProgress ?? 0
  }
}
