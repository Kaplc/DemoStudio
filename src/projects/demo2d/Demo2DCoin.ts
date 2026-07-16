/**
 * Demo2DCoin — 2D 金币（可收集）
 * 挂 SpriteComponent（CanvasTexture），由 GameMode 在 XY 平面随机放置与重置。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent } from '@/engine'
import { COIN_RADIUS } from './types'

/** 程序化生成金币纹理（外金内深） */
function makeCoinTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffd200'
  ctx.beginPath()
  ctx.arc(32, 32, 26, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#b8860b'
  ctx.beginPath()
  ctx.arc(32, 32, 15, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Demo2DCoin extends Actor {
  private sprite: SpriteComponent

  constructor() {
    super('Demo2DCoin')
    this.sprite = new SpriteComponent(this, COIN_RADIUS * 2, COIN_RADIUS * 2, 'CoinSprite')
    this.sprite.setTexture(makeCoinTexture())
    this.addComponent(this.sprite)
  }
}
