/**
 * PlaneMeshComponent — 平面几何网格组件
 *
 * MeshComponent 的具体派生，几何类型固定为 THREE.PlaneGeometry。
 * 蓝图声明用：
 *   { "baseClass": "PlaneMeshComponent", "properties": { "size": [w, h], "color": "#7cb342" } }
 *
 * 两阶段创建：
 *   const geo = createPlaneGeometry(10, 10)
 *   const mat = createMeshBasicMaterial({ color: 0x7cb342 })
 *   const mesh = world.factory.createMesh(geo, mat)
 *   const comp = actor.addComponent(PlaneMeshComponent, mesh, 'Ground') as PlaneMeshComponent
 *   comp.size = [10, 10]
 *   comp.color = '#7cb342'
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import { createPlaneGeometry } from '../gameflow/ThreeObjectUtils'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class PlaneMeshComponent extends MeshComponent {
  /** 平面尺寸 [w, h] */
  private _size: [number, number] = [1, 1]

  constructor(
    owner: Actor,
    mesh: ConstructorParameters<typeof MeshComponent>[1],
    name = 'PlaneMeshComponent',
  ) {
    super(owner, mesh, name)
    const g = (mesh as THREE.Mesh).geometry
    const p = (g as THREE.PlaneGeometry).parameters
    this._size = [p.width ?? 1, p.height ?? 1]
  }

  /** 尺寸 setter：写入后立即重建 PlaneGeometry（走 factory） */
  set size(v: [number, number]) {
    this._size = v
    this.rebuildPlane()
  }
  get size(): [number, number] {
    return this._size
  }

  private rebuildPlane(): void {
    const old = this.obj.object.geometry
    const [w, h] = this._size
    this.obj.object.geometry = createPlaneGeometry(w || 1, h || 1)
    old.dispose()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null
    return {
      size: [...this._size],
      color: mat?.color ? `#${mat.color.getHexString()}` : '#ffffff',
      opacity: mat ? Math.round((mat.opacity ?? 1) * 100) / 100 : 1,
      visible: this.obj.object.visible,
    }
  }

  /** Plane 可编辑属性：size + 继承基类的 color/opacity/visible */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'size', type: 'vec3', step: 0.1,
        get: () => [...this._size, 0],
        set: (v) => {
          const arr = v as number[]
          this.size = [arr[0] ?? 1, arr[1] ?? 1]
        },
      },
      ...super.getEditableProperties(),
    ]
  }
}