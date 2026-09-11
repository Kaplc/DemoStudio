/**
 * RingBuildComponent — 聚能环建设组件（25 槽位制，2026-09-11 槽位化改版）
 *
 * 职责边界（槽位化方案 V1）：环 = 25 个环段槽位，建设流每灌满一级交付一个**空槽位**；
 * 等级 = 已建成槽位数的连续推导（helpers.ringLevelOf），焚烧/船帽/研究点消费方口径零改动。
 * 玩家循环：灌 H3 建当前槽位 → 灌满交付（毛坯空槽）→ 花 H3 自选环建筑装入 → 下一格。
 * 安装：只能装入「已建成且空置」槽位，安装费 = 建筑造价，点击即扣（ledger.ringInstall）。
 * 拆除（2026-09-11 用户拍板：既花 H3 又花时间）：拆除费 = 造价 × demolishCostPct 不返还，
 * 复用建设泵「反向灌入」——发起后泵切到目标格（同一点数控速、灌入即计费），拆除期间目标格
 * 建筑效果立即停摆（ringModsOf 跳过）；同一时刻泵只灌一个目标，active 切换=来回调配，双侧进度
 * 各自保留入存档；拆完槽位回空置可再装（拆装不降级）。
 * 建设点数：默认 1 点、可清 0 停建（面板 +/− 调节，ring_build.config.json）。
 * 0 点 / 断环（储量耗尽）停灌停费，无衰减乘区。
 */
import { BObjectComponent } from '@/engine'
import { B, ringBuildingDefOf, ringModsOf } from '../core/balance'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 建设点数上限（读 B.ringSlots 同源：槽位全建成也不需要更多） */
const maxBuildPoints = (): number => Math.max(1, B.ringSlots)

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

  // ─── 环段建筑安装 / 拆除（环构筑双通道） ───

  /** 槽位是否已建成（0 基槽位号；已建成 = 下标 < ringSlots） */
  slotBuilt(slot: number): boolean {
    const s = this.sc.state
    return Number.isInteger(slot) && slot >= 0 && slot < s.ringSlots
  }

  /** 安装费预览（含合法性原因；null = 可装） */
  installIssue(slot: number, typeId: string): string | null {
    const s = this.sc.state
    const def = ringBuildingDefOf(typeId)
    if (!def) return '未知环建筑'
    if (s.flare.phase === 'active') return '太阳耀斑 · 通讯中断，无法安装'
    if (!this.slotBuilt(slot)) return '该槽位尚未建成'
    if (s.ringBuildings[slot]) return '该槽位已装有建筑（先拆除再换装）'
    if (s.ringDemolish && s.ringDemolish.slot === slot) return '该槽位拆除中'
    if (s.earthH3 < def.cost) return `H3 不足（需 ${def.cost}）`
    return null
  }

  /** 安装环建筑到已建成空槽（点击即扣安装费 = 建筑造价；效果即时生效） */
  installBuilding(slot: number, typeId: string): boolean {
    const issue = this.installIssue(slot, typeId)
    if (issue) { this.sc.hint(issue); return false }
    const s = this.sc.state
    const def = ringBuildingDefOf(typeId)!
    s.earthH3 -= def.cost
    s.ledger.ringInstall += def.cost
    s.ringBuildings[slot] = typeId
    this.sc.emit({ type: 'ring_installed', value: slot, text: def.name })
    return true
  }

  /** 拆除费（造价 × demolishCostPct；走建设泵反向灌入 = 总耗时 ≈ 同格建设时长 × 此比例） */
  demolishFeeOf(slot: number): number {
    const s = this.sc.state
    const id = s.ringBuildings[slot]
    if (!id) return 0
    return Math.round((ringBuildingDefOf(id)?.cost ?? 0) * B.ringBuild.demolishCostPct)
  }

  /** 发起拆除（不预扣费：拆除费经建设泵反向灌入逐步扣，灌满 = 拆完）；
   *  已有拆除目标时：同槽 = 切换泵 active（续拆/暂停），异槽 = 忽略（先拆完当前） */
  startDemolish(slot: number): boolean {
    const s = this.sc.state
    if (s.flare.phase === 'active') { this.sc.hint('太阳耀斑 · 通讯中断，无法拆除'); return false }
    if (!this.slotBuilt(slot) || !s.ringBuildings[slot]) { this.sc.hint('该槽位没有可拆除的建筑'); return false }
    if (s.ringDemolish) {
      if (s.ringDemolish.slot === slot) {
        s.ringDemolish.active = true
        return true
      }
      this.sc.hint('已有拆除中的槽位（可点建设格切回灌建设）')
      return false
    }
    s.ringDemolish = { slot, progress: 0, active: true }
    return true
  }

  /** 泵目标切换：点建设格切回灌建设（拆除进度保留）、点拆除格续拆（active=true） */
  setDemolishActive(active: boolean): void {
    const s = this.sc.state
    if (s.ringDemolish) s.ringDemolish.active = active
  }

  /** 建设推进（造价制）：泵 = 点数 × costPerS × 环建筑泵速乘区，同一时刻只灌一个目标——
   *  拆除中（ringDemolish.active）反向灌入拆除格（进度 = 已投入 ÷ 拆除费，拆完 → 槽位回空置）；
   *  否则灌当前建设槽（本级造价 = levelCost × ringBuildCostMult，灌满 → 槽位交付 +1）。
   *  末段按剩余量/剩余储量截断（不超付、储量不变负）；0 点 / 断环 / 满级停灌。 */
  tickBuild(dt: number): void {
    const s = this.sc.state
    if (s.ringBuild.points <= 0) return // 0 点停建（无灌入无计费）
    const ring = ringModsOf(s)
    const pump = s.earthH3 > 0 ? s.ringBuild.points * B.ringBuild.costPerS * ring.buildPumpMult : 0
    if (pump <= 0) return // 断环（储量耗尽）停建停费

    // 拆除目标：反向灌入（拆除费 ÷ 泵速 = 拆除时长；效果停摆由 ringModsOf 跳过实现）
    const demo = s.ringDemolish
    if (demo && demo.active) {
      const fee = this.demolishFeeOf(demo.slot)
      if (!(fee > 0)) { s.ringDemolish = null; return }
      const spend = Math.min(pump * dt, fee * (1 - demo.progress), s.earthH3)
      if (spend > 0) {
        s.earthH3 -= spend
        s.ledger.ringBuild += spend
        demo.progress = Math.min(1, demo.progress + spend / fee)
      }
      if (demo.progress >= 1 - 1e-6) {
        const removed = s.ringBuildings[demo.slot]
        s.ringBuildings[demo.slot] = null
        s.ringDemolish = null
        this.sc.emit({ type: 'ring_demolished', value: demo.slot, text: removed ?? undefined })
      }
      return
    }

    // 建设目标：当前建设槽
    if (s.ringSlots >= B.ringSlots) return
    const base = B.ringBuild.levelCost[Math.min(s.ringSlots, B.ringBuild.levelCost.length - 1)]
    const cost = base * s.mods.ringBuildCostMult
    const invested = (s.ringBuildProgress ?? 0) * cost
    const spend = Math.min(pump * dt, cost - invested, s.earthH3)
    if (spend <= 0) return
    s.earthH3 -= spend
    s.ledger.ringBuild += spend
    const ni = invested + spend
    if (ni >= cost - 1e-6) {
      s.ringBuildProgress = 0
      s.ringSlots = Math.min(B.ringSlots, s.ringSlots + 1)
      this.sc.emit({ type: 'slot_built', value: s.ringSlots })
    } else {
      s.ringBuildProgress = ni / cost
    }
  }

  /** 当前槽位建设进度（0..1；详情面板进度条消费） */
  get buildProgress(): number {
    return this.sc.state.ringBuildProgress ?? 0
  }
}
