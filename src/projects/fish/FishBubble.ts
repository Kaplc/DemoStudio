/**
 * FishBubble — 上升气泡（氛围装饰，池化版本）
 * 从底部缓慢上浮 + 轻微左右摆动，到顶部释放回池。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent, ObjectPool } from '@/engine'
import type { IPoolable } from '@/engine'
import { makeBubbleTexture } from './textures'
import { AREA_H } from './types'

let _tex: ReturnType<typeof makeBubbleTexture> | null = null
function tex() {
  if (!_tex) _tex = makeBubbleTexture()
  return _tex
}

export class FishBubble extends Actor implements IPoolable {
  pool: ObjectPool<FishBubble> | null = null
  active = false

  private vy = 0
  private phase = 0
  private amp = 0
  private baseX = 0
  private sprite: SpriteComponent

  constructor() {
    super('Bubble')
    this.sprite = new SpriteComponent(this, 1, 1, 'BubbleSprite')
    this.sprite.setTexture(tex())
    this.addComponent(this.sprite)
    this.deactivate()
  }

  activate(opts?: any): void {
    const data = opts as { x: number; y: number } | undefined
    this.active = true
    const size = 0.3 + Math.random() * 0.5
    this.sprite.setSize(size, size)
    this.sprite.setOpacity(0.6)
    this.baseX = data?.x ?? 0
    this.vy = 1.5 + Math.random() * 1.6
    this.amp = 0.2 + Math.random() * 0.4
    this.phase = Math.random() * Math.PI * 2
    this.setPosition(this.baseX, data?.y ?? -AREA_H, -0.6)
    this.root.visible = true
  }

  deactivate(): void {
    this.active = false
    this.root.visible = false
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (!this.active) return
    this.position.y += this.vy * dt
    this.phase += dt * 2
    this.position.x = this.baseX + Math.sin(this.phase) * this.amp
    if (this.position.y > AREA_H + 1) {
      this.pool?.release(this)
    }
  }
}
