/**
 * InputComponent — 输入处理组件（ActorComponent）
 * 仿 UE InputComponent，支持按键绑定到动作（Action）
 * 挂载到 PlayerController（Actor）上
 */
import { Component } from '../entity/Component'
import { logger } from '..'
import type { Actor } from '../entity/Actor'

export type InputEventType = 'pressed' | 'released'

interface Binding {
  action?: string
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
    this.bindings.push({ key, eventType, callback, action })
  }

  UnbindKey(key: string): void {
    this.bindings = this.bindings.filter((b) => b.key !== key)
  }

  ProcessInput(key: string, eventType: InputEventType): boolean {
    if (!this.bEnabled) {
      logger.info(`InputComponent.ProcessInput: DISABLED (bEnabled=false) key=${key}`)
      return false
    }
    let handled = false
    for (const binding of this.bindings) {
      if (binding.key === key && binding.eventType === eventType) {
        logger.info(`InputComponent.ProcessInput: MATCH key=${key} callback=${binding.action || '?'}`)
        binding.callback()
        handled = true
      }
    }
    if (!handled) {
      logger.info(`InputComponent.ProcessInput: NO MATCH key=${key} bindings=[${this.bindings.map(b => `${b.key}:${b.eventType}`).join(', ')}]`)
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
