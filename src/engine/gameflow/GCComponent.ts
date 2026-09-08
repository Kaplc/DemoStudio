/**
 * GCComponent — 统一资源回收组件
 *
 * 注入 ThreeFactoryComponent，只负责追踪和兜底回收。
 * 由 World.Destroy() 触发 disposeAll()。
 */
import { AObjectComponent } from '../entity/AObjectComponent'
import { ThreeObject } from '../rendering/ThreeObject'
import { logger } from '../Logger'
import type { ThreeFactoryComponent } from './ThreeFactoryComponent'
import type { World } from './World'

export class GCComponent extends AObjectComponent {
  private _factory!: ThreeFactoryComponent

  setFactory(factory: ThreeFactoryComponent): void {
    this._factory = factory
  }

  get count(): number {
    return this._factory?.count ?? 0
  }

  findOrphanObjects(): Array<{ sceneName: string; obj: THREE.Object3D; chain: string }> {
    if (!this._factory) return []
    // 与 ActorManagerComponent.findOrphanObjects 同口径：Actor root 子树内的对象视为已跟踪。
    // 批量渲染组件（星图/地图渲染器等）经工厂建对象后整体挂到 owner.root，
    // 不逐个走 ThreeObjectComponent——凡祖先链可达任一 Actor root（或 owner 显式认领）不算孤儿
    const trackedRoots = new Set<THREE.Object3D>()
    const world = this.owner as World
    if (world?.actorMgr) {
      for (const actor of world.actorMgr.GetAllActors()) trackedRoots.add(actor.root)
    }
    const isOwned = (o: ThreeObject): boolean => {
      if (o.owner) return true
      let p: THREE.Object3D | null = o.object
      while (p) {
        if (trackedRoots.has(p)) return true
        p = p.parent
      }
      return false
    }
    return this._factory.objects
      .filter((o) => !o.disposed && !isOwned(o))
      .map((o) => ({
        sceneName: 'main',
        obj: o.object,
        chain: o.object.parent ? o.object.parent.name || 'parent' : 'none',
      }))
  }

  disposeAll(): { orphans: ThreeObject[]; total: number } {
    if (!this._factory) return { orphans: [], total: 0 }
    const orphans = this._factory.objects.filter((o) => !o.disposed)
    const total = this._factory.count
    // 真孤儿计数必须在 dispose 之前（dispose 会断开 owner 引用）
    const trueOrphanCount = orphans.filter((o) => !o.owner).length
    for (const obj of this._factory.objects) obj.dispose()
    // 组件托管对象（owner 已认领）由组件在 EndPlay 自行释放 GPU 资源，
    // 包装层随 World 统一兜底 dispose 属设计内路径，只有真孤儿（无人认领）才告警
    if (trueOrphanCount > 0) {
      logger.warn(`[GCComponent] 兜底回收 ${trueOrphanCount} 个未被认领的 THREE 对象`)
    } else if (orphans.length > 0) {
      logger.info(`[GCComponent] 兜底释放 ${orphans.length} 个组件托管 THREE 对象`)
    }
    return { orphans, total }
  }
}

import type * as THREE from 'three'
