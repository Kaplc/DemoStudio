/**
 * GameMode — 游戏规则权威
 * 模仿 UE GameMode（Actor），控制游戏流程
 */
import { Actor } from './Actor'
import { GameState } from './GameState'
import { PlayerCameraManager } from './PlayerCameraManager'
import type { Pawn } from './Pawn'
import type { PlayerController } from './PlayerController'

export abstract class GameMode extends Actor {
  public readonly gameState: GameState
  public readonly cameraManager: PlayerCameraManager

  constructor() {
    super('GameMode')
    this.gameState = new GameState()
    this.cameraManager = new PlayerCameraManager()
  }

  InitGame(): void {
    this.gameState.reset()
  }

  StartPlay(): void {
    this.gameState.setPhase('playing')
  }

  override Tick(dt: number): void {
    super.Tick(dt) // component ticks
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
