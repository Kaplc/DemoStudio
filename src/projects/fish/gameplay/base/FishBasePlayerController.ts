/**
 * FishBasePlayerController — 基地阶段 PlayerController
 *
 * 接收 Viewport 转发的鼠标事件，并转发给 GameMode 的部落冲突建造系统
 * （放置建筑 / 移动选中建筑 / 预览跟随）。
 * 滚轮事件转发给 GameMode 上的 CameraZoomComponent 做基地相机缩放。
 * 基类 PlayerController.OnPointerDownScreen / OnPointerMoveScreen
 * 已由 InputSys 调用，这里只需转发屏幕坐标。
 */
import { PlayerController } from '@/engine'
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
    this.gameMode?.onScreenMove(screenX, screenY)
  }

  /** 滚轮缩放基地相机（委托给 GameMode 上的 CameraZoomComponent） */
  override OnScroll(delta: number): void {
    this.gameMode?.cameraZoom.zoom(delta)
  }
}
