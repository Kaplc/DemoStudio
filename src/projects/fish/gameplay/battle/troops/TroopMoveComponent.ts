/**
 * TroopMoveComponent — 兵移动组件（A* 寻路 + 物理 velocity）
 *
 * 每帧：目标为空或已在攻击距离内 → 站桩；
 * 否则：
 *  - A* 寻路（GameMode.navigation，仅静态建筑为障碍）计算路径
 *  - 沿路径方向用物理 velocity 移动
 *  - 寻路失败 → 回退直线移动
 *  - 被挡改目标：碰撞到建筑（static）即切换攻击目标 + 重算路径
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

/** 近战兵攻击距离额外缓冲（格），确保移动停止点仍在可攻击范围内 */
const MELEE_ATTACK_BUFFER = 0.5

export class TroopMoveComponent extends ActorComponent {
  private readonly troop: TroopType
  private readonly gm: FishLevelGameMode
  /** 碰撞体（飞行兵无碰撞体为 null） */
  private collider: ColliderComponent | null = null

  private path: THREE.Vector3[] | null = null
  private pathTarget: ClashBuildingBaseActor | null = null
  private pathFailCooldownSec = 0
  /** 帧计数器：每 N 帧才计算一次 A* 寻路 */
  private pathTickCounter = 0
  private static readonly REPATH_INTERVAL = 24

  private lastTickX = 0
  private lastTickZ = 0
  private stuckTicks = 0

  constructor(owner: Actor, gm: FishLevelGameMode, troop: TroopType) {
    super(owner)
    this.name = 'TroopMoveComponent'
    this.gm = gm
    this.troop = troop
  }

  override BeginPlay(): void {
    super.BeginPlay()
    if (this.troop.flying) return
    this.collider = this.findColliderInSubtree()
    if (this.collider) {
      this.collider.onCollisionEnter = (e) => this.onHitBuilding(e.other)
    }
  }

  override EndPlay(): void {
    if (this.collider) this.collider.onCollisionEnter = null
    this.collider = null
    this.path = null
    this.pathTarget = null
    this.pathTickCounter = 0
    super.EndPlay()
  }

  private findColliderInSubtree(): ColliderComponent | null {
    const stack: Actor[] = [this.owner]
    while (stack.length > 0) {
      const a = stack.pop()!
      const c = a.getAllComponents().find((comp) => comp instanceof ColliderComponent) as ColliderComponent | undefined
      if (c) return c
      stack.push(...a.getChildren())
    }
    return null
  }

  /** 撞上建筑（static）：切换攻击目标 + 重算路径 */
  private onHitBuilding(other: ColliderComponent): void {
    const building = other.owner
    if (!(building instanceof ClashBuildingBaseActor)) return
    if (building.bPendingDestroy) return
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (building === target) return
    logger.info(`[Battle] ${this.troop.name} 被 ${building.type.name} 阻挡，切换攻击目标`)
    this.gm.setTroopTargetOverride(this.owner as TroopActor, building)
    this.path = null
    this.pathTarget = null
  }

  private stopMove(): void {
    if (this.collider) this.collider.setVelocity(0, 0)
  }

  override Tick(dt: number): void {
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) {
      this.stopMove()
      return
    }

    const pos = this.owner.root.position

    // 获取目标中心
    const center = new THREE.Vector3()
    this.gm.buildingCenterInto(target, center)

    const dx = center.x - pos.x
    const dz = center.z - pos.z
    const distToCenter = Math.hypot(dx, dz)
    const halfSize = target.type.size / 2

    // 目标点：建筑边缘（沿着移动方向偏移半个 size）
    const edgeX = center.x - (dx / distToCenter) * halfSize
    const edgeZ = center.z - (dz / distToCenter) * halfSize

    const dx2 = edgeX - pos.x
    const dz2 = edgeZ - pos.z
    const dist = Math.hypot(dx2, dz2)
    let attackDist = troopAttackDist(this.troop, target)
    // 近战兵（range=0）攻击距离增加缓冲，确保停止点仍在可攻击范围内
    if (this.troop.range === 0) attackDist += MELEE_ATTACK_BUFFER

    // 已在攻击距离内 → 站桩
    if (dist <= attackDist) {
      this.stopMove()
      return
    }

    // 无碰撞体（飞行兵或特殊兵）：直线移动
    if (!this.collider) {
      const step = this.troop.speed * dt
      pos.x += (dx2 / dist) * step
      pos.z += (dz2 / dist) * step
      return
    }

    if (this.pathFailCooldownSec > 0) this.pathFailCooldownSec -= dt

    // 卡死检测
    const moved = Math.abs(pos.x - this.lastTickX) + Math.abs(pos.z - this.lastTickZ)
    this.lastTickX = pos.x
    this.lastTickZ = pos.z
    if (moved < 0.05) {
      this.stuckTicks += 1
    } else {
      this.stuckTicks = 0
    }

    // 每 24 帧才计算一次 A* 寻路
    this.pathTickCounter++
    const canRepath = this.pathTickCounter >= TroopMoveComponent.REPATH_INTERVAL

    // 需要重算路径
    const needRepath = (() => {
      if (!canRepath) return false
      if (this.pathFailCooldownSec > 0) return false
      if (this.stuckTicks > 36) return true
      if (this.pathTarget !== target) return true
      if (!this.path || this.path.length === 0) return false
      const wp = this.path[0]
      const wdx = wp.x - pos.x
      const wdz = wp.z - pos.z
      const wpd = Math.hypot(wdx, wdz)
      return wpd > this.gm.navigation.grid.cellSize * 2
    })()

    if (this.stuckTicks > 36) {
      logger.warn(`[Battle] ${this.troop.name} 卡死 ${this.stuckTicks} 帧，强制重路径`)
    }

    // A* 寻路到建筑边缘
    const edgePoint = new THREE.Vector3(edgeX, 0, edgeZ)
    if (needRepath) {
      this.pathTickCounter = 0
      this.pathTarget = target
      this.path = this.gm.navigation.findPath(pos, edgePoint)
      if (this.path && this.path.length >= 2) {
        logger.info(`[Battle] ${this.troop.name} A* 寻路成功（${this.path.length} 路点） → ${target.type.name}`)
        this.stuckTicks = 0
      } else {
        logger.warn(`[Battle] ${this.troop.name} A* 寻路失败，回退直线 → ${target.type.name}`)
        this.path = null
        this.pathFailCooldownSec = 0.15
      }
    }

    // 取移动方向
    let dirX = dx2
    let dirZ = dz2
    if (this.path && this.path.length > 0) {
      const wp = this.path[0]
      let wdx = wp.x - pos.x
      let wdz = wp.z - pos.z
      let wd = Math.hypot(wdx, wdz)
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

    this.collider.setVelocity((dirX / d) * this.troop.speed, (dirZ / d) * this.troop.speed)
  }
}
