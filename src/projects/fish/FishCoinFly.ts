/**
 * FishCoinFly — 金币飞向 UI 动画
 * 从鱼死亡位置生成数个金币，呈弧形飞向左上角金币面板位置，到达后消失。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent } from '@/engine'
import { makeCoinTexture } from './textures'
import { AREA_W, AREA_H } from './types'

let _coinTex: THREE.Texture | null = null
function coinTexture(): THREE.Texture {
  if (!_coinTex) _coinTex = makeCoinTexture()
  return _coinTex
}

/** 目标位置：对应左上角 COINS 面板的世界坐标 */
const TARGET_X = -AREA_W + 2
const TARGET_Y = AREA_H - 1.2

interface FlyCoin {
  mesh: THREE.Mesh
  /** 起始位置 */
  sx: number
  sy: number
  /** 飞行进度 0→1 */
  progress: number
  /** 飞行速度 */
  speed: number
  /** 随机延迟才开始飞 */
  delay: number
}

export class FishCoinFly extends Actor {
  private coins: FlyCoin[] = []
  private age = 0
  private allDone = false

  constructor(x: number, y: number, count: number = 5) {
    super('CoinFly')
    for (let i = 0; i < count; i++) {
      const sprite = new SpriteComponent(this, 0.5, 0.5, `CoinFly_${i}`)
      sprite.setTexture(coinTexture())
      this.addComponent(sprite)
      // 从鱼位置分散一点
      const sx = x + (Math.random() - 0.5) * 1.2
      const sy = y + (Math.random() - 0.5) * 1.2
      sprite.mesh.position.set(sx, sy, 0.7)
      this.coins.push({
        mesh: sprite.mesh,
        sx, sy,
        progress: 0,
        speed: 0.6 + Math.random() * 0.5,
        delay: i * 0.08 + Math.random() * 0.1,
      })
    }
  }

  override Tick(dt: number) {
    super.Tick(dt)
    this.age += dt
    let alive = 0

    for (const c of this.coins) {
      if (c.progress >= 1) {
        c.mesh.visible = false
        continue
      }
      alive++

      // 延迟后才开始飞
      if (this.age < c.delay) {
        // 原地轻微跳动
        const bounce = Math.sin(this.age * 20) * 0.02
        c.mesh.position.y += bounce
        continue
      }

      c.progress += c.speed * dt
      if (c.progress >= 1) {
        c.progress = 1
        c.mesh.visible = false
        continue
      }

      // 贝塞尔弧形：起始 → 目标（向上拱起）
      const t = c.progress
      const cx = c.sx + (TARGET_X - c.sx) * t
      const cy = c.sy + (TARGET_Y - c.sy) * t
      // 弧线高度（先升后降）
      const arcHeight = 2.5 * Math.sin(t * Math.PI)

      c.mesh.position.x = cx
      c.mesh.position.y = cy + arcHeight
      c.mesh.position.z = 0.7

      // 逐渐缩小 + 淡出
      const scale = 0.5 * (1 - t * 0.6)
      c.mesh.scale.set(scale, scale, 1)
      const mat = c.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, 1 - t * 0.7)
    }

    if (alive === 0) this.destroy()
  }
}
