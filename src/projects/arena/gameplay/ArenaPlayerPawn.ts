/**
 * ArenaPlayerPawn — 玩家角色（第三人称胶囊体）
 *
 * 装配：胶囊视觉 + dynamic 胶囊碰撞体（player 层）+ CharacterControllerComponent
 * （引擎 A2）+ HealthComponent（引擎 B2）+ ParticleEmitterComponent（打击火花）。
 * 移动/跳跃/翻滚全部由引擎角色控制器驱动；攻击连击在 PlayerCombatComponent。
 */
import * as THREE from 'three'
import { Pawn } from '@/engine'
import { CapsuleColliderComponent } from '@/engine'
import { CharacterControllerComponent } from '@/engine'
import { HealthComponent } from '@/engine'
import { ParticleEmitterComponent } from '@/engine'
import { ThreeObject } from '@/engine'
import { createMesh, createCapsuleGeometry, createMeshStandardMaterial } from '@/engine/gameflow/ThreeObjectUtils'
import { ThreeObjectComponent } from '@/engine/rendering/ThreeObjectComponent'
import { PlayerCombatComponent } from './PlayerCombatComponent'
import type { Actor } from '@/engine'

/** 玩家胶囊视觉（ThreeObject 托管，随 Actor 生命周期释放） */
class PlayerCapsuleVisual extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  readonly obj: ThreeObject<THREE.Mesh>
  constructor(owner: Actor) {
    super(owner, 'PlayerCapsuleVisual')
    const geo = createCapsuleGeometry(0.42, 0.7, 4, 12)
    const mat = createMeshStandardMaterial({ color: 0x5ec8f2 })
    this.obj = this.wrap(createMesh(geo, mat))
    this.obj.object.castShadow = true
    this.obj.object.position.y = 0.8
    this.attachToRoot(this.obj)
  }
}

export class ArenaPlayerPawn extends Pawn {
  collider: CapsuleColliderComponent
  /** 引擎角色控制器（命名避开 Pawn.controller: PlayerController 基类字段） */
  charCtrl: CharacterControllerComponent
  health: HealthComponent
  particles: ParticleEmitterComponent
  combat: PlayerCombatComponent

  constructor(name = 'ArenaPlayer') {
    super(name)
    // 视觉：胶囊体
    this.addComponent(PlayerCapsuleVisual)

    // 物理：dynamic 胶囊（低摩擦——摩擦预算 ∝ |g|，速度全权交给控制器）
    this.collider = this.addComponent(CapsuleColliderComponent)
    this.collider.bodyType = 'dynamic'
    this.collider.mass = 1
    this.collider.lockY = false
    this.collider.linearDamping = 0
    this.collider.radius = 0.42
    this.collider.length = 0.7
    this.collider.group = 'player'
    this.collider.mask = ['default', 'enemy', 'pickup']
    this.collider.offset = [0, 0.8, 0]

    // 引擎角色控制器（A2）
    this.charCtrl = this.addComponent(CharacterControllerComponent)
    this.charCtrl.speed = 7
    this.charCtrl.acceleration = 50
    this.charCtrl.jumpSpeed = 9
    this.charCtrl.dodgeSpeed = 13
    this.charCtrl.dodgeDuration = 0.25
    this.charCtrl.dodgeCooldown = 0.8
    this.charCtrl.cameraRelative = true

    // 血量（B2）：受击无敌帧 0.5s
    this.health = this.addComponent(HealthComponent)
    this.health.maxHp = 100
    this.health.team = 'player'
    this.health.invulnDuration = 0.5
    this.health.resetHp()

    // 打击粒子
    this.particles = this.addComponent(ParticleEmitterComponent)

    // 三段连击
    this.combat = this.addComponent(PlayerCombatComponent)
  }

  override BeginPlay(): void {
    super.BeginPlay()
    this.enableTick()
  }

  /** 受击闪白 + 受击音（Health.onDamaged 由 GameMode 装配时接音效） */
  flashHurt(): void {
    const visual = this.getComponent(PlayerCapsuleVisual)
    const mesh = visual?.obj.object
    const mat = mesh?.material as THREE.MeshStandardMaterial | undefined
    if (!mat) return
    mat.emissive.set(0xff3333)
    window.setTimeout(() => mat.emissive.set(0x000000), 120)
  }
}
