/**
 * 贪吃蛇游戏逻辑 — Three.js 版（遗留实现，保留参考）
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

  init(options?: { skipArena?: boolean }) {
    if (!options?.skipArena) {
      const sceneGroup = this.scene3D.build({ gridSize: this.config.gridSize })
      this.group.add(sceneGroup.group)
    }
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
    this.clearSnake()
    this.clearFood()

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

    this.rebuildSnake()
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
      mesh.position.set(seg.x + 0.5, 0.4, seg.z + 0.5)
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
    this.foodMesh.position.set(pos.x + 0.5, 0.4, pos.z + 0.5)
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
}
