/**
 * Component — 可附加到 Actor 上的行为模块
 * 模仿 UE ActorComponent
 */

import type { Actor } from './Actor'

export abstract class Component {
  public readonly owner: Actor
  public bEnabled = true
  public name = 'Component'

  constructor(owner: Actor) {
    this.owner = owner
  }

  /** 游戏开始/激活时调用 */
  BeginPlay(): void {}
  /** 每帧调用 */
  Tick(_deltaTime: number): void {}
  /** 绘制调试 Gizmos（由所属 Actor 每帧调用，可重写） */
  OnDrawGizmos(): void {}
  /** 销毁时调用 */
  EndPlay(): void {}

  /** 启用/禁用 */
  setEnabled(enabled: boolean) {
    this.bEnabled = enabled
  }

  /** 序列化（预留；子类按需 override 返回自定义数据） */
  serialize(): Record<string, unknown> {
    return {}
  }

  /**
   * 获取组件可展示属性（Inspector 用）。
   * 返回扁平的键值对，值应为可 JSON 化的基础类型（string/number/boolean/数组/对象）。
   * 子类按需 override；基类默认返回空对象。
   */
  getProperties(): Record<string, unknown> {
    return {}
  }
}
