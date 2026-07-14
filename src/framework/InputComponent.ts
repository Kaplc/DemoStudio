/**
 * InputComponent — 输入处理组件（ActorComponent）
 * 仿 UE InputComponent，支持按键绑定到动作（Action）
 * 挂载到 PlayerController（Actor）上
 */
import { Component } from './Component'
import type { Actor } from './Actor'

export type InputEventType = 'pressed' | 'released'

interface Binding {
  key: string
  eventType: InputEventType
  callback: () => void
}

export class InputComponent extends Component {
  private bindings: Binding[] = []

  constructor(owner: Actor, name = 'InputComponent') {
    super(owner)
    this.name = name
  }

  BindAction(action: string, key: string, eventType: InputEventType, callback: () => void): void {
    this.bindings.push({ key, eventType, callback })
  }

  UnbindKey(key: string): void {
    this.bindings = this.bindings.filter((b) => b.key !== key)
  }

  ProcessInput(key: string, eventType: InputEventType): boolean {
    if (!this.bEnabled) return false
    let handled = false
    for (const binding of this.bindings) {
      if (binding.key === key && binding.eventType === eventType) {
        binding.callback()
        handled = true
      }
    }
    return handled
  }

  ClearBindings(): void {
    this.bindings = []
  }

  override EndPlay(): void {
    this.ClearBindings()
    super.EndPlay()
  }
}
