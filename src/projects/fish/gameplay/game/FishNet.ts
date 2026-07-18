/**
 * FishNet — 张开的网（展开态，池化版本）
 * 从 0 展开到全尺寸→捕获判定→淡出消失。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent, ObjectPool } from '@/engine'
import type { IPoolable } from '@/engine'
import { makeNetTexture } from '../common/textures'

let _netTex: THREE.Texture | null = null
function netTexture(): THREE.Texture {
  if (!_netTex) _netTex = makeNetTexture()
  return _netTex
}

export interface FishNetOptions {
  pos: THREE.Vector3
  radius: number
  power: number
  captureBonus: number
}

const EXPAND_TIME = 0.14
const FADE_TIME = 0.26

export class FishNet extends Actor implements IPoolable {
  pool: ObjectPool<FishNet> | null = null
  active = false

  radius = 0
  power = 0
  captureBonus = 0
  expanded = false
  consumed = false
  private age = 0
  private sprite: SpriteComponent
  private fullSize = 0

  constructor() {
    super('FishNet')
    this.sprite = new SpriteComponent(this, 1, 1, 'NetSprite')
    this.sprite.setTexture(netTexture())
    this.sprite.setOpacity(0.9)
    this.addComponent(this.sprite)
    this.deactivate()
  }

  activate(opts?: any): void {
    const o = opts as FishNetOptions
    this.active = true
    this.radius = o.radius
    this.power = o.power
    this.captureBonus = o.captureBonus
    this.expanded = false
    this.consumed = false
    this.age = 0
    const d = o.radius * 2
    this.fullSize = d
    this.sprite.setSize(d, d)
    this.sprite.mesh.scale.set(d * 0.01, d * 0.01, 1)
    this.setPosition(o.pos.x, o.pos.y, o.pos.z)
    this.sprite.setOpacity(0.9)
    this.root.visible = true
  }

  deactivate(): void {
    this.active = false
    this.root.visible = false
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (!this.active) return
    this.age += dt
    if (this.age < EXPAND_TIME) {
      const k = this.age / EXPAND_TIME
      this.sprite.mesh.scale.set(this.fullSize * k, this.fullSize * k, 1)
    } else {
      this.expanded = true
      const k = Math.max(0, 1 - (this.age - EXPAND_TIME) / FADE_TIME)
      this.sprite.mesh.scale.set(this.fullSize, this.fullSize, 1)
      this.sprite.setOpacity(0.9 * k)
      if (this.age >= EXPAND_TIME + FADE_TIME) {
        this.pool?.release(this)
      }
    }
  }
}
