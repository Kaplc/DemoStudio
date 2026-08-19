/**
 * BoxMeshComponent — 轴对齐盒几何网格组件
 *
 * MeshComponent 的具体派生，几何类型固定为 THREE.BoxGeometry。
 * 蓝图声明用：
 *   { "baseClass": "BoxMeshComponent", "properties": { "size": [w,h,d], "color": "#ffffff" } }
 *
 * 推荐创建（默认形态：组件内部创建 BoxGeometry(1,1,1) + 白色 MeshBasicMaterial，
 * 外部只需设置尺寸（size/xyz）和材质球（setMaterial））：
 *   const actor = new GenericActor('Box')
 *   spawnActor(actor)
 *   const comp = actor.addComponent(BoxMeshComponent, 'BoxMesh') as BoxMeshComponent
 *   comp.size = [1, 2, 1]                                            // 尺寸 xyz
 *   comp.setMaterial(createMeshBasicMaterial({ color: 0xffffff }))   // 替换材质球
 *
 * 兼容创建（显式传入已建 mesh，scene 导入等路径仍走此形态）：
 *   const geo = createBoxGeometry(1, 1, 1)
 *   const mat = createMeshBasicMaterial({ color: 0xffffff })
 *   const mesh = createMesh(geo, mat)
 *   actor.addComponent(BoxMeshComponent, mesh, 'BoxMesh')
 *
 * 几何重建（size 变化）：自动走 createBoxGeometry + 旧 geo.dispose。
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import {
  createBoxGeometry,
  createBoxGeometryUntracked,
  createMesh,
  createMeshBasicMaterial,
  createMeshBasicMaterialUntracked,
  createMeshUntracked,
} from '../gameflow/ThreeObjectUtils'
import { GameInstance } from '../gameflow/GameInstance'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class BoxMeshComponent extends MeshComponent {
  /** 几何尺寸 [w, h, d] */
  private _size: [number, number, number] = [1, 1, 1]

  /**
   * 构造：
   *  - 第二参传 mesh → 显式挂载（scene 导入等路径）
   *  - 第二参省略 / 传字符串组件名 → 组件内部默认创建 BoxGeometry(1,1,1) + 白色 MeshBasicMaterial，
   *    外部后续只需设 size（xyz）与 setMaterial（材质球）
   */
  constructor(
    owner: Actor,
    meshOrName?: ConstructorParameters<typeof MeshComponent>[1] | string,
    name = 'BoxMeshComponent',
  ) {
    // 未传 mesh（或首参直接传组件名）→ 组件内部默认创建（走 utils → GC 追踪；无 live world 兜底 Untracked）
    const mesh = typeof meshOrName === 'string'
      ? BoxMeshComponent.createDefaultMesh()
      : (meshOrName ?? BoxMeshComponent.createDefaultMesh())
    const compName = typeof meshOrName === 'string' ? meshOrName : name
    super(owner, mesh, compName)
    // 从已挂载 mesh.geometry.parameters 推导真实尺寸（scene 导入路径）
    const g = this.obj.object.geometry
    const p = (g as THREE.BoxGeometry).parameters
    this._size = [p.width ?? 1, p.height ?? 1, p.depth ?? 1]
  }

  /** 默认网格：内部创建 BoxGeometry(1,1,1) + 白色 MeshBasicMaterial（走 utils；无 live world 时兜底 Untracked） */
  private static createDefaultMesh(): ConstructorParameters<typeof MeshComponent>[1] {
    if (GameInstance.current?.world) {
      return createMesh(createBoxGeometry(1, 1, 1), createMeshBasicMaterial())
    }
    return createMeshUntracked(createBoxGeometryUntracked(1, 1, 1), createMeshBasicMaterialUntracked())
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