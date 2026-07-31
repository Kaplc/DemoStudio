/**
 * GameMode — 游戏规则权威
 * 模仿 UE GameMode（Actor），控制游戏流程
 */
import { Actor } from '../entity/Actor'
import { GameState } from './GameState'
import { PlayerCameraManager } from '../input/PlayerCameraManager'
import type { Pawn } from '../entity/Pawn'
import type { PlayerController } from '../input/PlayerController'

export abstract class GameMode extends Actor {
  public readonly gameState: GameState
  public readonly cameraManager: PlayerCameraManager

  /**
   * HUD 蓝图路径（模仿 UE GameMode.HUDClass）。
   * World 在场景切换时据此调用 UIManager.createHUD 创建 HUD，UI Actor 的生成由 UIManager 统一管理。
   */
  HUDClass?: string

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

  override BeginPlay(): void {
    super.BeginPlay()
  }

  override EndPlay(): void {
    super.EndPlay()
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
