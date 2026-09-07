/**
 * WarmCurrentMenuGameMode — 主菜单 GameMode（fish FishMainMenuGameMode 同款结构）
 * 只设置相机与背景氛围，不启动任何游戏逻辑；
 * 「开始游戏 / 读取存档」经 onMenuAction 回调交 GameInstance 切场景。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent } from '@/engine'
import { WarmCurrentMenuPlayerController } from './WarmCurrentMenuPlayerController'
import { WarmCurrentMenuPawn } from './WarmCurrentMenuPawn'

/** 主菜单动作类型（按钮 → GameInstance 分发） */
export type MenuAction = 'new' | 'load'

/**
 * 主菜单相机正交半高：匹配 UI 根画布世界尺寸（9.6×5.4，设计分辨率 1920×1080），
 * UI 恰好铺满视口（fish 同款算法：halfH = 5.4/2 = 2.7）。
 */
const MENU_ORTHO_SIZE = 2.7

export class WarmCurrentMenuGameMode extends GameMode {
  readonly gameCamera: CameraComponent
  /** UI 按钮回调（由 GameInstance 注入：new → 新开局，load → 读最近存档进游戏） */
  onMenuAction: ((action: MenuAction) => void) | null = null

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
    // 必须调基类：基类 StartPlay 内含 SpawnPlayer()（创建菜单 controller），
    // 漏掉会导致 mode.controller 为 null（fish 踩过的坑）。
    super.StartPlay()
    this.gameState.setPhase('waiting')
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // 菜单模式无游戏逻辑；背景氛围（星体漂移）由星图渲染层在游戏场景内自转
  }

  override spawnPlayerInternal() {
    return { controller: new WarmCurrentMenuPlayerController(), pawn: new WarmCurrentMenuPawn() }
  }

  /** UI 按钮入口（MainMenu.script 调用） */
  emitMenuAction(action: MenuAction): void {
    this.onMenuAction?.(action)
  }
}
