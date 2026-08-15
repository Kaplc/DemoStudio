/**
 * FishMainMenuGameMode — ClashMaster 主菜单 GameMode
 * 只设置相机和背景，不启动任何游戏逻辑。
 * 玩家点击开始后通过回调切换至 FishGameMode。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent } from '@/engine'
import { FishMainMenuPlayerController } from './FishMainMenuPlayerController'
import { FishMainMenuPawn } from './FishMainMenuPawn'

/**
 * 主菜单相机正交半高：匹配 UI 根画布世界尺寸（9.6×5.4，设计分辨率 1920×1080）。
 * 使 UI 恰好铺满视口（halfH = 5.4/2 = 2.7，halfW = 2.7×aspect 在 16:9 下 = 4.8 = 9.6/2）。
 */
const MENU_ORTHO_SIZE = 2.7

export class FishMainMenuGameMode extends GameMode {
  readonly gameCamera: CameraComponent
  /** 外部设置：玩家点击开始后的回调 */
  onStartGame: (() => void) | null = null

  /** HUD 蓝图：主菜单 UI（由 World.SwitchScene 统一创建） */
  override HUDClass = 'asset/blueprints/ui/main_menu.widget.json'

  constructor() {
    super()
    this.gameCamera = new CameraComponent(this, 'MenuCamera', 'orthographic')
    this.gameCamera.SetOrtho(MENU_ORTHO_SIZE, 0.1, 200)
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

  override spawnPlayerInternal() {
    const controller = new FishMainMenuPlayerController()
    const pawn = new FishMainMenuPawn()
    return { controller, pawn }
  }

  /** 玩家点击开始游戏，由外部（GameInstance）调用 */
  startGame() {
    this.onStartGame?.()
  }
}
