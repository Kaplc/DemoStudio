/**
 * 贪吃蛇游戏逻辑 — Three.js 版
 * 完整移植自 Python/Panda3D 版本
 */
import * as THREE from 'three'
import { SnakeScene3D } from './Scene3D'
import {
  type Vec2,
  type Direction,
  type GameConfig,
  type GameStatus,
  DEFAULT_CONFIG,
  DIRECTION_VECTORS,
} from './types'

export class SnakeGame {
  // ─── 配置 ───
  private config: GameConfig
  private scene3D: SnakeScene3D

  // ─── 场景对象 ───
  public group: THREE.Group
  private foodMesh: THREE.Mesh | null = null
  private snakeMeshes: THREE.Mesh[] = []

  // ─── 游戏状态 ───
  private snake: Vec2[] = []
  private foodPos: Vec2 = { x: 0, z: 0 }
  private currentDir: Vec2 = { x: 1, z: 0 }
  private nextDir: Vec2 = { x: 1, z: 0 }
  private status: GameStatus = 'idle'
  private score = 0
  private moveTimer = 0

  // ─── 材质缓存 ───
  private headMat: THREE.MeshStandardMaterial
  private bodyMat: THREE.MeshStandardMaterial
  private foodMat: THREE.MeshStandardMaterial

  // ─── 回调 ───
  public onScoreChange?: (score: number) => void
  public onStatusChange?: (status: GameStatus) => void

  constructor() {
    this.config = { ...DEFAULT_CONFIG }
    this.scene3D = new SnakeScene3D()
    this.group = new THREE.Group()

    // 材质
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x44ff88,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x22ff66,
      emissiveIntensity: 0.2,
    })
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x33cc77,
      roughness: 0.4,
      metalness: 0.1,
    })
    this.foodMat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0xff2222,
      emissiveIntensity: 0.3,
    })
  }

  // ─── 生命周期 ───

  init() {
    // 构建 3D 场景
    const sceneGroup = this.scene3D.build(this.config.gridSize)
    this.group.add(sceneGroup)

    this.reset()
  }

  start() {
    if (this.status === 'gameover') {
      this.reset()
    }
    this.status = 'running'
    this.moveTimer = 0
    this.onStatusChange?.(this.status)
  }

  stop() {
    this.status = 'idle'
    this.onStatusChange?.(this.status)
  }

  reset() {
    // 清除蛇
    this.clearSnake()
    this.clearFood()

    // 重置状态
    const half = this.config.gridHalf
    this.snake = [
      { x: 0, z: 0 },
      { x: -1, z: 0 },
      { x: -2, z: 0 },
    ]
    this.currentDir = { x: 1, z: 0 }
    this.nextDir = { x: 1, z: 0 }
    this.score = 0
    this.moveTimer = 0
    this.status = 'idle'

    // 重建蛇
    this.rebuildSnake()

    // 生成食物
    this.spawnFood()

    this.onScoreChange?.(this.score)
    this.onStatusChange?.(this.status)
  }

  dispose() {
    this.clearSnake()
    this.clearFood()
    this.scene3D.dispose()
    this.headMat.dispose()
    this.bodyMat.dispose()
    this.foodMat.dispose()
  }

  // ─── 蛇管理 ───

  private rebuildSnake() {
    this.clearSnake()
    const half = this.config.cellSize / 2
    for (let i = 0; i < this.snake.length; i++) {
      const seg = this.snake[i]
      const isHead = i === 0
      const geo = new THREE.BoxGeometry(this.config.cellSize * 0.9, 0.8, this.config.cellSize * 0.9)
      const mat = isHead ? this.headMat : this.bodyMat
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(seg.x, 0.4, seg.z)
      mesh.castShadow = true
      this.group.add(mesh)
      this.snakeMeshes.push(mesh)
    }
  }

  private clearSnake() {
    for (const mesh of this.snakeMeshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.snakeMeshes = []
  }

  // ─── 食物管理 ───

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
    this.group.add(this.foodMesh)
  }

  private clearFood() {
    if (this.foodMesh) {
      this.group.remove(this.foodMesh)
      this.foodMesh.geometry.dispose()
      this.foodMesh = null
    }
  }

  // ─── 输入 ───

  setDirection(dir: Direction) {
    const vec = DIRECTION_VECTORS[dir]
    // 禁止 180 度掉头
    if (vec.x + this.currentDir.x === 0 && vec.z + this.currentDir.z === 0) {
      return
    }
    this.nextDir = vec
  }

  // ─── 更新 ───

  update(dt: number) {
    if (this.status !== 'running') return

    this.moveTimer += dt
    if (this.moveTimer < this.config.moveInterval) return
    this.moveTimer = 0

    this.moveSnake()
  }

  private moveSnake() {
    this.currentDir = { ...this.nextDir }

    // 计算新头部位置
    const head = this.snake[0]
    const newHead: Vec2 = {
      x: head.x + this.currentDir.x,
      z: head.z + this.currentDir.z,
    }

    // 碰撞检测：墙壁
    const half = this.config.gridHalf
    if (Math.abs(newHead.x) >= half || Math.abs(newHead.z) >= half) {
      this.gameOver()
      return
    }

    // 碰撞检测：自身
    for (const seg of this.snake) {
      if (seg.x === newHead.x && seg.z === newHead.z) {
        this.gameOver()
        return
      }
    }

    // 移动蛇
    this.snake.unshift(newHead)

    // 吃食物
    if (newHead.x === this.foodPos.x && newHead.z === this.foodPos.z) {
      this.score++
      this.onScoreChange?.(this.score)
      this.spawnFood()
    } else {
      this.snake.pop()
    }

    // 更新 3D 表现
    this.rebuildSnake()
  }

  private gameOver() {
    this.status = 'gameover'
    this.onStatusChange?.(this.status)
  }

  // ─── 状态查询 ───

  getStatus(): GameStatus {
    return this.status
  }

  getScore(): number {
    return this.score
  }

  getSnakePositions(): Vec2[] {
    return [...this.snake]
  }

  getFoodPosition(): Vec2 {
    return { ...this.foodPos }
  }
}
