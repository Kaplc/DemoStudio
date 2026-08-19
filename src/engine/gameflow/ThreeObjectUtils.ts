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
 * 内部通过 GameInstance.current.world.factory 获取工厂，调用方无需任何参数。
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

function factory() {
  return GameInstance.current!.world.factory
}

// ─── 已追踪（推荐）：经工厂创建，GC 自动释放 ───

export function createMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.Mesh> {
  return factory().createMesh(geometry, material)
}

export function createGroup(): ThreeObject<THREE.Group> {
  return factory().createGroup()
}

export function createLineSegments(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.LineSegments> {
  return factory().createLine(geometry, material)
}

export function createLine(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.LineSegments> {
  return factory().createLine(geometry, material)
}

export function createSprite(material: THREE.SpriteMaterial): ThreeObject<THREE.Sprite> {
  return factory().createSprite(material)
}

export function createPoints(
  geometry: THREE.BufferGeometry,
  material: THREE.PointsMaterial,
): ThreeObject<THREE.Points> {
  return factory().createPoints(geometry, material)
}

export function createEdgesBox(
  w: number, h: number, d: number,
  color: number,
  transparent = false,
  opacity = 1,
): ThreeObject<THREE.LineSegments> {
  return factory().createEdgesBox(w, h, d, color, transparent, opacity)
}

export function createGridLines(
  min: number, max: number, step: number,
  color: number,
  transparent?: boolean,
  opacity?: number,
): ThreeObject<THREE.LineSegments> {
  return factory().createGridLines(min, max, step, color, transparent, opacity)
}

export function trackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
  return factory().trackObject(object)
}

// ─── BufferGeometry 工厂 ───

export function createBoxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  return factory().createBoxGeometry(w, h, d)
}

export function createSphereGeometry(radius: number, widthSegments = 16, heightSegments = 16): THREE.SphereGeometry {
  return factory().createSphereGeometry(radius, widthSegments, heightSegments)
}

export function createPlaneGeometry(w: number, h: number): THREE.PlaneGeometry {
  return factory().createPlaneGeometry(w, h)
}

export function createCapsuleGeometry(radius: number, length: number, capSegments = 4, radialSegments = 12): THREE.CapsuleGeometry {
  return factory().createCapsuleGeometry(radius, length, capSegments, radialSegments)
}

export function createEdgesGeometry(source: THREE.BufferGeometry, thresholdAngle = 1): THREE.EdgesGeometry {
  return factory().createEdgesGeometry(source, thresholdAngle)
}

export function createBufferGeometry(): THREE.BufferGeometry {
  return factory().createBufferGeometry()
}

// ─── Material 工厂 ───

export function createMeshBasicMaterial(params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return factory().createMeshBasicMaterial(params)
}

export function createMeshStandardMaterial(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return factory().createMeshStandardMaterial(params)
}

export function createLineBasicMaterial(params: THREE.LineBasicMaterialParameters = {}): THREE.LineBasicMaterial {
  return factory().createLineBasicMaterial(params)
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
