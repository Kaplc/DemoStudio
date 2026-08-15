/**
 * TroopHealthComponent — 兵生命值组件（组件组合：受击/死亡）
 *
 * 所有兵种统一挂载：持有 hp、受击扣血（takeDamage）、死亡回调
 * （通知战斗 GameMode 移出列表 + 失败判定 + 销毁自身）。
 * 原 BattleTroopActor.takeDamage 逻辑拆出，组件优先原则。
 *
 * 挂载方式（TroopActors 装配函数）：
 *   actor.addComponent(new TroopHealthComponent(actor, gm, troop))
 */
import { ActorComponent, logger, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { TroopType } from '../../common/types'
import type { TroopActor } from './TroopActors'

export class TroopHealthComponent extends ActorComponent {
  /** 当前生命值 */
  private _hp: number
  /** 是否已死亡（防重复死亡回调） */
  private _dead = false
  /** 兵种配置（name 日志用） */
  private readonly troop: TroopType
  /** 所属战斗 GameMode（死亡回调） */
  private readonly gm: FishLevelGameMode

  constructor(owner: Actor, gm: FishLevelGameMode, troop: TroopType) {
    super(owner)
    this.name = 'TroopHealthComponent'
    this.gm = gm
    this.troop = troop
    this._hp = troop.hp
  }

  /** 当前生命值 */
  get hp(): number {
    return this._hp
  }

  /** 是否已死亡 */
  get isDead(): boolean {
    return this._dead
  }

  /**
   * 受到伤害（防御塔弹丸命中）：
   * hp 扣到 0 → 标记死亡 → 通知 GameMode（移除军队计数 + 胜负判定）→ 销毁宿主。
   */
  takeDamage(amount: number): void {
    if (this._dead) return
    this._hp -= amount
    logger.info(`[Battle] 兵 ${this.troop.name} 受击 -${Math.round(amount)}（剩余 hp=${Math.max(0, Math.round(this._hp))}）`)
    if (this._hp <= 0) {
      this._dead = true
      this.gm.onTroopDied(this.owner as TroopActor)
      this.owner.destroy()
    }
  }
}
