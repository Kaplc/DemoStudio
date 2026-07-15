/**
 * SnakeGameMode — 贪吃蛇游戏规则
 * 控制：食物生成、计分、游戏结束判断
 */
import { GameMode, SpawnComponent, CameraComponent } from '@/engine'
import { SnakePawn } from './SnakePawn'
import { SnakeFoodPawn } from './SnakeFoodPawn'
import { SnakePlayerController } from './SnakePlayerController'
import { DEFAULT_CONFIG } from './types'
import type { Vec2 } from './types'

export class SnakeGameMode extends GameMode {
  public spawnComponent: SpawnComponent
  /** 游戏摄像机（固定 2.5D 俯视视角） */
  public gameCamera: CameraComponent

  /** 当前食物网格坐标 */
  public foodGridPos: Vec2 = { x: 0, z: 0 }
  private foodPawn: SnakeFoodPawn | null = null

  constructor() {
    super()
    this.spawnComponent = new SpawnComponent(this)
    this.addComponent(this.spawnComponent)

    // 创建游戏摄像机（45 度俯视 2.5D 视角），挂载到 GameMode 自身
    this.gameCamera = new CameraComponent(this, 'GameCamera')
    this.gameCamera.SetView(45, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()

    // 配置生成点：网格中央作为蛇的初始位置
    this.spawnComponent.ClearSpawnPoints()
    this.spawnComponent.AddSpawnPoint(0, 0, 0, 'SnakeSpawn')

    // 注册并设置游戏摄像机（45 度俯视 2.5D 视角，朝向 -Z）
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    const dist = 24
    cam.position.set(0, dist * 0.7, dist * 0.7)
    cam.lookAt(0, 0, 0)
    this.gameCamera.SyncToActor()
  }

  override StartPlay() {
    super.StartPlay()
  }

  // ═══════════════════════════════════
  //  食物管理
  // ═══════════════════════════════════

  /** 生成初始食物（避开蛇身） */
  SpawnInitialFood(snakePositions: Vec2[]): void {
    this.foodGridPos = this.generateFoodPosition(snakePositions)
    this.foodPawn = new SnakeFoodPawn()
    this.spawnComponent.SpawnPawnAt(this.foodPawn, this.foodGridPos.x + 0.5, 0.4, this.foodGridPos.z + 0.5)
    this.world?.SpawnActor(this.foodPawn)
  }

  /** 重新生成食物 */
  RespawnFood(snakePositions: Vec2[]): void {
    if (this.foodPawn) {
      this.foodPawn.destroy()
      this.foodPawn = null
    }
    this.SpawnInitialFood(snakePositions)
  }

  /** 吃食物时调用 */
  OnEatFood(snakePositions: Vec2[]): void {
    this.gameState.addScore(1)
    this.RespawnFood(snakePositions)
  }

  /** 蛇死亡时调用 */
  OnSnakeDied(): void {
    this.gameState.setPhase('gameover')
  }

  /** 获取食物网格坐标 */
  getFoodGridPosition(): Vec2 {
    return { x: this.foodGridPos.x, z: this.foodGridPos.z }
  }

  /** 在空闲网格位置随机生成食物坐标 */
  private generateFoodPosition(snakePositions: Vec2[]): Vec2 {
    const occupied = new Set(snakePositions.map((s) => `${s.x},${s.z}`))
    let pos: Vec2
    do {
      pos = {
        x: Math.floor(Math.random() * DEFAULT_CONFIG.gridSize) - DEFAULT_CONFIG.gridHalf,
        z: Math.floor(Math.random() * DEFAULT_CONFIG.gridSize) - DEFAULT_CONFIG.gridHalf,
      }
    } while (occupied.has(`${pos.x},${pos.z}`))
    return pos
  }

  override IsGameOver(): boolean {
    return this.gameState.phase === 'gameover'
  }

  override SpawnPlayer() {
    // 先创建 Controller
    const controller = new SnakePlayerController()

    // 通过 SpawnComponent 在场景坐标位置创建 Pawn
    const pawn = this.spawnComponent.SpawnPawn(new SnakePawn(), 0)

    return { controller, pawn }
  }
}
