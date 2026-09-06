/**
 * Hoi4PlayerController — 地图输入操作者（规范 §2.3：操作归 Controller，规则归 GameMode）
 *
 * 左键点省 → 转发 GameMode.onScreenClick（选省/下令的规则判定都在 GameMode）；
 * Esc → 清除选择（GameMode.clearSelection）。
 */
import { PlayerController, logger } from '@/engine'
import type { Hoi4GameMode } from './Hoi4GameMode'

export class Hoi4PlayerController extends PlayerController {
  gameMode: Hoi4GameMode | null = null

  constructor() {
    super('Hoi4PlayerController')
    this.inputComponent.BindAction('hoi4-clear-selection', 'Escape', 'pressed', () => {
      this.gameMode?.clearSelection()
    })
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    this.gameMode?.onScreenClick(screenX, screenY)
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    // 边缘平移的鼠标坐标转发（CameraRig 边缘检测输入源）
    this.gameMode?.setMouseScreen(screenX, screenY)
  }

  override OnScroll(delta: number): void {
    this.gameMode?.zoomMap(delta)
  }

  override OnPossess(_pawn: import('@/engine').Pawn): void {
    logger.info('[Hoi4PlayerController] Possess')
  }
}
