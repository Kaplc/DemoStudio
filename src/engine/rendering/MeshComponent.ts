/**
 * MeshComponent — 网格渲染组件
 *
 * 持有一个 ThreeObject<THREE.Mesh>，挂到 owner.root 下参与 Actor 生命周期。
 * EndPlay 时自动释放（由 ThreeObject.dispose 统一负责）。
 *
 * 替代 StaticMeshActor：任何需要直接持有 THREE.Mesh 的场景，
 * 创建一个 GenericActor（或其他 Actor 子类），然后 addComponent(new MeshComponent(...))。
 * 一个 Actor 可挂载多个 MeshComponent 以持有多个网格。
 *
 * 用法（THREE 对象必须经 Game 工厂创建，禁止裸 new）：
 *   const actor = new GenericActor('Cube')
 *   const mesh = game.createMesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial())
 *   actor.addComponent(new MeshComponent(actor, mesh))
 *   world.SpawnActor(actor)
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import type { Actor } from '../entity/Actor'

export class MeshComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  constructor(owner: Actor, mesh: ThreeObject<THREE.Mesh> | THREE.Mesh, name = 'MeshComponent') {
    super(owner, name)
    this.obj = this.wrap(mesh)
    // 从原父节点移除，挂到 owner.root 下
    this.attachToRoot(this.obj)
  }

  /** 便捷访问（语义化别名） */
  get mesh(): THREE.Mesh {
    return this.obj.object
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      Geometry: this.obj.object.geometry.type,
      Visible: this.obj.object.visible,
    }
    const params = (this.obj.object.geometry as any).parameters as Record<string, unknown> | undefined
    if (params) {
      for (const key of ['width', 'height', 'depth', 'radius', 'segments']) {
        if (typeof params[key] === 'number') props[capitalize(key)] = round2(params[key] as number)
      }
    }
    return props
  }
}

/** 保留 2 位小数 */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 首字母大写 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
