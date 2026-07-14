/**
 * SnakePawn — 贪吃蛇角色
 * 继承 Pawn，拥有蛇身网格、移动、碰撞、进食逻辑
 */
import * as THREE from 'three'
import { Pawn, CameraComponent } from '../../framework'
import { logger } from '../../engine'
import { SnakeScene3D } from './Scene3D'
import { DEFAULT_CONFIG, DIRECTION_VECTORS } from './types'
import type { Vec2, Direction, GameConfig } from './types'
import type { SnakeGameMode } from './SnakeGameMode'

// 全局游戏状态快照类型
export interface SnakeGameSnapshot {
  phase: string
  score: number
  snakeLength: number
  headPosition: { x: number; z: number } | null
  foodPosition: { x: number; z: number }
  currentDirection: { x: number; z: number }
  pendingDirection: { x: number; z: number }
}

export class SnakePawn extends Pawn {
  private config: GameConfig
  private scene3D: SnakeScene3D

  // 游戏状态
  private snake: Vec2[] = []
  private foodPos: Vec2 = { x: 0, z: 0 }
  private currentDir: Vec2 = { x: 1, z: 0 }
  private nextDir: Vec2 = { x: 1, z: 0 }
  private moveTimer = 0

  // 3D 对象
  private foodMesh: THREE.Mesh | null = null
  private snakeMeshes: THREE.Mesh[] = []

  // 材质
  private headMat: THREE.MeshStandardMaterial
  private bodyMat: THREE.MeshStandardMaterial
  private foodMat: THREE.MeshStandardMaterial

  /** 游戏摄像机（俯瞰蛇头） */
  public gameCamera: CameraComponent

  constructor() {
    super('SnakePawn')
    this.config = { ...DEFAULT_CONFIG }
    this.scene3D = new SnakeScene3D()

    // 创建游戏摄像机（2.5D 俯视视角）
    this.gameCamera = new CameraComponent(this, 'GameCamera')
    this.gameCamera.SetView(45, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)

    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x44ff88, roughness: 0.3, metalness: 0.1,
      emissive: 0x22ff66, emissiveIntensity: 0.2,
    })
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x33cc77, roughness: 0.4, metalness: 0.1,
    })
    this.foodMat = new THREE.MeshStandardMaterial({
      color: 0xff4444, roughness: 0.2, metalness: 0.3,
      emissive: 0xff2222, emissiveIntensity: 0.3,
    })
  }

  /** 由 GameMode 在生成时调用 */
  InitGame() {
    // 竞技场由 Scene3D（作为场景资源）已在 Viewport 中加载
    // 这里只初始化蛇和食物
    this.resetState()
    this.rebuildSnake()
    this.spawnFood()
    // 固定 2.5D 俯视摄像机
    // 直接设置 Actor root 位置，让 SyncFromActor 每帧正确同步
    const cam = this.gameCamera.camera
    cam.position.set(0, 20, 0.01)
    cam.lookAt(0, 0, 0)
    // 通过 SyncToActor 把摄像机姿态固话到 Actor root
    this.gameCamera.SyncToActor();
    (window as any).__snakeGameData = this.getSnapshot()
  }

  private resetState() {
    this.snake = [
      { x: 0, z: 0 },
      { x: -1, z: 0 },
      { x: -2, z: 0 },
    ]
    this.currentDir = { x: 1, z: 0 }
    this.nextDir = { x: 1, z: 0 }
    this.moveTimer = 0
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (this.moveTimer === -1) return // 未开始

    this.moveTimer += dt
    if (this.moveTimer < this.config.moveInterval) return
    this.moveTimer = 0

    this.moveSnake()
  }

  /** 开始移动 */
  StartMoving() { this.moveTimer = 0 }

  /** 停止移动 */
  StopMoving() { this.moveTimer = -1 }

  /** 设置方向（由 Controller 调用） */
  SetDirection(dir: Direction) {
    const vec = DIRECTION_VECTORS[dir]
    if (vec.x + this.currentDir.x === 0 && vec.z + this.currentDir.z === 0) return
    this.nextDir = vec
    logger.info(`方向: ${dir} → (${vec.x}, ${vec.z})`)
  }

  private moveSnake() {
    this.currentDir = { ...this.nextDir }

    const head = this.snake[0]
    const newHead: Vec2 = {
      x: head.x + this.currentDir.x,
      z: head.z + this.currentDir.z,
    }

    // 撞墙
    const half = this.config.gridHalf
    if (Math.abs(newHead.x) >= half || Math.abs(newHead.z) >= half) {
      logger.warn(`撞墙! 位置: (${newHead.x}, ${newHead.z})`)
      this.onGameOver()
      return
    }

    // 撞自身
    for (const seg of this.snake) {
      if (seg.x === newHead.x && seg.z === newHead.z) {
        logger.warn(`撞自身! 位置: (${newHead.x}, ${newHead.z})`)
        this.onGameOver()
        return
      }
    }

    this.snake.unshift(newHead)

    // 吃食物
    if (newHead.x === this.foodPos.x && newHead.z === this.foodPos.z) {
      const gm = this.world?.gameMode as SnakeGameMode
      gm?.OnEatFood()
      this.spawnFood()
      logger.info(`吃食物! 蛇长: ${this.snake.length}`)
    } else {
      this.snake.pop()
    }

    logger.info(`移动: (${head.x}, ${head.z}) → (${newHead.x}, ${newHead.z}) | 蛇长: ${this.snake.length}`)
    this.rebuildSnake()
    // 更新全局游戏状态快照
    if (typeof window !== 'undefined') {
      (window as any).__snakeGameData = this.getSnapshot()
    }
  }

  /** 更新游戏摄像机位置（固定俯视 2.5D 视角，不跟随蛇头） */
  private updateGameCamera() {
    const cam = this.gameCamera.camera
    // 固定俯视整个棋盘，不跟随蛇头
    cam.position.set(0, 20, 0.01)
    cam.lookAt(0, 0, 0)
  }

  private onGameOver() {
    this.StopMoving()
    const gm = this.world?.gameMode as SnakeGameMode
    gm?.OnSnakeDied()
    if (typeof window !== 'undefined') {
      (window as any).__snakeGameData = this.getSnapshot()
    }
  }

  /** 获取游戏状态快照（供 MCP 查询） */
  getSnapshot() {
    const head = this.snake.length > 0 ? this.snake[0] : null
    return {
      phase: (this.world?.gameMode as SnakeGameMode)?.gameState.phase || 'waiting',
      score: (this.world?.gameMode as SnakeGameMode)?.gameState.score || 0,
      snakeLength: this.snake.length,
      headPosition: head ? { x: head.x, z: head.z } : null,
      foodPosition: { x: this.foodPos.x, z: this.foodPos.z },
      currentDirection: this.currentDir,
      pendingDirection: this.nextDir,
    }
  }

  // ═══ 3D 表现 ═══

  private rebuildSnake() {
    this.clearSnake()
    for (let i = 0; i < this.snake.length; i++) {
      const seg = this.snake[i]
      const geo = new THREE.BoxGeometry(this.config.cellSize * 0.9, 0.8, this.config.cellSize * 0.9)
      const mesh = new THREE.Mesh(geo, i === 0 ? this.headMat : this.bodyMat)
      mesh.position.set(seg.x, 0.4, seg.z)
      mesh.castShadow = true
      this.root.add(mesh)
      this.snakeMeshes.push(mesh)
    }
  }

  private clearSnake() {
    for (const m of this.snakeMeshes) {
      this.root.remove(m)
      m.geometry.dispose()
    }
    this.snakeMeshes = []
  }

  private spawnFood() {
    this.clearFood()
    const occupied = new Set(this.snake.map((s) => `${s.x},${s.z}`))
    let pos: Vec2
    do {
      pos = {
        x: Math.floor(Math.random() * this.config.gridSize) - this.config.gridHalf,
        z: Math.floor(Math.random() * this.config.gridSize) - this.config.gridHalf,
      }
    } while (occupied.has(`${pos.x},${pos.z}`))
    this.foodPos = pos

    const geo = new THREE.SphereGeometry(0.4, 12, 12)
    this.foodMesh = new THREE.Mesh(geo, this.foodMat)
    this.foodMesh.position.set(pos.x, 0.4, pos.z)
    this.foodMesh.castShadow = true
    this.root.add(this.foodMesh)
  }

  private clearFood() {
    if (this.foodMesh) {
      this.root.remove(this.foodMesh)
      this.foodMesh.geometry.dispose()
      this.foodMesh = null
    }
  }

  override EndPlay() {
    this.clearSnake()
    this.clearFood()
    this.headMat.dispose()
    this.bodyMat.dispose()
    this.foodMat.dispose()
    super.EndPlay()
  }

  getScore(): number {
    return (this.world?.gameMode as SnakeGameMode)?.gameState.score ?? 0
  }

  getSnakePositions(): Vec2[] {
    return [...this.snake]
  }

  getFoodPosition(): Vec2 {
    return { ...this.foodPos }
  }
}
