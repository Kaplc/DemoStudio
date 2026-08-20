/**
 * FishFlash — 通用短命闪光/光环特效（池化版本）
 * 出现后放大 + 淡出，到期释放回池。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent, ObjectPool } from '@/engine'
import type { IPoolable } from '@/engine'

export interface FishFlashOptions {
  pos: THREE.Vector3
  size: number
  texture: THREE.Texture
  ttl?: number
  grow?: number
  opacity?: number
}

export class FishFlash extends Actor implements IPoolable {
  pool: ObjectPool<FishFlash> | null = null
  active = false

  private sprite: SpriteComponent
  private ttl = 0.25
  private grow = 4
  private baseOpacity = 1
  private baseSize = 1
  private age = 0

  constructor() {
    super('Flash')
    this.sprite = new SpriteComponent(this, 1, 1, 'FlashSprite')
    this.addComponent(this.sprite)
    this.deactivate()
  }

  activate(opts?: any): void {
    const o = opts as FishFlashOptions
    this.active = true
    this.ttl = o.ttl ?? 0.25
    this.grow = o.grow ?? 4
    this.baseOpacity = o.opacity ?? 1
    this.baseSize = o.size
    this.age = 0
    this.sprite.setTexture(o.texture)
    this.sprite.setOpacity(this.baseOpacity)
    this.sprite.mesh.scale.set(o.size, o.size, 1)
    this.setPosition(o.pos.x, o.pos.y, o.pos.z)
    this.root.visible = true
    this.enableTick()
  }

  deactivate(): void {
    this.active = false
    this.root.visible = false
    this.disableTick()
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (!this.active) return
    this.age += dt
    const k = this.age / this.ttl
    const s = this.baseSize * (1 + this.grow * this.age)
    this.sprite.mesh.scale.set(s, s, 1)
    this.sprite.setOpacity(this.baseOpacity * Math.max(0, 1 - k))
    if (this.age >= this.ttl) {
      this.pool?.release(this)
    }
  }
}
