/**
 * BoxMeshComponent — 轴对齐盒几何网格组件
 *
 * MeshComponent 的具体派生，几何类型固定为 THREE.BoxGeometry。
 * 蓝图声明用：
 *   { "baseClass": "BoxMeshComponent", "properties": { "size": [w,h,d], "color": "#ffffff" } }
 *
 * 两阶段创建（推荐）：
 *   const actor = new GenericActor('Box')
 *   spawnActor(actor)
 *   const geo = createBoxGeometry(1, 1, 1)
 *   const mat = createMeshBasicMaterial({ color: 0xffffff })
 *   const mesh = world.factory.createMesh(geo, mat)
 *   const comp = actor.addComponent(BoxMeshComponent, mesh, 'BoxMesh') as BoxMeshComponent
 *   comp.size = [1, 1, 1]
 *   comp.color = '#ffffff'
 *   comp.opacity = 0.5
 *
 * 几何重建（size 变化）：自动走 world.factory.createBoxGeometry + 旧 geo.dispose。
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import { createBoxGeometry } from '../gameflow/ThreeObjectUtils'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class BoxMeshComponent extends MeshComponent {
  /** 几何尺寸 [w, h, d] */
  private _size: [number, number, number] = [1, 1, 1]

  constructor(
    owner: Actor,
    mesh: ConstructorParameters<typeof MeshComponent>[1],
    name = 'BoxMeshComponent',
  ) {
    super(owner, mesh, name)
    // 从已挂载 mesh.geometry.parameters 推导真实尺寸（scene 导入路径）
    const g = (mesh as THREE.Mesh).geometry
    const p = (g as THREE.BoxGeometry).parameters
    this._size = [p.width ?? 1, p.height ?? 1, p.depth ?? 1]
  }

  /** 尺寸 setter：写入后立即重建 BoxGeometry（dispose 旧几何） */
  set size(v: [number, number, number]) {
    this._size = v
    this.rebuildBox()
  }
  get size(): [number, number, number] {
    return this._size
  }

  /** 重建 BoxGeometry（尺寸变化时调用）。走 utils 集中处理 world 守卫（追踪 GC / 兜底 Untracked）。 */
  private rebuildBox(): void {
    const old = this.obj.object.geometry
    const [w, h, d] = this._size
    this.obj.object.geometry = createBoxGeometry(w || 1, h || 1, d || 1)
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

  /** Box 可编辑属性：size 三维尺寸 + 继承基类的 color/opacity/visible */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'size', type: 'vec3', step: 0.1,
        get: () => [...this._size],
        set: (v) => { this.size = v as [number, number, number] },
      },
      ...super.getEditableProperties(),
    ]
  }
}