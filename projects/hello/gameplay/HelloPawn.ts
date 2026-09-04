/**
 * HelloPawn — 外部工程根示例：玩家化身（弹跳球）
 * 视觉构建在 BeginPlay()（actor.world 已就绪）中经 world 工厂创建，
 * 避免项目代码裸 new THREE 几何体/网格/材质（codeLint 违规）。
 */
import { Pawn } from '@/engine'

export class HelloPawn extends Pawn {
  private bodyMat: import('three').MeshStandardMaterial | null = null

  constructor() {
    super('HelloPawn')
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return

    this.bodyMat = w.createStandardMaterial({ color: 0x3aa0ff, roughness: 0.35, metalness: 0.1 })
    const body = w.createCustomMesh(w.createSphereGeometry(1, 24, 16), this.bodyMat)
    body.castShadow = true
    body.position.set(0, 1, 0)
    this.root.add(body)
  }

  override EndPlay(): void {
    this.bodyMat?.dispose()
    this.bodyMat = null
    super.EndPlay()
  }
}