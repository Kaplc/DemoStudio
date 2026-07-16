/**
 * FishGameInstance — 捕鱼达人游戏实例
 * 封装 World + GameMode + 炮台生命周期，React HUD 渲染。
 */
import * as THREE from 'three'
import React from 'react'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { FishGameMode } from './FishGameMode'
import { FishPlayerController } from './FishPlayerController'
import type { FishCannon } from './FishCannon'
import { makeSeabedTexture } from './textures'
import { GameHud } from './components/GameHud'
import type { GameHudProps } from './components/GameHud'

export class FishGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: FishGameMode

  private _controller: FishPlayerController | null = null
  pawn: FishCannon | null = null

  private _hudProps: GameHudProps = { coins: 0, score: 0, level: 1, bossActive: false, bossHp: 0, bossMaxHp: 0, phase: 'waiting' }
  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null
  /** 海底氛围背景 mesh（直接挂到 world.scene，非 Actor） */
  private seabed: THREE.Mesh | null = null

  constructor(sharedScene: THREE.Scene) {
    super()
    this.world = new World(sharedScene)
    this.gameMode = new FishGameMode()
    this.world.SetGameMode(this.gameMode)
    this.world.Stop()
    // 重置模式——World.SetGameMode 会调用 InitGame + StartPlay，
    // 但此时 GameInstance 还未就绪，我们将在 start() 中重新调用
    this.gameMode.gameState.setPhase('waiting')

    this.unsubGameState = this.gameMode.gameState.subscribe(() => {
      const gs = this.gameMode.gameState
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover') {
        this.callbacks.onGameOver?.()
      }
    })
  }

  override get controller(): FishPlayerController | null {
    return this._controller
  }

  override setCallbacks(cbs: GameInstanceCallbacks) {
    this.callbacks = cbs
  }

  override start(): boolean {
    logger.info('[Fish] 启动游戏...')
    this.gameMode.InitGame()
    this.gameMode.StartPlay()
    const spawn = this.gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[Fish] SpawnPlayer 返回空')
      return false
    }
    const pawn = spawn.pawn as FishCannon
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as FishPlayerController
    this.pawn = pawn
    this.world.BeginPlay()
    this.spawnSeabed()

    this._hudProps = {
      coins: this.gameMode.coins,
      score: 0,
      level: pawn.level,
      bossActive: false,
      bossHp: 0,
      bossMaxHp: 0,
      phase: 'playing',
    }
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))

    logger.info('[Fish] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
    const gs = this.gameMode.gameState
    this._hudProps.coins = this.gameMode.coins
    this._hudProps.score = gs.score
    this._hudProps.level = this.pawn?.level ?? 1
    this._hudProps.bossActive = this.gameMode.bossActive
    const boss = this.gameMode.bossPawn
    this._hudProps.bossMaxHp = boss ? boss.config.hp : 0
    this._hudProps.bossHp = boss && !boss.captured ? boss.hp : 0
    this._hudProps.phase = gs.phase as GameHudProps['phase']
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  /** 生成海底氛围背景（渐变水深 + 斜射光柱） */
  private spawnSeabed() {
    if (this.seabed) return
    const geo = new THREE.PlaneGeometry(72, 44)
    const mat = new THREE.MeshBasicMaterial({ map: makeSeabedTexture(), depthWrite: false })
    this.seabed = new THREE.Mesh(geo, mat)
    this.seabed.position.set(0, 0, -2.5)
    this.world.scene.add(this.seabed)
  }

  /** 清除海底背景 */
  private clearSeabed() {
    if (!this.seabed) return
    this.world.scene.remove(this.seabed)
    this.seabed.geometry.dispose()
    ;(this.seabed.material as THREE.MeshBasicMaterial).dispose()
    this.seabed = null
  }

  override stop() {
    this.clearSeabed()
    if (!this._controller && !this.pawn) return
    logger.info('[Fish] 停止游戏...')
    this.world.DestroyAllActors()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
    this._controller = null
    this.pawn = null
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
