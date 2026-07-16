/**
 * Demo2DPawn — 2D 玩家角色
 * 挂 SpriteComponent（CanvasTexture 程序化绘制），在 XY 平面连续移动，
 * 位置被夹在 ±BOUND 内。由 PlayerController 通过 SetDirection 驱动。
 */
import * as THREE from 'three'
import { Pawn, SpriteComponent, gizmos } from '@/engine'
import { BOUND, PLAYER_RADIUS } from './types'

const SPEED = 8

// Gizmos 复用临时对象（避免每帧分配）
const _pa = new THREE.Vector3()
const _pb = new THREE.Vector3()

/** 程序化生成玩家纹理（绿色圆球 + 眼睛），不依赖外部图片资源 */
function makePlayerTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#4ade80'
  ctx.beginPath()
  ctx.arc(32, 32, 28, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0a2a14'
  ctx.beginPath()
  ctx.arc(24, 26, 5, 0, Math.PI * 2)
  ctx.arc(40, 26, 5, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Demo2DPawn extends Pawn {
  private sprite: SpriteComponent
  private velocity = new THREE.Vector2(0, 0)
  private dir = new THREE.Vector2(0, 0)

  constructor() {
    super('Demo2DPawn')
    this.sprite = new SpriteComponent(this, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2, 'PlayerSprite')
    this.sprite.setTexture(makePlayerTexture())
    this.addComponent(this.sprite)
  }

  /** 设置移动方向（归一化向量），(0,0) 表示停止 */
  SetDirection(dx: number, dy: number) {
    this.dir.set(dx, dy)
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // 速度平滑趋近目标方向 × 速度
    const targetX = this.dir.x * SPEED
    const targetY = this.dir.y * SPEED
    const k = 1 - Math.exp(-12 * dt)
    this.velocity.x += (targetX - this.velocity.x) * k
    this.velocity.y += (targetY - this.velocity.y) * k
    // 更新 XY 位置（z 保持 0）
    const p = this.position
    p.x = THREE.MathUtils.clamp(p.x + this.velocity.x * dt, -BOUND, BOUND)
    p.y = THREE.MathUtils.clamp(p.y + this.velocity.y * dt, -BOUND, BOUND)
  }

  override OnDrawGizmos() {
    // XY 平面玩家范围圈（青色，用线段近似圆）
    gizmos.color = 0x00e5ff
    const cx = this.position.x
    const cy = this.position.y
    const segs = 12
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2
      const a2 = ((i + 1) / segs) * Math.PI * 2
      _pa.set(cx + Math.cos(a1) * PLAYER_RADIUS, cy + Math.sin(a1) * PLAYER_RADIUS, 0)
      _pb.set(cx + Math.cos(a2) * PLAYER_RADIUS, cy + Math.sin(a2) * PLAYER_RADIUS, 0)
      gizmos.DrawLine(_pa, _pb)
    }
  }
}
