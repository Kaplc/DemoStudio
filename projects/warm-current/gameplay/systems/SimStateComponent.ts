/**
 * SimStateComponent — 仿真状态持有组件（GameMode 上的组件位）
 *
 * 持有 SimState 纯数据 + 事件队列 + 确定性 rng；快照/重试本幕/沙盒/派生查询。
 * 子系统组件（transport/economy/research/hazards/buildings/acts）都经 mode.simState 读写状态。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { createInitialState, deepSnapshot, mulberry32, ringLevelOf } from '../core/helpers'
import type { SimEvent, SimShip, SimState } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class SimStateComponent extends BObjectComponent<WarmCurrentGameMode> {
  state: SimState
  events: SimEvent[] = []
  rng: () => number

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'SimStateComponent'
    const seed = Date.now() % 0x7fffffff
    this.rng = mulberry32(seed)
    this.state = createInitialState(seed)
  }

  /** 重开一局（新种子新状态；配置覆盖由 GameMode.InitGame/restart 先行刷新） */
  reset(): void {
    const seed = Date.now() % 0x7fffffff
    this.rng = mulberry32(seed)
    this.state = createInitialState(seed)
    this.events.length = 0
  }

  emit(e: SimEvent): void {
    this.events.push(e)
  }

  hint(text: string): void {
    this.emit({ type: 'hint', text })
  }

  // ─── 派生查询 ───

  /** 实时焚烧（吨/秒）：随聚能环等级增长（B.levelBurn / level_burn 表），含节能修正 */
  get burnRate(): number {
    const s = this.state
    const lv = ringLevelOf(s.nodes, s.ringBuildProgress).level
    return (B.levelBurn[lv - 1] ?? B.levelBurn[B.levelBurn.length - 1] ?? 0) * s.mods.burnMult
  }

  /** 研究点数计费（吨/秒）：各线已分配点数合计 × 每点单价；储量耗尽不计费 */
  get researchCost(): number {
    const s = this.state
    if (s.earthH3 <= 0) return 0
    return s.research.reduce((sum, l) => sum + l.points, 0) * B.researchPointCostPerS
  }

  /** 聚能环建设灌入速率（吨/秒，即每秒实扣）：建设点数 × 每点单价；储量耗尽停建停费。
   *  造价制下卡效果 ringBuildCostMult 不乘灌入速率，而是折扣本级造价（省总 H3 = 同速更快），见 RingBuildComponent。 */
  get ringBuildCost(): number {
    const s = this.state
    return s.earthH3 > 0 ? s.ringBuild.points * B.ringBuild.costPerS : 0
  }

  /** 已分配研究点总数（四线合计） */
  get allocatedResearchPoints(): number {
    return this.state.research.reduce((sum, l) => sum + l.points, 0)
  }

  /** 可用研究点 = 当前聚能环等级 − 已分配（每级 1 点，含开局 Lv1；等级只升不降，随建设流推进） */
  get unspentResearchPoints(): number {
    const s = this.state
    return Math.max(0, ringLevelOf(s.nodes, s.ringBuildProgress).level - this.allocatedResearchPoints)
  }

  /** 当前聚能环等级（1..ringLevels，随建设流派生；造船上限等消费方的唯一口径） */
  get ringLevel(): number {
    return ringLevelOf(this.state.nodes, this.state.ringBuildProgress).level
  }

  /** 飞船数量上限（ship_cap 表按当前等级；主动造船的在册+排队总数不可超，卡片/GM 加船可越限） */
  get shipCap(): number {
    const arr = B.shipCap
    return arr[Math.min(this.ringLevel, arr.length) - 1]
  }

  /** 当前总需求（焚烧 + 研究点计费 + 建设计费，储量耗尽为 0） */
  get demand(): number {
    return this.state.earthH3 > 0 ? this.burnRate + this.researchCost + this.ringBuildCost : 0
  }

  get idleShips(): number {
    return this.countByState('idle')
  }

  get flyingShips(): number {
    return this.countByState('flying') + this.countByState('loading') + this.countByState('unloading')
  }

  get frozenShips(): SimShip[] {
    return this.state.ships.filter((s) => s.state === 'frozen')
  }

  shipById(id: number): SimShip | undefined {
    return this.state.ships.find((x) => x.id === id)
  }

  private countByState(state: SimShip['state']): number {
    return this.state.ships.filter((s) => s.state === state).length
  }

  // ─── 快照 / 终局 ───

  snapshot(): SimState {
    return deepSnapshot(this.state)
  }

  restore(snapshot: SimState): void {
    this.state = deepSnapshot(snapshot)
  }

  /** 重试本幕（恢复幕入口快照） */
  retryAct(): boolean {
    const s = this.state
    const snap = s.act === 3 ? s.actSnapshots.act3 : s.act === 2 ? s.actSnapshots.act2 : null
    if (!snap) return false
    const restored = JSON.parse(snap) as SimState
    restored.outcome = 'playing'
    restored.sandbox = false
    this.state = restored
    this.hint(`重试第${restored.act}幕`)
    return true
  }

  /** 胜利后进入沙盒（无失败压力） */
  enterSandbox(): void {
    this.state.sandbox = true
    this.state.outcome = 'playing'
    this.state.coreTemp = 100
    this.state.ring = 'running'
    if (this.state.earthH3 < B.earthH3Start) this.state.earthH3 = B.earthH3Start
  }

  /** 堆心温度归零 → 堆心熄灭 → 失败（唯一硬性失败线） */
  checkDefeat(): void {
    const s = this.state
    if (s.coreTemp <= 0 && !s.sandbox) {
      s.coreTemp = 0
      s.outcome = 'defeat'
      this.emit({ type: 'defeat' })
    }
  }
}
