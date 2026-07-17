/**
 * FishCannon — 炮台(玩家 Pawn)
 * 跟随鼠标旋转炮管；按住连射；金币不足无法开炮。
 * 炮口闪光直接用 Sprite 挂在炮台下，不依赖对象池。
 */
import * as THREE from 'three'
import { Pawn, SpriteComponent, ConfigRegistry, logger } from '@/engine'
import { makeCannonTexture, makeFlashTexture } from './textures'
import { CANNON_Y } from './types'
import type { CannonConfig } from './types'

// 炮台纹理按等级缓存
const _cannonTex = new Map<number, THREE.Texture>()
function cannonTexture(level: number): THREE.Texture {
  let t = _cannonTex.get(level)
  if (!t) { t = makeCannonTexture(level); _cannonTex.set(level, t) }
  return t
}

// 闪光纹理
let _flashTex: THREE.Texture | null = null
function flashTex(): THREE.Texture {
  if (!_flashTex) _flashTex = makeFlashTexture()
  return _flashTex
}

interface CoinWallet { coins: number; spendCoins(n: number): void }

export class FishCannon extends Pawn {
  private sprite: SpriteComponent
  level: number = 1
  private aim = new THREE.Vector2(0, 1)
  private firing = false
  private cooldown = 0

  // ─── 炮口闪光（每个 Cannon 持有一个，反复用） ───
  private flashMat: THREE.MeshBasicMaterial
  private flashMesh: THREE.Mesh
  private flashVisible = false
  private flashAge = 0
  private flashTTL = 0.15
  private flashGrow = 6

  constructor() {
    super('FishCannon')
    this.sprite = new SpriteComponent(this, 2.4, 2.4, 'CannonSprite')
    this.sprite.setTexture(cannonTexture(1))
    this.addComponent(this.sprite)

    // 炮口闪光 mesh（直接挂在炮台 root 下，朝向 +Z）
    this.flashMat = new THREE.MeshBasicMaterial({
      map: flashTex(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.flashMat,
    )
    this.flashMesh.position.set(0, 1.4, 0.3) // 默认在炮口位置（朝 +Y）
    this.flashMesh.visible = false
    this.root.add(this.flashMesh)

    this.setPosition(0, CANNON_Y, 0.2)
  }

  SetAimTarget(world: THREE.Vector3) {
    const dx = world.x - this.position.x
    const dy = world.y - this.position.y
    this.rotation.z = Math.atan2(-dx, dy)
    this.aim.set(dx, dy).normalize()
  }

  SetFiring(on: boolean) { this.firing = on }

  SetLevel(n: number) {
    if (n === this.level) return
    this.level = n
    this.sprite.setTexture(cannonTexture(n))
  }

  get levelConfig() {
    const cfg = ConfigRegistry.getConfig<CannonConfig>('fish.cannon')
    return cfg.levels[this.level - 1] ?? cfg.levels[0]
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (this.cooldown > 0) this.cooldown -= dt
    if (this.firing && this.cooldown <= 0) this.tryFire()

    // 炮口闪光动画
    if (this.flashVisible) {
      this.flashAge += dt
      const k = this.flashAge / this.flashTTL
      const s = 1 + this.flashGrow * this.flashAge
      this.flashMesh.scale.set(s, s, 1)
      this.flashMat.opacity = Math.max(0, 1 - k)
      if (this.flashAge >= this.flashTTL) {
        this.flashVisible = false
        this.flashMesh.visible = false
      }
    }
  }

  /** 开炮 */
  private tryFire(): boolean {
    const cfg = this.levelConfig
    const wallet = this.world?.gameMode as unknown as (CoinWallet & object) | null
    if (!wallet || wallet.coins < cfg.cost) return false
    wallet.spendCoins(cfg.cost)
    this.cooldown = cfg.fireCooldown

    // 炮口位置（基于瞄准方向）
    const muzzleLen = 1.4
    const pos = new THREE.Vector3(
      this.position.x + this.aim.x * muzzleLen,
      this.position.y + this.aim.y * muzzleLen,
      0.3,
    )

    // 发射子弹（对象池）
    const pools = (this.world?.gameMode as any)?.pools
    if (pools) {
      pools.acquireBullet({
        pos,
        dir: new THREE.Vector3(this.aim.x, this.aim.y, 0),
        speed: cfg.netSpeed,
        netRadius: cfg.netRadius,
        power: cfg.power,
        captureBonus: cfg.captureBonus,
      })
    }

    // ─── 炮口闪光（本地 mesh，位置已在构造时固定到炮口，随 root 旋转自动跟随） ───
    this.flashMesh.scale.set(cfg.netRadius * 2.6, cfg.netRadius * 2.6, 1)
    this.flashMesh.visible = true
    this.flashVisible = true
    this.flashAge = 0
    this.flashMat.opacity = 0.9

    return true
  }

  override EndPlay() {
    this.flashMat.dispose()
    this.flashMesh.geometry.dispose()
    super.EndPlay()
  }
}
