/**
 * BattleTroopActor — 战斗兵 Actor（攻打其他部落玩法）
 *
 * 由 FishLevelGameMode.tryDeployTroop 在放兵时生成（World.SpawnActor 托管），
 * 覆写 Tick 实现战斗 AI：
 *  1. 索敌：按兵种 preferred 偏好（resources/defenses/walls/any）优先选目标，否则最近建筑
 *  2. 目标在攻击距离（range）内 → 站桩攻击（攻击间隔 0.5s，伤害 = dps×0.5，dps 守恒），
 *     发射弹丸（近战 = 快速挥砍弹丸，远程 = 箭矢）
 *  3. 目标在射程外 → 直线移向目标；地面兵撞上阻挡建筑（blocksGround）→ 位置回退到
 *     包围盒边缘并把阻挡物设为目标（部落冲突式：被挡攻击阻挡物，不绕行）
 *  4. 飞行兵（flying）直接越过城墙/建筑，不做碰撞检测
 *
 * 死亡：takeDamage 扣血到 0 → 通知 GameMode（军队计数/胜负判定）→ destroy 自毁。
 * 网格：主体立方体（兵种 size × 颜色），飞行兵悬空（y 抬高）。
 */
import * as THREE from 'three'
import { GenericActor, MeshComponent, logger } from '@/engine'
import type { TroopType } from '../common/types'
import type { FishLevelGameMode } from '../level/FishLevelGameMode'

/** 兵攻击间隔（秒）：伤害 = dps × 0.5 每击，保证每秒总伤害 = dps（数值自洽） */
export const TROOP_ATTACK_INTERVAL = 0.5

export class BattleTroopActor extends GenericActor {
  /** 兵种配置（hp/dps/range/speed/preferred/flying/size 单一数据源） */
  readonly troop: TroopType
  /** 当前生命值 */
  hp: number
  /** 所属战斗 GameMode（索敌/弹丸/伤害回调） */
  private gm: FishLevelGameMode
  /** 攻击间隔计时器（倒计时到 0 开火并重置） */
  private attackTimer = 0
  /** 是否已死亡（防重复死亡回调） */
  private dead = false

  constructor(gm: FishLevelGameMode, troopId: string, troop: TroopType, x: number, z: number) {
    super(`BattleTroop_${troopId}`)
    this.gm = gm
    this.troop = troop
    this.hp = troop.hp
    this.setPosition(x, troop.flying ? 2 : 0, z)
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return
    // 主体立方体：兵种渲染尺寸 × 兵种色（飞行兵悬空 y 已抬高）
    const [sw, sh, sd] = this.troop.size
    const body = w.createBoxMesh(sw, sh, sd, this.troop.color)
    body.position.y = sh / 2
    this.addComponent(new MeshComponent(this, body, 'BodyMesh'))
    logger.info(`[Battle] 兵部署: ${this.troop.name} @ (${this.root.position.x.toFixed(1)}, ${this.root.position.z.toFixed(1)}) hp=${this.hp} flying=${this.troop.flying}`)
  }

  /**
   * 每帧战斗 AI（由 World 驱动）：
   * 战斗已结束 → 停摆；否则按 索敌 → 攻击/移动 状态机推进。
   */
  override Tick(dt: number): void {
    super.Tick(dt)
    if (this.dead || this.gm.battleEnded) return
    this.attackTimer = Math.max(0, this.attackTimer - dt)

    const target = this.gm.getBestTargetFor(this)
    if (!target) return // 无存活建筑 → 待机

    const pos = this.root.position
    const center = this.gm.buildingCenter(target)
    const dx = center.x - pos.x
    const dz = center.z - pos.z
    const dist = Math.hypot(dx, dz)
    // 攻击距离 = range + 目标半宽（兵中心到建筑中心距离换算成"兵到建筑边缘"的 gap）：
    // 近战兵被 AABB 阻挡在 half+兵半宽 处，若只用 range（0.5~0.8）判定会永远够不到
    // 阻挡物（死锁）。加目标半宽后，贴到建筑边缘即进入攻击距离。
    const attackDist = this.troop.range + target.type.size / 2

    // ─── 射程内：站桩攻击 ───
    if (dist <= attackDist) {
      if (this.attackTimer <= 0) {
        this.attackTimer = TROOP_ATTACK_INTERVAL
        // 每击伤害 = dps × 间隔（0.5s），每秒总伤害守恒
        this.gm.fireTroopAttack(this, target, this.troop.dps * TROOP_ATTACK_INTERVAL)
      }
      return
    }

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
      // 原因：兵移动步长（speed×dt）可能超过攻击距离余量，若被挡时位置停在
      // AABB 外不动，会卡在"够不到阻挡物"的死锁（只能挨塔打）。贴到边缘后
      // 距离 = 半宽+兵半宽 ≤ range+半宽（攻击距离），下一帧即可攻击。
      const half = blocker.type.size / 2 + this.troop.size[0] / 2
      const c = this.gm.buildingCenter(blocker)
      const dirX = nx - pos.x
      const dirZ = nz - pos.z
      // 各轴到达 AABB 边界所需比例 t，取最小 = 最先触壁的轴
      let t = 1
      if (dirX > 0) t = Math.min(t, (c.x - half - pos.x) / dirX)
      else if (dirX < 0) t = Math.min(t, (c.x + half - pos.x) / dirX)
      if (dirZ > 0) t = Math.min(t, (c.z - half - pos.z) / dirZ)
      else if (dirZ < 0) t = Math.min(t, (c.z + half - pos.z) / dirZ)
      // 停在边界外 0.05（浮点余量防进入 AABB）
      const tStop = Math.max(0, Math.min(1, t - 0.05))
      pos.x += dirX * tStop
      pos.z += dirZ * tStop
      // 被挡攻击阻挡物：切换目标覆盖
      if (blocker !== target) {
        logger.info(`[Battle] ${this.troop.name} 被 ${blocker.type.name} 阻挡，切换攻击目标`)
        this.gm.setTroopTargetOverride(this, blocker)
      }
      return
    }
    pos.x = nx
    pos.z = nz
  }

  /**
   * 受到伤害（防御塔弹丸/敌方反击命中）：
   * hp 扣到 0 → 标记死亡 → 通知 GameMode（移除军队计数 + 胜负判定）→ 自毁。
   */
  takeDamage(amount: number): void {
    if (this.dead) return
    this.hp -= amount
    logger.info(`[Battle] 兵 ${this.troop.name} 受击 -${Math.round(amount)}（剩余 hp=${Math.max(0, Math.round(this.hp))}）`)
    if (this.hp <= 0) {
      this.dead = true
      this.gm.onTroopDied(this)
      this.destroy()
    }
  }

  get isDead(): boolean {
    return this.dead
  }

  override EndPlay(): void {
    // 网格由 MeshComponent.EndPlay 自动释放
    super.EndPlay()
  }
}
