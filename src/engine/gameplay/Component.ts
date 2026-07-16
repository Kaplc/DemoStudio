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
}
