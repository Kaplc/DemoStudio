/**
 * ThreeObject — THREE 对象包装基类
 *
 * 所有 THREE 对象（Mesh / LineSegments / Sprite / Group ...）统一包装为 ThreeObject，
 * 禁止在引擎/项目代码中裸 `new THREE.xxx` —— 一律通过 Game 的工厂创建：
 *
 *   const meshObj = game.createMesh(geo, mat)        // 返回 ThreeObject<THREE.Mesh>
 *   const groupObj = game.createGroup()              // 返回 ThreeObject<THREE.Group>
 *
 * 继承 OObject：纳入引擎对象体系（全局注册表 + 销毁标记）。
 *  - disposed：GPU 资源已释放（dispose 后置位）
 *  - bDestroyed：对象已销毁（dispose 时联动 markDestroyed）
 *  - 回收：由 Game 的 _threeObjects 列表统一追踪（本类无 world/owner 归属，注册表不负责回收）
 *
 * 职责：
 *  - 持有底层 THREE 对象（object）
 *  - 统一释放：dispose() 递归释放 geometry / material / texture（GPU 资源）
 *  - 归属追踪：Game 记录所有创建的 ThreeObject，shutdown 时统一回收
 *
 * 设计动机：
 *  - 裸 new 散落各处 → 释放靠自觉，漏写即 GPU 泄漏
 *  - 统一入口 → Game 可追踪全部 THREE 对象，销毁游戏时一次性回收
 */
import * as THREE from 'three'
import { OObject } from '../entity/OObject'
import type { Actor } from '../entity/Actor'

export interface ThreeObjectOptions {
  /** 是否释放 geometry（默认 true；共享几何体传 false，如 SpriteComponent 的 sharedGeo） */
  disposeGeometry?: boolean
}

export class ThreeObject<T extends THREE.Object3D = THREE.Object3D> extends OObject {
  /** 底层 THREE 对象 */
  public readonly object: T

  /**
   * 当前挂载归属：组件 attachToRoot 时写入（= 组件 owner Actor）。
   * null = 基础设施/未挂载对象。shutdown 兜底释放时用于孤儿诊断。
   */
  public owner: Actor | null = null

  /** 是否释放 geometry（false = 共享几何体，跳过 dispose） */
  private readonly _disposeGeometry: boolean

  /** 是否已释放（dispose 后置位；防止重复释放） */
  private _disposed = false

  constructor(object: T, options: ThreeObjectOptions = {}) {
    super()
    this.object = object
    this._disposeGeometry = options.disposeGeometry ?? true
  }

  get disposed(): boolean {
    return this._disposed
  }

  /**
   * 释放 GPU 资源（geometry + material + 材质引用的 texture）。
   * 递归遍历子节点释放（Group 等复合对象）。
   * 幂等：重复调用无副作用。释放同时联动 markDestroyed（对象死亡标记）。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    const walk = (obj: THREE.Object3D) => {
      const anyObj = obj as THREE.Object3D & {
        geometry?: THREE.BufferGeometry
        material?: THREE.Material | THREE.Material[]
      }
      // Geometry（可跳过：共享几何体）
      if (this._disposeGeometry) anyObj.geometry?.dispose?.()
      // Material（数组或单个；递归处理 map 等纹理）
      const mats = Array.isArray(anyObj.material)
        ? anyObj.material
        : anyObj.material
          ? [anyObj.material]
          : []
      for (const mat of mats) {
        const anyMat = mat as THREE.Material & Record<string, unknown>
        for (const key of Object.keys(anyMat)) {
          const value = anyMat[key]
          if (value instanceof THREE.Texture) value.dispose()
        }
        mat.dispose()
      }
      // 递归子节点
      for (const child of obj.children) walk(child)
    }
    walk(this.object)

    // 对象销毁标记（纳入 OObject 体系）
    this.markDestroyed()
    // 已死亡：断开归属引用，避免引用链滞留
    this.owner = null
  }
}
