/**
 * FishLevelPlayerController — 关卡战斗阶段 PlayerController
 *
 * 战斗阶段输入职责：
 *  - 鼠标按下/移动：转发给 FishLevelGameMode（放置模式下点击战场放兵）
 *  - 滚轮缩放 + 右键平移：由战斗摄像机云台（CameraRigComponent）订阅
 *    inputComponent 处理（FishLevelGameMode.spawnPlayerInternal 中 bindInput）
 *  - Esc：由 FishLevelGameMode 绑定（取消放置模式）
 */
import { PlayerController } from '@/engine'
import type { FishLevelGameMode } from './FishLevelGameMode'

export class FishLevelPlayerController extends PlayerController {
  /** 所属 GameMode（SpawnPlayer 时由 GameMode 注入） */
  gameMode: FishLevelGameMode | null = null

  constructor() {
    super('FishLevelPlayerController')
  }

  override OnPointerDownScreen(screenX: number, screenY: number): void {
    // 空地点击（未被 UI/建筑 Clickable 消费）→ 放置模式放兵
    this.gameMode?.onScreenDown(screenX, screenY)
  }

  override OnPointerMoveScreen(screenX: number, screenY: number): void {
    // 记录鼠标位置供摄像机云台做边缘平移检测
    this.gameMode?.baseCamera.rig.setMouseScreen(screenX, screenY)
  }
}
