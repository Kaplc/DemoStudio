/**
 * SnakePlayerController — 贪吃蛇输入控制
 * 方向键 → 蛇的移动方向（通过 InputComponent 绑定）
 */
import { PlayerController, logger } from '@/engine'
import { SnakePawn } from './SnakePawn'
import type { Direction } from './types'

export class SnakePlayerController extends PlayerController {
  protected override OnPossess(pawn: any) {
    if (!(pawn instanceof SnakePawn)) return

    logger.info(`SnakePlayerController.OnPossess: ${pawn.name}`)

    // 绑定方向键到蛇的移动方向（方向键 + WASD 两套方案）
    this.inputComponent.BindAction('MoveUp', 'ArrowUp', 'pressed', () => {
      logger.info('Input → MoveUp')
      pawn.SetDirection('up' as Direction)
    })
    this.inputComponent.BindAction('MoveUp', 'w', 'pressed', () => {
      logger.info('Input → MoveUp (W)')
      pawn.SetDirection('up' as Direction)
    })
    this.inputComponent.BindAction('MoveUp', 'W', 'pressed', () => {
      pawn.SetDirection('up' as Direction)
    })
    this.inputComponent.BindAction('MoveDown', 'ArrowDown', 'pressed', () => {
      logger.info('Input → MoveDown')
      pawn.SetDirection('down' as Direction)
    })
    this.inputComponent.BindAction('MoveDown', 's', 'pressed', () => {
      logger.info('Input → MoveDown (S)')
      pawn.SetDirection('down' as Direction)
    })
    this.inputComponent.BindAction('MoveDown', 'S', 'pressed', () => {
      pawn.SetDirection('down' as Direction)
    })
    this.inputComponent.BindAction('MoveLeft', 'ArrowLeft', 'pressed', () => {
      logger.info('Input → MoveLeft')
      pawn.SetDirection('left' as Direction)
    })
    this.inputComponent.BindAction('MoveLeft', 'a', 'pressed', () => {
      logger.info('Input → MoveLeft (A)')
      pawn.SetDirection('left' as Direction)
    })
    this.inputComponent.BindAction('MoveLeft', 'A', 'pressed', () => {
      pawn.SetDirection('left' as Direction)
    })
    this.inputComponent.BindAction('MoveRight', 'ArrowRight', 'pressed', () => {
      logger.info('Input → MoveRight')
      pawn.SetDirection('right' as Direction)
    })
    this.inputComponent.BindAction('MoveRight', 'd', 'pressed', () => {
      logger.info('Input → MoveRight (D)')
      pawn.SetDirection('right' as Direction)
    })
    this.inputComponent.BindAction('MoveRight', 'D', 'pressed', () => {
      pawn.SetDirection('right' as Direction)
    })

    pawn.StartMoving()
  }

  override ProcessInput(key: string, eventType: 'pressed' | 'released'): boolean {
    logger.info(`PlayerController.ProcessInput: key=${key} event=${eventType} pawn=${!!this.pawn}`)
    return super.ProcessInput(key, eventType)
  }
}
