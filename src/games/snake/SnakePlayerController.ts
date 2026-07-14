/**
 * SnakePlayerController — 贪吃蛇输入控制
 * 方向键 → 蛇的移动方向（通过 InputComponent 绑定）
 */
import { PlayerController } from '../../framework'
import { SnakePawn } from './SnakePawn'
import type { Direction } from './types'

export class SnakePlayerController extends PlayerController {
  protected override OnPossess(pawn: any) {
    if (!(pawn instanceof SnakePawn)) return

    // 绑定方向键到蛇的移动方向
    this.inputComponent.BindAction('MoveUp', 'ArrowUp', 'pressed', () => pawn.SetDirection('up' as Direction))
    this.inputComponent.BindAction('MoveDown', 'ArrowDown', 'pressed', () => pawn.SetDirection('down' as Direction))
    this.inputComponent.BindAction('MoveLeft', 'ArrowLeft', 'pressed', () => pawn.SetDirection('left' as Direction))
    this.inputComponent.BindAction('MoveRight', 'ArrowRight', 'pressed', () => pawn.SetDirection('right' as Direction))

    pawn.StartMoving()
  }
}
