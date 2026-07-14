/**
 * SpawnComponent — 生成点管理组件
 * 挂载到 GameMode，持有世界坐标生成点列表，负责在指定位置创建 Pawn
 *
 * 使用流程：
 *   1. GameMode.InitGame() 中配置生成点（AddSpawnPoint / AddGridSpawnPoint）
 *   2. GameMode.SpawnPlayer() 中先创建 Controller
 *   3. 通过 SpawnComponent.SpawnPawn() 在对应坐标位置创建 Pawn
 */
import * as THREE from 'three'
import { Component } from './Component'
import type { Pawn } from './Pawn'
import type { Actor } from './Actor'

export interface SpawnPoint {
  position: THREE.Vector3
  rotation: THREE.Euler
  name: string
}

export class SpawnComponent extends Component {
  private spawnPoints: SpawnPoint[] = []

  constructor(owner: Actor) {
    super(owner)
    this.name = 'SpawnComponent'
  }

  // ═══════════════════════════════════
  //  生成点管理
  // ═══════════════════════════════════

  /** 添加一个世界坐标生成点 */
  AddSpawnPoint(x: number, y: number, z: number, name?: string): void {
    this.spawnPoints.push({
      position: new THREE.Vector3(x, y, z),
      rotation: new THREE.Euler(0, 0, 0),
      name: name || `SpawnPoint_${this.spawnPoints.length}`,
    })
  }

  /** 添加一个网格坐标生成点（自动加上 +0.5 偏移对齐地砖中心） */
  AddGridSpawnPoint(gx: number, gz: number, y: number = 0, name?: string): void {
    this.AddSpawnPoint(gx + 0.5, y, gz + 0.5, name || `GridSpawn_(${gx},${gz})`)
  }

  /** 获取生成点数量 */
  GetSpawnPointCount(): number {
    return this.spawnPoints.length
  }

  /** 获取指定索引的生成点 */
  GetSpawnPoint(index: number): SpawnPoint | null {
    return this.spawnPoints[index] ?? null
  }

  /** 清除所有生成点 */
  ClearSpawnPoints(): void {
    this.spawnPoints = []
  }

  // ═══════════════════════════════════
  //  生成 Pawn
  // ═══════════════════════════════════

  /**
   * 在指定生成点生成 Pawn，设置其世界坐标后返回
   * @param pawn      要生成的 Pawn 实例
   * @param spawnIndex 生成点索引（默认 0）
   */
  SpawnPawn<T extends Pawn>(pawn: T, spawnIndex: number = 0): T {
    const pt = this.spawnPoints[spawnIndex]
    if (pt) {
      pawn.setPosition(pt.position.x, pt.position.y, pt.position.z)
      pawn.setRotation(pt.rotation.x, pt.rotation.y, pt.rotation.z)
    }
    return pawn
  }

  /**
   * 在指定的世界坐标生成 Pawn
   * @param pawn  要生成的 Pawn 实例
   * @param x, y, z 世界坐标
   */
  SpawnPawnAt<T extends Pawn>(pawn: T, x: number, y: number, z: number): T {
    pawn.setPosition(x, y, z)
    return pawn
  }
}
