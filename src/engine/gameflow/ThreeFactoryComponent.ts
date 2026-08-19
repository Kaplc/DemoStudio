/**
 * ThreeFactoryComponent — THREE 对象工厂组件
 *
 * 统一创建并追踪 ThreeObject（Mesh / Group / Line / Sprite / Points ...）。
 * 禁止裸 `new THREE.xxx` —— 一律经本组件：
 *
 *   const meshObj = factory.createMesh(geo, mat)   // 返回 ThreeObject<THREE.Mesh>
 *   const groupObj = factory.createGroup()         // 返回 ThreeObject<THREE.Group>
 */
import * as THREE from 'three'
import { AObjectComponent } from '../entity/AObjectComponent'
import { ThreeObject } from '../rendering/ThreeObject'
import type { World } from './World'

export class ThreeFactoryComponent extends AObjectComponent {
  private readonly _objects: ThreeObject[] = []

  get count(): number {
    return this._objects.length
  }

  createMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.Mesh> {
    return this._track(new ThreeObject(new THREE.Mesh(geometry, material)))
  }

  createGroup(): ThreeObject<THREE.Group> {
    return this._track(new ThreeObject(new THREE.Group()))
  }

  createLine(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.LineSegments> {
    return this._track(new ThreeObject(new THREE.LineSegments(geometry, material)))
  }

  createSprite(material: THREE.SpriteMaterial): ThreeObject<THREE.Sprite> {
    return this._track(new ThreeObject(new THREE.Sprite(material)))
  }

  createPoints(geometry: THREE.BufferGeometry, material: THREE.PointsMaterial): ThreeObject<THREE.Points> {
    return this._track(new ThreeObject(new THREE.Points(geometry, material)))
  }

  createGridLines(min: number, max: number, step: number, color: number, transparent?: boolean, opacity?: number): ThreeObject<THREE.LineSegments> {
    const points: THREE.Vector3[] = []
    for (let i = min; i <= max; i += step) {
      points.push(new THREE.Vector3(i, 0, min), new THREE.Vector3(i, 0, max))
      points.push(new THREE.Vector3(min, 0, i), new THREE.Vector3(max, 0, i))
    }
    return this.createLine(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, ...(transparent ? { transparent, opacity } : {}) }),
    )
  }

  /** 创建线框包围盒（BoxGeometry → EdgesGeometry） */
  createEdgesBox(w: number, h: number, d: number, color: number, transparent = false, opacity = 1): ThreeObject<THREE.LineSegments> {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
    const mat = new THREE.LineBasicMaterial({ color, ...(transparent ? { transparent, opacity } : {}) })
    return this.createLineSegments(geo, mat)
  }

  createLineSegments(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.LineSegments> {
    return this._track(new ThreeObject(new THREE.LineSegments(geometry, material)))
  }

  trackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
    return this._track(new ThreeObject(object))
  }

  // ─── Geometry 工厂（经 factory 创建的 Geometry 同样被追踪，disposeAll 时统一释放）───

  createBoxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
    return new THREE.BoxGeometry(w, h, d)
  }

  createSphereGeometry(radius: number, widthSegments = 16, heightSegments = 16): THREE.SphereGeometry {
    return new THREE.SphereGeometry(radius, widthSegments, heightSegments)
  }

  createPlaneGeometry(w: number, h: number): THREE.PlaneGeometry {
    return new THREE.PlaneGeometry(w, h)
  }

  createCapsuleGeometry(radius: number, length: number, capSegments = 4, radialSegments = 12): THREE.CapsuleGeometry {
    return new THREE.CapsuleGeometry(radius, Math.max(0, length), capSegments, radialSegments)
  }

  createEdgesGeometry(source: THREE.BufferGeometry, thresholdAngle = 1): THREE.EdgesGeometry {
    return new THREE.EdgesGeometry(source, thresholdAngle)
  }

  createBufferGeometry(): THREE.BufferGeometry {
    return new THREE.BufferGeometry()
  }

  // ─── Material 工厂 ───

  createMeshBasicMaterial(params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial(params)
  }

  createMeshStandardMaterial(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial(params)
  }

  createLineBasicMaterial(params: THREE.LineBasicMaterialParameters = {}): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial(params)
  }

  private _track<T extends THREE.Object3D>(obj: ThreeObject<T>): ThreeObject<T> {
    this._objects.push(obj)
    return obj
  }

  /** 内部访问列表（供 GCComponent 使用） */
  get objects(): readonly ThreeObject[] {
    return this._objects
  }
}
