/**
 * TroopMoveComponent — 兵移动组件（组件组合：寻路/阻挡）
 *
 * 每帧：目标为空或已在攻击距离内 → 原地站桩（攻击由 TroopAttackComponent 负责）；
 * 否则朝目标直线移动：
 *  - 飞行兵（flying）无视地面阻挡直接移动
 *  - 地面兵撞上阻挡建筑（blocksGround）→ 贴到 AABB 边缘（slab 法），
 *    并把阻挡物设为目标覆盖（部落冲突式：被挡攻击阻挡物，不绕行）
 *
 * 挂载方式（TroopActors 装配函数）：
 *   actor.addComponent(new TroopMoveComponent(actor, gm, troop))
 */
import { ActorComponent, logger, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import type { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'
import type { TroopType } from '../../common/types'
import type { TroopActor } from './TroopActors'
import { TroopTargetComponent, troopAttackDist } from './TroopTargetComponent'

export class TroopMoveComponent extends ActorComponent {
  /** 兵种配置（速度/飞行/尺寸单一数据源） */
  private readonly troop: TroopType
  /** 所属战斗 GameMode（阻挡检测/目标覆盖） */
  private readonly gm: FishLevelGameMode

  constructor(owner: Actor, gm: FishLevelGameMode, troop: TroopType) {
    super(owner)
    this.name = 'TroopMoveComponent'
    this.gm = gm
    this.troop = troop
  }

  override Tick(dt: number): void {
    // 目标（TroopTargetComponent 每帧刷新）
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) return // 无存活建筑 → 待机

    const pos = this.owner.root.position
    const center = this.gm.buildingCenter(target)
    const dx = center.x - pos.x
    const dz = center.z - pos.z
    const dist = Math.hypot(dx, dz)
    // 已在攻击距离内 或 已与目标 AABB 接触（贴墙近战）→ 站桩（攻击由 TroopAttackComponent 处理）
    const halfSum = target.type.size / 2 + this.troop.size[0] / 2
    const touching = Math.abs(dx) <= halfSum && Math.abs(dz) <= halfSum
    if (dist <= troopAttackDist(this.troop, target) || touching) return

    // ─── 射程外：直线移动 ───
    const step = this.troop.speed * dt
    const nx = pos.x + (dx / dist) * step
    const nz = pos.z + (dz / dist) * step

    // 飞行兵无视地面阻挡，直接更新位置
    if (this.troop.flying) {
      pos.x = nx
      pos.z = nz
      return
    }

    // 地面兵：检测移动后是否进入阻挡建筑包围盒
    const blocker = this.gm.findBlockerAt(nx, nz, this.troop.size[0] / 2)
    if (blocker) {
      // 贴墙：沿移动方向推进到阻挡物 AABB 边缘（slab 法求最近边界交点）。
      // ⚠️ 修复（死锁）：① 仅对"兵在该轴外侧且朝墙移动"的轴求 t——
      //    兵某轴已落在 AABB 投影内时（如斜向撞墙），该轴 t 会算出负值，
      //    tStop 被夹回 0 → 完全卡死（皮卡打爆墙后被隔壁墙卡住不动）；
      //    ② 去掉比例余量（t-0.05 在步长远大于余量时 tStop=0 同样死锁），
      //    越界由下方钳制兜底处理。
      const half = blocker.type.size / 2 + this.troop.size[0] / 2
      const c = this.gm.buildingCenter(blocker)
      const dirX = nx - pos.x
      const dirZ = nz - pos.z
      let t = 1
      if (dirX > 0 && pos.x < c.x - half) t = Math.min(t, (c.x - half - pos.x) / dirX)
      else if (dirX < 0 && pos.x > c.x + half) t = Math.min(t, (c.x + half - pos.x) / dirX)
      if (dirZ > 0 && pos.z < c.z - half) t = Math.min(t, (c.z - half - pos.z) / dirZ)
      else if (dirZ < 0 && pos.z > c.z + half) t = Math.min(t, (c.z + half - pos.z) / dirZ)
      const tStop = Math.max(0, Math.min(1, t))
      pos.x += dirX * tStop
      pos.z += dirZ * tStop
      // 兜底：修正后仍进入 AABB（步长跨越边界/浮点）→ 沿移动方向主轴钳回边界
      if (Math.abs(pos.x - c.x) < half && Math.abs(pos.z - c.z) < half) {
        if (Math.abs(dirX) >= Math.abs(dirZ)) {
          pos.x = dirX >= 0 ? c.x - half : c.x + half
        } else {
          pos.z = dirZ >= 0 ? c.z - half : c.z + half
        }
      }
      // 被挡攻击阻挡物：切换目标覆盖
      if (blocker !== target) {
        logger.info(`[Battle] ${this.troop.name} 被 ${blocker.type.name} 阻挡，切换攻击目标`)
        this.gm.setTroopTargetOverride(this.owner as TroopActor, blocker)
      }
      return
    }
    pos.x = nx
    pos.z = nz
  }
}
