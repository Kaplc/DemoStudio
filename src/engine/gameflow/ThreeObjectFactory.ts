/**
 * ThreeObjectFactory — THREE 对象工厂
 *
 * 统一创建并追踪 ThreeObject（Mesh / Group / Line / Sprite / Points ...）、
 * BufferGeometry 与 Material——禁止在引擎/项目代码中裸 `new THREE.xxx`，
 * 一律经此工厂创建：
 *
 *   const meshObj = factory.createMesh(geo, mat)        // 返回 ThreeObject<THREE.Mesh>
 *   const groupObj = factory.createGroup()              // 返回 ThreeObject<THREE.Group>
 *   const geo = factory.createBoxGeometry(1, 1, 1)      // 追踪释放的 BoxGeometry
 *   const mat = factory.createMeshBasicMaterial({...})  // 追踪释放的 MeshBasicMaterial
 *
 * 由 Game 持有（Game 的 createXxx 方法转发至此），
 * shutdown 时调用 disposeAll() 统一释放 + 孤儿诊断。
 *
 * 释放链路（双轨）：
 *  - 正常路径：组件 EndPlay → ThreeObject.dispose()（disposed=true，跟随 Actor）
 *  - 兜底路径：disposeAll() 回收未释放对象（基础设施 owner=null，预期由本处回收）
 *
 * 关于 Geometry/Material 追踪：
 *  - 所有经 factory 创建的 geo/mat 都会 push 进 `_geometries` / `_materials`，shutdown 兜底回收
 *  - ThreeObject.dispose() 默认 dispose mesh.geometry + mesh.material，
 *    与本工厂的"按对象追踪"是双保险：组件正常销毁链路释放后，shutdown 兜底不会再重复 dispose
 *    （通过 _disposed 标记去重）
 *  - 跨 Actor 共享的几何/材质由调用方自行管理（用 sharedGeo / sharedMat 标记跳过 dispose）——
 *    factory 默认追踪，但 ThreeObject 包装时 disposeGeometry=false 跳过逐 mesh 释放
 */
import * as THREE from 'three'
import { ThreeObject } from '../rendering/ThreeObject'

export class ThreeObjectFactory {
  /** 由本工厂创建的全部 THREE 对象（shutdown 时统一 dispose 回收） */
  private _objects: ThreeObject[] = []
  /** 由本工厂创建的全部 BufferGeometry（兜底回收 + 跨 Actor 共享诊断） */
  private _geometries: THREE.BufferGeometry[] = []
  /** 由本工厂创建的全部 Material（兜底回收 + 跨 Actor 共享诊断） */
  private _materials: THREE.Material[] = []

  /** 当前追踪的 THREE 对象数（调试用） */
  get count(): number {
    return this._objects.length
  }
  /** 当前追踪的 geometry 数（调试用） */
  get geometryCount(): number {
    return this._geometries.length
  }
  /** 当前追踪的 material 数（调试用） */
  get materialCount(): number {
    return this._materials.length
  }

  // ═══════════════════════════════════════
  //  Object3D 创建（追踪释放）
  // ═══════════════════════════════════════

  /** 创建 Mesh（追踪释放）。geometry/material 应来自本工厂的 createXxxGeometry/createXxxMaterial。 */
  createMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.Mesh> {
    return this.track(new ThreeObject(new THREE.Mesh(geometry, material)))
  }

  /** 创建 Group（追踪释放） */
  createGroup(): ThreeObject<THREE.Group> {
    return this.track(new ThreeObject(new THREE.Group()))
  }

  /** 创建 Line / LineSegments（追踪释放） */
  createLine(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.LineSegments> {
    return this.track(new ThreeObject(new THREE.LineSegments(geometry, material)))
  }

  /**
   * 创建平面网格线框（追踪释放）。
   * 仅提供从 min 到 max 每 step 一条线的能力，具体格子坐标/偏移规则由调用方（游戏）自行计算。
   * 水平面 y=0，含边界。
   * @param min 网格范围最小值（含）
   * @param max 网格范围最大值（含）
   * @param step 线间距
   */
  createGridLines(min: number, max: number, step: number, color: number, transparent?: boolean, opacity?: number): ThreeObject<THREE.LineSegments> {
    const points: THREE.Vector3[] = []
    for (let i = min; i <= max; i += step) {
      points.push(new THREE.Vector3(i, 0, min), new THREE.Vector3(i, 0, max))
      points.push(new THREE.Vector3(min, 0, i), new THREE.Vector3(max, 0, i))
    }
    const geo = this.createBufferGeometry().setFromPoints(points)
    const mat = this.createLineBasicMaterial({ color, ...(transparent ? { transparent, opacity } : {}) })
    return this.createLine(geo, mat)
  }

  /** 创建轴对齐盒线框（追踪释放）。用于选中高亮、不可见碰撞体轮廓等。 */
  createEdgesBox(w: number, h: number, d: number, color: number, transparent = false, opacity = 1): ThreeObject<THREE.LineSegments> {
    const geo = this.createEdgesGeometry(new THREE.BoxGeometry(w, h, d))
    const mat = this.createLineBasicMaterial({ color, transparent, opacity })
    return this.createLine(geo, mat)
  }

  /** 创建 Sprite（追踪释放） */
  createSprite(material: THREE.SpriteMaterial): ThreeObject<THREE.Sprite> {
    return this.track(new ThreeObject(new THREE.Sprite(material)))
  }

  /** 创建 Points（追踪释放） */
  createPoints(geometry: THREE.BufferGeometry, material: THREE.PointsMaterial): ThreeObject<THREE.Points> {
    return this.track(new ThreeObject(new THREE.Points(geometry, material)))
  }

  /**
   * 手动创建任意 Object3D（追踪释放）。
   * 仅在工厂方法未覆盖的类型时使用；工厂方法应优先。
   */
  trackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
    return this.track(new ThreeObject(object))
  }

  // ═══════════════════════════════════════
  //  BufferGeometry 创建（追踪释放）
  // ═══════════════════════════════════════

  /** 创建 BoxGeometry（追踪释放） */
  createBoxGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
    const g = new THREE.BoxGeometry(width, height, depth)
    this._geometries.push(g)
    return g
  }

  /** 创建 SphereGeometry（追踪释放） */
  createSphereGeometry(radius: number, widthSegments = 16, heightSegments = 16): THREE.SphereGeometry {
    const g = new THREE.SphereGeometry(radius, widthSegments, heightSegments)
    this._geometries.push(g)
    return g
  }

  /** 创建 PlaneGeometry（追踪释放） */
  createPlaneGeometry(width: number, height: number): THREE.PlaneGeometry {
    const g = new THREE.PlaneGeometry(width, height)
    this._geometries.push(g)
    return g
  }

  /** 创建 CapsuleGeometry（追踪释放） */
  createCapsuleGeometry(radius: number, length: number, capSegments = 4, radialSegments = 12): THREE.CapsuleGeometry {
    const g = new THREE.CapsuleGeometry(radius, Math.max(0, length), capSegments, radialSegments)
    this._geometries.push(g)
    return g
  }

  /** 创建 EdgesGeometry（追踪释放，输入 BoxGeometry） */
  createEdgesGeometry(sourceGeometry: THREE.BufferGeometry, thresholdAngle = 1): THREE.EdgesGeometry {
    const g = new THREE.EdgesGeometry(sourceGeometry, thresholdAngle)
    this._geometries.push(g)
    return g
  }

  /** 创建空 BufferGeometry（追踪释放），后续 setFromPoints 等填充 */
  createBufferGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    this._geometries.push(g)
    return g
  }

  // ═══════════════════════════════════════
  //  Material 创建（追踪释放）
  // ═══════════════════════════════════════

  /** 创建 MeshBasicMaterial（追踪释放） */
  createMeshBasicMaterial(params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial(params)
    this._materials.push(m)
    return m
  }

  /** 创建 MeshStandardMaterial（追踪释放） */
  createMeshStandardMaterial(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(params)
    this._materials.push(m)
    return m
  }

  /** 创建 LineBasicMaterial（追踪释放） */
  createLineBasicMaterial(params: THREE.LineBasicMaterialParameters = {}): THREE.LineBasicMaterial {
    const m = new THREE.LineBasicMaterial(params)
    this._materials.push(m)
    return m
  }

  // ═══════════════════════════════════════
  //  释放
  // ═══════════════════════════════════════

  /** 内部：登记追踪 */
  private track<T extends THREE.Object3D>(obj: ThreeObject<T>): ThreeObject<T> {
    this._objects.push(obj)
    return obj
  }

  /**
   * 统一释放全部 THREE 对象（GPU 资源：geometry/material/texture）。
   * 幂等：dispose() 内部已防重。
   * @returns 兜底回收的孤儿列表（未释放对象）——正常路径由组件 EndPlay 释放，
   *          未释放的 = 组件销毁链路异常（有 owner）或基础设施（owner=null，预期由本处回收）
   *
   * geometry / material 兜底顺序：先 mesh 全部 dispose（其内部 dispose geo/mat），再 geo/mat 兜底
   * 扫描（去重：dispose 已调用过的不再调）。
   */
  disposeAll(): ThreeObject[] {
    const orphans = this._objects.filter((o) => !o.disposed)
    for (const obj of this._objects) obj.dispose()
    this._objects = []
    // 兜底扫描：geo/mat 可能被共享/未挂载组件（如场景静态道具），
    // ThreeObject.dispose 不会跑到它们，需要工厂自己释放。
    for (const g of this._geometries) {
      // dispose() 幂等；ThreeObject.dispose 调过的会 throw-less noop
      try { g.dispose() } catch { /* 已被释放，跳过 */ }
    }
    for (const m of this._materials) {
      try { m.dispose() } catch { /* 已被释放，跳过 */ }
    }
    this._geometries = []
    this._materials = []
    return orphans
  }
}