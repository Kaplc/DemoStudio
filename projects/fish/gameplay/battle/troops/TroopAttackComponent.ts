/**
 * TroopAttackComponent — 兵攻击组件（组件组合：攻击节奏/开火）
 *
 * 每帧：目标在攻击距离内 → 按攻击间隔（0.5s）发射弹丸，
 * 伤害 = dps × 间隔（dps 守恒）。dps ≤ 0（治疗师等无伤害兵种）不攻击。
 * 近战/远程差异由配置 range 决定（fireTroopAttack 内部区分挥砍/箭矢）。
 *
 * 挂载方式（TroopActors 装配函数）：
 *   actor.addComponent(TroopAttackComponent, gm, troop)
 */
import * as THREE from 'three'
import { ActorComponent, logger, type Actor } from '@/engine'
import { gizmos } from '@/engine/tools/Gizmos'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'
import type { TroopType } from '../../common/types'
import type { TroopActor } from './TroopActors'
import { TroopTargetComponent, troopAttackDist } from './TroopTargetComponent'
import { TroopHealthComponent } from './TroopHealthComponent'
import { GameEvents } from '../../common/GameEvents'

/** 兵攻击事件（攻击组件广播 → GM 订阅发射弹丸） */
export interface TroopAttackEvent {
  troop: TroopActor
  target: ClashBuildingBaseActor
  damage: number
}

export const BATTLE_TROOP_ATTACK = 'battle.troopAttack'

/** 兵攻击间隔（秒）：伤害 = dps × 0.5 每击，保证每秒总伤害 = dps（数值自洽） */
export const TROOP_ATTACK_INTERVAL = 0.5

export class TroopAttackComponent extends ActorComponent {
  /** 兵种配置（dps/range 单一数据源） */
  private readonly troop: TroopType
  /** 所属战斗 GameMode（开火回调） */
  private readonly gm: FishLevelGameMode
  /** 攻击间隔计时器（倒计时到 0 开火并重置） */
  private attackTimer = 0

  constructor(owner: Actor, gm: FishLevelGameMode, troop: TroopType) {
    super(owner)
    this.name = 'TroopAttackComponent'
    this.gm = gm
    this.troop = troop
  }

  override Tick(dt: number): void {
    // 无伤害兵种（治疗师 dps=0）不攻击
    if (this.troop.dps <= 0) return
    this.attackTimer = Math.max(0, this.attackTimer - dt)

    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) return // 无目标 → 待机（移动组件会靠近）
    const pos = this.owner.root.position
    const center = this.gm.buildingCenter(target)
    const dx = center.x - pos.x
    const dz = center.z - pos.z
    const dist = Math.hypot(dx, dz)
    // 攻击判定：AABB 接触（近战贴墙，部落冲突式：被挡即攻击）或 中心距在射程内（远程兵）
    // ⚠️ 只靠 dist ≤ range+半宽 会在斜向撞墙时打不到（中心距 > range+半宽，但 AABB 已接触）
    const halfSum = target.type.size / 2 + this.troop.size[0] / 2
    const touching = Math.abs(dx) <= halfSum && Math.abs(dz) <= halfSum
    if (!touching && dist > troopAttackDist(this.troop, target)) return // 未接触且射程外（移动组件负责靠近）

    if (this.attackTimer <= 0) {
      this.attackTimer = TROOP_ATTACK_INTERVAL
      // 狂暴增益：读 rage 标记（光环组件每帧写入），用后清零回 1（伤害 ×倍率 = 等效攻速提升）
      const health = this.owner.getComponent(TroopHealthComponent)
      const rageMul = health?.rageMark ?? 1
      if (health) health.rageMark = 1
      this.gm.gameInstance?.events.emit(BATTLE_TROOP_ATTACK, {
        troop: this.owner as TroopActor,
        target,
        damage: this.troop.dps * TROOP_ATTACK_INTERVAL * rageMul,
      } as TroopAttackEvent)
    }
  }

  override OnDrawGizmos(): void {
    gizmos.setColor(0x00ff88)
    gizmos.DrawCircle(this.owner.root.position, new THREE.Vector3(0, 1, 0), this.troop.range)
  }
}
