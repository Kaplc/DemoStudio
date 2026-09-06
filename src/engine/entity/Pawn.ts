/**
 * Pawn — 可被 PlayerController 控制的 Actor
 * 模仿 UE Pawn，是玩家在世界中的化身
 */
import type { PlayerController } from '../input/PlayerController'
import { Actor } from './Actor'
import { CharacterControllerComponent } from '../physics/CharacterControllerComponent'

export abstract class Pawn extends Actor {
  /** 当前控制此 Pawn 的控制器 */
  public controller: PlayerController | null = null

  /** 移动轴状态（pressed/released 事件驱动；world 系输入 = right·x + forward·z） */
  private _axisForward = 0
  private _axisRight = 0

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

  /** 前后移动（+1 前进 / -1 后退 / 0 停；pressed/released 配对驱动） */
  MoveForward(value: number): void {
    this._axisForward = value
    this._syncMoveInput()
  }

  /** 左右移动（+1 右 / -1 左 / 0 停） */
  MoveRight(value: number): void {
    this._axisRight = value
    this._syncMoveInput()
  }

  /** 跳跃/动作 */
  Jump(): void {
    this.getComponent(CharacterControllerComponent)?.jump()
  }

  /** 轴状态 → CharacterController 输入（相机相对换算在控制器组件内完成） */
  private _syncMoveInput(): void {
    this.getComponent(CharacterControllerComponent)?.setMoveInput(this._axisRight, this._axisForward)
  }

  override destroy() {
    if (this.controller) {
      this.controller.Unpossess()
    }
    super.destroy()
  }
}
