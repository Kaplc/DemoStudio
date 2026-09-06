/**
 * SlimeActor — 史莱姆敌人（M1 垂直切片）
 *
 * 装配：球体视觉（挤压拉伸动画）+ dynamic 球碰撞体（enemy 层）+
 * HealthComponent（enemy 阵营）+ StateMachineComponent（引擎 A8）四态：
 *   idle（停顿）→ chase（追击玩家）→ windup（蓄力前摇）→ attack（扑击）
 *   → recover（硬直）→ chase…；死亡进 dead（缩放溶解后销毁）。
 *
 * 伤害：扑击窗口内碰撞玩家 → 12 伤害 + 击退（碰撞事件驱动）。
 * 受击：onDamaged → 闪白 + 击退（attack 来源方向）；onDied → 死亡流程。
 */
import * as THREE from 'three'
import { Actor } from '@/engine'
import { CapsuleColliderComponent } from '@/engine'
import { SphereMeshComponent } from '@/engine'
import { HealthComponent } from '@/engine'
import { StateMachineComponent } from '@/engine'
import { ParticleEmitterComponent } from '@/engine'
import { audioSys } from '@/engine/audio/AudioSys'
import { logger } from '@/engine/Logger'
import { createMesh, createSphereGeometry, createMeshStandardMaterial } from '@/engine/gameflow/ThreeObjectUtils'
import type { ArenaPlayerPawn } from './ArenaPlayerPawn'

/** 数值配置（M1 内联；M2 迁配置表） */
const SLIME_HP = 40
const SLIME_CHASE_SPEED = 3.2
const SLIME_LUNGE_SPEED = 9
const SLIME_DAMAGE = 12
const WINDUP_TIME = 0.5
const ATTACK_TIME = 0.42
const RECOVER_TIME = 0.7
const AGGRO_RANGE = 12
const ATTACK_RANGE = 1.9

export class SlimeActor extends Actor {
  collider: CapsuleColliderComponent
  health: HealthComponent
  fsm: StateMachineComponent
  particles: ParticleEmitterComponent
  /** 目标玩家（GameMode 注入） */
  target: ArenaPlayerPawn | null = null
  /** 死亡完成回调（GameMode 清点用） */
  onDeathComplete: ((slime: SlimeActor) => void) | null = null

  private _attackTimer = 0
  private _idleTimer = 0
  private _attacking = false
  private _dying = false
  private _flashUntil = 0
  private _baseScaleY = 1

  constructor(name = 'Slime') {
    super(name)
    // 视觉：球体史莱姆（emissive 闪白用 standard 材质）
    const visual = this.addComponent(
      SphereMeshComponent,
      createMesh(createSphereGeometry(0.7, 16, 16), createMeshStandardMaterial({ color: 0x7ddf64 })),
      'SlimeVisual',
    )
    visual.radius = 0.7

    // 物理：dynamic 球（cannon 侧用 Sphere 近似；低摩擦同玩家）
    this.collider = this.addComponent(CapsuleColliderComponent)
    this.collider.bodyType = 'dynamic'
    this.collider.mass = 0.8
    this.collider.lockY = false
    this.collider.linearDamping = 0
    this.collider.radius = 0.7
    this.collider.length = 0.2
    this.collider.group = 'enemy'
    this.collider.mask = ['default', 'player']

    this.health = this.addComponent(HealthComponent)
    this.health.maxHp = SLIME_HP
    this.health.team = 'enemy'
    this.health.resetHp()

    this.particles = this.addComponent(ParticleEmitterComponent)

    this.fsm = this.addComponent(StateMachineComponent)
    this._buildFsm()
  }

  override BeginPlay(): void {
    super.BeginPlay()
    this.enableTick()
    this._baseScaleY = this.root.scale.y
    // 受击闪白（emissive 瞬时置位）+ 死亡接管
    this.health.onDamaged = (amount, source) => {
      this._flashUntil = performance.now() + 110
      audioSys.playAt('enemy.hit', this.root.position, { maxDistance: 40 })
      // 击退：来源方向（attack 来源 = 玩家 Actor）
      const src = source as import('@/engine').Actor | undefined
      if (src?.root) {
        const dir = this.root.position.clone().sub(src.root.position)
        dir.y = 0
        if (dir.lengthSq() > 1e-4) {
          dir.normalize().multiplyScalar(6)
          this.collider.body?.wakeUp()
          this.collider.body!.velocity.x += dir.x
          this.collider.body!.velocity.z += dir.z
        }
      }
      void amount
    }
    this.health.onDied = () => this._die()
    // 扑击碰撞 → 伤害玩家
    this.collider.onCollisionEnter = (e) => {
      if (!this._attacking) return
      const otherHealth = e.other.owner?.getComponent(HealthComponent)
      if (otherHealth && otherHealth.team === 'player' && !otherHealth.isDead) {
        otherHealth.damage(SLIME_DAMAGE, this)
        const otherPawn = e.other.owner as ArenaPlayerPawn
        otherPawn.flashHurt?.()
        const dir = otherPawn.root.position.clone().sub(this.root.position)
        dir.y = 0
        dir.normalize().multiplyScalar(7)
        otherPawn.charCtrl.knockback(dir.x, 3, dir.z)
        audioSys.playAt('player.hurt', otherPawn.root.position, { maxDistance: 40 })
        this._attacking = false // 一次扑击只结算一次伤害
      }
    }
    this.fsm.start()
  }

  /** 四态状态机（引擎 A8 表驱动 FSM） */
  private _buildFsm(): void {
    const distToTarget = (): number => {
      if (!this.target || this.target.health.isDead) return Infinity
      return this.root.position.distanceTo(this.target.root.position)
    }

    this.fsm
      .addState({
        name: 'idle',
        onEnter: () => {
          this._idleTimer = 0.6 + Math.random() * 0.8
          this.collider.setVelocity(0, 0)
        },
        onUpdate: (dt) => {
          this._idleTimer -= dt
          this._faceTarget()
        },
      })
      .addState({
        name: 'chase',
        onEnter: () => audioSys.playAt('slime.jump', this.root.position, { maxDistance: 30 }),
        onUpdate: () => {
          this._faceTarget()
          const t = this.target
          if (!t) return
          const dir = t.root.position.clone().sub(this.root.position)
          dir.y = 0
          if (dir.lengthSq() > 1e-4) {
            dir.normalize().multiplyScalar(SLIME_CHASE_SPEED)
            this.collider.setVelocity(dir.x, dir.z)
          }
          // 挤压行进动画
          const squash = 1 + Math.sin(performance.now() / 90) * 0.08
          this.root.scale.y = this._baseScaleY * squash
        },
      })
      .addState({
        name: 'windup',
        onEnter: () => {
          this._attackTimer = WINDUP_TIME
          this.collider.setVelocity(0, 0)
          audioSys.playAt('slime.attack', this.root.position, { maxDistance: 30 })
        },
        onUpdate: (dt) => {
          this._attackTimer -= dt
          this._faceTarget()
          // 蓄力压扁（起跳前摇）
          this.root.scale.y = this._baseScaleY * Math.max(0.55, 1 - (1 - this._attackTimer / WINDUP_TIME) * 0.45)
        },
      })
      .addState({
        name: 'attack',
        onEnter: () => {
          this._attackTimer = ATTACK_TIME
          this._attacking = true
          // 扑向玩家当前位置
          const t = this.target
          if (t) {
            const dir = t.root.position.clone().sub(this.root.position)
            dir.y = 0
            if (dir.lengthSq() > 1e-4) {
              dir.normalize().multiplyScalar(SLIME_LUNGE_SPEED)
              this.collider.body?.wakeUp()
              this.collider.body!.velocity.x = dir.x
              this.collider.body!.velocity.z = dir.z
              this.collider.body!.velocity.y = 3.5
            }
          }
        },
        onUpdate: (dt) => {
          this._attackTimer -= dt
          // 滞空拉伸
          this.root.scale.y = this._baseScaleY * 1.25
        },
        onExit: () => {
          this._attacking = false
        },
      })
      .addState({
        name: 'recover',
        onEnter: () => {
          this._attackTimer = RECOVER_TIME
          this.collider.setVelocity(0, 0)
        },
        onUpdate: (dt) => {
          this._attackTimer -= dt
          // 落地回弹
          const t = this._attackTimer / RECOVER_TIME
          this.root.scale.y = this._baseScaleY * (0.75 + 0.25 * (1 - t))
        },
      })
      .addState({
        name: 'dead',
        onEnter: () => {
          this.collider.setVelocity(0, 0)
        },
      })

    // 转换表（注册序 = 优先级）
    this.fsm
      .addTransition({ from: 'idle', to: 'dead', when: () => this.health.isDead })
      .addTransition({ from: 'idle', to: 'chase', when: () => distToTarget() < AGGRO_RANGE })
      .addTransition({ from: 'chase', to: 'dead', when: () => this.health.isDead })
      .addTransition({ from: 'chase', to: 'windup', when: () => distToTarget() < ATTACK_RANGE })
      .addTransition({ from: 'windup', to: 'dead', when: () => this.health.isDead })
      .addTransition({ from: 'windup', to: 'attack', when: () => this._attackTimer <= 0 })
      .addTransition({ from: 'attack', to: 'recover', when: () => this._attackTimer <= 0 })
      .addTransition({ from: 'recover', to: 'dead', when: () => this.health.isDead })
      .addTransition({ from: 'recover', to: 'chase', when: () => this._attackTimer <= 0 })
  }

  /** 面朝目标（仅视觉 yaw；body fixedRotation） */
  private _faceTarget(): void {
    const t = this.target
    if (!t) return
    const dir = t.root.position.clone().sub(this.root.position)
    if (dir.lengthSq() < 1e-4) return
    this.root.rotation.y = Math.atan2(dir.x, dir.z)
  }

  /** 外部击退（玩家连击第三段重击用；onDamaged 自带基础击退之外的加成） */
  applyKnockback(dir: THREE.Vector3): void {
    const body = this.collider.body
    if (!body) return
    body.wakeUp()
    body.velocity.x += dir.x
    body.velocity.z += dir.z
  }

  /** 死亡流程：FSM 入 dead + 粒子 + 音效 + 缩放溶解（Tick 驱动） */
  private _die(): void {
    if (this._dying) return
    this._dying = true
    this.fsm.setState('dead')
    audioSys.playAt('enemy.die', this.root.position, { maxDistance: 40 })
    this.particles.emit({
      count: 22,
      speed: [2, 6],
      spread: 'hemisphere',
      lifetime: [0.3, 0.7],
      size: 0.14,
      color: ['#7ddf64', '#3a9e4a'],
      gravity: -14,
      additive: false,
      localOffset: [0, 0.7, 0],
    })
    logger.info(`[Slime] ${this.name} 死亡`)
  }

  override Tick(dt: number): void {
    super.Tick(dt) // 驱动组件链（StateMachineComponent 的转换判定在此，绝不能漏）
    // 死亡溶解：缩放至零后销毁并通知清点
    if (this._dying) {
      const s = Math.max(0, this.root.scale.x - dt * 2.6)
      this.root.scale.set(s, this.root.scale.y * 0.92, s)
      if (s <= 0.02) {
        this.onDeathComplete?.(this)
        this.onDeathComplete = null
        this.destroy()
      }
      return
    }
    // 受击闪白衰减
    if (this._flashUntil > 0) {
      const visual = this.getComponent(SphereMeshComponent)
      const mat = visual?.mesh.material as import('three').MeshStandardMaterial | undefined
      if (mat) {
        if (performance.now() < this._flashUntil) mat.emissive.set(0xffffff)
        else {
          mat.emissive.set(0x000000)
          this._flashUntil = 0
        }
      }
    }
    void dt
  }
}
