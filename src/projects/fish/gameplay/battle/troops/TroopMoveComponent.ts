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
 * CoC 风格站位（迁移自 slot 池）：
 *  - 兵切到新目标时，本兵自己调 `enumerateStandPoints` 枚举建筑 hitbox 周围
 *    rank 0..4 的所有候选格（共 40 个），按距离 pos 排序后取最近 1 个
 *  - 不再维护全局 slot 池——同伴互不重叠由物理引擎推开
 *  - 卡死 36 帧后强制重算 standPoint（不依赖任何池）
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
  /** A* 失败冷却（秒）：避免兵被同伴挤死后每帧重算空路径 */
  private pathFailCooldownSec = 0
  /** 上次 tick 时位置（卡死检测：pos 几乎不变 → stuckTicks 累加） */
  private lastTickX = 0
  private lastTickZ = 0
  /** 连续未移动帧数；超 36 帧（≈0.6s @60fps）强制重规划 */
  private stuckTicks = 0

  /**
   * 当前目标对应的 standPoint 缓存（target → standPoint 世界坐标）；
   * 目标切换/standPoint 重算时清空。
   * 复用 scratchStand，无 GC 压力。
   */
  private cachedTarget: ClashBuildingBaseActor | null = null
  private readonly scratchStand = new THREE.Vector3()
  /** 候选格缓存（每帧 enumerateStandPoints 写入，按距离排序后取最近） */
  private readonly scratchCandidates: THREE.Vector3[] = []
  /** scratchCenter 复用：每帧 buildingCenterInto 写入 */
  private readonly scratchCenter = new THREE.Vector3()

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
    if (this.collider) this.collider.onCollisionEnter = null
    this.collider = null
    this.path = null
    this.pathTarget = null
    this.pathFailCooldownSec = 0
    this.stuckTicks = 0
    this.lastTickX = 0
    this.lastTickZ = 0
    this.cachedTarget = null
    super.EndPlay()
  }

  /** 沿 owner 子树查找碰撞体（自身或挂模型子 Actor 的组件） */
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

  /** 撞上建筑（static）：切换攻击目标到阻挡物 + 重算路径（部落冲突式被挡改目标） */
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

  /** 站桩：速度清零（推挤仍由引擎处理，下帧继续清零） */
  private stopMove(): void {
    if (this.collider) this.collider.setVelocity(0, 0)
  }

  /**
   * 上次计算 standPoint 的游戏时间（用于卡死时强制重算的节流，避免每帧重算）。
   * 由 GameMode.elapsedSec 提供（避免本地 deltaTime 漂移）。
   */
  private lastPickAtSec = 0
  /** 计算 standPoint 的最小时间间隔（秒）：卡死重算时受此限制 */
  private static readonly PICK_COOLDOWN_SEC = 0.1
  /** 缓存命中有效期（同一目标 + N 秒内无条件复用，避免每帧重算） */
  private static readonly PICK_REFRESH_SEC = 0.4

  /**
   * 计算本兵在目标建筑前的"自取最近可走格"（CoC 风格）：
   *  1. 枚举建筑 hitbox 周围 rank 0..4 的所有候选格（最多 40 个，物理引擎负责互不重叠）
   *  2. 按距离 `pos` 排序，取最近的 1 个
   *  3. 目标不变时复用同一 standPoint（缓存到 `cachedTarget`）
   *  4. 候选全空（建筑被围死）→ fallback 到最近可走格（螺旋外扩 6 格）
   *  5. 兜底失败 → 退到建筑中心
   *
   * forceRecompute：true 时无视 `cachedTarget === target` 缓存与 PICK_COOLDOWN 强制重算
   * （卡死哨兵触发时使用）。
   */
  private resolveStandPoint(
    target: ClashBuildingBaseActor,
    center: THREE.Vector3,
    pos: THREE.Vector3,
    forceRecompute: boolean,
    nowSec: number,
  ): THREE.Vector3 {
    // 缓存命中（同一目标、未要求重算、且未过冷却）→ 直接复用
    if (!forceRecompute && this.cachedTarget === target && (nowSec - this.lastPickAtSec) < TroopMoveComponent.PICK_REFRESH_SEC) {
      return this.scratchStand
    }

    this.cachedTarget = target
    this.lastPickAtSec = nowSec

    // 枚举候选（rank 0..4，每 rank 8 方位 → 最多 40 个候选）
    const n = this.gm.navigation.enumerateStandPoints(center, 4, this.scratchCandidates)

    if (n > 0) {
      // 取距离 pos 最近的一个（按距离平方排序即可，避免 sqrt）
      let bestIdx = 0
      let bestD = Number.POSITIVE_INFINITY
      for (let i = 0; i < n; i++) {
        const c = this.scratchCandidates[i]
        const dx = c.x - pos.x
        const dz = c.z - pos.z
        const d = dx * dx + dz * dz
        if (d < bestD) { bestD = d; bestIdx = i }
      }
      this.scratchStand.copy(this.scratchCandidates[bestIdx])
      return this.scratchStand
    }

    // 候选全空（建筑被围死 / 全部越界）→ 螺旋外扩 6 格兜底
    logger.warn(`[Battle] ${this.troop.name} 目标 ${target.type.name} 候选全空，螺旋兜底`)
    const [ci, cj] = this.gm.navigation.grid.worldToCell(center.x, center.z)
    const stride = this.gm.navigation.grid.halfExtent * 2 + 1
    const gridKey = (i: number, j: number) => (j + this.gm.navigation.grid.halfExtent) * stride + (i + this.gm.navigation.grid.halfExtent)
    const seen = new Set<number>()
    const dirs: Array<[number, number]> = [
      [0, -1], [1, 0], [0, 1], [-1, 0],
      [1, -1], [1, 1], [-1, 1], [-1, -1],
    ]
    for (let r = 1; r <= 6; r++) {
      for (const [dx, dz] of dirs) {
        const i = ci + dx * r
        const j = cj + dz * r
        const k = gridKey(i, j)
        if (seen.has(k)) continue
        seen.add(k)
        if (this.gm.navigation.grid.isBlocked(i, j)) continue
        const [x, z] = this.gm.navigation.grid.cellToWorld(i, j)
        this.scratchStand.set(x, 0, z)
        return this.scratchStand
      }
    }

    // 全部围死 → 退到建筑中心
    logger.warn(`[Battle] ${this.troop.name} 建筑被围死，退到中心`)
    this.scratchStand.copy(center)
    return this.scratchStand
  }

  override Tick(dt: number): void {
    const target = this.owner.getComponent(TroopTargetComponent)?.target
    if (!target) {
      this.stopMove()
      if (this.cachedTarget !== null) this.cachedTarget = null
      return
    }

    const pos = this.owner.root.position
    this.lastPickAtSec += dt

    // CoC 风格站位：每兵自取建筑 hitbox 周围最近的候选格
    const center = this.scratchCenter
    this.gm.buildingCenterInto(target, center)
    const standPoint = this.resolveStandPoint(target, center, pos, false, this.lastPickAtSec)

    const dx = standPoint.x - pos.x
    const dz = standPoint.z - pos.z
    const dist = Math.hypot(dx, dz)
    const halfReach = target.type.size / 2 + this.troop.size[0] / 2
    // 距自己 standPoint 已到贴边距离 → 站桩（其他兵在另一格不影响）
    if (dist <= halfReach) {
      this.stopMove()
      return
    }
    // 兜底：dist 即 eudl 但距离建筑本身中心仍在攻击距离内 → 也站桩（处理 standPoint 远离却贴墙的退化情形）
    const centerDx = center.x - pos.x
    const centerDz = center.z - pos.z
    const centerDist = Math.hypot(centerDx, centerDz)
    const attackDist = troopAttackDist(this.troop, target)
    if (centerDist <= attackDist) {
      // 卡死中：36 帧未挪动 → 强制重算 standPoint（让本兵换候选格，绕开拥塞区）
      if (this.stuckTicks > 36) {
        logger.warn(`[Battle] ${this.troop.name} 卡死站桩 ${this.stuckTicks} 帧（moved=0），强制重选 standPoint`)
        this.resolveStandPoint(target, center, pos, true, this.lastPickAtSec)
        this.path = null
        this.stuckTicks = 0
        return
      }
      this.stopMove()
      return
    }

    // 飞行兵：无视地面阻挡，直线移动
    if (this.troop.flying) {
      const step = this.troop.speed * dt
      pos.x += (dx / dist) * step
      pos.z += (dz / dist) * step
      return
    }

    // 地面兵无碰撞体：回退直线
    if (!this.collider) {
      const step = this.troop.speed * dt
      pos.x += (dx / dist) * step
      pos.z += (dz / dist) * step
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

    const needRepath = (() => {
      if (this.pathFailCooldownSec > 0) return false
      if (this.stuckTicks > 36) return true
      if (this.pathTarget !== target) return true
      if (!this.path || this.path.length === 0) return false
      const wp = this.path[0]
      const wdx = wp.x - pos.x
      const wdz = wp.z - pos.z
      const wpd = Math.hypot(wdx, wdz)
      const behind = (wdx * dx + wdz * dz) < 0
      return !behind && wpd > this.gm.navigation.grid.cellSize * 2
    })()
    if (this.stuckTicks > 36) {
      logger.warn(`[Battle] ${this.troop.name} 卡死 ${this.stuckTicks} 帧（moved=${moved.toFixed(3)}），强制重路径`)
    }
    if (needRepath) {
      this.pathTarget = target
      this.path = this.gm.navigation.findPath(pos, standPoint)
      if (!this.path || this.path.length < 2) {
        const fallback = this.gm.navigation.findPath(pos, center)
        if (fallback && fallback.length >= 2) {
          this.path = fallback
          logger.info(`[Battle] ${this.troop.name} A* 失败回退到中心重试成功（${fallback.length} 路点） → ${target.type.name}`)
        }
      }
      if (this.path && this.path.length >= 2) {
        logger.info(`[Battle] ${this.troop.name} A* 寻路成功（${this.path.length} 路点） → ${target.type.name}`)
        this.stuckTicks = 0
      } else {
        logger.warn(`[Battle] ${this.troop.name} A* 寻路失败，回退直线 → ${target.type.name}（pos=(${pos.x.toFixed(2)},${pos.z.toFixed(2)})，standPoint=(${standPoint.x.toFixed(2)},${standPoint.z.toFixed(2)})）`)
        this.path = null
        this.pathFailCooldownSec = 0.15
        if (this.stuckTicks > 36) {
          // 卡死 + A* 失败 → 重选 standPoint（缓存失效 → 下次取不同候选）
          logger.warn(`[Battle] ${this.troop.name} 失败+卡死，强制重选 standPoint`)
          this.resolveStandPoint(target, center, pos, true, this.lastPickAtSec)
          this.stuckTicks = 0
        }
      }
    }

    // 取移动方向
    let dirX = dx
    let dirZ = dz
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
        if (wd > 0.05 && (wdx * dx + wdz * dz) < 0) {
          this.path.shift()
        } else {
          dirX = wdx
          dirZ = wdz
        }
      }
    }
    const d = Math.hypot(dirX, dirZ)
    if (d < 0.001) {
      logger.warn(`[Battle] ${this.troop.name} 无有效方向停止移动（dist=${dist.toFixed(2)}，centerDist=${centerDist.toFixed(2)}，attackDist=${attackDist.toFixed(2)}，path=${this.path ? this.path.length : 'null'}）`)
      this.stopMove()
      return
    }
    this.collider.setVelocity((dirX / d) * this.troop.speed, (dirZ / d) * this.troop.speed)
  }
}