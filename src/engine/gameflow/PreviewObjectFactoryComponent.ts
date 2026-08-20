/**
 * PreviewObjectFactoryComponent — 编辑器预览对象工厂组件
 *
 * 与运行时的 ThreeFactoryComponent 完全独立：
 *  - 运行时：GameInstance.current.world.factory（ThreeFactoryComponent，GC 组件兜底回收）
 *  - 编辑器预览：本组件（挂预览 World，无 GameInstance 依赖，自带追踪 + EndPlay 统一释放）
 *
 * 编辑器预览场景（蓝图/场景/UI 资产预览）没有 GameInstance，而组件工厂
 * （registerBuiltinComponents 的 Mesh 组件等）统一经 ThreeObjectUtils 创建 THREE 对象。
 * ThreeObjectUtils.factory() 按序解析：运行时工厂 → 本预览工厂 → 未追踪兜底，
 * 预览管理器在每次 spawn 前置位 PreviewObjectFactoryComponent.setCurrent()，
 * 保证预览环境创建的 ThreeObject 被本组件追踪，manager dispose 时 disposeAll() 统一释放。
 *
 * 用法（预览管理器）：
 *   const pf = this.world.addComponent(PreviewObjectFactoryComponent)
 *   PreviewObjectFactoryComponent.setCurrent(pf)   // 每次 loadBlueprint/loadSceneAsset 前置位
 *   ...
 *   pf.disposeAll()   // manager dispose 时显式调用（World 无组件生命周期驱动）
 */
import * as THREE from 'three'
import { AObjectComponent } from '../entity/AObjectComponent'
import { ThreeObject } from '../rendering/ThreeObject'
import type { World } from './World'

export class PreviewObjectFactoryComponent extends AObjectComponent {
  /** 当前预览工厂（编辑器预览环境唯一激活；运行时为 null） */
  private static _current: PreviewObjectFactoryComponent | null = null

  /** 注册当前预览工厂（预览管理器在 spawn 前置位；同刻仅一个） */
  static setCurrent(f: PreviewObjectFactoryComponent | null): void {
    PreviewObjectFactoryComponent._current = f
  }

  /** 获取当前预览工厂（ThreeObjectUtils 预览分支 / PreviewObjectUtils 使用） */
  static getCurrent(): PreviewObjectFactoryComponent | null {
    return PreviewObjectFactoryComponent._current
  }

  /**
   * 当前预览工厂所属 World（ActorUtils.spawnActor 等无 GameInstance 场景回退用）。
   * 本组件挂在预览 World 上，owner 即 World；无激活工厂时为 null。
   */
  static getCurrentWorld(): World | null {
    return PreviewObjectFactoryComponent._current?.owner as World | null
  }

  /** 本工厂追踪创建的 ThreeObject（EndPlay 统一释放） */
  private readonly _objects: ThreeObject[] = []

  get count(): number {
    return this._objects.length
  }

  get objects(): readonly ThreeObject[] {
    return this._objects
  }

  // ─── Object3D 工厂（与 ThreeFactoryComponent 同构，但不依赖 GameInstance/GC）───

  createMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.Mesh> {
    return this._track(new ThreeObject(new THREE.Mesh(geometry, material)))
  }

  createGroup(): ThreeObject<THREE.Group> {
    return this._track(new ThreeObject(new THREE.Group()))
  }

  createLine(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.LineSegments> {
    return this._track(new ThreeObject(new THREE.LineSegments(geometry, material)))
  }

  createLineSegments(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.LineSegments> {
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

  trackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
    return this._track(new ThreeObject(object))
  }

  // ─── Geometry 工厂（裸 THREE 几何体，随宿主 ThreeObject 释放）───

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

  /**
   * 释放全部追踪对象 + 自清 current（预览管理器 dispose 时调用；幂等）。
   * 注：World 是 AObject（无组件 EndPlay 驱动），故由 manager 显式调用，
   * 与 ThreeFactoryComponent 依赖 GCComponent 兜底回收的机制解耦。
   */
  disposeAll(): void {
    for (const obj of this._objects) obj.dispose()
    this._objects.length = 0
    if (PreviewObjectFactoryComponent._current === this) {
      PreviewObjectFactoryComponent._current = null
    }
  }
}
