/**
 * FishBullet — 飞行炮弹（子弹阶段，池化版本）
 * 从炮口沿瞄准方向飞行；击中鱼或飞到最远距离时，在当前位置张开网（FishNet）。
 * 使用对象池复用，避免频繁 GC。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent, ObjectPool } from '@/engine'
import type { IPoolable } from '@/engine'
import { FishNet } from './FishNet'
import { makeBulletTexture } from '../common/textures'
import { NET_MAX_DISTANCE } from '../common/types'

let _tex: THREE.Texture | null = null
function bulletTexture(): THREE.Texture {
  if (!_tex) _tex = makeBulletTexture()
  return _tex
}

export interface FishBulletOptions {
  pos: THREE.Vector3
  dir: THREE.Vector3
  speed: number
  netRadius: number
  power: number
  captureBonus: number
}

export class FishBullet extends Actor implements IPoolable {
  /** 对象池引用（由池在 acquire 时设置） */
  pool: ObjectPool<FishBullet> | null = null
  /** 是否正在被使用 */
  active = false

  dir = new THREE.Vector2()
  speed = 0
  netRadius = 0
  power = 0
  captureBonus = 0
  /** 子弹自身碰撞半径（小） */
  readonly radius = 0.35
  /** 已张网 */
  detonated = false
  private traveled = 0
  private sprite: SpriteComponent

  constructor() {
    super('FishBullet')
    this.sprite = new SpriteComponent(this, 0.7, 0.7, 'BulletSprite')
    this.sprite.setTexture(bulletTexture())
    this.addComponent(this.sprite)
    this.deactivate()
  }

  /** 从池中取出时初始化 */
  activate(opts?: any): void {
    const o = opts as FishBulletOptions
    this.active = true
    this.detonated = false
    this.traveled = 0
    this.dir.set(o.dir.x, o.dir.y).normalize()
    this.speed = o.speed
    this.netRadius = o.netRadius
    this.power = o.power
    this.captureBonus = o.captureBonus
    this.setPosition(o.pos.x, o.pos.y, o.pos.z)
    this.root.visible = true
    this.enableTick()
  }

  /** 放回池中 */
  deactivate(): void {
    this.active = false
    this.detonated = true
    this.root.visible = false
  }

  /** 在当前位置张开网并释放回池 */
  detonate() {
    if (this.detonated) return
    this.detonated = true
    // 从池获取网，或用池引用释放
    this.pool?.release(this)
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (!this.active || this.detonated) return
    const move = this.speed * dt
    this.position.x += this.dir.x * move
    this.position.y += this.dir.y * move
    this.traveled += move
    if (this.traveled >= NET_MAX_DISTANCE) {
      this.pool?.release(this)
    }
  }
}
