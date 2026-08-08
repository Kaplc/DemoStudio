/**
 * Demo2DGameMode — 2D 游戏规则
 * 配置正交相机、生成玩家与金币、XY 平面圆碰撞计分。
 */
import * as THREE from 'three'
import { GameMode, SpawnComponent, CameraComponent, gizmos, logger } from '@/engine'
import { Demo2DPawn } from './Demo2DPawn'
import { Demo2DCoin } from './Demo2DCoin'
import { Demo2DPlayerController } from './Demo2DPlayerController'
import { BOUND, PLAYER_RADIUS, COIN_RADIUS } from './types'

// Gizmos 复用临时对象
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

export class Demo2DGameMode extends GameMode {
  public spawnComponent: SpawnComponent
  /** 2D 正交游戏相机 */
  public gameCamera: CameraComponent
  private coin: Demo2DCoin | null = null

  constructor() {
    super()
    this.spawnComponent = new SpawnComponent(this)
    this.addComponent(this.spawnComponent)

    // 正交相机：mode='orthographic'，半高 10（视野高度 20 世界单位）
    this.gameCamera = new CameraComponent(this, 'GameCamera', 'orthographic')
    this.gameCamera.SetOrtho(10, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.spawnComponent.ClearSpawnPoints()
    this.spawnComponent.AddSpawnPoint(0, 0, 0, 'PlayerStart')

    // 注册正交相机：沿 +Z 朝 -Z 看，俯瞰 XY 平面
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 0, 20)
    cam.lookAt(0, 0, 0)
    this.gameCamera.SyncToActor()
  }

  override spawnPlayerInternal() {
    const controller = new Demo2DPlayerController()
    const pawn = this.spawnComponent.SpawnPawn(new Demo2DPawn(), 0)
    return { controller, pawn }
  }

  /** 生成初始金币 */
  SpawnInitialCoin() {
    this.coin = new Demo2DCoin()
    this.placeCoin()
    this.world?.SpawnActor(this.coin)
  }

  /** 随机放置金币（避开玩家出生点附近） */
  private placeCoin() {
    if (!this.coin) return
    let x = 0
    let y = 0
    do {
      x = (Math.random() * 2 - 1) * (BOUND - 1)
      y = (Math.random() * 2 - 1) * (BOUND - 1)
    } while (x * x + y * y < 4) // 避免太靠近中心
    this.coin.setPosition(x, y, 0)
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (!this.world?.running || !this.coin) return
    const player = this.world.FindActor(Demo2DPawn)
    if (!player) return
    // XY 平面圆碰撞
    const dx = player.position.x - this.coin.position.x
    const dy = player.position.y - this.coin.position.y
    const r = PLAYER_RADIUS + COIN_RADIUS
    if (dx * dx + dy * dy < r * r) {
      this.gameState.addScore(1)
      logger.info(`[Demo2D] 收集金币! 得分: ${this.gameState.score}`)
      this.placeCoin()
    }
  }

  override OnDrawGizmos() {
    // 活动边界（XY 平面矩形）
    gizmos.color = 0x4488cc
    const b = BOUND
    const corners: Array<[number, number]> = [
      [-b, -b], [b, -b], [b, b], [-b, b],
    ]
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i]
      const [x2, y2] = corners[(i + 1) % 4]
      _a.set(x1, y1, 0)
      _b.set(x2, y2, 0)
      gizmos.DrawLine(_a, _b)
    }
  }
}
