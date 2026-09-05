/**
 * GameMode — 游戏规则权威
 * 模仿 UE GameMode（BObject，非场景对象），控制游戏流程
 *
 * Controller 生命周期归 GameMode 管理（World 不持有 Controller 引用）：
 *  - SpawnPlayer() 创建后登记到 this.controller
 *  - BeginPlay / EndPlay / Tick 统一驱动
 */
import { BObject } from '../entity/BObject'
import { GameState } from './GameState'
import { PlayerCameraManager } from '../rendering/PlayerCameraManager'
import type { Pawn } from '../entity/Pawn'
import type { PlayerController } from '../input/PlayerController'
import type { World } from './World'

export abstract class GameMode extends BObject {
  /** 所属世界（由 World.SetGameMode 注入；GameMode 非场景对象，自行持有） */
  public world: World | null = null

  public readonly gameState: GameState
  public readonly cameraManager: PlayerCameraManager

  /**
   * 当前玩家 Controller（由本 GameMode 创建并管理生命周期）。
   * 场景切换（SetGameMode 清理旧 GameMode）时随 EndPlay 自动销毁。
   */
  public controller: PlayerController | null = null

  /**
   * HUD 蓝图路径（模仿 UE GameMode.HUDClass）。
   * SpawnPlayer 登记 controller 后由 PC.ClientSetHUD 创建并持有 HUD（对齐 UE InitializeHUDForPlayer），
   * UI Actor 的生成仍由 UIManager 统一管理。无 controller（spawnPlayerInternal 返回 null）则无 HUD（UE 语义）。
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
    // GameMode 创建时自动生成玩家 Controller + Pawn（子类实现 spawnPlayerInternal）
    this.SpawnPlayer()
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // GameState + Controller 生命周期统一由 GameMode 驱动（World 不再逐个调用）
    if (!this.gameState.bHasBegunPlay) {
      this.gameState.BeginPlay()
    }
    if (this.controller && !this.controller.bHasBegunPlay) {
      this.controller.BeginPlay()
    }
  }

  override EndPlay(): void {
    // GameState + Controller 随 GameMode 一起结束生命周期
    this.gameState.EndPlay()
    this.controller?.EndPlay()
    this.controller = null
    // 相机管理器终态（幂等：BObject.EndPlay 自动 markDestroyed + 注册表注销）
    this.cameraManager.EndPlay()
    super.EndPlay()
  }

  override Tick(dt: number): void {
    super.Tick(dt) // component ticks
    // 统一驱动：GameState → Controller → 摄像机管理器（由 GameMode 集中驱动，World 不再逐个调用）
    this.gameState.Tick(dt)
    this.controller?.Tick(dt)
    this.cameraManager.UpdateCamera()
  }

  OnPlayerDied(_pawn: Pawn): void {}
  OnScoreChanged(_newScore: number): void {}

  IsGameOver(): boolean {
    return this.gameState.phase === 'gameover'
  }

  /**
   * 生成玩家（基类封装）：
   * 1. spawnPlayerInternal() 创建 controller + pawn
   * 2. 登记 controller 到 this.controller 统一生命周期
   * 3. Pawn 由 World 生成（SpawnPawn），生成完成后经 OnPawnSpawned 通知 Controller
   */
  SpawnPlayer(): { controller: PlayerController; pawn: Pawn } | null {
    const result = this.spawnPlayerInternal()
    if (!result) return null
    this.controller = result.controller
    // 对齐 UE InitializeHUDForPlayer：controller 诞生即签发 HUDClass（PC.ClientSetHUD 创建并持有 HUD）
    result.controller.world = this.world
    result.controller.ClientSetHUD(this.HUDClass)
    // Pawn 由 World 统一生成；生成完成后经 OnPawnSpawned 通知 Controller（Possess）
    this.world?.actorMgr.SpawnPawn(result.pawn, (pawn) => this.OnPawnSpawned(pawn))
    return result
  }

  /** 子类覆盖点：创建并返回玩家 Controller + Pawn */
  protected spawnPlayerInternal(): { controller: PlayerController; pawn: Pawn } | null {
    return null
  }

  /**
   * Pawn 生成完成回调（由 World.SpawnPawn 在生成进世界后触发）。
   * 默认行为：让当前 Controller Possess 该 Pawn（子类可覆写定制）。
   */
  protected OnPawnSpawned(pawn: Pawn): void {
    if (this.controller) {
      this.controller.Possess(pawn)
    }
  }

  protected EndGame() {
    this.gameState.setPhase('gameover')
  }
}
