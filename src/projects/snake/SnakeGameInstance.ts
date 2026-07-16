/**
 * SnakeGameInstance — 贪吃蛇游戏实例
 * 封装 World + GameMode + 玩家生命周期，供 Viewport 使用
 * 使用 React 组件渲染游戏 HUD
 */
import * as THREE from 'three'
import React from 'react'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { SnakeGameMode, SnakePawn, SnakePlayerController } from './'
import { GameHud } from './components/GameHud'
import type { GameHudProps } from './components/GameHud'

export class SnakeGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: SnakeGameMode

  private _controller: SnakePlayerController | null = null
  pawn: SnakePawn | null = null

  /** 缓存 HUD props，避免每帧创建新对象 */
  private _hudProps: GameHudProps = { score: 0, phase: 'waiting' }

  override get controller(): SnakePlayerController | null {
    return this._controller
  }

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null

  constructor(sharedScene: THREE.Scene) {
    super()
    this.world = new World(sharedScene)
    this.gameMode = new SnakeGameMode()
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
    logger.info('[GameInstance] 启动游戏...')
    this.gameMode.InitGame()
    this.gameMode.StartPlay()
    const spawn = this.gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[GameInstance] SpawnPlayer 返回空')
      return false
    }
    const pawn = spawn.pawn as SnakePawn
    pawn.InitGame()
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as SnakePlayerController
    this.pawn = pawn
    this.gameMode.SpawnInitialFood(pawn.getSnakePositions())
    logger.info(`[GameInstance] 玩家生成: ${pawn.name}`)
    this.world.BeginPlay()

    // 首次渲染 React HUD
    this._hudProps = { score: 0, phase: 'playing' }
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))

    logger.info('[GameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
    // 更新 React HUD（React diff 确保只更新变化的 DOM）
    const gs = this.gameMode.gameState
    this._hudProps.score = gs.score
    this._hudProps.phase = gs.phase as GameHudProps['phase']
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))
  }

  /** 每帧绘制蛇的调试 Gizmos（方向射线 / 蛇身格 / 食物 / 场地范围） */
  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[GameInstance] 停止游戏...')
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
