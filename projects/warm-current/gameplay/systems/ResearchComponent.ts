/**
 * ResearchComponent — 聚能环多线研究组件（模块 03/05）
 *
 * 5 线并行推进（环运转加成 + 研究点数提速 + 下一节点生长修正）→ 节点达成弹
 * 海克斯三选一（研究冻结、其余系统照常）→ 选卡数据驱动应用 effects。
 *
 * 研究点数：聚能环每升 1 级得 1 点（含开局 Lv1），科研面板 +/− 按钮分配到线；
 * 点数越多该线推进越快，同时按点数持续消耗 H3（断环/储量耗尽时加成与计费一并失效）。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { drawCards, getCardDef } from '../core/cards'
import { LINE_DEFS, makeShip, researchRateOf, ringLevelOf } from '../core/helpers'
import type { ResearchLineId } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class ResearchComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'ResearchComponent'
  }

  private get sc() { return this.owner.simState }

  tickResearch(dt: number): void {
    const s = this.sc.state
    // 海克斯选卡期间：仅冻结研究推进，其余系统照常
    if (s.pendingCard) return
    if (s.nodes >= B.researchNodeCap) return
    for (const line of s.research) {
      line.progress += researchRateOf(line, s) * dt
      if (line.progress >= 1) {
        line.progress = 1
        if (!s.cardQueue.includes(line.id)) s.cardQueue.push(line.id)
      }
    }
    if (s.cardQueue.length > 0) {
      const lineId = s.cardQueue.shift()!
      const line = s.research.find((l) => l.id === lineId)
      if (line) line.progress = 0
      s.pendingCard = {
        line: lineId,
        since: s.time,
        choices: drawCards(lineId, s.takenCards, s.mods.flareWarning, this.sc.rng),
      }
      this.sc.emit({ type: 'card_pending', text: LINE_DEFS.find((d) => d.id === lineId)?.name })
    }
  }

  /** 海克斯三选一（effects 数据驱动统一应用） */
  chooseCard(cardId: string): boolean {
    const s = this.sc.state
    if (!s.pendingCard || !s.pendingCard.choices.includes(cardId)) return false
    const lineId = s.pendingCard.line
    const def = getCardDef(cardId)
    if (!def) return false
    const fx = def.effects ?? {}
    // 乘区
    if (fx.fuelMult !== undefined) s.mods.fuelMult *= fx.fuelMult
    if (fx.speedMult !== undefined) s.mods.speedMult *= fx.speedMult
    if (fx.cargoMult !== undefined) s.mods.cargoMult *= fx.cargoMult
    if (fx.burnMult !== undefined) s.mods.burnMult *= fx.burnMult
    if (fx.recoverMult !== undefined) s.mods.recoverMult *= fx.recoverMult
    // 加法
    if (fx.moonLoadAdd !== undefined) s.mods.moonLoadAdd += fx.moonLoadAdd
    if (fx.otherLoadAdd !== undefined) s.mods.otherLoadAdd += fx.otherLoadAdd
    if (fx.bufferAdd !== undefined) s.mods.bufferAdd += fx.bufferAdd
    if (fx.gravityAdd !== undefined) s.mods.gravityAdd += fx.gravityAdd
    // 旗标
    if (fx.flareWarning) s.mods.flareWarning = true
    // 扩编船队：新船立即入列空闲池
    if (fx.fleetBonus !== undefined) {
      for (let i = 0; i < fx.fleetBonus; i++) {
        s.ships.push(makeShip(s.ships.length + 1))
      }
    }
    // 下一节点生长修正
    if (fx.nextGrowth) {
      const target = fx.nextGrowth.line === 'self' ? lineId : fx.nextGrowth.line
      const line = s.research.find((l) => l.id === target)
      if (line) line.nextMult *= fx.nextGrowth.mult
    }
    // 节点推进（twin_node extraNodes=2 → 本节点+额外 1 段）
    const gained = fx.extraNodes ?? 1
    s.nodes = Math.min(B.researchNodeCap, s.nodes + gained)
    const line = s.research.find((l) => l.id === lineId)
    if (line) line.progress = 0
    s.takenCards.push(cardId)
    s.stats.cardsTaken++
    s.pendingCard = null
    this.sc.emit({ type: 'card_chosen', text: def.name })
    return true
  }

  /**
   * 分配/回收研究点（科研面板 +/− 按钮；delta = +1 分配 / −1 回收）。
   * 可用点数 = 当前聚能环等级 − 已分配总数（等级只升不降，点数随之单调增长）。
   */
  allocateResearch(lineId: ResearchLineId, delta: 1 | -1): boolean {
    const s = this.sc.state
    const line = s.research.find((l) => l.id === lineId)
    if (!line) return false
    if (delta > 0) {
      if (this.sc.unspentResearchPoints <= 0) {
        this.sc.hint('无可用研究点（聚能环每升 1 级获得 1 点）')
        return false
      }
      line.points++
    } else {
      if (line.points <= 0) return false
      line.points--
    }
    return true
  }

  /** 把进度最靠前的线直接推满（e2e/GM 用） */
  forceResearch(): ResearchLineId | null {
    const s = this.sc.state
    if (s.pendingCard) return null
    const line = s.research.reduce((a, b) => (a.progress >= b.progress ? a : b))
    line.progress = 1
    return line.id
  }
}
