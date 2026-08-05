/**
 * Pawn — 可被 PlayerController 控制的 Actor
 * 模仿 UE Pawn，是玩家在世界中的化身
 */
import type { PlayerController } from '../input/PlayerController'
import { Actor } from './Actor'

export abstract class Pawn extends Actor {
  /** 当前控制此 Pawn 的控制器 */
  public controller: PlayerController | null = null

  constructor(name = 'Pawn') {
    super(name)
  }

  /** 被控制器占据时调用 */
  PossessedBy(controller: PlayerController) {
    this.controller = controller
  }

  /** 被控制器释放时调用 */
  Unpossessed() {
    this.controller = null
  }

  /** 前后移动 */
  MoveForward(_value: number): void {}
  /** 左右移动 */
  MoveRight(_value: number): void {}
  /** 跳跃/动作 */
  Jump(): void {}

  override destroy() {
    if (this.controller) {
      this.controller.Unpossess()
    }
    super.destroy()
  }
}
