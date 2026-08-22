/**
 * TroopHealthComponent — 兵生命值组件（组件组合：受击/死亡）
 *
 * 所有兵种统一挂载：持有 hp、受击扣血（takeDamage）、死亡回调
 * （通知战斗 GameMode 移出列表 + 失败判定 + 销毁自身）。
 * 原 BattleTroopActor.takeDamage 逻辑拆出，组件优先原则。
 *
 * 挂载方式（TroopActors 装配函数）：
 *   actor.addComponent(TroopHealthComponent, gm, troop)
 */
import { ActorComponent, logger, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { TroopType } from '../../common/types'
import type { PoolableTroopActor, TroopActor } from './TroopActors'
import { TroopHealthBarComponent } from '../../common/comp/TroopHealthBarComponent'

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
   * 对象池复用时重置生命值（由 PoolableTroopActor._assemble 复用路径调用）。
   */
  resetHp(): void {
    this._hp = this.troop.hp
    this._dead = false
  }

  /**
   * 受到伤害（防御塔弹丸命中）：
   * 刷新头顶血条（显示 + 比例 + 1.5s 隐藏计时）→ hp 扣到 0 → 标记死亡 →
   * 通知 GameMode（移除军队计数 + 胜负判定）→ 销毁宿主。
   */
  takeDamage(amount: number): void {
    if (this._dead) return
    this._hp -= amount
    // 头顶血条组件：受击显示 + 刷新比例/颜色 + 重置 1.5s 隐藏计时
    this.owner.getComponent(TroopHealthBarComponent)?.onDamaged(Math.max(0, this._hp) / this.troop.hp)
    logger.info(`[Battle] 兵 ${this.troop.name} 受击 -${Math.round(amount)}（剩余 hp=${Math.max(0, Math.round(this._hp))}）`)
    if (this._hp <= 0) {
      this._dead = true
      this.gm.onTroopDied(this.owner as TroopActor)
      ;(this.owner as PoolableTroopActor).pool?.release(this.owner as PoolableTroopActor)
    }
  }
}
