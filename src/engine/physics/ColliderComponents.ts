/**
 * BoxColliderComponent / CircleColliderComponent / CapsuleColliderComponent
 * — 三个具体碰撞体组件（注册进 ComponentRegistry，供蓝图 baseClass 引用）
 *
 * 通用能力（碰撞事件/分层/dynamic 速度注入/位置回写）继承 ColliderComponent，
 * 此处实现形状创建与 gizmos 绘制：各自 override OnDrawGizmos 直接画线框，
 * 绘制中心经基类 resolveGizmoCenterInto（游戏用 body / 预览回退属性中心）。
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
import { gizmos } from '../tools/Gizmos'

/** 碰撞盒线框统一颜色（绿色） */
const GIZMO_COLOR = 0x00e676

// ─── 复用临时向量（gizmos 写入即时拷贝数值，复用安全）───
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _size = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
/** 竖边方向极点（乘以半径得 xz 平面 ±r、±r 四点） */
const VERTICAL_DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

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

  /** 线框：12 边盒 */
  override OnDrawGizmos(): void {
    const center = this.resolveGizmoCenterInto(this._gizmoCenter)
    gizmos.setColor(GIZMO_COLOR)
    gizmos.DrawWireCube(center, _size.set(this.size[0], this.size[1], this.size[2]))
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

  /** 线框：上下两环（XZ 平面）+ 4 条侧边竖线（竖直圆柱轮廓） */
  override OnDrawGizmos(): void {
    const center = this.resolveGizmoCenterInto(this._gizmoCenter)
    gizmos.setColor(GIZMO_COLOR)
    const half = this.height / 2
    gizmos.DrawCircle(_a.set(center.x, center.y - half, center.z), _up, this.radius, 24)
    gizmos.DrawCircle(_a.set(center.x, center.y + half, center.z), _up, this.radius, 24)
    for (const [ux, uz] of VERTICAL_DIRS) {
      const dx = ux * this.radius
      const dz = uz * this.radius
      gizmos.DrawLine(
        _a.set(center.x + dx, center.y - half, center.z + dz),
        _b.set(center.x + dx, center.y + half, center.z + dz),
      )
    }
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

  /** 线框：上下两环（XZ 平面，±length/2 处）+ 4 条侧边竖线（胶囊轮廓） */
  override OnDrawGizmos(): void {
    const center = this.resolveGizmoCenterInto(this._gizmoCenter)
    gizmos.setColor(GIZMO_COLOR)
    const half = this.length / 2
    gizmos.DrawCircle(_a.set(center.x, center.y - half, center.z), _up, this.radius, 24)
    gizmos.DrawCircle(_a.set(center.x, center.y + half, center.z), _up, this.radius, 24)
    for (const [ux, uz] of VERTICAL_DIRS) {
      const dx = ux * this.radius
      const dz = uz * this.radius
      gizmos.DrawLine(
        _a.set(center.x + dx, center.y - half, center.z + dz),
        _b.set(center.x + dx, center.y + half, center.z + dz),
      )
    }
  }
}
