/**
 * OObjectFactory — OObject 体系对象工厂
 *
 * OObject 是引擎对象体系的最顶层基类；ThreeObject（继承 OObject）是其渲染包装子类。
 * 本工厂统一创建并追踪 ThreeObject（Mesh / Group / Line / Sprite / Points ...）：
 * 禁止在引擎/项目代码中裸 `new THREE.xxx` —— 一律经此工厂创建：
 *
 *   const meshObj = factory.createMesh(geo, mat)   // 返回 ThreeObject<THREE.Mesh>
 *   const groupObj = factory.createGroup()         // 返回 ThreeObject<THREE.Group>
 *
 * 由 Game 持有（Game 的 createXxx 方法转发至此），
 * shutdown 时调用 disposeAll() 统一释放 + 孤儿诊断。
 *
 * 释放链路（双轨）：
 *  - 正常路径：组件 EndPlay → ThreeObject.dispose()（disposed=true，跟随 Actor）
 *  - 兜底路径：disposeAll() 回收未释放对象（基础设施 owner=null，预期由本处回收）
 */
import * as THREE from 'three'
import { ThreeObject } from '../rendering/ThreeObject'

export class OObjectFactory {
  /** 由本工厂创建的全部 THREE 对象（shutdown 时统一 dispose 回收） */
  private _objects: ThreeObject[] = []

  /** 当前追踪的 THREE 对象数（调试用） */
  get count(): number {
    return this._objects.length
  }

  /** 创建 Mesh（追踪释放） */
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
   */
  disposeAll(): ThreeObject[] {
    const orphans = this._objects.filter((o) => !o.disposed)
    for (const obj of this._objects) obj.dispose()
    this._objects = []
    return orphans
  }
}
