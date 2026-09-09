/**
 * RingBuildComponent — 聚能环建设组件（脱离科研的独立流，2026-09-08 用户拍板）
 *
 * 职责边界（模块 03 §5 物理层）：交点解锁唯一来源 = 本组件建设流（点数控制速度，
 * 满进度 → 交点 +1 直至 12 满网）。2026-09-08 交点单流化：研究线选卡恒 +1（保底
 * 解锁）与火星模块点亮第 12 交点均已移除，twin_node 的 extraNodes 批量效果亦废弃。
 * 建设点数：默认 1 点、可清 0 停建（面板 +/− 调节，配置表 ring_build.config.json）。
 * 计费（造价制，2026-09-08 拍板）：每级交点有独立造价（level_cost 表 × ringBuildCostMult 卡折扣，
 * 折扣省总 H3 = 同速更快），本组件每秒把 建设点数 × costPerS 吨 H3 从地球储量**实扣灌入**当前
 * 交点（灌入即计费，EconomyComponent 不再扣建设项），进度 = 已投入 ÷ 本级造价；灌满 → 交点 +1。
 * 0 点 / 断环（储量耗尽）停灌停费，无衰减乘区。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 建设点数上限（读 B.totalNodes 同源：交点全解锁也不需要更多） */
const maxBuildPoints = (): number => Math.max(1, B.totalNodes)

export class RingBuildComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'RingBuildComponent'
  }

  private get sc() { return this.owner.simState }

  /** 建设点数分配/回收（详情面板 +/−；min 封底可清 0，max 防御封顶） */
  allocateBuildPoints(delta: 1 | -1): boolean {
    const s = this.sc.state
    if (delta > 0) {
      if (s.ringBuild.points >= maxBuildPoints()) return false
      s.ringBuild.points++
    } else {
      if (s.ringBuild.points <= B.ringBuild.minPoints) {
        this.sc.hint(
          B.ringBuild.minPoints > 0
            ? `建设点数最低保留 ${B.ringBuild.minPoints} 点（聚能环建设不停工）`
            : '建设点数已清零（聚能环建设暂停，0 计费）',
        )
        return false
      }
      s.ringBuild.points--
    }
    return true
  }

  /** 建设推进（造价制）：把 pump = 点数 × costPerS 吨/秒 H3 实扣灌入当前交点，
   *  本级造价 = levelCost × ringBuildCostMult（卡折扣省总 H3：总投入变少 = 同速下更快），
   *  进度 = 已投入 ÷ 本级造价（ringBuildProgress）；灌满 → 交点 +1（满级 12 封顶）。
   *  末段按剩余造价/剩余储量截断（不超付、储量不变负）；0 点 / 断环 / 满网 停灌。 */
  tickBuild(dt: number): void {
    const s = this.sc.state
    if (s.ringBuild.points <= 0) return // 0 点停建（无灌入无计费）
    if (s.nodes >= B.totalNodes) return
    const pump = s.earthH3 > 0 ? s.ringBuild.points * B.ringBuild.costPerS : 0
    if (pump <= 0) return // 断环（储量耗尽）停建停费
    const base = B.ringBuild.levelCost[Math.min(s.nodes, B.ringBuild.levelCost.length - 1)]
    const cost = base * s.mods.ringBuildCostMult
    const invested = (s.ringBuildProgress ?? 0) * cost
    const spend = Math.min(pump * dt, cost - invested, s.earthH3)
    if (spend <= 0) return
    s.earthH3 -= spend
    s.ledger.ringBuild += spend
    const ni = invested + spend
    if (ni >= cost - 1e-6) {
      s.ringBuildProgress = 0
      s.nodes = Math.min(B.totalNodes, s.nodes + 1)
      this.sc.emit({ type: 'node_built', value: s.nodes })
    } else {
      s.ringBuildProgress = ni / cost
    }
  }

  /** 当前交点建设进度（0..1；详情面板进度条消费） */
  get buildProgress(): number {
    return this.sc.state.ringBuildProgress ?? 0
  }
}
