/**
 * PlayerCombatComponent — 玩家三段连击（M1 垂直切片）
 *
 * 三段节奏：每段 = 起手(windup) → 判定(active) → 收招(recover)；
 * active 帧做一次扇形命中查询（物理 queryAll 圆近似 + 朝向夹角过滤），
 * 命中 → 敌人 Health.damage + 击退 + 打击反馈三件套：
 *  - hitstop（world.hitstop，第三段更重）
 *  - 粒子（命中点爆发）
 *  - 音效（playAt 空间衰减）+ 第三段屏震（FollowCamera.shake）
 *
 * 连招缓冲：当前攻击进行中再按 → 排队下一段（窗口 = 整段时长 + 0.25s）；
 * 超时/未命中重置回第一段。
 */
import * as THREE from 'three'
import { ActorComponent } from '@/engine'
import { HealthComponent } from '@/engine'
import { audioSys } from '@/engine/audio/AudioSys'
import { logger } from '@/engine/Logger'
import type { Actor } from '@/engine'
import type { ColliderComponent } from '@/engine/physics/ColliderComponent'
import type { ArenaPlayerPawn } from './ArenaPlayerPawn'
import type { SlimeActor } from './SlimeActor'

/** 单段攻击配置 */
interface ComboStage {
  /** 起手时间（秒） */
  windup: number
  /** 判定窗口（秒） */
  active: number
  /** 收招时间（秒） */
  recover: number
  /** 伤害 */
  damage: number
  /** 击退强度（m/s） */
  knockback: number
  /** 攻击音效 */
  swingSfx: string
  /** 命中音效 */
  hitSfx: string
  /** hitstop 毫秒 */
  hitstopMs: number
}

const COMBO: ComboStage[] = [
  { windup: 0.1, active: 0.1, recover: 0.16, damage: 12, knockback: 3, swingSfx: 'player.attack1', hitSfx: 'hit.light', hitstopMs: 50 },
  { windup: 0.1, active: 0.1, recover: 0.18, damage: 14, knockback: 3.5, swingSfx: 'player.attack2', hitSfx: 'hit.light', hitstopMs: 50 },
  { windup: 0.14, active: 0.12, recover: 0.3, damage: 22, knockback: 8, swingSfx: 'player.attack3', hitSfx: 'hit.heavy', hitstopMs: 90 },
]

/** 攻击判定：范围（米）与半角（度，相对面朝方向） */
const ATTACK_RANGE = 2.4
const ATTACK_HALF_ANGLE = 65

type AttackPhase = 'idle' | 'windup' | 'active' | 'recover'

export class PlayerCombatComponent extends ActorComponent {
  /** 当前段（0 基；idle 时为 -1） */
  private _stage = -1
  private _phase: AttackPhase = 'idle'
  private _phaseTime = 0
  /** 连招缓冲：active/recover 期间的再按请求 */
  private _queued = false
  /** 整段结束后的缓冲窗口计时 */
  private _chainWindow = 0

  constructor(owner: Actor) {
    super(owner)
    this.name = 'PlayerCombatComponent'
  }

  private get _pawn(): ArenaPlayerPawn {
    return this.owner as ArenaPlayerPawn
  }

  /** 当前攻击阶段（AI 快照/调试） */
  get phase(): string {
    return this._phase
  }

  /** 当前段序（1 基显示；未攻击 0） */
  get stage(): number {
    return this._stage + 1
  }

  /**
   * 发起攻击（攻击键/AI）。返回是否被接受：
   * idle → 立即起手；攻击进行中 → 排队下一段（连招缓冲）。
   */
  attack(): boolean {
    if (this._pawn.health.isDead) return false
    if (this._phase === 'idle') {
      this._startStage(this._stage + 1)
      return true
    }
    // 连招缓冲（不排队第三段之后的循环——M1 固定三段，第三段后回到第一段）
    this._queued = true
    return true
  }

  /** 起手第 stage 段（0 基） */
  private _startStage(stage: number): void {
    this._stage = stage % COMBO.length
    this._phase = 'windup'
    this._phaseTime = 0
    this._queued = false
    audioSys.play(COMBO[this._stage].swingSfx, { volume: 0.8 })
  }

  override Tick(dt: number): void {
    const st = this._stage >= 0 ? COMBO[this._stage] : null
    if (!st) return
    this._phaseTime += dt

    switch (this._phase) {
      case 'windup':
        if (this._phaseTime >= st.windup) {
          this._phase = 'active'
          this._phaseTime = 0
          this._doHit(st)
        }
        break
      case 'active':
        if (this._phaseTime >= st.active) {
          this._phase = 'recover'
          this._phaseTime = 0
        }
        break
      case 'recover':
        if (this._phaseTime >= st.recover) {
          // 段结束：有缓冲 → 下一段；否则回 idle（保留短链窗口）
          if (this._queued) {
            this._startStage(this._stage + 1)
          } else {
            this._chainWindow = 0.25
            this._phase = 'idle'
            this._phaseTime = 0
          }
        }
        break
      case 'idle':
        // 链窗口内可接下一段（保持段序），超时重置
        if (this._chainWindow > 0) {
          this._chainWindow -= dt
          if (this._chainWindow <= 0) this._stage = -1
        }
        if (this._queued) {
          this._startStage(this._stage + 1)
        }
        break
    }
  }

  /** active 帧扇形命中：范围 + 朝向夹角过滤，命中全部应用伤害/击退/反馈 */
  private _doHit(st: ComboStage): void {
    const world = this.owner.world
    if (!world) return
    const pos = new THREE.Vector3()
    this.owner.root.getWorldPosition(pos)
    const yaw = this.owner.root.rotation.y
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const halfCos = Math.cos((ATTACK_HALF_ANGLE * Math.PI) / 180)

    // 物理圆查询（enemy 层）+ 距离/夹角精筛
    const hits = world.physics.queryAll(pos, ATTACK_RANGE, { group: 16 /* CollisionLayer.ENEMY */ })
    let hitAny = false
    for (const hit of hits) {
      const target = hit.collider.owner
      const health = target?.getComponent(HealthComponent)
      if (!health || health.isDead || health.team !== 'enemy') continue
      const tp = new THREE.Vector3()
      target.root.getWorldPosition(tp)
      const to = tp.clone().sub(pos)
      to.y = 0
      const dist = to.length()
      if (dist > ATTACK_RANGE + 0.5) continue
      if (dist > 0.1) {
        to.normalize()
        if (to.dot(fwd) < halfCos) continue // 背后不打
      }
      // 命中：伤害 + 击退 + 反馈
      health.damage(st.damage, this.owner)
      const slime = target as SlimeActor
      slime.applyKnockback?.(to.multiplyScalar(st.knockback))
      // 粒子：命中点火花（上飘小爆发）
      this._pawn.particles.emit({
        count: 14,
        speed: [1.5, 4],
        spread: 'hemisphere',
        lifetime: [0.15, 0.4],
        size: 0.12,
        color: ['#ffe08a', '#ff9d4d'],
        gravity: -12,
        additive: true,
        localOffset: [0, 0.9, 0],
      })
      audioSys.playAt(st.hitSfx, tp, { volume: 1, maxDistance: 40 })
      world.hitstop(st.hitstopMs)
      hitAny = true
    }
    // 第三段命中：屏震（经 GameMode 上的跟随相机）
    if (hitAny && st.hitstopMs >= 90) {
      const gm = world.gameMode as { shakeCamera?: (i: number, d: number) => void } | null
      gm?.shakeCamera?.(0.22, 0.25)
    }
    if (!hitAny) {
      logger.debug(`[Combat] 第 ${this._stage + 1} 段落空`)
    }
  }

  override getProperties(): Record<string, unknown> {
    return {
      phase: this._phase,
      stage: this.stage,
      queued: this._queued,
    }
  }
}
