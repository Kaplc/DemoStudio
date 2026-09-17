/**
 * AbilityComponents — 兵种专属能力组件（炸弹人破墙自爆 / 治疗师周期治疗 / 狂暴光环）
 *
 * 组件组合原则（与 TroopAttack/Move/Target 同级）：
 *  - WallBreakerAbilityComponent：攻击目标为城墙时伤害 × wallDamageMultiplier；
 *    命中（或接触到目标）后自爆移除自身（一次性单位）
 *  - HealerAbilityComponent：周期性对半径内生命值最低且未满血的友军恢复 healAmount；
 *    自身无攻击（dps=0），跟随友军集群（寻路由既有 TroopMove 承担）
 *  - RageAuraComponent：狂暴法术落点生成的光环，持续时间内对半径内友军攻速/移速增益
 *
 * 装配：TroopActors.makeTroopClass activate 时按 troop.ability 挂载。
 */
import { ActorComponent, logger, type Actor } from '@/engine'
import { TroopTargetComponent } from './TroopTargetComponent'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'
import type { TroopAbility } from '../../common/types'
import type { TroopActor } from './TroopActors'
import { TroopHealthComponent } from './TroopHealthComponent'

// ════════════════════════════════════════════
//  炸弹人：对城墙倍伤 + 自爆
// ════════════════════════════════════════════

export class WallBreakerAbilityComponent extends ActorComponent {
  private readonly gm: FishLevelGameMode
  private readonly cfg: TroopAbility
  /** 是否已自爆（防重复移除） */
  private detonated = false
  /** 攻击发射钩子（TroopActors 装配时注入：拦截 BATTLE_TROOP_ATTACK 伤害计算前的目标信息） */

  constructor(owner: Actor, gm: FishLevelGameMode, cfg: TroopAbility) {
    super(owner)
    this.name = 'WallBreakerAbilityComponent'
    this.gm = gm
    this.cfg = cfg
  }

  /** 每帧：目标为城墙且已接触 → 自爆（一次性，倍伤直接通过 damageBuilding 落地） */
  override Tick(_dt: number): void {
    if (this.detonated) return
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) return
    const isWall = target.type.id === 'wall'
    if (!isWall) return // 无城墙目标按普通近战行动（doc 边界条件）
    const pos = this.owner.root.position
    const c = this.gm.buildingCenter(target)
    const halfSum = target.type.size / 2 + (this.owner as TroopActor).troop.size[0] / 2
    const touching = Math.abs(c.x - pos.x) <= halfSum && Math.abs(c.z - pos.z) <= halfSum
    if (!touching) return
    this.detonate(target)
  }

  /** 自爆：对目标建筑 × 倍率伤害 → 自身移除（伤害不因自身死亡而丢失） */
  private detonate(target: ClashBuildingBaseActor): void {
    if (this.detonated) return
    this.detonated = true
    const mult = this.cfg.wallDamageMultiplier ?? 10
    const troop = (this.owner as TroopActor).troop
    const damage = troop.dps * 0.5 * mult // 一击 = 0.5s 基础伤害 × 倍率
    this.gm.damageBuilding(target, damage)
    logger.info(`[Ability] 炸弹人自爆 → ${target.type.name}（${troop.dps}×0.5×${mult} = ${Math.round(damage)} 伤害）`)
    // 自身移除（走死亡路径保持统计一致：onTroopDied + 池回收）
    const health = this.owner.getComponent(TroopHealthComponent)
    health?.takeDamage(Number.MAX_SAFE_INTEGER)
  }
}

// ════════════════════════════════════════════
//  治疗师：周期性治疗友军
// ════════════════════════════════════════════

export class HealerAbilityComponent extends ActorComponent {
  private readonly gm: FishLevelGameMode
  private readonly cfg: TroopAbility
  /** 治疗周期计时器 */
  private timer = 0

  constructor(owner: Actor, gm: FishLevelGameMode, cfg: TroopAbility) {
    super(owner)
    this.name = 'HealerAbilityComponent'
    this.gm = gm
    this.cfg = cfg
  }

  override Tick(dt: number): void {
    const interval = this.cfg.healInterval ?? 1
    const amount = this.cfg.healAmount ?? 20
    const radius = this.cfg.healRadius ?? 4
    this.timer += dt
    if (this.timer < interval) return
    this.timer = 0
    // 半径内生命值最低且未满血的友军（治疗师不互相治疗：排除同能力组件的友军）
    const self = this.owner as TroopActor
    const pos = self.root.position
    let best: TroopActor | null = null
    let bestRatio = 1
    for (const t of this.gm.troops) {
      if (t === self || t.health.isDead) continue
      if (t.troop.ability?.type === 'healer') continue // 治疗师不互相治疗
      const ratio = t.health.hp / t.troop.hp
      if (ratio >= 1) continue // 满血不治（不溢出上限）
      const d = Math.hypot(t.root.position.x - pos.x, t.root.position.z - pos.z)
      if (d <= radius && ratio < bestRatio) {
        bestRatio = ratio
        best = t
      }
    }
    if (!best) return
    const before = best.health.hp
    best.health.heal(amount)
    logger.info(`[Ability] 治疗师 → ${best.troop.name} +${Math.round(best.health.hp - before)} hp（范围 ${radius}）`)
  }
}

// ════════════════════════════════════════════
//  狂暴光环：法术落点生成的范围增益（区域 Actor 承载）
// ════════════════════════════════════════════

export class RageAuraComponent extends ActorComponent {
  private readonly gm: FishLevelGameMode
  /** 效果半径 */
  readonly radius: number
  /** 攻速/移速倍率 */
  readonly multiplier: number
  /** 剩余持续时间（秒） */
  private remaining: number

  constructor(owner: Actor, gm: FishLevelGameMode, radius: number, multiplier: number, duration: number) {
    super(owner)
    this.name = 'RageAuraComponent'
    this.gm = gm
    this.radius = radius
    this.multiplier = multiplier
    this.remaining = duration
  }

  override Tick(dt: number): void {
    this.remaining -= dt
    if (this.remaining <= 0) {
      this.owner.destroy()
      return
    }
    // 对半径内友军打 rage 标记（TroopMove/TroopAttack 每帧读取后清零）
    const pos = this.owner.root.position
    for (const t of this.gm.troops) {
      if (t.health.isDead) continue
      const d = Math.hypot(t.root.position.x - pos.x, t.root.position.z - pos.z)
      if (d <= this.radius) t.health.rageMark = Math.max(t.health.rageMark, this.multiplier)
    }
  }
}
