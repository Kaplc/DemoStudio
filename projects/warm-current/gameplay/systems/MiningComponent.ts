/**
 * MiningComponent — 行星矿产开发系统组件（2026-09-13 供应链重构：全息勘探 → 矿点造矿建 → 产出入星球堆场）
 *
 * 配置表驱动（mineral_type / mineral_deposit / mine_building 三表 → B.mineralTypes /
 * B.mineralDeposits / B.mineBuildings）：加矿种/矿点/矿建只改表。
 * 建造 = 全息面板选矿点选型落位（一次性扣全款）→ tickMines 按工期灌进度 → 满格建成开采。
 * 产出（2026-09-13 重构）：
 *  - 资源星（moon/europa/mars）：yieldPerS 采入该星堆场 starStock（受矿点余量 + 堆场上限双门控，
 *    堆满停产——必须由航线运回才到手，产量层与运力层在此咬合）
 *  - 普通行星（earth/mercury/...）：维持直采地球储备（无航线可达，堆场无意义）
 * 产量乘区 = 环建筑采矿馈能 miningMult × 卡 miningMult。
 * 落位合法性（placementIssue）为面板预览/落位共用单一口径。
 */
import { BObjectComponent, logger } from '@/engine'
import { B, type MineBuildingDef, type MineralDepositDef } from '../core/balance'
import { starMiningRate, starStockCapOf, starPosAt } from '../core/helpers'
import type { PlanetBodyId, SimState, StarId } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 矿建类型定义查询（未知类型 null） */
export function mineDefOf(type: string): MineBuildingDef | null {
  return (B.mineBuildings as Record<string, MineBuildingDef | undefined>)[type] ?? null
}

/** 矿点定义查询（未知矿点 null） */
export function depositDefOf(id: string): MineralDepositDef | null {
  return (B.mineralDeposits as Record<string, MineralDepositDef | undefined>)[id] ?? null
}

/** 某天体的矿点列表（表序；无矿点天体 = 空数组） */
export function depositsOf(body: string): Array<{ id: string; def: MineralDepositDef }> {
  return Object.entries(B.mineralDeposits)
    .filter(([, d]) => d.planet === body)
    .map(([id, def]) => ({ id, def }))
}

/** 矿点余量（吨；表 reserve − Σ同点已采出。读态聚合，余量不进状态） */
export function depositLeft(s: SimState, depositId: string): number {
  const def = depositDefOf(depositId)
  if (!def) return 0
  const taken = s.mines.filter((m) => m.depositId === depositId).reduce((sum, m) => sum + m.extracted, 0)
  return Math.max(0, def.reserve - taken)
}

export class MiningComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'MiningComponent'
  }

  private get sc() { return this.owner.simState }

  /** 落位合法性（预览/落位共用口径）：null = 可建，否则为原因文案 */
  placementIssue(depositId: string, typeId: string): string | null {
    const s = this.sc.state
    const dep = depositDefOf(depositId)
    const def = mineDefOf(typeId)
    if (!dep || !def) return '未知矿点或矿建类型'
    if (s.flare.phase === 'active') return '太阳耀斑 · 通讯中断，无法建造'
    // 资源星走幕解锁门（moon/europa/mars）；普通行星恒可建
    const star = dep.planet as StarId
    if (star === 'moon' || star === 'europa' || star === 'mars') {
      if (!this.owner.transport.starUnlocked(star)) return `该天体第 ${B.stars[star].unlockAct} 幕解锁后可开发`
    }
    if (s.mines.some((m) => m.depositId === depositId)) return '该矿点已有设施'
    const allowed = def.minTypes.split(',').map((x) => x.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(dep.type)) return `${def.name}不适用于此矿种`
    if (s.earthH3 < def.cost) return `H3 不足（需 ${def.cost}）`
    return null
  }

  /** 落位矿建（成功扣全款并入状态） */
  tryPlace(depositId: string, typeId: string): boolean {
    const issue = this.placementIssue(depositId, typeId)
    if (issue) { this.sc.hint(issue); return false }
    const s = this.sc.state
    const def = mineDefOf(typeId)!
    s.mines.push({ depositId, type: typeId, progress: 0, built: false, extracted: 0 })
    s.earthH3 -= def.cost
    s.ledger.mineBuild += def.cost
    logger.info(`[Mining] 落位 ${def.name} @${depositId}（${def.cost} H3，工期 ${def.buildTime}s）`)
    return true
  }

  /**
   * 建造推进 + 开采产出（SimulationComponent 编排调用）：
   *  在建矿建按工期灌进度（满 1 → 建成发事件）。
   *  建成矿建按 yieldPerS × 产量乘区采出，双门控：矿点余量（枯竭停采）+ 堆场上限（堆满停产）。
   *  资源星产出落 starStock（本地堆场，等船运）；普通行星直入地球储备（老口径）。
   *  瓶颈沿触发 hint（堆满/枯竭只在状态翻转时提示一次，不刷屏）。
   */
  tickMines(dt: number): void {
    const s = this.sc.state
    const ring = this.sc.ringMods
    const miningMult = ring.miningMult * s.mods.miningMult
    for (const mine of s.mines) {
      const def = mineDefOf(mine.type)
      if (!def) continue
      if (!mine.built) {
        if (def.buildTime <= 0) { mine.built = true; mine.progress = 1; continue }
        mine.progress = Math.min(1, mine.progress + dt / def.buildTime)
        if (mine.progress >= 1) {
          mine.built = true
          const dep = depositDefOf(mine.depositId)
          const pos = dep ? starPosAt(s, dep.planet as PlanetBodyId) : null
          this.sc.emit({ type: 'mine_built', text: def.name, x: pos?.x, y: pos?.y })
          logger.info(`[Mining] 建成 ${def.name} @${mine.depositId}（产出 ${def.yieldPerS}/s）`)
        }
        continue
      }
      if (def.yieldPerS <= 0) continue
      const dep = depositDefOf(mine.depositId)
      const body = dep?.planet ?? ''
      const left = depositLeft(s, mine.depositId)
      if (left <= 0) continue
      // 产量上限：资源星受堆场余量门控（堆满停产）；普通行星直采无堆场门
      let stockLeft = Infinity
      const cap = starStockCapOf(body)
      if (Number.isFinite(cap)) {
        stockLeft = Math.max(0, cap - (s.starStock[body] ?? 0))
        if (stockLeft <= 0) {
          if (this.stockFullStars && !this.stockFullStars.has(body)) {
            this.stockFullStars.add(body)
            this.sc.hint(`${B.stars[body as StarId]?.name ?? body}堆场已满 · 运力不足，停产待运`)
          }
          continue
        }
      }
      this.stockFullStars?.delete(body)
      const n = Math.min(def.yieldPerS * miningMult * dt, left, stockLeft)
      mine.extracted += n
      if (Number.isFinite(cap)) s.starStock[body] = (s.starStock[body] ?? 0) + n
      else s.earthH3 += n
      s.ledger.mining += n
    }
  }

  /** 堆满沿触发记录（天体 → 本 tick 是否已提示；采出后清键，避免逐帧刷 hint） */
  private stockFullStars = new Set<string>()

  /** 某矿点的矿建（无 → null） */
  mineAt(depositId: string) {
    return this.sc.state.mines.find((m) => m.depositId === depositId) ?? null
  }

  /** 该天体矿建总产量速率（吨/秒，满负荷口径；面板/试航展示用） */
  miningRateAt(body: string): number {
    return starMiningRate(this.sc.state, body, this.sc.ringMods)
  }
}
