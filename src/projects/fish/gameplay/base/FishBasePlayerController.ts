/**
 * FishBasePlayerController — 基地阶段 PlayerController
 *
 * 接收 Viewport 转发的鼠标事件，并转发给 GameMode 的部落冲突建造系统
 * （放置建筑 / 移动选中建筑 / 预览跟随）。
 * 滚轮事件转发给 GameMode 上的 BaseCameraActor 做基地相机缩放。
 * 基类 PlayerController.OnPointerDownScreen / OnPointerMoveScreen
 * 已由 InputSys 调用，这里只需转发屏幕坐标。
 */
import { PlayerController, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

export class FishBasePlayerController extends PlayerController {
  /** 所属 GameMode（SpawnPlayer 时由 GameMode 注入） */
  gameMode: FishBaseGameMode | null = null

  constructor() {
    super()
    this.root.name = 'FishBasePlayerController'
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    this.gameMode?.onScreenDown(screenX, screenY)
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    // 记录鼠标位置供基地 GameMode 做屏幕边缘平移
    this.gameMode?.setMouseScreen(screenX, screenY)
    this.gameMode?.onScreenMove(screenX, screenY)
  }

  /** 滚轮缩放基地相机（委托给 GameMode 上的 BaseCameraActor 摄像机类） */
  override OnScroll(delta: number): void {
    if (!this.gameMode) {
      logger.warn(`[BaseController] OnScroll: gameMode 为空，无法缩放 (delta=${delta})`)
      return
    }
    logger.info(`[BaseController] OnScroll: delta=${delta} -> baseCamera.zoom`)
    this.gameMode.baseCamera.zoom(delta)
  }
}
