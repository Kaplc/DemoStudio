/**
 * BattleProjectileActor — 战斗弹丸 Actor（防御塔炮弹 / 兵远程箭矢 / 近战挥砍）
 * 对象池版本：构造预分配，acquire 初始化，deactivate 归还池。
 * 构造时指定 起点/终点/速度/目标建筑或兵，覆写 Tick 直线飞行：
 *  - 命中（距目标 < 0.4 或飞行距离超过总路程）→ 对目标扣血 → deactivate 归还
 *  - 近战挥砍（speed 很大、路程短）视觉上等同快速弹丸，无需独立动画
 *
 * 网格：0.3×0.3×0.3 小立方体弹丸（BoxMeshComponent 内部默认创建几何，颜色区分来源）。
 */
import * as THREE from 'three'
import { GenericActor, BoxMeshComponent, ObjectPool } from '@/engine'
import type { IPoolable } from '@/engine'
import { createMeshBasicMaterial } from '@/engine/gameflow/ThreeObjectUtils'
import type { FishLevelGameMode } from '../level/FishLevelGameMode'
import { ClashBuildingBaseActor } from '../base/ClashBuildingActors'
import type { TroopActor } from './troops/TroopActors'

export interface BattleProjectileOptions {
  gm: FishLevelGameMode
  from: THREE.Vector3
  to: THREE.Vector3
  speed: number
  damage: number
  color: number
  target: ClashBuildingBaseActor | TroopActor
}

export class BattleProjectileActor extends GenericActor implements IPoolable {
  /** 对象池引用（由池在 acquire 时设置） */
  pool: ObjectPool<BattleProjectileActor> | null = null
  /** 是否正在被使用 */
  active = false

  /** 起始位置（世界坐标） */
  private start: THREE.Vector3 = new THREE.Vector3()
  /** 终点位置（目标中心，世界坐标） */
  private end: THREE.Vector3 = new THREE.Vector3()
  /** 飞行速度（世界单位/秒） */
  private speed = 0
  /** 命中伤害 */
  private damage = 0
  /** 所属战斗 GameMode */
  private gm: FishLevelGameMode | null = null
  /** 目标建筑（命中建筑扣建筑血；与 targetTroop 二选一） */
  private targetBuilding: ClashBuildingBaseActor | null = null
  /** 目标兵（命中兵扣兵血；与 targetBuilding 二选一） */
  private targetTroop: TroopActor | null = null
  /** 总飞行距离（超出即视为未命中销毁，防永久飞行） */
  private totalDist = 0
  /** 已飞行距离 */
  private traveled = 0
  /** 弹丸颜色 */
  private _color = 0
  private _meshComp: BoxMeshComponent | null = null

  constructor() {
    super('BattleProjectile')
    // 预分配 BoxMeshComponent，acquire 时设尺寸和材质
    this._meshComp = this.addComponent(BoxMeshComponent, 'ProjMesh')
    this._meshComp.size = [0.3, 0.3, 0.3]
    this.deactivate()
  }

  /** 从池中取出时初始化 */
  activate(opts?: BattleProjectileOptions): void {
    const o = opts as BattleProjectileOptions
    this.active = true
    this.gm = o.gm
    this.start.copy(o.from)
    this.end.copy(o.to)
    this.speed = o.speed
    this.damage = o.damage
    this.totalDist = this.start.distanceTo(this.end)
    this.traveled = 0
    this._color = o.color
    if (o.target instanceof ClashBuildingBaseActor) {
      this.targetBuilding = o.target
      this.targetTroop = null
    } else {
      this.targetTroop = o.target
      this.targetBuilding = null
    }
    this.setPosition(o.from.x, o.from.y, o.from.z)
    if (this._meshComp) {
      this._meshComp.setMaterial(createMeshBasicMaterial({ color: this._color }))
    }
    this.root.visible = true
    this.enableTick()
  }

  /** 放回池中 */
  deactivate(): void {
    this.active = false
    this.root.visible = false
    this.setPreviewHidden(false)
    this.targetBuilding = null
    this.targetTroop = null
    this.gm = null
    this.disableTick()
  }

  /**
   * 每帧直线飞行：
   * 到达终点附近 → 命中结算（建筑/兵扣血）→ deactivate 归还；超出总路程 → 未命中归还。
   */
  override Tick(dt: number): void {
    super.Tick(dt)
    if (!this.active) return
    const step = this.speed * dt
    this.traveled += step
    const pos = this.root.position
    if (this.traveled >= this.totalDist || pos.distanceTo(this.end) < 0.4) {
      if (this.targetBuilding && !this.targetBuilding.bPendingDestroy) {
        this.gm!.damageBuilding(this.targetBuilding, this.damage)
      } else if (this.targetTroop && !this.targetTroop.health.isDead) {
        this.targetTroop.health.takeDamage(this.damage)
      }
      this.pool?.release(this)
      return
    }
    const dir = this.end.clone().sub(this.start).normalize()
    pos.addScaledVector(dir, step)
  }
}
