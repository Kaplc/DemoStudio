/**
 * PreviewObjectUtils — 编辑器预览对象创建工具（与运行时 ThreeObjectUtils 完全独立）
 *
 * 运行时请用 ThreeObjectUtils（经 GameInstance.current.world.factory，GC 追踪）。
 * 编辑器预览（蓝图/场景/UI 资产预览）没有 GameInstance，本工具经
 * PreviewObjectFactoryComponent.getCurrent() 定位当前预览工厂：
 *   - 预览管理器已注册工厂 → 经工厂创建（本组件 EndPlay 统一释放）
 *   - 未注册（非预览环境）→ 未追踪兜底（裸 new，调用方自行 dispose）
 *
 * 用法（预览管理器/预览环境组件代码）：
 *   const mesh = previewCreateMesh(geo, mat)
 */
import * as THREE from 'three'
import { ThreeObject } from '../rendering/ThreeObject'
import { PreviewObjectFactoryComponent } from './PreviewObjectFactoryComponent'

/** 当前预览工厂；未注册（非预览环境）时 null，调用方退化为未追踪创建 */
function factory(): PreviewObjectFactoryComponent | null {
  return PreviewObjectFactoryComponent.getCurrent()
}

// ─── Object3D ───

export function previewCreateMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.Mesh> {
  const f = factory()
  if (f) return f.createMesh(geometry, material)
  return new ThreeObject(new THREE.Mesh(geometry, material))
}

export function previewCreateGroup(): ThreeObject<THREE.Group> {
  const f = factory()
  if (f) return f.createGroup()
  return new ThreeObject(new THREE.Group())
}

export function previewCreateLineSegments(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.LineSegments> {
  const f = factory()
  if (f) return f.createLineSegments(geometry, material)
  return new ThreeObject(new THREE.LineSegments(geometry, material))
}

export function previewCreateLine(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): ThreeObject<THREE.LineSegments> {
  const f = factory()
  if (f) return f.createLine(geometry, material)
  return new ThreeObject(new THREE.LineSegments(geometry, material))
}

export function previewCreateSprite(material: THREE.SpriteMaterial): ThreeObject<THREE.Sprite> {
  const f = factory()
  if (f) return f.createSprite(material)
  return new ThreeObject(new THREE.Sprite(material))
}

export function previewCreatePoints(
  geometry: THREE.BufferGeometry,
  material: THREE.PointsMaterial,
): ThreeObject<THREE.Points> {
  const f = factory()
  if (f) return f.createPoints(geometry, material)
  return new ThreeObject(new THREE.Points(geometry, material))
}

export function previewCreateEdgesBox(
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

export function previewCreateGridLines(
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

export function previewTrackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
  const f = factory()
  if (f) return f.trackObject(object)
  return new ThreeObject(object)
}
