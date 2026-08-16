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
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class CapsuleMeshComponent extends MeshComponent {
  /** 胶囊半径（可编辑属性） */
  private _radius: number
  /** 圆柱段长度（可编辑属性；0 = 纯球） */
  private _length: number

  constructor(
    owner: Actor,
    radius: number,
    length: number,
    color: number | string,
    name = 'CapsuleMeshComponent',
  ) {
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0, length), 4, 12)
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color) })
    super(owner, new THREE.Mesh(geo, mat), name)
    this._radius = radius
    this._length = Math.max(0, length)
  }

  /** 重建胶囊几何（尺寸变化时调用） */
  private rebuildCapsule(): void {
    const old = this.obj.object.geometry
    this.obj.object.geometry = new THREE.CapsuleGeometry(this._radius, this._length, 4, 12)
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

  /** 胶囊体可编辑属性：radius/length 尺寸 + color（几何类型固定胶囊，不可切换） */
  override getEditableProperties(): EditableProperty[] {
    const base = super.getEditableProperties()
    // 去掉 base 的 geometry/size（胶囊几何由 radius/length 参数化驱动）
    const rest = base.filter((p) => p.key !== 'geometry' && p.key !== 'size')
    return [
      {
        key: 'radius', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._radius * 100) / 100,
        set: (v) => {
          this._radius = Math.max(0.01, v as number)
          this.rebuildCapsule()
        },
      },
      {
        key: 'length', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._length * 100) / 100,
        set: (v) => {
          this._length = Math.max(0, v as number)
          this.rebuildCapsule()
        },
      },
      ...rest,
    ]
  }
}
