/**
 * Demo2DPlayerController — 方向键 / WASD → 玩家移动方向
 * 按下设置方向，松开任一移动键即停止（速度由 Pawn 平滑插值）。
 */
import { PlayerController, logger } from '@/engine'
import type { Pawn } from '@/engine'
import { Demo2DPawn } from './Demo2DPawn'

const MOVE_KEYS = ['ArrowUp', 'w', 'W', 'ArrowDown', 's', 'S', 'ArrowLeft', 'a', 'A', 'ArrowRight', 'd', 'D']

export class Demo2DPlayerController extends PlayerController {
  protected override OnPossess(pawn: Pawn) {
    if (!(pawn instanceof Demo2DPawn)) return
    const p = pawn
    const set = (dx: number, dy: number) => p.SetDirection(dx, dy)

    // 按下方向键 / WASD 设置移动方向（2D：x→右，y→上）
    this.inputComponent.BindAction('Up', 'ArrowUp', 'pressed', () => set(0, 1))
    this.inputComponent.BindAction('Up', 'w', 'pressed', () => set(0, 1))
    this.inputComponent.BindAction('Up', 'W', 'pressed', () => set(0, 1))
    this.inputComponent.BindAction('Down', 'ArrowDown', 'pressed', () => set(0, -1))
    this.inputComponent.BindAction('Down', 's', 'pressed', () => set(0, -1))
    this.inputComponent.BindAction('Down', 'S', 'pressed', () => set(0, -1))
    this.inputComponent.BindAction('Left', 'ArrowLeft', 'pressed', () => set(-1, 0))
    this.inputComponent.BindAction('Left', 'a', 'pressed', () => set(-1, 0))
    this.inputComponent.BindAction('Left', 'A', 'pressed', () => set(-1, 0))
    this.inputComponent.BindAction('Right', 'ArrowRight', 'pressed', () => set(1, 0))
    this.inputComponent.BindAction('Right', 'd', 'pressed', () => set(1, 0))
    this.inputComponent.BindAction('Right', 'D', 'pressed', () => set(1, 0))

    // 松开任一移动键 → 停止
    const stop = () => set(0, 0)
    for (const k of MOVE_KEYS) {
      this.inputComponent.BindAction('Stop', k, 'released', stop)
    }

    logger.info('[Demo2D] PlayerController 已绑定输入')
  }
}
