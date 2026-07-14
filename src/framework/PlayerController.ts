/**
 * PlayerController — 处理玩家输入并控制 Pawn
 * 模仿 UE PlayerController
 */
import type { Pawn } from './Pawn'

export abstract class PlayerController {
  /** 当前控制的 Pawn */
  public pawn: Pawn | null = null

  /** 占据一个 Pawn */
  Possess(pawn: Pawn) {
    if (this.pawn) this.Unpossess()
    this.pawn = pawn
    pawn.PossessedBy(this)
    this.OnPossess(pawn)
  }

  /** 释放当前 Pawn */
  Unpossess() {
    if (this.pawn) {
      this.pawn.Unpossessed()
      this.OnUnpossess(this.pawn)
      this.pawn = null
    }
  }

  /** 占据后调用（子类重写绑定输入） */
  protected OnPossess(_pawn: Pawn): void {}

  /** 释放后调用 */
  protected OnUnpossess(_pawn: Pawn): void {}

  /** 处理键盘事件（由外部转发） */
  abstract HandleInput(key: string, eventType: 'pressed' | 'released'): void
}
