/**
 * FishCannon — 炮台(玩家 Pawn)
 * 跟随鼠标旋转炮管；按住连射；金币不足无法开炮。
 * 炮口闪光由 MuzzleFlashComponent 组件自管（放大 + 淡出动画），本类只负责触发。
 */
import * as THREE from 'three'
import { Pawn, SpriteComponent, ConfigRegistry, GameInstance } from '@/engine'
import { makeCannonTexture } from '../common/textures'
import { CANNON_Y } from '../common/types'
import type { CannonConfig } from '../common/types'
import type { FishGameInstance } from '../FishGameInstance'
import { MuzzleFlashComponent } from './comp/MuzzleFlashComponent'

// 炮台纹理按等级缓存
const _cannonTex = new Map<number, THREE.Texture>()
function cannonTexture(level: number): THREE.Texture {
  let t = _cannonTex.get(level)
  if (!t) { t = makeCannonTexture(level); _cannonTex.set(level, t) }
  return t
}

export class FishCannon extends Pawn {
  private sprite: SpriteComponent
  level: number = 1
  private aim = new THREE.Vector2(0, 1)
  private firing = false
  private cooldown = 0

  constructor() {
    super('FishCannon')
    this.sprite = this.addComponent(SpriteComponent, 2.4, 2.4, 'CannonSprite')
    this.sprite.setTexture(cannonTexture(1))

    // 炮口闪光组件（mesh/材质/动画全部内聚在组件内部，本类只触发）
    this.addComponent(MuzzleFlashComponent)

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
  }

  /** 开炮 */
  private tryFire(): boolean {
    const cfg = this.levelConfig
    // 直接取 GameInstance 上的资源组件（金币钱包，跨阶段共享）
    const res = (GameInstance.current as FishGameInstance | null)?.resources
    if (!res || !res.has('coins', cfg.cost)) return false
    res.spend('coins', cfg.cost)
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

    // ─── 炮口闪光（MuzzleFlashComponent 自管动画；位置已固定在炮口，随 root 旋转自动跟随） ───
    this.getComponent(MuzzleFlashComponent)?.flash(cfg.netRadius * 2.6)

    return true
  }
}
