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
import { ActorComponent, ColliderComponent, gizmos, logger, type Actor } from '@/engine'
import type { FishLevelGameMode } from '../../level/FishLevelGameMode'
import { ClashBuildingBaseActor } from '../../base/ClashBuildingActors'
import type { TroopType } from '../../common/types'
import type { TroopActor } from './TroopActors'
import { TroopTargetComponent, troopAttackDist } from './TroopTargetComponent'
import { TroopHealthComponent } from './TroopHealthComponent'

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
  /** 每 N 帧进行一次位置碰撞检测（备用检测，即使 cannon 碰撞不工作也能检测） */
  private _posCheckCounter = 0
  private static readonly POS_CHECK_INTERVAL = 8

  /** 是否在攻击范围内停止（停止寻路） */
  private _inAttackRange = false

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

  /**
   * 基于位置的碰撞检测（备用方案）：
   * 当 cannon 物理碰撞事件不触发时，使用重叠检测来发现兵是否进入了建筑内部。
   * 如果检测到碰撞，触发与 onHitBuilding 相同的逻辑。
   */
  private checkPositionCollision(): void {
    if (!this.collider || !this.collider.body) return
    const pos = this.owner.root.position
    const myRadius = this.collider.boundRadiusXZ

    for (const building of this.gm.buildings) {
      if (building.bPendingDestroy) continue
      const center = new THREE.Vector3()
      this.gm.buildingCenterInto(building, center)
      const halfSize = building.type.size / 2

      // AABB 检测：兵圆形 vs 建筑方形
      const dx = Math.abs(pos.x - center.x)
      const dz = Math.abs(pos.z - center.z)
      if (dx < halfSize + myRadius && dz < halfSize + myRadius) {
        // 检测到重叠（可能穿透），触发碰撞处理
        this.onHitBuilding(this.collider)
        return
      }
    }
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
    const attackDist = troopAttackDist(this.troop, target)

    // 寻路终点：兵→建筑直连线上、距中心 attackDist 的点（攻击范围边界）
    // 公式保证目标点正好落在兵到建筑中心这条射线上、A* 才不会绕到建筑背后。
    // 若 distToCenter < attackDist（兵已在攻击范围内），endpoint = center；不会发生。
    const distToEdge = Math.max(distToCenter, 0.0001)
    const edgeX = center.x - (dx / distToEdge) * attackDist
    const edgeZ = center.z - (dz / distToEdge) * attackDist

    const dx2 = edgeX - pos.x
    const dz2 = edgeZ - pos.z
    const dist = Math.hypot(dx2, dz2)

    // 已在攻击范围内（pos→center 距离）→ 站桩，停止寻路
    const wasInRange = this._inAttackRange
    this._inAttackRange = distToCenter <= attackDist

    if (this._inAttackRange) {
      this.stopMove()
      // 刚进入攻击范围，清除路径，下次需要重算
      if (!wasInRange) {
        this.path = null
      }
      return
    }

    // 无碰撞体（飞行兵或特殊兵）：直线移动
    if (!this.collider) {
      const step = this.troop.speed * dt
      pos.x += (dx2 / dist) * step
      pos.z += (dz2 / dist) * step
      return
    }

    // 位置碰撞检测（备用，即使 cannon 碰撞不触发也能检测）
    this._posCheckCounter++
    if (this._posCheckCounter >= TroopMoveComponent.POS_CHECK_INTERVAL) {
      this._posCheckCounter = 0
      this.checkPositionCollision()
    }

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

    // 狂暴增益：读 rage 标记（光环组件每帧写入），用后清零回 1
    const health = this.owner.getComponent(TroopHealthComponent)
    const speedMul = health?.rageMark ?? 1
    if (health) health.rageMark = 1

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

    const speed = this.troop.speed * speedMul
    this.collider.setVelocity((dirX / d) * speed, (dirZ / d) * speed)
  }

  override OnDrawGizmos(): void {
    const pos = this.owner.root.position
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) return

    const center = new THREE.Vector3()
    this.gm.buildingCenterInto(target, center)
    gizmos.setColor(0xffcc00)
    gizmos.DrawLine(pos, center)

    // 寻路终点（兵→建筑直连线 attackDist 处的点）：玫红色圆环标识
    const dx = center.x - pos.x
    const dz = center.z - pos.z
    const distToCenter = Math.hypot(dx, dz)
    if (distToCenter > 0.0001) {
      const attackDist = troopAttackDist(this.troop, target)
      const edge = new THREE.Vector3(
        center.x - (dx / distToCenter) * attackDist,
        0,
        center.z - (dz / distToCenter) * attackDist,
      )
      gizmos.setColor(0xff66ff)
      gizmos.DrawCircle(edge, new THREE.Vector3(0, 1, 0), 0.2, 16)
    }

    if (this.path && this.path.length > 0) {
      gizmos.setColor(0x00aaff)
      let prev = pos
      for (const wp of this.path) {
        gizmos.DrawLine(prev, wp)
        prev = wp
      }
    }
  }
}
