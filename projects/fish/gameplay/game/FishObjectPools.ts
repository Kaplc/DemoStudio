/**
 * FishObjectPools — ClashMaster 对象池管理器
 * 继承 ObjectPoolManager，复用引擎级对象池基础设施。
 * init(world) 时将所有预分配 Actor 注入 World，之后切换 visible 来复用。
 */
import { ObjectPool, ObjectPoolManager } from '@/engine/pools/ObjectPoolManager'
import { FishBullet } from './FishBullet'
import type { FishBulletOptions } from './FishBullet'
import { FishNet } from './FishNet'
import type { FishNetOptions } from './FishNet'
import { FishFlash } from './FishFlash'
import type { FishFlashOptions } from './FishFlash'
import { FishBubble } from './FishBubble'
import { BattleProjectileActor } from '../battle/BattleProjectileActor'
import type { BattleProjectileOptions } from '../battle/BattleProjectileActor'
import {
  PoolableTroopActor,
  TROOP_ACTOR_CLASSES,
  type TroopDeployOptions,
} from '../battle/troops/TroopActors'

export class FishObjectPools extends ObjectPoolManager {
  readonly bullets: ObjectPool<FishBullet>
  readonly nets: ObjectPool<FishNet>
  readonly flashes: ObjectPool<FishFlash>
  readonly bubbles: ObjectPool<FishBubble>
  readonly projectiles: ObjectPool<BattleProjectileActor>

  /**
   * 兵种对象池（每个兵种一个 ObjectPool）。
   * 键为兵种 id，值为该兵种所有实例的共享池。
   */
  readonly troops: Record<string, ObjectPool<PoolableTroopActor>> = {}

  constructor() {
    super()
    this.bullets = this.registerPool(
      new ObjectPool<FishBullet>(() => new FishBullet(), 0, 30),
      'bullets',
    )
    this.nets = this.registerPool(
      new ObjectPool<FishNet>(() => new FishNet(), 0, 20),
      'nets',
    )
    this.flashes = this.registerPool(
      new ObjectPool<FishFlash>(() => new FishFlash(), 0, 30),
      'flashes',
    )
    this.bubbles = this.registerPool(
      new ObjectPool<FishBubble>(() => new FishBubble(), 0, 15),
      'bubbles',
    )
    this.projectiles = this.registerPool(
      new ObjectPool<BattleProjectileActor>(() => new BattleProjectileActor(), 0, 20),
      'projectiles',
    )

    // 兵种池：每个兵种一个独立池
    for (const [id, ctor] of Object.entries(TROOP_ACTOR_CLASSES)) {
      this.troops[id] = this.registerPool(
        new ObjectPool<PoolableTroopActor>(ctor as unknown as () => PoolableTroopActor, 0, 50),
        `troops_${id}`,
      )
    }
  }

  acquireBullet(opts: FishBulletOptions): FishBullet {
    const b = this.bullets.acquire(opts)
    this.ensureInWorld(b)
    b.pool = this.bullets
    return b
  }

  acquireNet(opts: FishNetOptions): FishNet {
    const n = this.nets.acquire(opts)
    this.ensureInWorld(n)
    n.pool = this.nets
    return n
  }

  acquireFlash(opts: FishFlashOptions): FishFlash {
    const f = this.flashes.acquire(opts)
    this.ensureInWorld(f)
    f.pool = this.flashes
    return f
  }

  acquireBubble(x: number, y: number): FishBubble {
    const b = this.bubbles.acquire({ x, y })
    this.ensureInWorld(b)
    b.pool = this.bubbles
    return b
  }

  acquireProjectile(opts: BattleProjectileOptions): BattleProjectileActor {
    const p = this.projectiles.acquire(opts)
    this.ensureInWorld(p)
    p.pool = this.projectiles
    return p
  }

  /**
   * 从兵种池获取一个兵（acquire 时需传入 gm/troop/x/z/modelActor）。
   * 模型 Actor 由调用方 SpawnActorFromBlueprint 并缓存复用。
   */
  acquireTroop(opts: TroopDeployOptions): PoolableTroopActor {
    const pool = this.troops[opts.troopId]
    if (!pool) throw new Error(`[FishObjectPools] 无兵种池: ${opts.troopId}`)
    const actor = pool.acquire(opts)
    this.ensureInWorld(actor)
    actor.pool = pool
    return actor
  }
}
