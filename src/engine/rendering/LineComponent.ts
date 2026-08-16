/**
 * LineComponent — 线框/线段渲染组件
 *
 * 管理一个 ThreeObject<THREE.Line | THREE.LineSegments>，挂到 owner.root 下参与 Actor 生命周期。
 * EndPlay 时自动释放（由 ThreeObject.dispose 统一负责）。
 *
 * 与 MeshComponent 的区别：MeshComponent 只接受 THREE.Mesh，
 * 需要线框（选中高亮、网格线等）时使用本组件。
 *
 * 用法（THREE 对象必须经 Game 工厂创建，禁止裸 new）：
 *   const actor = new GenericActor('Grid')
 *   const lines = game.createLine(new THREE.BufferGeometry(), new THREE.LineBasicMaterial())
 *   actor.addComponent(LineComponent, lines)
 *   world.SpawnActor(actor)
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import type { Actor } from '../entity/Actor'

export class LineComponent extends ThreeObjectComponent<ThreeObject<THREE.Line | THREE.LineSegments>> {
  public readonly obj: ThreeObject<THREE.Line | THREE.LineSegments>

  constructor(
    owner: Actor,
    lines: ThreeObject<THREE.Line | THREE.LineSegments> | (THREE.Line | THREE.LineSegments),
    name = 'LineComponent',
  ) {
    super(owner, name)
    this.obj = this.wrap(lines)
    // 从原父节点移除，挂到 owner.root 下
    this.attachToRoot(this.obj)
  }

  /** 便捷访问（语义化别名） */
  get lines(): THREE.Line | THREE.LineSegments {
    return this.obj.object
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      Geometry: this.obj.object.geometry.type,
      Visible: this.obj.object.visible,
    }
    const mat = this.obj.object.material
    if (!Array.isArray(mat)) {
      // 仅线条材质（LineBasicMaterial 等）有 color；兜底保护非线条材质
      const colored = mat as THREE.Material & { color?: THREE.Color }
      if (colored.color) {
        props['Color'] = `#${colored.color.getHexString()}`
        props['Opacity'] = round2(mat.opacity)
      }
    }
    return props
  }
}

/** 保留 2 位小数 */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
