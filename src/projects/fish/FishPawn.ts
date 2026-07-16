/**
 * FishPawn — 鱼
 * 沿水平方向游过屏幕并带正弦摆动；被网命中触发捕获判定。
 * 纹理默认朝右，左行时翻转 scale.x。
 */
import * as THREE from 'three'
import { Actor, SpriteComponent } from '@/engine'
import { makeFishTexture } from './textures'
import type { FishType } from './types'

// 鱼纹理按 art 缓存
const _texCache = new Map<string, THREE.Texture>()
function fishTexture(art: string): THREE.Texture {
  let t = _texCache.get(art)
  if (!t) {
    t = makeFishTexture(art as FishType['art'])
    _texCache.set(art, t)
  }
  return t
}

export class FishPawn extends Actor {
  readonly config: FishType
  hp: number
  /** 本条鱼已被捕获标记，避免重复处理 */
  captured = false

  private vx: number
  private baseY = 0
  private phase: number
  private amp: number
  private baseScaleX: number
  /** 受击弹跳量（>0 时放大，衰减回 0） */
  private hitPunch = 0
  private sprite: SpriteComponent

  constructor(config: FishType, fromLeft: boolean) {
    super(`Fish_${config.key}`)
    this.config = config
    this.hp = config.hp
    this.vx = fromLeft ? config.speed : -config.speed
    this.amp = 0.4 + Math.random() * 0.8
    this.phase = Math.random() * Math.PI * 2
    const [w, h] = config.size
    this.sprite = new SpriteComponent(this, w, h, 'FishSprite')
    this.sprite.setTexture(fishTexture(config.art))
    this.baseScaleX = fromLeft ? 1 : -1 // 左行翻转
    this.addComponent(this.sprite)
  }

  /** 由 GameMode 在出生边缘设置位置 */
  spawnAt(edgeX: number, y: number) {
    this.baseY = y
    this.setPosition(edgeX, y, 0)
  }

  /** 调整游速倍率 (群游时每条鱼微调，产生错落感) */
  setSpeedVariation(factor: number) {
    this.vx = (this.vx > 0 ? 1 : -1) * this.config.speed * factor
  }

  override Tick(dt: number) {
    super.Tick(dt)
    this.position.x += this.vx * dt
    this.phase += dt * 2
    this.position.y = this.baseY + Math.sin(this.phase) * this.amp
    // 鱼身摆动（绕 z 轴轻微摇摆，模拟游泳）
    this.sprite.mesh.rotation.z = Math.sin(this.phase * 3) * 0.12
    // 受击弹跳（放大后衰减，与翻转 baseScaleX 叠加）
    if (this.hitPunch > 0) this.hitPunch = Math.max(0, this.hitPunch - dt * 3)
    const s = 1 + this.hitPunch
    const [baseW, baseH] = this.sprite.getSize()
    this.sprite.mesh.scale.set(this.baseScaleX * s * baseW, s * baseH, 1)
  }

  /** 被网命中：roll 捕获率或扣 hp，返回是否被捕获 */
  TakeHit(power: number, captureBonus: number): boolean {
    if (this.captured) return false
    const chance = Math.min(0.95, this.config.captureChance * captureBonus)
    if (Math.random() < chance) {
      this.captured = true
      return true
    }
    this.hp -= power
    this.hitPunch = 0.35 // 受击弹跳反馈（打中了但没死）
    if (this.hp <= 0) {
      this.captured = true
      return true
    }
    return false
  }
}
