/**
 * EatFishGameInstance — 大鱼吃小鱼游戏实例
 * 封装 World + GameMode + 玩家生命周期
 */
import * as THREE from 'three'
import React from 'react'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { EatFishGameMode, EatFishPawn, EatFishPlayerController } from './'
import { GameHud } from './components/GameHud'
import type { GameHudProps } from './components/GameHud'

export class EatFishGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: EatFishGameMode

  private _controller: EatFishPlayerController | null = null
  pawn: EatFishPawn | null = null

  private _hudProps: GameHudProps = { score: 0, fishSize: 1, phase: 'waiting' }

  override get controller(): EatFishPlayerController | null {
    return this._controller
  }

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null

  private sharedScene: THREE.Scene

  constructor(sharedScene: THREE.Scene) {
    super()
    this.sharedScene = sharedScene
    // 设置水下场景氛围
    sharedScene.background = new THREE.Color(0x0a3d6b)
    sharedScene.fog = new THREE.Fog(0x0a3d6b, 20, 45)
    // 环境光加强水下效果
    const ambient = sharedScene.children.find(c => c instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined
    if (ambient) {
      ambient.intensity = 0.5
      ambient.color.setHex(0x6688cc)
    }
    const hemi = sharedScene.children.find(c => c instanceof THREE.HemisphereLight) as THREE.HemisphereLight | undefined
    if (hemi) {
      hemi.color.setHex(0x4488cc)
      hemi.groundColor.setHex(0x002244)
    }

    this.world = new World(sharedScene)
    this.gameMode = new EatFishGameMode()
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
    logger.info('[EatFishGameInstance] 启动游戏...')
    this.gameMode.InitGame()
    this.gameMode.StartPlay()

    const spawn = this.gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[EatFishGameInstance] SpawnPlayer 返回空')
      return false
    }

    const pawn = spawn.pawn as EatFishPawn
    pawn.InitGame()
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as EatFishPlayerController
    this.pawn = pawn

    // 生成鱼群
    this.gameMode.SpawnInitialFish()

    logger.info(`[EatFishGameInstance] 玩家生成: ${pawn.name}`)
    this.world.BeginPlay()

    // 首次渲染 HUD
    this._hudProps = { score: 0, fishSize: pawn.getScale(), phase: 'playing' }
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))

    logger.info('[EatFishGameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    // 处理玩家输入
    this._controller?.ProcessKeys(dt)

    // Tick 世界
    this.world.manualTick(dt)

    // 更新 HUD
    const gs = this.gameMode.gameState
    const fs = this.pawn?.getScale() ?? 1
    this._hudProps.score = gs.score
    this._hudProps.fishSize = fs
    this._hudProps.phase = gs.phase as GameHudProps['phase']
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[EatFishGameInstance] 停止游戏...')
    this.world.DestroyAllActors()
    this.gameMode.CleanupFish()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
    this._controller = null
    this.pawn = null
    // 恢复场景背景
    this.sharedScene.background = new THREE.Color(0x1a1a2e)
    this.sharedScene.fog = new THREE.Fog(0x1a1a2e, 30, 60)
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
