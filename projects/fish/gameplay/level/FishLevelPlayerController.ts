/**
 * FishLevelPlayerController — 关卡战斗阶段 PlayerController
 *
 * 战斗阶段输入职责（用户操作全在 Controller，游戏逻辑在 FishLevelGameMode）：
 *  - 鼠标按下：转发 FishLevelGameMode（放置模式下立即放一个兵）+ 进入长按连续放兵
 *    （按住期间每 HOLD_DEPLOY_INTERVAL 秒在最近鼠标位置再放一个，CoC 风格）
 *  - 鼠标移动：记录最近坐标（长按定位用）+ 转发摄像机云台（右键平移/边缘检测）
 *  - 鼠标释放：结束长按连续放兵（订阅 inputComponent.BindMouseButton）
 *  - 滚轮缩放 + 右键平移：由战斗摄像机云台（CameraRigComponent）订阅
 *    inputComponent 处理（FishLevelGameMode.spawnPlayerInternal 中 bindInput）
 *  - Esc：由 FishLevelGameMode 绑定（取消放置模式）
 */
import { PlayerController, logger } from '@/engine'
import type { FishLevelGameMode } from './FishLevelGameMode'

/** 长按连续放兵间隔（秒）：按住期间每隔该时长放一个兵 */
const HOLD_DEPLOY_INTERVAL = 0.2

export class FishLevelPlayerController extends PlayerController {
  /** 所属 GameMode（SpawnPlayer 时由 GameMode 注入） */
  gameMode: FishLevelGameMode | null = null
  /** 长按连续放兵定时器 id（null = 未在长按） */
  private holdTimer: number | null = null
  /** 最近鼠标屏幕坐标（长按期间按此位置放兵） */
  private lastX = 0
  private lastY = 0

  constructor() {
    super('FishLevelPlayerController')
    // 左键释放 → 结束长按连续放兵（InputSys.handlePointerUp → ProcessMouseButton 广播）
    this.inputComponent.BindMouseButton((button, eventType) => {
      if (button !== 0) return
      if (eventType === 'released') this.stopHoldDeploy()
    })
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    // 记录按下位置 + 立即放一个兵（空地点击未被 UI/建筑 Clickable 消费时到达）
    this.lastX = screenX
    this.lastY = screenY
    this.gameMode?.onScreenDown(screenX, screenY)
    // 进入长按连续放兵（长按期间持续放兵）
    this.startHoldDeploy()
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    // 记录最近鼠标位置（长按期间按此位置放兵）
    this.lastX = screenX
    this.lastY = screenY
    // 转发摄像机云台（右键平移 / 边缘检测）
    this.gameMode?.baseCamera.rig.setMouseScreen(screenX, screenY)
  }

  /** 开始长按连续放兵：按住期间每 HOLD_DEPLOY_INTERVAL 秒在最近鼠标位置放一个兵 */
  private startHoldDeploy(): void {
    this.stopHoldDeploy()
    this.holdTimer = window.setInterval(() => {
      if (!this.gameMode) return
      // 放置模式取消（Esc/点卡片）后不再放兵
      if (!this.gameMode.placeTroopId) {
        this.stopHoldDeploy()
        return
      }
      // 静默失败：长按移动到非法位置（叠建筑/超范围）不刷 warn，避免日志刷屏
      this.gameMode.deployAtScreen(this.lastX, this.lastY, true)
    }, HOLD_DEPLOY_INTERVAL * 1000)
    logger.info('[FishLevelPlayerController] 进入长按连续放兵（按住持续放兵，松开停止）')
  }

  /** 结束长按连续放兵 */
  private stopHoldDeploy(): void {
    if (this.holdTimer !== null) {
      clearInterval(this.holdTimer)
      this.holdTimer = null
      logger.info('[FishLevelPlayerController] 长按连续放兵结束')
    }
  }

  override EndPlay(): void {
    // 清理定时器（防悬挂）
    this.stopHoldDeploy()
    super.EndPlay()
  }
}
