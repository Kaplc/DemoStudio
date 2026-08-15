/**
 * TroopTargetComponent — 兵索敌组件（组件组合：目标选择）
 *
 * 每帧从战斗 GameMode 拉取当前目标（getBestTargetFor 已含：
 * 阻挡目标覆盖优先 → preferred 偏好过滤 → 最近建筑）。
 * 输出 `target` 供移动/攻击组件消费（组件间通过 getComponent 协作）。
 *
 * 挂载方式（TroopActors 装配函数）：
 *   actor.addComponent(new TroopTargetComponent(actor, gm, troop))
 */
import { ActorComponent, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'
import type { TroopType } from '../../common/types'
import type { TroopActor } from './TroopActors'

/**
 * 兵对建筑的攻击距离判定（兵中心到建筑中心的阈值）：
 * range（兵到建筑边缘）+ 建筑半宽。贴到建筑边缘即进入攻击距离，
 * 避免地面兵被 AABB 挡在 half+兵半宽 处永远够不到的死锁。
 */
export function troopAttackDist(troop: TroopType, building: ClashBuildingBaseActor): number {
  return troop.range + building.type.size / 2
}

export class TroopTargetComponent extends ActorComponent {
  /** 当前目标建筑（无存活建筑时为 null → 兵待机） */
  private _target: ClashBuildingBaseActor | null = null
  /** 兵种配置（组件自持） */
  private readonly troop: TroopType
  /** 所属战斗 GameMode（索敌） */
  private readonly gm: FishLevelGameMode

  constructor(owner: Actor, gm: FishLevelGameMode, troop: TroopType) {
    super(owner)
    this.name = 'TroopTargetComponent'
    this.gm = gm
    this.troop = troop
  }

  /** 当前目标建筑 */
  get target(): ClashBuildingBaseActor | null {
    return this._target
  }

  override Tick(_dt: number): void {
    // GameMode.getBestTargetFor 内部已处理：目标覆盖（被挡攻击阻挡物）优先
    this._target = this.gm.getBestTargetFor(this.owner as TroopActor)
  }
}
