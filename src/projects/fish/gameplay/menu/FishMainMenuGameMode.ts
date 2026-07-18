/**
 * FishMainMenuGameMode — 捕鱼达人主菜单 GameMode
 * 只设置相机和背景，不启动任何游戏逻辑。
 * 玩家点击开始后通过回调切换至 FishGameMode。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent } from '@/engine'
import { CAMERA_ORTHO_SIZE } from '../common/types'
import { FishMainMenuPlayerController } from './FishMainMenuPlayerController'
import { FishMainMenuPawn } from './FishMainMenuPawn'

export class FishMainMenuGameMode extends GameMode {
  readonly gameCamera: CameraComponent
  /** 外部设置：玩家点击开始后的回调 */
  onStartGame: (() => void) | null = null

  constructor() {
    super()
    this.gameCamera = new CameraComponent(this, 'MenuCamera', 'orthographic')
    this.gameCamera.SetOrtho(CAMERA_ORTHO_SIZE, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.gameState.setPhase('waiting')
  }

  override StartPlay() {
    // 菜单模式不进入 playing 阶段
    this.gameState.setPhase('waiting')
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // 菜单模式不执行游戏逻辑，仅保留相机更新
  }

  override SpawnPlayer() {
    const controller = new FishMainMenuPlayerController()
    const pawn = new FishMainMenuPawn()
    return { controller, pawn }
  }

  /** 玩家点击开始游戏，由外部（GameInstance）调用 */
  startGame() {
    this.onStartGame?.()
  }
}
