/**
 * ObjectPoolManager — 引擎级对象池管理器
 *
 * 职责：
 *  1. 集中管理所有 ObjectPool（项目注册池后自动维护）
 *  2. init(world) 时将所有预分配 Actor 注入 World（root.visible=false）
 *  3. releaseAll() 归还所有活跃对象
 *
 * 项目层继承或组合本类来扩展自己的池（如 FishObjectPools）。
 */
import { ObjectPool } from '../tools/ObjectPool'
import type { PoolableActor } from '../tools/ObjectPool'
import { spawnActor } from '../gameflow/ActorUtils'
import type { World } from '../gameflow/World'

export { ObjectPool } from '../tools/ObjectPool'
export type { IPoolable, PoolableActor } from '../tools/ObjectPool'

export interface PoolDef<T extends PoolableActor> {
  name: string
  pool: ObjectPool<T>
}

export class ObjectPoolManager {
  private _world: World | null = null
  private _spawned = false
  private readonly _pools: PoolDef<PoolableActor>[] = []

  get world(): World | null { return this._world }

  protected registerPool<T extends PoolableActor>(pool: ObjectPool<T>, name: string): ObjectPool<T> {
    this._pools.push({ name, pool: pool as ObjectPool<PoolableActor> })
    return pool
  }

  init(world: World): void {
    this._world = world
    if (this._spawned) return
    this._spawned = true
    for (const def of this._pools) {
      def.pool.forEach((obj) => {
        spawnActor(obj)
        obj.root.visible = false
      })
    }
  }

  protected ensureInWorld(obj: PoolableActor): void {
    if (!this._world || obj.root.parent) return
    spawnActor(obj)
    obj.root.visible = false
  }

  releaseAll(): void {
    for (const def of this._pools) {
      def.pool.releaseAll()
    }
  }

  activeCount(poolName?: string): number {
    if (poolName) {
      const def = this._pools.find(d => d.name === poolName)
      return def ? def.pool.activeCount : 0
    }
    return this._pools.reduce((sum, d) => sum + d.pool.activeCount, 0)
  }
}
