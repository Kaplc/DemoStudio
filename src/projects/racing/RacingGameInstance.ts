/**
 * RacingGameInstance — 赛车游戏实例
 */
import * as THREE from 'three'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { RacingGameMode, RacingCarPawn, RacingPlayerController } from './'

export class RacingGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: RacingGameMode

  private _controller: RacingPlayerController | null = null
  pawn: RacingCarPawn | null = null

  override get controller(): RacingPlayerController | null {
    return this._controller
  }

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null

  private sharedScene: THREE.Scene

  constructor(sharedScene: THREE.Scene) {
    super()
    this.sharedScene = sharedScene
    sharedScene.background = new THREE.Color(0x87ceeb)

    const ambient = sharedScene.children.find(c => c instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined
    if (ambient) { ambient.intensity = 0.6; ambient.color.setHex(0xffffff) }
    const hemi = sharedScene.children.find(c => c instanceof THREE.HemisphereLight) as THREE.HemisphereLight | undefined
    if (hemi) { hemi.color.setHex(0x87ceeb); hemi.groundColor.setHex(0x3a7d44) }
    const dl = sharedScene.children.find(c => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined
    if (dl) { dl.intensity = 1.5; dl.position.set(30, 40, 20) }

    this.world = new World(sharedScene)
    this.gameMode = new RacingGameMode()
    this.world.SetGameMode(this.gameMode)
    this.world.Stop()

    this.unsubGameState = this.gameMode.gameState.subscribe(() => {
      const gs = this.gameMode.gameState
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover') {
        this.callbacks.onGameOver?.()
      }
    })
  }

  override setCallbacks(cbs: GameInstanceCallbacks) {
    this.callbacks = cbs
  }

  override start(): boolean {
    logger.info('[RacingGameInstance] 启动游戏...')
    this.gameMode.InitGame()
    this.gameMode.StartPlay()

    const spawn = this.gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[RacingGameInstance] SpawnPlayer 返回空')
      return false
    }

    const pawn = spawn.pawn as RacingCarPawn
    pawn.InitGame()
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as RacingPlayerController
    this.pawn = pawn

    logger.info(`[RacingGameInstance] 赛车生成: ${pawn.name}`)
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

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[RacingGameInstance] 停止游戏...')
    this.world.DestroyAllActors()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
    this._controller = null
    this.pawn = null
    this.sharedScene.background = new THREE.Color(0x1a1a2e)
  }

  override destroy() {
    this.stop()
    if (this.unsubGameState) {
      this.unsubGameState()
      this.unsubGameState = null
    }
    this.world.Destroy()
  }
}
