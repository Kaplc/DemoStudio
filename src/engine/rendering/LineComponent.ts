/**
 * LineComponent — 线框/线段渲染组件
 *
 * 管理一个 THREE.LineSegments / THREE.Line 对象，挂到 owner.root 下参与 Actor 生命周期。
 * EndPlay 时自动释放 geometry/material，避免资源泄漏。
 *
 * 与 MeshComponent 的区别：MeshComponent 只接受 THREE.Mesh，
 * 需要线框（选中高亮、网格线等）时使用本组件。
 *
 * 用法：
 *   const actor = new GenericActor('Grid')
 *   const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial())
 *   actor.addComponent(new LineComponent(actor, lines))
 *   world.SpawnActor(actor)
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'

export class LineComponent extends Component<Actor> {
  public lines: THREE.Line | THREE.LineSegments

  constructor(owner: Actor, lines: THREE.Line | THREE.LineSegments, name = 'LineComponent') {
    super(owner)
    this.name = name
    this.lines = lines
    // 从原父节点移除，挂到 owner.root 下
    if (lines.parent) lines.parent.remove(lines)
    owner.root.add(lines)
  }

  override EndPlay(): void {
    this.lines.geometry.dispose()
    const mat = this.lines.material
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose()
    } else {
      mat.dispose()
    }
    super.EndPlay()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      Geometry: this.lines.geometry.type,
      Visible: this.lines.visible,
    }
    const mat = this.lines.material
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
