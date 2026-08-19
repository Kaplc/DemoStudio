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
    return this._factory.objects
      .filter((o) => !o.disposed && !o.owner)
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
    for (const obj of this._factory.objects) obj.dispose()
    if (orphans.length > 0) {
      logger.warn(`[GCComponent] 兜底回收 ${orphans.length} 个未释放 THREE 对象`)
    }
    return { orphans, total }
  }
}

import type * as THREE from 'three'
