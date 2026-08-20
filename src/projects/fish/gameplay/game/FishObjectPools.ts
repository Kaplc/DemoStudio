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

export class FishObjectPools extends ObjectPoolManager {
  readonly bullets: ObjectPool<FishBullet>
  readonly nets: ObjectPool<FishNet>
  readonly flashes: ObjectPool<FishFlash>
  readonly bubbles: ObjectPool<FishBubble>
  readonly projectiles: ObjectPool<BattleProjectileActor>

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
}
