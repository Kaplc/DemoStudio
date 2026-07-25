/**
 * MeshComponent — 网格渲染组件
 *
 * 持有一个 THREE.Mesh，挂到 owner.root 下参与 Actor 生命周期。
 * EndPlay 时自动释放 geometry/material，避免资源泄漏。
 *
 * 替代 StaticMeshActor：任何需要直接持有 THREE.Mesh 的场景，
 * 创建一个 GenericActor（或其他 Actor 子类），然后 addComponent(new MeshComponent(...))。
 * 一个 Actor 可挂载多个 MeshComponent 以持有多个网格。
 *
 * 用法：
 *   const actor = new GenericActor('Cube')
 *   const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial())
 *   actor.addComponent(new MeshComponent(actor, mesh))
 *   world.SpawnActor(actor)
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'

export class MeshComponent extends Component {
  public mesh: THREE.Mesh

  constructor(owner: Actor, mesh: THREE.Mesh, name = 'MeshComponent') {
    super(owner)
    this.name = name
    this.mesh = mesh
    // 从原父节点移除，挂到 owner.root 下
    if (mesh.parent) mesh.parent.remove(mesh)
    owner.root.add(mesh)
  }

  override EndPlay(): void {
    this.mesh.geometry.dispose()
    if (Array.isArray(this.mesh.material)) {
      for (const mat of this.mesh.material) mat.dispose()
    } else {
      this.mesh.material.dispose()
    }
    super.EndPlay()
  }
}
