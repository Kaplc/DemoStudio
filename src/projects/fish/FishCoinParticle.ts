/**
 * FishCoinParticle — 捕获金币飞溅特效
 * 在捕获点生成若干小金币向上飞溅（带重力）并淡出，短寿命自毁。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent } from '@/engine'
import { makeCoinTexture } from './textures'

let _coinTex: THREE.Texture | null = null
function coinTexture(): THREE.Texture {
  if (!_coinTex) _coinTex = makeCoinTexture()
  return _coinTex
}

interface Particle {
  mesh: THREE.Mesh
  vx: number
  vy: number
}

export class FishCoinParticle extends Actor {
  private parts: Particle[] = []
  private readonly ttl: number
  private age = 0

  constructor(x: number, y: number, count = 5) {
    super('CoinBurst')
    this.ttl = 0.8
    for (let i = 0; i < count; i++) {
      const sprite = new SpriteComponent(this, 0.5, 0.5, `Coin_${i}`)
      sprite.setTexture(coinTexture())
      this.addComponent(sprite)
      sprite.mesh.position.set(
        x + (Math.random() - 0.5) * 0.6,
        y + (Math.random() - 0.5) * 0.6,
        0.6,
      )
      this.parts.push({
        mesh: sprite.mesh,
        vx: (Math.random() - 0.5) * 4,
        vy: 4 + Math.random() * 4,
      })
    }
  }

  override Tick(dt: number) {
    super.Tick(dt)
    this.age += dt
    const k = this.age / this.ttl
    for (const p of this.parts) {
      p.mesh.position.x += p.vx * dt
      p.mesh.position.y += p.vy * dt
      p.vy -= 12 * dt // 重力
      const m = p.mesh.material as THREE.MeshBasicMaterial
      m.opacity = Math.max(0, 1 - k)
    }
    if (this.age >= this.ttl) this.destroy()
  }
}
