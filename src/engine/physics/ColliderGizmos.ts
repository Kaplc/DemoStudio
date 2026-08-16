/**
 * colliderGizmos — 碰撞盒线框可视化开关（编辑器/运行时共用）
 *
 * 控制碰撞体组件 OnDrawGizmos 是否实际绘制：
 *  - 默认显示（true）
 *  - 快捷键 V 切换（KeyboardShortcuts 派发 shortcut-toggle-collider-gizmos 事件）
 *
 * 独立成模块的原因：引擎组件（engine/physics）不能依赖编辑器（editor/），
 * 开关状态放引擎侧，编辑器只负责改值。绘制直接走引擎 gizmos 单例（即时模式，
 * Game 视口随 World.drawGizmos 每帧驱动）。
 */
import * as THREE from 'three'
import { gizmos } from '../tools/Gizmos'

class ColliderGizmosState {
  private _enabled = true

  /** 与 gizmos 全局开关独立（gizmos 关时 beginFrame 清空画面，自然隐藏） */
  get enabled(): boolean {
    return this._enabled
  }

  setEnabled(v: boolean): void {
    this._enabled = v
  }

  toggle(): boolean {
    this._enabled = !this._enabled
    return this._enabled
  }

  setColor(c: number): void {
    gizmos.color = c
  }

  private _v = new THREE.Vector3()
  private _size = new THREE.Vector3()
  private _up = new THREE.Vector3(0, 1, 0)
  private _end = new THREE.Vector3()

  /** 画中心 + 全尺寸的线框盒 */
  drawWireBox(center: THREE.Vector3, sx: number, sy: number, sz: number): void {
    gizmos.DrawWireCube(center, this._size.set(sx, sy, sz))
  }

  /** 画水平圆环（俯视角圆/胶囊轮廓） */
  drawRing(center: THREE.Vector3, radius: number): void {
    gizmos.DrawCircle(center, this._up, radius, 24)
  }

  /** 画胶囊 4 条竖边 */
  drawVerticalEdges(p: { x: number; y: number; z: number }, r: number, half: number): void {
    const pts: Array<[number, number]> = [[r, 0], [-r, 0], [0, r], [0, -r]]
    for (const [dx, dz] of pts) {
      gizmos.DrawLine(
        this._v.set(p.x + dx, p.y - half, p.z + dz),
        this._end.set(p.x + dx, p.y + half, p.z + dz),
      )
    }
  }
}

export const colliderGizmos = new ColliderGizmosState()
