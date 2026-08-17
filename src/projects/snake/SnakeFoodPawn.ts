/**
 * SnakeFoodPawn — 贪吃蛇食物角色
 * 继承 Pawn，拥有食物球体网格，由 GameMode 通过 SpawnComponent 创建和放置
 *
 * 视觉构建：在 BeginPlay()（actor.world 已就绪）中通过 world 工厂创建，
 * 避免项目代码裸 new THREE.<几何体/网格/材质> 触发 CodeLint 违规。
 */
import * as THREE from 'three'
import { Pawn, gizmos } from '@/engine'

export class SnakeFoodPawn extends Pawn {
  private mesh!: THREE.Mesh
  private material!: THREE.MeshStandardMaterial

  constructor() {
    super('SnakeFoodPawn')
  }

  /** 构建 3D 视觉（BeginPlay 时 actor.world 已就绪；此阶段才创建 THREE 资源） */
  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return

    this.material = w.createStandardMaterial({
      color: 0xff4444,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0xff2222,
      emissiveIntensity: 0.3,
    })

    const geo = w.createSphereGeometry(0.4, 12, 12)
    this.mesh = w.createCustomMesh(geo, this.material)
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

  /** 绘制食物拾取范围（黄色线框球） */
  override OnDrawGizmos() {
    gizmos.color = 0xffe600
    gizmos.DrawWireSphere(this.position, 0.7, 12)
  }

  override EndPlay() {
    if (this.mesh) {
      this.root.remove(this.mesh)
      this.mesh.geometry.dispose()
    }
    if (this.material) this.material.dispose()
    super.EndPlay()
  }
}