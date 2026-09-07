/**
 * SimStateComponent — 仿真状态持有组件（GameMode 上的组件位）
 *
 * 持有 SimState 纯数据 + 事件队列 + 确定性 rng；快照/重试本幕/沙盒/派生查询。
 * 子系统组件（transport/economy/research/hazards/stations/acts）都经 mode.simState 读写状态。
 */
import { BObjectComponent } from '@/engine'
import { B } from '../core/balance'
import { createInitialState, deepSnapshot, mulberry32 } from '../core/helpers'
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

  /** 单节点焚烧（吨/秒，含节能修正） */
  get burnRate(): number {
    return B.nodeBurn[Math.min(this.state.nodes, B.totalNodes) - 1] * this.state.mods.burnMult
  }

  /** 超频支出（吨/秒） */
  get overclockCost(): number {
    return this.state.overclocked.length * B.overclockCostPerS
  }

  /** 当前总需求（焚烧 + 超频，衰减期为 0） */
  get demand(): number {
    return this.state.ring === 'running' ? this.burnRate + this.overclockCost : 0
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
    this.state.continuity = 100
    this.state.ring = 'running'
    if (this.state.earthH3 < B.earthH3Start) this.state.earthH3 = B.earthH3Start
  }

  /** 延续度归零 → 失败（唯一硬性失败线） */
  checkDefeat(): void {
    const s = this.state
    if (s.continuity <= 0 && !s.sandbox) {
      s.continuity = 0
      s.outcome = 'defeat'
      this.emit({ type: 'defeat' })
    }
  }
}
