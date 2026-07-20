/**
 * GameMode — 游戏规则权威
 * 模仿 UE GameMode（Actor），控制游戏流程
 */
import { Actor } from '../entity/Actor'
import { GameState } from './GameState'
import { PlayerCameraManager } from '../input/PlayerCameraManager'
import { HUD } from '../ui/HUD'
import type { Pawn } from '../entity/Pawn'
import type { PlayerController } from '../input/PlayerController'

export abstract class GameMode extends Actor {
  public readonly gameState: GameState
  public readonly cameraManager: PlayerCameraManager

  /** HUD 控制器（由子类在构造时创建并赋值） */
  hud: HUD | null = null

  constructor() {
    super('GameMode')
    this.gameState = new GameState()
    this.cameraManager = new PlayerCameraManager()
  }

  InitGame(): void {
    this.gameState.reset()
    this.hud?.Init()
  }

  StartPlay(): void {
    this.gameState.setPhase('playing')
  }

  override BeginPlay(): void {
    super.BeginPlay()
    this.hud?.BeginPlay()
  }

  override EndPlay(): void {
    this.hud?.EndPlay()
    super.EndPlay()
  }

  override Tick(dt: number): void {
    super.Tick(dt) // component ticks
    this.hud?.Tick(dt)
  }

  OnPlayerDied(_pawn: Pawn): void {}
  OnScoreChanged(_newScore: number): void {}

  IsGameOver(): boolean {
    return this.gameState.phase === 'gameover'
  }

  SpawnPlayer(): { controller: PlayerController; pawn: Pawn } | null {
    return null
  }

  protected EndGame() {
    this.gameState.setPhase('gameover')
  }
}
