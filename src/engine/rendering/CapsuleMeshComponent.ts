/**
 * CapsuleMeshComponent — 胶囊体网格组件（继承 MeshComponent）
 *
 * 蓝图资产声明模型胶囊体（兵种等角色）专用组件，与 MeshComponent 同族：
 * 持有一个 CapsuleGeometry 网格挂到 owner.root，随 Actor 生命周期自动释放。
 *
 * 注册：registerBuiltinComponents.ts 注册进 ComponentRegistry，
 * 蓝图组件声明为 { baseClass: 'CapsuleMeshComponent', properties: { radius, length, color, name? } }。
 * 几何体中心在胶囊体中心，贴地偏移由蓝图 TransformComponent 控制
 * （position.y = radius + length/2 使胶囊底部贴地 y=0）。
 *
 * 用法（蓝图资产 components 数组）：
 *   { "baseClass": "CapsuleMeshComponent", "properties": { "radius": 0.4, "length": 0.3, "color": "#e53935" } }
 *
 * 两阶段代码创建：
 *   const geo = createCapsuleGeometry(0.4, 0.3)
 *   const mat = createMeshStandardMaterial({ color: 0xe53935 })
 *   const mesh = world.factory.createMesh(geo, mat)
 *   const comp = actor.addComponent(CapsuleMeshComponent, mesh, 'Capsule') as CapsuleMeshComponent
 *   comp.radius = 0.4
 *   comp.length = 0.3
 *   comp.color = '#e53935'
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import { createCapsuleGeometry } from '../gameflow/ThreeObjectUtils'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class CapsuleMeshComponent extends MeshComponent {
  /** 胶囊半径（可编辑属性） */
  private _radius: number = 0.3
  /** 圆柱段长度（可编辑属性；0 = 纯球） */
  private _length: number = 0.3

  constructor(
    owner: Actor,
    mesh: ConstructorParameters<typeof MeshComponent>[1],
    name = 'CapsuleMeshComponent',
  ) {
    super(owner, mesh, name)
    // 从已挂载 mesh.geometry.parameters 推导（入参可能是 ThreeObject，统一读 this.obj.object）
    const g = this.obj.object.geometry as THREE.CapsuleGeometry
    const p = g?.parameters as { radius?: number; length?: number } | undefined
    if (p?.radius !== undefined) this._radius = p.radius
    if (p?.length !== undefined) this._length = p.length
  }

  /** 半径 setter */
  set radius(v: number) {
    this._radius = Math.max(0.01, v)
    this.rebuildCapsule()
  }
  get radius(): number {
    return this._radius
  }

  /** 长度 setter（0 = 纯球） */
  set length(v: number) {
    this._length = Math.max(0, v)
    this.rebuildCapsule()
  }
  get length(): number {
    return this._length
  }

  /** 重建胶囊几何（尺寸变化时调用） */
  private rebuildCapsule(): void {
    const old = this.obj.object.geometry
    this.obj.object.geometry = createCapsuleGeometry(this._radius, this._length, 4, 12)
    old.dispose()
  }

  /** Inspector 属性展示（key 与 getEditableProperties 一致，camelCase） */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial | null
    return {
      radius: Math.round(this._radius * 100) / 100,
      length: Math.round(this._length * 100) / 100,
      color: mat?.color ? `#${mat.color.getHexString()}` : '#ffffff',
      opacity: mat ? Math.round((mat.opacity ?? 1) * 100) / 100 : 1,
      visible: this.obj.object.visible,
    }
  }

  /** 胶囊体可编辑属性：radius/length 尺寸 + 继承基类的 color/opacity/visible */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'radius', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._radius * 100) / 100,
        set: (v) => { this.radius = v as number },
      },
      {
        key: 'length', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._length * 100) / 100,
        set: (v) => { this.length = v as number },
      },
      ...super.getEditableProperties(),
    ]
  }
}