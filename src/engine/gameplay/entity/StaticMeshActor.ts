/**
 * StaticMeshActor — 静态网格 Actor
 *
 * 包装一个 THREE.Mesh，使其参与 Actor 生命周期。
 * 用于 JSON 场景资产中的 sprite/box/plane/sphere 等静态对象，
 * 让它们能被 World.DestroyAllActors 统一清理。
 *
 * 用法：
 *   const actor = new StaticMeshActor(mesh, 'Seaweed')
 *   world.SpawnActor(actor)
 *   // 停止时由 DestroyAllActors 自动销毁并释放 geometry/material
 */
import * as THREE from 'three'
import { Actor } from './Actor'

export class StaticMeshActor extends Actor {
  private readonly meshes: THREE.Mesh[] = []

  constructor(mesh: THREE.Object3D, name = 'StaticMesh') {
    super(name)

    // 递归收集所有 Mesh
    mesh.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        this.meshes.push(node)
      }
    })

    // 将传入的 Object3D 挂到 Actor.root 下，保持世界变换
    this.root.add(mesh)
  }

  override EndPlay(): void {
    // 释放所有 Mesh 的 geometry 和 material
    for (const m of this.meshes) {
      m.geometry.dispose()
      if (Array.isArray(m.material)) {
        m.material.forEach((mat) => mat.dispose())
      } else {
        m.material.dispose()
      }
    }
    this.meshes.length = 0
    super.EndPlay()
  }
}
