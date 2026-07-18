/**
 * FishObjectPools — 捕鱼达人对象池管理器
 * 集中管理所有高频创建/销毁对象的池。
 * init(world) 时将所有预分配 Actor 注入 World，之后切换 visible 来复用。
 */
import { ObjectPool, type World, logger } from '@/engine'
import { FishBullet } from './FishBullet'
import type { FishBulletOptions } from './FishBullet'
import { FishNet } from './FishNet'
import type { FishNetOptions } from './FishNet'
import { FishFlash } from './FishFlash'
import type { FishFlashOptions } from './FishFlash'
import { FishBubble } from './FishBubble'

export class FishObjectPools {
  readonly bullets: ObjectPool<FishBullet>
  readonly nets: ObjectPool<FishNet>
  readonly flashes: ObjectPool<FishFlash>
  readonly bubbles: ObjectPool<FishBubble>

  private world: World | null = null
  /** 预分配对象是否已注入 World */
  private spawned = false

  constructor() {
    this.bullets = new ObjectPool<FishBullet>(
      () => new FishBullet(),
      12, 30,
    )
    this.nets = new ObjectPool<FishNet>(
      () => new FishNet(),
      8, 20,
    )
    this.flashes = new ObjectPool<FishFlash>(
      () => new FishFlash(),
      10, 30,
    )
    this.bubbles = new ObjectPool<FishBubble>(
      () => new FishBubble(),
      6, 15,
    )
  }

  /** 将池中所有对象注入 World（必须在游戏开始前调用一次） */
  init(world: World) {
    this.world = world
    if (this.spawned) return
    this.spawned = true

    const doSpawn = (pool: ObjectPool<any>) => {
      pool.forEach((obj: any) => {
        world.SpawnActor(obj)
        obj.root.visible = false
      })
    }
    doSpawn(this.bullets)
    doSpawn(this.nets)
    doSpawn(this.flashes)
    doSpawn(this.bubbles)
  }

  /** 确保对象在 World 中（池扩容时自动注入新对象） */
  private ensureInWorld(obj: any) {
    if (!this.world || obj.root.parent) return
    this.world.SpawnActor(obj)
    obj.root.visible = false
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

  releaseAll() {
    this.bullets.releaseAll()
    this.nets.releaseAll()
    this.flashes.releaseAll()
    this.bubbles.releaseAll()
  }
}
