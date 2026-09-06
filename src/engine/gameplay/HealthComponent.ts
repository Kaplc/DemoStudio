/**
 * HealthComponent — 通用血量/伤害组件（B2）
 *
 * 从 fish 手写的 TroopHealth / GameMode 建筑血量 Map 下沉为引擎组件：
 *  - damage(amount, source?)：受击（无敌帧窗口内/已死亡时拒绝）
 *  - heal / revive / resetHp
 *  - onDamaged / onDied / onHealed 委托（击退/粒子/音效/掉落由游戏代码订阅）
 *  - invulnDuration：受击后无敌帧窗口（Tick 衰减；闪避无敌由游戏代码经
 *    grantInvulnerability(sec) 手动授予）
 *  - team：阵营（'player'|'enemy'|'neutral'），伤害过滤由游戏代码判定
 *
 * Tick 需求：owner Actor 需 enableTick()（无敌帧衰减用）。
 */
import { ActorComponent } from '../entity/ActorComponent'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'

export type HealthTeam = 'player' | 'enemy' | 'neutral'

/** 伤害结果：applied=已结算 / invulnerable=无敌帧内 / dead=已死亡无法再受伤 */
export type DamageResult = 'applied' | 'invulnerable' | 'dead'

export class HealthComponent extends ActorComponent {
  /** 最大血量 */
  maxHp = 100
  /** 阵营（伤害过滤/目标索敌用） */
  team: HealthTeam = 'neutral'
  /** 受击后无敌帧窗口（秒；0 = 无敌帧关闭） */
  invulnDuration = 0

  private _hp = -1 // -1 = 未初始化（读作 maxHp，允许先配 maxHp 再 resetHp/直接读）
  private _dead = false
  private _invulnTimer = 0

  // ─── 事件委托 ───
  onDamaged: ((amount: number, source: unknown) => void) | null = null
  onDied: ((source: unknown) => void) | null = null
  onHealed: ((amount: number) => void) | null = null

  constructor(owner: Actor) {
    super(owner)
    this.name = 'HealthComponent'
  }

  /** 当前血量（未显式初始化时 = maxHp） */
  get hp(): number {
    return this._hp < 0 ? this.maxHp : this._hp
  }

  /** 是否死亡 */
  get isDead(): boolean {
    return this._dead
  }

  /** 血量比例 [0,1]（血条/AI 快照用） */
  get ratio(): number {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0
  }

  /** 无敌帧是否生效中 */
  get isInvulnerable(): boolean {
    return this._invulnTimer > 0
  }

  /** 初始化/重置血量（对象池复用、开局配置 maxHp 后调用） */
  resetHp(hp?: number): void {
    this._hp = Math.max(0, hp ?? this.maxHp)
    this._dead = this._hp <= 0
    this._invulnTimer = 0
  }

  /**
   * 结算伤害。返回 applied 表示已扣血；invulnerable/dead 表示被拒绝。
   * source 透传给 onDamaged/onDied（攻击者/投射物等）。
   */
  damage(amount: number, source?: unknown): DamageResult {
    if (this._dead) return 'dead'
    if (amount <= 0) return 'applied'
    if (this._invulnTimer > 0) return 'invulnerable'
    if (this._hp < 0) this._hp = this.maxHp
    this._hp = Math.max(0, this._hp - amount)
    this._invulnTimer = this.invulnDuration
    this.onDamaged?.(amount, source)
    if (this._hp <= 0) {
      this._dead = true
      this.onDied?.(source)
    }
    return 'applied'
  }

  /** 治疗（ clamp 到 maxHp；死亡不可治疗） */
  heal(amount: number): number {
    if (this._dead || amount <= 0) return 0
    if (this._hp < 0) this._hp = this.maxHp
    const before = this._hp
    this._hp = Math.min(this.maxHp, this._hp + amount)
    const applied = this._hp - before
    if (applied > 0) this.onHealed?.(applied)
    return applied
  }

  /** 复活（比例填充；重置无敌帧与死亡标记） */
  revive(fraction = 1): void {
    this._dead = false
    this._hp = Math.max(1, Math.round(this.maxHp * Math.min(1, Math.max(0, fraction))))
    this._invulnTimer = 0
  }

  /** 手动授予一段无敌时间（秒；取与剩余时间的较大值。闪避无敌帧用） */
  grantInvulnerability(seconds: number): void {
    if (seconds <= 0) return
    this._invulnTimer = Math.max(this._invulnTimer, seconds)
  }

  override Tick(dt: number): void {
    if (this._invulnTimer > 0) {
      this._invulnTimer = Math.max(0, this._invulnTimer - dt)
    }
  }

  override getProperties(): Record<string, unknown> {
    return {
      hp: Math.round(this.hp * 10) / 10,
      maxHp: this.maxHp,
      team: this.team,
      dead: this._dead,
      invulnerable: this.isInvulnerable,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      { key: 'maxHp', type: 'number', min: 1, step: 5, get: () => this.maxHp, set: (v) => { this.maxHp = Math.max(1, v as number) } },
      {
        key: 'team', type: 'enum', options: ['player', 'enemy', 'neutral'],
        get: () => this.team, set: (v) => { this.team = v as HealthTeam },
      },
      { key: 'invulnDuration', type: 'number', min: 0, step: 0.05, get: () => this.invulnDuration, set: (v) => { this.invulnDuration = v as number } },
      {
        // 直接写血量（状态注入通道：ai.setProperty / GM / 调试；不走 damage 事件管线，
        // 不触发 onDamaged/onDied——只同步死亡标记）
        key: 'hp', type: 'number', min: 0,
        get: () => this.hp,
        set: (v) => {
          this._hp = Math.max(0, Math.min(this.maxHp, v as number))
          this._dead = this._hp <= 0
        },
      },
    ]
  }
}
