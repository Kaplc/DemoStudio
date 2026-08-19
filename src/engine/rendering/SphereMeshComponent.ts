/**
 * SphereMeshComponent — 球体几何网格组件
 *
 * MeshComponent 的具体派生，几何类型固定为 THREE.SphereGeometry。
 * 蓝图声明用：
 *   { "baseClass": "SphereMeshComponent", "properties": { "radius": 0.5, "color": "#ff0000" } }
 *
 * 两阶段创建：
 *   const geo = createSphereGeometry(0.5)
 *   const mat = createMeshBasicMaterial({ color: 0xff0000 })
 *   const mesh = world.factory.createMesh(geo, mat)
 *   const comp = actor.addComponent(SphereMeshComponent, mesh, 'Marker') as SphereMeshComponent
 *   comp.radius = 0.5
 *   comp.color = '#ff0000'
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import { createSphereGeometry } from '../gameflow/ThreeObjectUtils'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class SphereMeshComponent extends MeshComponent {
  /** 球半径 */
  private _radius: number = 0.5

  constructor(
    owner: Actor,
    mesh: ConstructorParameters<typeof MeshComponent>[1],
    name = 'SphereMeshComponent',
  ) {
    super(owner, mesh, name)
    // 从已挂载 mesh.geometry.parameters 推导真实半径（入参可能是 ThreeObject，统一读 this.obj.object）
    const g = this.obj.object.geometry
    const p = (g as THREE.SphereGeometry).parameters
    this._radius = p.radius ?? 0.5
  }

  /** 半径 setter：写入后立即重建 SphereGeometry（走 factory） */
  set radius(v: number) {
    this._radius = Math.max(0.01, v)
    this.rebuildSphere()
  }
  get radius(): number {
    return this._radius
  }

  private rebuildSphere(): void {
    const old = this.obj.object.geometry
    this.obj.object.geometry = createSphereGeometry(this._radius, 16, 16)
    old.dispose()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null
    return {
      radius: Math.round(this._radius * 100) / 100,
      color: mat?.color ? `#${mat.color.getHexString()}` : '#ffffff',
      opacity: mat ? Math.round((mat.opacity ?? 1) * 100) / 100 : 1,
      visible: this.obj.object.visible,
    }
  }

  /** Sphere 可编辑属性：radius + 继承基类的 color/opacity/visible */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'radius', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._radius * 100) / 100,
        set: (v) => { this.radius = v as number },
      },
      ...super.getEditableProperties(),
    ]
  }
}