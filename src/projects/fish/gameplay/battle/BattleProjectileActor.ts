/**
 * BattleProjectileActor — 战斗弹丸 Actor（防御塔炮弹 / 兵远程箭矢 / 近战挥砍）
 *
 * 由 FishLevelGameMode 开火时生成（World.SpawnActor 托管）：
 * 构造时指定 起点/终点/速度/目标建筑或兵，覆写 Tick 直线飞行：
 *  - 命中（距目标 < 0.4 或飞行距离超过总路程）→ 对目标扣血 → 自毁
 *  - 近战挥砍（speed 很大、路程短）视觉上等同快速弹丸，无需独立动画
 *
 * 网格：小球体（颜色区分来源：防御塔暗灰、己方兵兵种色）。
 */
import * as THREE from 'three'
import { GenericActor, PrimitiveMeshComponent, logger } from '@/engine'
import type { FishLevelGameMode } from '../level/FishLevelGameMode'
import { ClashBuildingBaseActor } from '../base/ClashBuildingActors'
import type { TroopActor } from './troops/TroopActors'

export class BattleProjectileActor extends GenericActor {
  /** 起始位置（世界坐标） */
  private readonly start: THREE.Vector3
  /** 终点位置（目标中心，世界坐标） */
  private readonly end: THREE.Vector3
  /** 飞行速度（世界单位/秒） */
  private readonly speed: number
  /** 命中伤害 */
  private readonly damage: number
  /** 所属战斗 GameMode */
  private readonly gm: FishLevelGameMode
  /** 目标建筑（命中建筑扣建筑血；与 targetTroop 二选一） */
  private readonly targetBuilding: ClashBuildingBaseActor | null
  /** 目标兵（命中兵扣兵血；与 targetBuilding 二选一） */
  private readonly targetTroop: TroopActor | null
  /** 总飞行距离（超出即视为未命中销毁，防永久飞行） */
  private readonly totalDist: number
  /** 已飞行距离 */
  private traveled = 0

  constructor(
    gm: FishLevelGameMode,
    from: THREE.Vector3,
    to: THREE.Vector3,
    speed: number,
    damage: number,
    color: number,
    target: ClashBuildingBaseActor | TroopActor,
  ) {
    super(`BattleProjectile_${Math.floor(Math.random() * 100000)}`)
    this.gm = gm
    this.start = from.clone()
    this.end = to.clone()
    this.speed = speed
    this.damage = damage
    this.totalDist = this.start.distanceTo(this.end)
    // 用 instanceof 区分目标类型（建筑 → 扣建筑血；兵 → 扣兵血）
    if (target instanceof ClashBuildingBaseActor) {
      this.targetBuilding = target
      this.targetTroop = null
    } else {
      this.targetTroop = target
      this.targetBuilding = null
    }
    this.setPosition(from.x, from.y, from.z)
    // 保存颜色供 BeginPlay 建网格
    this._color = color
  }

  /** 弹丸颜色（构造时暂存，BeginPlay 建网格时使用） */
  private readonly _color: number

  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return
    // 小立方体弹丸（0.3×0.3×0.3，颜色区分来源：防御塔暗灰、己方兵兵种色）
    const mesh = w.createBoxMesh(0.3, 0.3, 0.3, this._color)
    this.addComponent(PrimitiveMeshComponent, mesh, 'ProjMesh')
  }

  /**
   * 每帧直线飞行：
   * 到达终点附近 → 命中结算（建筑/兵扣血）→ 自毁；超出总路程 → 未命中自毁。
   */
  override Tick(dt: number): void {
    super.Tick(dt)
    const step = this.speed * dt
    this.traveled += step
    const pos = this.root.position
    const dir = this.end.clone().sub(this.start)
    if (this.traveled >= this.totalDist || pos.distanceTo(this.end) < 0.4) {
      // 命中结算
      if (this.targetBuilding && !this.targetBuilding.bPendingDestroy) {
        this.gm.damageBuilding(this.targetBuilding, this.damage)
      } else if (this.targetTroop && !this.targetTroop.health.isDead) {
        this.targetTroop.health.takeDamage(this.damage)
      }
      this.destroy()
      return
    }
    dir.normalize()
    pos.addScaledVector(dir, step)
  }

  override EndPlay(): void {
    // 网格由 MeshComponent.EndPlay 自动释放
    super.EndPlay()
  }
}
