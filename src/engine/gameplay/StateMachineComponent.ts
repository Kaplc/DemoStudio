/**
 * StateMachineComponent — 表驱动有限状态机组件（A8）
 *
 * 最小可用形态（明确不做行为树）：
 *  - 状态表：addState({ name, onEnter?, onExit?, onUpdate? })
 *  - 转换表：addTransition({ from: name|'*', to, when })——注册序即优先级，
 *    每 Tick 按 from 匹配 + when() 判定，首个命中即切换
 *  - setState(name)：强制切换（外部驱动/调试）
 *  - current / timeInState 可查询——进 ai.getState / ai.getComponent 输出（AI 调试刚需）
 *
 * Tick 需求：owner Actor 需 enableTick()。
 */
import { ActorComponent } from '../entity/ActorComponent'
import { logger } from '../Logger'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'

/** 状态定义（钩子全部可选；onUpdate 参数为 dt 与本状态已持续时间） */
export interface FSMState {
  name: string
  onEnter?: (from: string | null) => void
  onExit?: (to: string) => void
  onUpdate?: (dt: number, timeInState: number) => void
}

/** 转换规则：from='*' 表示任意状态；注册序即判定优先级 */
export interface FSMTransition {
  from: string | '*'
  to: string
  when: () => boolean
}

export class StateMachineComponent extends ActorComponent {
  /** 初始状态名（首个 addState 时自动设为 initial；setState 前停留在 null） */
  initial = ''

  private _states = new Map<string, FSMState>()
  private _transitions: FSMTransition[] = []
  private _current: string | null = null
  private _timeInState = 0

  constructor(owner: Actor) {
    super(owner)
    this.name = 'StateMachineComponent'
  }

  /** 当前状态名（未启动时 null） */
  get current(): string | null {
    return this._current
  }

  /** 当前状态已持续时间（秒） */
  get timeInState(): number {
    return this._timeInState
  }

  /** 注册状态（重名覆盖；首个注册且未设 initial 时自动作为初始态） */
  addState(state: FSMState): this {
    this._states.set(state.name, state)
    if (!this.initial) this.initial = state.name
    return this
  }

  /** 注册转换规则（注册序即优先级） */
  addTransition(t: FSMTransition): this {
    this._transitions.push(t)
    return this
  }

  /** 强制切换状态（exit 旧 → enter 新；未知状态拒绝并告警） */
  setState(name: string): boolean {
    const next = this._states.get(name)
    if (!next) {
      logger.warn(`[FSM:${this.owner.name}] 未知状态 "${name}"（现有: ${[...this._states.keys()].join(', ') || '无'}）`)
      return false
    }
    if (this._current === name) return true
    const prev = this._current
    if (prev !== null) this._states.get(prev)?.onExit?.(name)
    this._current = name
    this._timeInState = 0
    next.onEnter?.(prev)
    return true
  }

  /** 启动到初始态（Owner BeginPlay 后由游戏代码调用，或首 Tick 自动启动） */
  start(): void {
    if (this._current === null && this.initial) {
      this.setState(this.initial)
    }
  }

  override Tick(dt: number): void {
    if (this._current === null) {
      this.start()
      if (this._current === null) return
    }
    this._timeInState += dt
    // 转换判定（注册序，首个命中即切）
    for (const t of this._transitions) {
      if (t.from !== '*' && t.from !== this._current) continue
      if (t.when()) {
        if (t.to !== this._current) {
          this.setState(t.to)
          return // 切换后本帧不再执行新状态 onUpdate（下帧起跑）
        }
        break
      }
    }
    this._states.get(this._current)?.onUpdate?.(dt, this._timeInState)
  }

  override getProperties(): Record<string, unknown> {
    return {
      current: this._current ?? '（未启动）',
      timeInState: Math.round(this._timeInState * 100) / 100,
      states: [...this._states.keys()].join(','),
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      { key: 'current', type: 'string', readonly: true, get: () => this._current ?? '', set: () => {} },
    ]
  }
}
