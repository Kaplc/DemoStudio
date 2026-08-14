/**
 * FishLevelGameMode — 关卡空壳 GameMode
 *
 * 由关卡场景资产（mode="level"）经 GameModeRegistry 匹配创建。
 * 只提供：
 *  - 正交相机（海域同款参数，覆盖 60x36 地面）
 *  - PlayerController（键盘输入管线，Esc → 暂停菜单开关）
 *  - 暂停菜单（pause_menu.widget.json，Esc 打开，内含"返回基地"按钮）
 * 无任何玩法逻辑（鱼群/捕鱼/计分等后续再接）。
 */
import { GameMode, CameraComponent, logger, type Actor } from '@/engine'
import { CAMERA_ORTHO_SIZE } from '../common/types'
import { FishLevelPlayerController } from './FishLevelPlayerController'
import { FishLevelPawn } from './FishLevelPawn'

export class FishLevelGameMode extends GameMode {
  /** 关卡相机（正交，海域同款参数） */
  readonly gameCamera: CameraComponent
  /** 暂停菜单 Actor（Esc 打开/关闭；由 World 销毁时统一回收） */
  private pausePanel: Actor | null = null

  constructor() {
    super()
    this.gameCamera = new CameraComponent(this, 'LevelCamera', 'orthographic')
    this.gameCamera.SetOrtho(CAMERA_ORTHO_SIZE, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.gameState.setPhase('waiting')
    // 注册正交相机：沿 +Z 朝 -Z 看（与海域 FishGameMode 一致）
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 0, 20)
    cam.lookAt(0, 0, 0)
    this.gameCamera.SyncToActor()
  }

  override StartPlay() {
    // 关卡空壳不进入 playing 阶段
    this.gameState.setPhase('waiting')
  }

  override spawnPlayerInternal() {
    const controller = new FishLevelPlayerController()
    controller.gameMode = this
    // Esc → 打开/关闭暂停菜单（键盘链路：Viewport keydown → InputSys.handleKeyDown → ProcessInput）
    controller.inputComponent.BindAction('pause-menu', 'Escape', 'pressed', () => this.togglePauseMenu())
    logger.info('[LevelGM] SpawnPlayer: controller 已创建，Esc 绑定暂停菜单')
    return { controller, pawn: new FishLevelPawn() }
  }

  /** Esc 开关暂停菜单：关闭时销毁面板，打开时生成 pause_menu.widget.json */
  togglePauseMenu() {
    if (this.pausePanel) {
      this.closePauseMenu()
      return
    }
    const w = this.world
    if (!w) {
      logger.error('[LevelGM] 打开暂停菜单失败：world 为空')
      return
    }
    const panel = w.ui.spawnUIActor('asset/blueprints/ui/pause_menu.widget.json')
    if (!panel) {
      logger.error('[LevelGM] 暂停菜单生成失败')
      return
    }
    this.pausePanel = panel
    logger.info('[LevelGM] 打开暂停菜单')
  }

  /** 关闭暂停菜单（由 PauseMenu 脚本"继续游戏"按钮调用） */
  closePauseMenu() {
    if (!this.pausePanel) return
    this.pausePanel.destroy()
    this.pausePanel = null
    logger.info('[LevelGM] 关闭暂停菜单')
  }

  override EndPlay() {
    // 暂停面板是 UI Actor，由 World 销毁时 UIManager.destroyAll 统一回收，这里只清引用
    this.pausePanel = null
    super.EndPlay()
  }
}
