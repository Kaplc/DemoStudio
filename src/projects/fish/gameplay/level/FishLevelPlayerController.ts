/**
 * FishLevelPlayerController — 关卡阶段 PlayerController
 *
 * 关卡是空壳占位场景（无玩法逻辑），此 Controller 负责转发键盘输入：
 * Esc 按键（'Escape'）由 FishLevelGameMode 在 SpawnPlayer 时通过
 * inputComponent.BindAction 绑定到暂停菜单开关。
 */
import { PlayerController } from '@/engine'
import type { FishLevelGameMode } from './FishLevelGameMode'

export class FishLevelPlayerController extends PlayerController {
  /** 所属 GameMode（SpawnPlayer 时由 GameMode 注入） */
  gameMode: FishLevelGameMode | null = null

  constructor() {
    super('FishLevelPlayerController')
  }
}
