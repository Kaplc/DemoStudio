/**
 * ThreeObjectUtils — THREE 对象工厂工具函数集
 *
 * 统一创建并追踪 ThreeObject（Mesh / Group / Line / Sprite / Points ...）。
 * 禁止裸 `new THREE.xxx` —— 一律经本 utils：
 *
 *   import { createMesh, createBoxGeometry, createMeshBasicMaterial } from '.../gameflow/ThreeObjectUtils'
 *   const geo  = createBoxGeometry(1, 1, 1)
 *   const mat  = createMeshBasicMaterial({ color: 0xff0000 })
 *   const obj  = createMesh(geo, mat)
 *
 * 内部按序解析当前工厂，调用方无需任何参数：
 *   1. 运行时：GameInstance.current.world.factory（GC 追踪）
 *   2. 编辑器预览：PreviewObjectFactoryComponent.getCurrent()（独立预览工厂，EndPlay 统一释放）
 *   3. 都无（无活跃实例且未挂预览工厂）→ 未追踪创建（裸 new THREE.xxx），
 *      由持有方（组件 EndPlay 等）自行 dispose —— 避免 `GameInstance.current!.world` 空引用崩溃。
 * 适用于：业务代码、Actor.build、Component.rebuild、GM 命令、Inspector 调试面板。
 *
 * 未追踪版本（`*Untracked`）：返回裸 THREE.Object3D / BufferGeometry / Material，
 * 适用于测试、预创建阶段、Inspector setter 中间态；调用方 wrap 成 ThreeObject 并负责 dispose。
 *
 * 完整覆盖：
 *   - Object3D：Mesh / LineSegments / Line / Group / Sprite / Points
 *   - BufferGeometry：Box / Sphere / Plane / Capsule / Edges / 空
 *   - Material：MeshBasic / MeshStandard / LineBasic
 */
import * as THREE from 'three'
import { ThreeObject } from '../rendering/ThreeObject'
import { GameInstance } from './GameInstance'
import { PreviewObjectFactoryComponent } from './PreviewObjectFactoryComponent'

/**
 * 当前 World 工厂（运行时优先）；无活跃游戏实例时退回编辑器预览工厂；
 * 两者皆无时为 null，调用方退化为未追踪创建。
 */
function factory() {
  const gi = GameInstance.current
  if (gi?.world) return gi.world.factory
  // 编辑器预览（蓝图/场景/UI 资产预览）：独立预览工厂，无 GameInstance 依赖
  const pf = PreviewObjectFactoryComponent.getCurrent()
  if (pf) return pf
  return null
}

// ─── 已追踪（推荐）：经工厂创建，GC 自动释放 ───

export function createMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.Mesh> {
  const f = factory()
  if (f) return f.createMesh(geometry, material)
  return new ThreeObject(new THREE.Mesh(geometry, material))
}

export function createGroup(): ThreeObject<THREE.Group> {
  const f = factory()
  if (f) return f.createGroup()
  return new ThreeObject(new THREE.Group())
}

export function createLineSegments(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.LineSegments> {
  const f = factory()
  if (f) return f.createLine(geometry, material)
  return new ThreeObject(new THREE.LineSegments(geometry, material))
}

export function createLine(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.LineSegments> {
  const f = factory()
  if (f) return f.createLine(geometry, material)
  return new ThreeObject(new THREE.LineSegments(geometry, material))
}

export function createSprite(material: THREE.SpriteMaterial): ThreeObject<THREE.Sprite> {
  const f = factory()
  if (f) return f.createSprite(material)
  return new ThreeObject(new THREE.Sprite(material))
}

export function createPoints(
  geometry: THREE.BufferGeometry,
  material: THREE.PointsMaterial,
): ThreeObject<THREE.Points> {
  const f = factory()
  if (f) return f.createPoints(geometry, material)
  return new ThreeObject(new THREE.Points(geometry, material))
}

export function createEdgesBox(
  w: number, h: number, d: number,
  color: number,
  transparent = false,
  opacity = 1,
): ThreeObject<THREE.LineSegments> {
  const f = factory()
  if (f) return f.createEdgesBox(w, h, d, color, transparent, opacity)
  const mat = new THREE.LineBasicMaterial({ color, ...(transparent ? { transparent, opacity } : {}) })
  return new ThreeObject(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), mat))
}

export function createGridLines(
  min: number, max: number, step: number,
  color: number,
  transparent?: boolean,
  opacity?: number,
): ThreeObject<THREE.LineSegments> {
  const f = factory()
  if (f) return f.createGridLines(min, max, step, color, transparent, opacity)
  const points: THREE.Vector3[] = []
  for (let i = min; i <= max; i += step) {
    points.push(new THREE.Vector3(i, 0, min), new THREE.Vector3(i, 0, max))
    points.push(new THREE.Vector3(min, 0, i), new THREE.Vector3(max, 0, i))
  }
  const mat = new THREE.LineBasicMaterial({ color, ...(transparent ? { transparent, opacity } : {}) })
  return new ThreeObject(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), mat))
}

export function trackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
  const f = factory()
  if (f) return f.trackObject(object)
  return new ThreeObject(object)
}

// ─── BufferGeometry 工厂 ───

export function createBoxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  const f = factory()
  if (f) return f.createBoxGeometry(w, h, d)
  return createBoxGeometryUntracked(w, h, d)
}

export function createSphereGeometry(radius: number, widthSegments = 16, heightSegments = 16): THREE.SphereGeometry {
  const f = factory()
  if (f) return f.createSphereGeometry(radius, widthSegments, heightSegments)
  return createSphereGeometryUntracked(radius, widthSegments, heightSegments)
}

export function createPlaneGeometry(w: number, h: number): THREE.PlaneGeometry {
  const f = factory()
  if (f) return f.createPlaneGeometry(w, h)
  return createPlaneGeometryUntracked(w, h)
}

export function createCapsuleGeometry(radius: number, length: number, capSegments = 4, radialSegments = 12): THREE.CapsuleGeometry {
  const f = factory()
  if (f) return f.createCapsuleGeometry(radius, length, capSegments, radialSegments)
  return createCapsuleGeometryUntracked(radius, length, capSegments, radialSegments)
}

export function createRingGeometry(innerRadius: number, outerRadius: number, thetaSegments = 32): THREE.RingGeometry {
  const f = factory()
  if (f) return f.createRingGeometry(innerRadius, outerRadius, thetaSegments)
  return createRingGeometryUntracked(innerRadius, outerRadius, thetaSegments)
}

export function createEdgesGeometry(source: THREE.BufferGeometry, thresholdAngle = 1): THREE.EdgesGeometry {
  const f = factory()
  if (f) return f.createEdgesGeometry(source, thresholdAngle)
  return createEdgesGeometryUntracked(source, thresholdAngle)
}

export function createBufferGeometry(): THREE.BufferGeometry {
  const f = factory()
  if (f) return f.createBufferGeometry()
  return createBufferGeometryUntracked()
}

// ─── Material 工厂 ───

export function createMeshBasicMaterial(params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const f = factory()
  if (f) return f.createMeshBasicMaterial(params)
  return createMeshBasicMaterialUntracked(params)
}

export function createMeshStandardMaterial(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const f = factory()
  if (f) return f.createMeshStandardMaterial(params)
  return createMeshStandardMaterialUntracked(params)
}

export function createLineBasicMaterial(params: THREE.LineBasicMaterialParameters = {}): THREE.LineBasicMaterial {
  const f = factory()
  if (f) return f.createLineBasicMaterial(params)
  return createLineBasicMaterialUntracked(params)
}

// ─── 未追踪（兜底）：直接裸 new，调用方负责 dispose ───

export function createMeshUntracked(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): THREE.Mesh {
  return new THREE.Mesh(geometry, material)
}

export function createGroupUntracked(): THREE.Group {
  return new THREE.Group()
}

export function createLineSegmentsUntracked(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): THREE.LineSegments {
  return new THREE.LineSegments(geometry, material)
}

export function createBoxGeometryUntracked(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d)
}

export function createSphereGeometryUntracked(radius: number, widthSegments = 16, heightSegments = 16): THREE.SphereGeometry {
  return new THREE.SphereGeometry(radius, widthSegments, heightSegments)
}

export function createPlaneGeometryUntracked(w: number, h: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(w, h)
}

export function createCapsuleGeometryUntracked(radius: number, length: number, capSegments = 4, radialSegments = 12): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0, length), capSegments, radialSegments)
}

export function createRingGeometryUntracked(innerRadius: number, outerRadius: number, thetaSegments = 32): THREE.RingGeometry {
  return new THREE.RingGeometry(innerRadius, outerRadius, thetaSegments)
}

export function createEdgesGeometryUntracked(source: THREE.BufferGeometry, thresholdAngle = 1): THREE.EdgesGeometry {
  return new THREE.EdgesGeometry(source, thresholdAngle)
}

export function createBufferGeometryUntracked(): THREE.BufferGeometry {
  return new THREE.BufferGeometry()
}

export function createMeshBasicMaterialUntracked(params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(params)
}

export function createMeshStandardMaterialUntracked(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial(params)
}

export function createLineBasicMaterialUntracked(params: THREE.LineBasicMaterialParameters = {}): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial(params)
}
