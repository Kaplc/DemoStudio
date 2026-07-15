/**
 * SnakeFoodPawn — 贪吃蛇食物角色
 * 继承 Pawn，拥有食物球体网格，由 GameMode 通过 SpawnComponent 创建和放置
 */
import * as THREE from 'three'
import { Pawn } from '@/engine'
import { DEFAULT_CONFIG } from './types'

export class SnakeFoodPawn extends Pawn {
  private mesh: THREE.Mesh
  private material: THREE.MeshStandardMaterial

  constructor() {
    super('SnakeFoodPawn')

    this.material = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0xff2222,
      emissiveIntensity: 0.3,
    })

    const geo = new THREE.SphereGeometry(0.4, 12, 12)
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.castShadow = true
    this.root.add(this.mesh)
  }

  /**
   * 将食物放置到网格坐标 (gx, gz)
   * 自动 +0.5 偏移以对齐地砖中心
   */
  SpawnAtGrid(gx: number, gz: number): void {
    this.setPosition(gx + 0.5, 0.4, gz + 0.5)
  }

  override EndPlay() {
    this.root.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.material.dispose()
    super.EndPlay()
  }
}
