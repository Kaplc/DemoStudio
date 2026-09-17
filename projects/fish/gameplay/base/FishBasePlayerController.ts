/**
 * FishBasePlayerController — 基地阶段 PlayerController
 *
 * 接收 Viewport 转发的鼠标事件，并转发给 GameMode 的部落冲突建造系统
 * （放置建筑 / 移动选中建筑 / 预览跟随 / 按住拖动连续放置）。
 * 拖动手势态（左键按住标记）归本 Controller，经 onScreenMove 的 dragging 参数
 * 透传给 GameMode（操作状态机在 Controller，放置规则在 GameMode）。
 * 滚轮缩放由 CameraRigComponent 订阅本控制器的 InputComponent 处理（无需覆写 OnScroll）。
 * 基类 PlayerController.OnPointerDownScreen / OnPointerMoveScreen
 * 已由 InputSys 调用，这里只需转发屏幕坐标。
 */
import { PlayerController } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

export class FishBasePlayerController extends PlayerController {
  /** 所属 GameMode（SpawnPlayer 时由 GameMode 注入） */
  gameMode: FishBaseGameMode | null = null
  /** 左键按住中（拖动手势态；释放时复位，EndPlay 兜底清理） */
  private dragging = false

  constructor() {
    super('FishBasePlayerController')
    // 左键释放 → 结束拖动手势（InputSys.handlePointerUp → ProcessMouseButton 广播）
    this.inputComponent.BindMouseButton((button, eventType) => {
      if (button !== 0) return
      if (eventType === 'released') this.dragging = false
    })
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    // 左键按下 → 进入拖动手势（是否连放由 GameMode 按 continuous 类型判断）
    this.dragging = true
    this.gameMode?.onScreenDown(screenX, screenY)
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    // 记录鼠标位置供基地 GameMode 做屏幕边缘平移
    this.gameMode?.setMouseScreen(screenX, screenY)
    // 透传按住手势态：拖动连放规则在 GameMode 消费，手势态不落 GameMode 存储
    this.gameMode?.onScreenMove(screenX, screenY, this.dragging)
  }

  override EndPlay(): void {
    // 清理手势态（防悬挂）
    this.dragging = false
    super.EndPlay()
  }
}
