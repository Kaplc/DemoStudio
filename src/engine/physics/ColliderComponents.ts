/**
 * BoxColliderComponent / CircleColliderComponent / CapsuleColliderComponent
 * — 三个具体碰撞体组件（注册进 ComponentRegistry，供蓝图 baseClass 引用）
 *
 * 通用能力全部继承 ColliderComponent（碰撞事件/分层/dynamic 速度注入/位置回写），
 * 此处只实现形状创建与 gizmos 绘制。
 *
 * 蓝图配置示例（建筑，static）：
 *   { "baseClass": "BoxColliderComponent",
 *     "properties": { "size": [1.6, 1.6, 1.6], "bodyType": "static",
 *                     "group": "building", "mask": ["troop", "building"] } }
 *
 * 蓝图配置示例（兵，dynamic 速度注入）：
 *   { "baseClass": "CircleColliderComponent",
 *     "properties": { "radius": 0.4, "bodyType": "dynamic", "mass": 1,
 *                     "group": "troop", "mask": ["troop", "building"] } }
 */
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { ColliderComponent } from './ColliderComponent'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'
import { colliderGizmos } from './ColliderGizmos'

/** 碰撞盒线框可视化颜色（按 bodyType 区分：建筑绿 / 兵橙） */
const GIZMO_COLOR_STATIC = 0x00e676
const GIZMO_COLOR_DYNAMIC = 0xff9100

// ════════════════════════════════════════════
//  Box — 盒形碰撞体（建筑）
// ════════════════════════════════════════════

export class BoxColliderComponent extends ColliderComponent {
  /** 盒尺寸（全宽，abc = x/y/z） */
  size: [number, number, number] = [1, 1, 1]

  constructor(owner: Actor) {
    super(owner)
    this.name = 'BoxColliderComponent'
  }

  protected override createShape(): CANNON.Shape {
    return new CANNON.Box(new CANNON.Vec3(this.size[0] / 2, this.size[1] / 2, this.size[2] / 2))
  }

  override get boundRadiusXZ(): number {
    return Math.max(this.size[0], this.size[2]) / 2
  }

  /** Box 尺寸可编辑（size 逐分量经 vec3 控件） */
  override getEditableProperties(): EditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        key: 'size', type: 'vec3', step: 0.1, min: 0,
        get: () => [this.size[0], this.size[1], this.size[2]] as [number, number, number],
        set: (v) => { const a = v as [number, number, number]; this.size = [Math.max(0.01, a[0]), Math.max(0.01, a[1]), Math.max(0.01, a[2])] },
      },
    ]
  }

  override OnDrawGizmos(): void {
    if (!colliderGizmos.enabled || !this.body) return
    colliderGizmos.setColor(this.bodyType === 'static' ? GIZMO_COLOR_STATIC : GIZMO_COLOR_DYNAMIC)
    const p = this.body.position
    colliderGizmos.drawWireBox(
      this._gizmoCenter.set(p.x, p.y, p.z),
      this.size[0], this.size[1], this.size[2],
    )
  }
}

// ════════════════════════════════════════════
//  Circle — 圆形碰撞体（球状；俯视角即圆柱形碰撞范围）
// ════════════════════════════════════════════

export class CircleColliderComponent extends ColliderComponent {
  /** 半径（xz 平面投影圆） */
  radius = 0.5
  /** 高度（cannon Cylinder 半高 = height/2；俯视角地面兵默认 1） */
  height = 1

  constructor(owner: Actor) {
    super(owner)
    this.name = 'CircleColliderComponent'
  }

  protected override createShape(): CANNON.Shape {
    // 俯视角：圆 = 竖直圆柱（cannon Cylinder 轴向为 y）
    return new CANNON.Cylinder(this.radius, this.radius, this.height, 12)
  }

  override get boundRadiusXZ(): number {
    return this.radius
  }

  /** Circle 尺寸可编辑（radius/height） */
  override getEditableProperties(): EditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        key: 'radius', type: 'number', step: 0.05, min: 0.01,
        get: () => this.radius,
        set: (v) => { this.radius = Math.max(0.01, v as number) },
      },
      {
        key: 'height', type: 'number', step: 0.05, min: 0.1,
        get: () => this.height,
        set: (v) => { this.height = Math.max(0.1, v as number) },
      },
    ]
  }

  override OnDrawGizmos(): void {
    if (!colliderGizmos.enabled || !this.body) return
    colliderGizmos.setColor(this.bodyType === 'static' ? GIZMO_COLOR_STATIC : GIZMO_COLOR_DYNAMIC)
    const p = this.body.position
    // 俯视圆环（y=地面处）+ 顶部圆环，直观显示圆柱碰撞范围
    colliderGizmos.drawRing(this._gizmoCenter.set(p.x, p.y - this.height / 2, p.z), this.radius)
    colliderGizmos.drawRing(this._gizmoCenter.set(p.x, p.y + this.height / 2, p.z), this.radius)
  }
}

// ════════════════════════════════════════════
//  Capsule — 胶囊碰撞体（角色）
// ════════════════════════════════════════════

export class CapsuleColliderComponent extends ColliderComponent {
  /** 胶囊半径 */
  radius = 0.35
  /** 圆柱段长度（总高 = length + 2*radius） */
  length = 0.6

  constructor(owner: Actor) {
    super(owner)
    this.name = 'CapsuleColliderComponent'
  }

  protected override createShape(): CANNON.Shape {
    // cannon-es 无原生 Capsule：中心球体 + BeginPlay 后补挂上下两个偏移球近似
    return new CANNON.Sphere(this.radius)
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 上下半球追加（createShape 只能返回单形状；组合形状在 body 创建后补挂）
    const body = this.body
    if (body) {
      const half = this.length / 2
      body.addShape(new CANNON.Sphere(this.radius), new CANNON.Vec3(0, half, 0))
      body.addShape(new CANNON.Sphere(this.radius), new CANNON.Vec3(0, -half, 0))
      body.updateBoundingRadius()
    }
  }

  override get boundRadiusXZ(): number {
    return this.radius
  }

  /** Capsule 尺寸可编辑（radius/length） */
  override getEditableProperties(): EditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        key: 'radius', type: 'number', step: 0.05, min: 0.01,
        get: () => this.radius,
        set: (v) => { this.radius = Math.max(0.01, v as number) },
      },
      {
        key: 'length', type: 'number', step: 0.05, min: 0,
        get: () => this.length,
        set: (v) => { this.length = Math.max(0, v as number) },
      },
    ]
  }

  override OnDrawGizmos(): void {
    if (!colliderGizmos.enabled || !this.body) return
    colliderGizmos.setColor(this.bodyType === 'static' ? GIZMO_COLOR_STATIC : GIZMO_COLOR_DYNAMIC)
    const p = this.body.position
    const half = this.length / 2
    // 轮廓：上下两个圆环 + 4 条竖边
    colliderGizmos.drawRing(this._gizmoCenter.set(p.x, p.y + half, p.z), this.radius)
    colliderGizmos.drawRing(this._gizmoCenter.set(p.x, p.y - half, p.z), this.radius)
    colliderGizmos.drawVerticalEdges(p, this.radius, half)
  }
}
