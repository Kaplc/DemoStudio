/**
 * HelloGameInstance — 外部工程根示例：游戏实例
 * 镜像 RacingGameInstance 的最小结构：场景背景 + 相机 + tick/stop 生命周期
 */
import * as THREE from 'three'
import { GameInstance, logger } from '@/engine'
import type { PlayerController } from '@/engine'
import { HelloGameMode } from './gameplay/HelloGameMode'
import { HelloPawn } from './gameplay/HelloPawn'
import type { HelloPlayerController } from './gameplay/HelloPlayerController'

export class HelloGameInstance extends GameInstance {
  private _gameMode!: HelloGameMode
  override get gameMode(): HelloGameMode { return this._gameMode }
  override createGameMode(): HelloGameMode { return this._gameMode = new HelloGameMode() }

  private _controller: HelloPlayerController | null = null
  pawn: HelloPawn | null = null

  override get controller(): HelloPlayerController | null {
    return this._controller
  }

  constructor() {
    super()
    const scene = this.world.sceneComp.scene
    scene.background = new THREE.Color(0x0e1a2e)
  }

  override onControllerReady(ctrl: PlayerController): void {
    this._controller = ctrl as HelloPlayerController
    this.pawn = ctrl.pawn as HelloPawn
  }

  override onStart(_ctrl: PlayerController): boolean {
    this.world.BeginPlay()
    logger.info('[HelloGameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    return this.gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[HelloGameInstance] 停止游戏...')
    this.world.DestroyAllActors()
    this.world.Pause()
    this._controller = null
    this.pawn = null
    this.world.sceneComp.scene.background = new THREE.Color(0x1a1a2e)
  }

  override destroy() {
    this.stop()
    super.destroy()
    this.world.Destroy()
  }
}