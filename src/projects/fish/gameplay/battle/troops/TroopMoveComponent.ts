/**
 * TroopMoveComponent — 兵移动组件（A* 寻路 + 物理速度注入）
 *
 * 每帧：目标为空或已在攻击距离内 → 站桩（速度清零，攻击由 TroopAttackComponent 负责）；
 * 否则朝目标移动：
 *  - 飞行兵（flying）：无碰撞体，直线飞行直接改位置（无视地面阻挡，现状语义）
 *  - 地面兵：A* 寻路（GameMode.navigation，仅静态建筑为障碍）→ 沿路径每帧 setVelocity
 *    注入速度（速度 = 路径方向 × troop.speed；body 为碰撞权威，位置回写由
 *    ColliderComponent.Tick 完成）。引擎处理推开/阻尼，兵群相互推挤不穿模。
 *  - 寻路失败（无路径/围死）→ 回退直线移动（现状行为）
 *  - 被挡改目标（部落冲突式）：订阅自身碰撞体的 onCollisionEnter，撞上
 *    ClashBuildingBaseActor（static）即切换攻击目标到阻挡物 + 重算路径
 *
 * 挂载方式（TroopActors 装配函数）：
 *   actor.addComponent(TroopMoveComponent, gm, troop)
 */
import * as THREE from 'three'
import { ActorComponent, ColliderComponent, logger, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'
import type { TroopType } from '../../common/types'
import type { TroopActor } from './TroopActors'
import { TroopTargetComponent, troopAttackDist } from './TroopTargetComponent'

export class TroopMoveComponent extends ActorComponent {
  /** 兵种配置（速度/飞行/尺寸单一数据源） */
  private readonly troop: TroopType
  /** 所属战斗 GameMode（寻路网格/目标覆盖） */
  private readonly gm: FishLevelGameMode
  /** 地面兵碰撞体（挂在模型子 Actor 上；飞行兵无碰撞体为 null） */
  private collider: ColliderComponent | null = null
  /** 当前路径路点队列（A* 结果；null = 无路径回退直线） */
  private path: THREE.Vector3[] | null = null
  /** 路径对应的目标（目标变化时重算） */
  private pathTarget: ClashBuildingBaseActor | null = null

  constructor(owner: Actor, gm: FishLevelGameMode, troop: TroopType) {
    super(owner)
    this.name = 'TroopMoveComponent'
    this.gm = gm
    this.troop = troop
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 飞行兵无碰撞体（不订阅碰撞事件）；地面兵找子树碰撞体（挂在模型 Actor）
    if (this.troop.flying) return
    this.collider = this.findColliderInSubtree()
    if (this.collider) {
      this.collider.onCollisionEnter = (e) => this.onHitBuilding(e.other)
    }
  }

  override EndPlay(): void {
    // 解除碰撞事件订阅（防残留引用）
    if (this.collider) this.collider.onCollisionEnter = null
    this.collider = null
    this.path = null
    this.pathTarget = null
    super.EndPlay()
  }

  /** 沿 owner 子树查找碰撞体（自身或挂模型子 Actor 的组件） */
  private findColliderInSubtree(): ColliderComponent | null {
    const stack: Actor[] = [this.owner]
    while (stack.length > 0) {
      const a = stack.pop()!
      // ColliderComponent 是抽象基类：遍历组件用 instanceof 判定
      const c = a.getAllComponents().find((comp) => comp instanceof ColliderComponent) as ColliderComponent | undefined
      if (c) return c
      stack.push(...a.getChildren())
    }
    return null
  }

  /** 撞上建筑（static）：切换攻击目标到阻挡物 + 重算路径（部落冲突式被挡改目标） */
  private onHitBuilding(other: ColliderComponent): void {
    const building = other.owner
    if (!(building instanceof ClashBuildingBaseActor)) return
    if (building.bPendingDestroy) return
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (building === target) return // 已在攻击该建筑，不重复切换
    logger.info(`[Battle] ${this.troop.name} 被 ${building.type.name} 阻挡，切换攻击目标`)
    this.gm.setTroopTargetOverride(this.owner as TroopActor, building)
    this.path = null
    this.pathTarget = null
  }

  /** 站桩：速度清零（推挤仍由引擎处理，下帧继续清零） */
  private stopMove(): void {
    if (this.collider) this.collider.setVelocity(0, 0)
  }

  override Tick(dt: number): void {
    // 目标（TroopTargetComponent 每帧刷新）
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) {
      this.stopMove() // 无存活建筑 → 待机
      return
    }

    const pos = this.owner.root.position
    const center = this.gm.buildingCenter(target)
    const dx = center.x - pos.x
    const dz = center.z - pos.z
    const dist = Math.hypot(dx, dz)
    // 已在攻击距离内 或 已与目标 AABB 接触（贴墙近战）→ 站桩（攻击由 TroopAttackComponent 处理）
    const halfSum = target.type.size / 2 + this.troop.size[0] / 2
    const touching = Math.abs(dx) <= halfSum && Math.abs(dz) <= halfSum
    if (dist <= troopAttackDist(this.troop, target) || touching) {
      this.stopMove()
      return
    }

    // ─── 飞行兵：无视地面阻挡，直线移动（无碰撞体，直接更新位置）───
    if (this.troop.flying) {
      const step = this.troop.speed * dt
      pos.x += (dx / dist) * step
      pos.z += (dz / dist) * step
      return
    }

    // ─── 地面兵 ───
    // 无碰撞体（物理禁用/旧蓝图）：回退直线直接移动（现状行为）
    if (!this.collider) {
      const step = this.troop.speed * dt
      pos.x += (dx / dist) * step
      pos.z += (dz / dist) * step
      return
    }

    // 目标切换 → 重算 A* 路径（仅目标变化时计算，不做每帧重算）
    if (this.pathTarget !== target) {
      this.pathTarget = target
      this.path = this.gm.navigation.findPath(pos, center)
      if (this.path) {
        logger.info(`[Battle] ${this.troop.name} A* 寻路成功（${this.path.length} 路点）→ ${target.type.name}`)
      } else {
        logger.info(`[Battle] ${this.troop.name} A* 寻路失败，回退直线 → ${target.type.name}`)
      }
    }

    // 取移动方向：优先下一个路点，路点耗尽/无路径 → 朝目标直线
    let dirX = dx
    let dirZ = dz
    if (this.path && this.path.length > 0) {
      const wp = this.path[0]
      let wdx = wp.x - pos.x
      let wdz = wp.z - pos.z
      let wd = Math.hypot(wdx, wdz)
      // 到达路点（含贴边误差）→ 弹出，取下一个
      while (this.path.length > 0 && wd < 0.2) {
        this.path.shift()
        if (this.path.length === 0) break
        const nwp = this.path[0]
        wdx = nwp.x - pos.x
        wdz = nwp.z - pos.z
        wd = Math.hypot(wdx, wdz)
      }
      if (this.path.length > 0) {
        dirX = wdx
        dirZ = wdz
      }
    }
    const d = Math.hypot(dirX, dirZ)
    if (d < 0.001) {
      this.stopMove()
      return
    }
    // 速度注入（body 为碰撞权威；引擎处理推开/阻尼/防穿透）
    this.collider.setVelocity((dirX / d) * this.troop.speed, (dirZ / d) * this.troop.speed)
  }
}
