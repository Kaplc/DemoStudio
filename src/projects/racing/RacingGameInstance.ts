/**
 * RacingGameInstance — 赛车游戏实例
 */
import * as THREE from 'three'
import { GameInstance, logger } from '@/engine'
import type { PlayerController } from '@/engine'
import { RacingGameMode, RacingCarPawn, RacingPlayerController } from './'

export class RacingGameInstance extends GameInstance {
  private _gameMode!: RacingGameMode
  override get gameMode(): RacingGameMode { return this._gameMode }
  override createGameMode(): RacingGameMode { return this._gameMode = new RacingGameMode() }

  private _controller: RacingPlayerController | null = null
  pawn: RacingCarPawn | null = null

  override get controller(): RacingPlayerController | null {
    return this._controller
  }

  constructor() {
    super()
    const scene = this.world.sceneComp.scene

    scene.background = new THREE.Color(0x87ceeb)
    const ambient = scene.children.find(c => c instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined
    if (ambient) { ambient.intensity = 0.6; ambient.color.setHex(0xffffff) }
    const hemi = scene.children.find(c => c instanceof THREE.HemisphereLight) as THREE.HemisphereLight | undefined
    if (hemi) { hemi.color.setHex(0x87ceeb); hemi.groundColor.setHex(0x3a7d44) }
    const dl = scene.children.find(c => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined
    if (dl) { dl.intensity = 1.5; dl.position.set(30, 40, 20) }
  }

  override onControllerReady(ctrl: PlayerController): void {
    this._controller = ctrl as RacingPlayerController
    this.pawn = ctrl.pawn as RacingCarPawn
  }

  override onStart(ctrl: PlayerController): boolean {
    this.pawn!.InitGame()
    logger.info(`[RacingGameInstance] 赛车生成: ${this.pawn!.name}`)
    this.world.BeginPlay()
    logger.info('[RacingGameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this._controller?.ProcessKeys(dt)
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
    logger.info('[RacingGameInstance] 停止游戏...')
    this.world.DestroyAllActors()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
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
