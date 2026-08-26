/**
 * SnakePawn — 贪吃蛇角色
 * 继承 Pawn，拥有蛇身网格、移动、碰撞、进食逻辑
 *
 * 视觉构建：在 BeginPlay()（actor.world 已就绪）中创建材质；rebuildSnake 中
 * 通过 world 工厂创建 BoxGeometry / Mesh —— 避免项目代码裸 new
 * THREE.<几何体/网格/材质> 触发 CodeLint 违规。
 */
import * as THREE from 'three'
import { Pawn, logger, gizmos } from '@/engine'
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

// Gizmos 复用临时对象（避免每帧分配）
const _segPos = new THREE.Vector3()
const _segSize = new THREE.Vector3(DEFAULT_CONFIG.cellSize * 0.9, 0.8, DEFAULT_CONFIG.cellSize * 0.9)
const _headDir = new THREE.Vector3()

export class SnakePawn extends Pawn {
  private config: GameConfig

  // 游戏状态
  private snake: Vec2[] = []
  private currentDir: Vec2 = { x: 1, z: 0 }
  private nextDir: Vec2 = { x: 1, z: 0 }
  private moveTimer = 0

  // 3D 对象
  private snakeMeshes: THREE.Mesh[] = []

  // 材质
  private headMat!: THREE.MeshStandardMaterial
  private bodyMat!: THREE.MeshStandardMaterial

  constructor() {
    super('SnakePawn')
    this.config = { ...DEFAULT_CONFIG }
  }

  /** 构建材质（BeginPlay 时 actor.world 已就绪；此阶段才创建 THREE 资源） */
  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return

    this.headMat = w.createStandardMaterial({
      color: 0x44ff88, roughness: 0.3, metalness: 0.1,
      emissive: 0x22ff66, emissiveIntensity: 0.2,
    })
    this.bodyMat = w.createStandardMaterial({
      color: 0x33cc77, roughness: 0.4, metalness: 0.1,
    })
  }

  /** 由 GameMode 在生成时调用 */
  InitGame() {
    this.resetState()
    this.rebuildSnake()
    if (typeof window !== 'undefined') {
      (window as any).__snakeGameData = this.getSnapshot()
    }
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

    // 撞墙（棋盘格范围 -half ≤ x < half, -half ≤ z < half）
    const half = this.config.gridHalf
    if (newHead.x < -half || newHead.x >= half || newHead.z < -half || newHead.z >= half) {
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

    // 吃食物（从 GameMode 获取食物位置）
    const gm = this.world?.gameMode as SnakeGameMode
    const foodPos = gm?.getFoodGridPosition()
    if (foodPos && newHead.x === foodPos.x && newHead.z === foodPos.z) {
      gm?.OnEatFood(this.snake)
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
    const gm = this.world?.gameMode as SnakeGameMode
    const foodPos = gm?.getFoodGridPosition() ?? { x: 0, z: 0 }
    return {
      phase: gm?.gameState.phase || 'waiting',
      score: gm?.gameState.score || 0,
      snakeLength: this.snake.length,
      headPosition: head ? { x: head.x, z: head.z } : null,
      foodPosition: { x: foodPos.x, z: foodPos.z },
      currentDirection: this.currentDir,
      pendingDirection: this.nextDir,
    }
  }

  // ═══ 3D 表现 ═══

  private rebuildSnake() {
    this.clearSnake()
    const w = this.world
    if (!w) return
    for (let i = 0; i < this.snake.length; i++) {
      const seg = this.snake[i]
      const geo = w.createBoxGeometry(this.config.cellSize * 0.9, 0.8, this.config.cellSize * 0.9)
      const mesh = w.createCustomMesh(geo, i === 0 ? this.headMat : this.bodyMat)
      mesh.position.set(seg.x + 0.5, 0.4, seg.z + 0.5)
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

  override EndPlay() {
    this.clearSnake()
    if (this.headMat) this.headMat.dispose()
    if (this.bodyMat) this.bodyMat.dispose()
    super.EndPlay()
  }

  getScore() {
    return (this.world?.gameMode as SnakeGameMode)?.gameState.score ?? 0
  }

  getSnakePositions(): Vec2[] {
    return [...this.snake]
  }

  // ═══ Gizmos 调试绘制 ═══

  /** 绘制蛇身格子（青色线框）+ 蛇头朝向（红色射线） */
  override OnDrawGizmos() {
    const base = this.position

    // 蛇身每一节的线框
    gizmos.color = 0x00e5ff
    for (const seg of this.snake) {
      _segPos.set(seg.x + 0.5, 0.4, seg.z + 0.5).add(base)
      gizmos.DrawWireCube(_segPos, _segSize)
    }

    // 蛇头移动方向射线
    if (this.snake.length > 0) {
      const head = this.snake[0]
      _segPos.set(head.x + 0.5, 0.4, head.z + 0.5).add(base)
      _headDir.set(this.currentDir.x, 0, this.currentDir.z)
      gizmos.color = 0xff3030
      gizmos.DrawRay(_segPos, _headDir, 3)
    }
  }
}