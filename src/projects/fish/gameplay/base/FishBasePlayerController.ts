/**
 * FishBasePlayerController — 基地阶段 PlayerController
 *
 * 接收 Viewport 转发的鼠标事件，
 * 基类 PlayerController.OnPointerDownScreen / OnPointerMoveScreen
 * 自动构建 Raycaster 并分发到世界中的 ClickableComponent。
 *
 * 此阶段只需调用 initRaycaster() 注入相机和 UI 元素，
 * 无需额外覆盖。
 */
import { PlayerController } from '@/engine'

export class FishBasePlayerController extends PlayerController {
  constructor() {
    super()
    this.root.name = 'FishBasePlayerController'
  }
}
