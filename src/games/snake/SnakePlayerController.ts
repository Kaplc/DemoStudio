/**
 * SnakePlayerController — 贪吃蛇输入控制
 * 方向键 → 蛇的移动方向
 */
import { PlayerController } from '../../framework'
import { SnakePawn } from './SnakePawn'

export class SnakePlayerController extends PlayerController {
  HandleInput(key: string, eventType: 'pressed' | 'released') {
    if (eventType !== 'pressed') return
    const pawn = this.pawn
    if (!(pawn instanceof SnakePawn)) return

    switch (key) {
      case 'ArrowUp':
        pawn.SetDirection('up')
        break
      case 'ArrowDown':
        pawn.SetDirection('down')
        break
      case 'ArrowLeft':
        pawn.SetDirection('left')
        break
      case 'ArrowRight':
        pawn.SetDirection('right')
        break
    }
  }

  protected override OnPossess(pawn: any) {
    if (pawn instanceof SnakePawn) {
      pawn.StartMoving()
    }
  }
}
