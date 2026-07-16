/**
 * FishSchool — 鱼群管理器
 * 管理一群鱼的编队游动：领航鱼 + 跟随者 + 基础集群行为
 */
import * as THREE from 'three'
import { logger } from '@/engine'
import { DEFAULT_CONFIG } from './types'
import type { GameConfig } from './types'
import { EatFishFoodPawn } from './EatFishFoodPawn'

const _center = new THREE.Vector3()
const _toCenter = new THREE.Vector3()
const _toLeader = new THREE.Vector3()
const _avoid = new THREE.Vector3()
const _totalDir = new THREE.Vector3()

export class FishSchool {
  /** 此鱼群的所有成员 */
  readonly members: EatFishFoodPawn[] = []
  /** 领航鱼 (索引0, 负责整体方向) */
  leader: EatFishFoodPawn | null = null

  /** 鱼群中心位置 (每帧更新) */
  readonly center = new THREE.Vector3()
  /** 鱼群整体方向 (每帧更新) */
  readonly direction = new THREE.Vector3(1, 0, 0)

  /** 颜色主题 (RGB 数组) */
  readonly colors: number[]

  /** 鱼群移动速度倍率 */
  private schoolSpeed: number
  /** 领航鱼方向切换计时 */
  private leaderDirTimer = 0
  /** 领航鱼当前目标方向 */
  private leaderTargetDir = new THREE.Vector3(1, 0, 0)

  /** 鱼群半径 */
  private radius: number
  /** 分离距离 */
  private separation: number
  /** 跟随强度 */
  private followStrength: number

  /** 各成员的偏移和相位信息 */
  private memberInfo: { offsetX: number; offsetZ: number; phase: number }[] = []

  constructor(
    colors: number[],
    config: GameConfig = DEFAULT_CONFIG,
  ) {
    this.colors = colors
    this.radius = config.schoolRadius
    this.separation = config.schoolSeparation
    this.followStrength = config.schoolFollowStrength
    this.schoolSpeed = config.foodFishSpeed * (0.7 + Math.random() * 0.3)

    // 随机初始方向
    const angle = Math.random() * Math.PI * 2
    this.leaderTargetDir.set(Math.sin(angle), 0, Math.cos(angle)).normalize()
    this.direction.copy(this.leaderTargetDir)
    this.leaderDirTimer = 2 + Math.random() * 3
  }

  /** 向鱼群添加成员 */
  addMember(fish: EatFishFoodPawn) {
    const idx = this.members.length
    // 为每个成员分配相对偏移和游动相位
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * this.radius * 0.6
    this.memberInfo.push({
      offsetX: Math.cos(angle) * dist,
      offsetZ: Math.sin(angle) * dist,
      phase: Math.random() * Math.PI * 2,
    })

    // 设置成员颜色 (取自主题)
    const colorIdx = idx % this.colors.length
    fish.setBodyColor(this.colors[colorIdx])

    this.members.push(fish)

    if (this.members.length === 1) {
      this.leader = fish
    }
  }

  /** 移除成员 (被吃掉时调用) */
  removeMember(fish: EatFishFoodPawn) {
    const idx = this.members.indexOf(fish)
    if (idx < 0) return
    this.members.splice(idx, 1)
    this.memberInfo.splice(idx, 1)

    // 如果领航鱼被吃，选新领航鱼
    if (fish === this.leader && this.members.length > 0) {
      this.leader = this.members[0]
      logger.info(`[FishSchool] 领航鱼更换`)
    }
    if (this.members.length === 0) {
      this.leader = null
    }
  }

  /** 鱼群是否还有存活成员 */
  get alive(): boolean {
    return this.members.length > 0
  }

  /** 获取所有存活成员 */
  getAliveMembers(): EatFishFoodPawn[] {
    return this.members.filter(f => !f.bPendingDestroy)
  }

  /** 每帧更新鱼群 */
  tick(dt: number, arenaHalf: number) {
    if (this.members.length === 0) return

    const alive = this.getAliveMembers()
    if (alive.length === 0) return

    // ─── 更新领航鱼方向 ───
    this.leaderDirTimer -= dt
    if (this.leaderDirTimer <= 0) {
      const angle = (Math.random() - 0.5) * Math.PI * 0.8 // 平滑转向，不突转
      this.leaderTargetDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
      this.leaderTargetDir.normalize()
      this.leaderDirTimer = 3 + Math.random() * 4
    }

    // 领航鱼缓慢转向目标方向
    this.direction.lerp(this.leaderTargetDir, dt * 0.8).normalize()

    // ─── 计算鱼群中心 ───
    _center.set(0, 0, 0)
    for (const f of alive) {
      _center.add(f.position)
    }
    _center.divideScalar(alive.length)
    this.center.copy(_center)

    // ─── 更新每条鱼的位置 ───
    for (let i = 0; i < this.members.length; i++) {
      const fish = this.members[i]
      if (fish.bPendingDestroy) continue

      const info = this.memberInfo[i]
      const pos = fish.position

      // 1) 朝鱼群中心方向 (凝聚力)
      _toCenter.copy(_center).sub(pos)
      _toCenter.y = 0
      const distToCenter = _toCenter.length()

      // 2) 朝领航鱼方向
      _toLeader.copy(this.leader!.position).sub(pos)
      _toLeader.y = 0

      // 3) 与其他成员的分离力
      _avoid.set(0, 0, 0)
      for (const other of this.members) {
        if (other === fish || other.bPendingDestroy) continue
        const diff = new THREE.Vector3().copy(pos).sub(other.position)
        diff.y = 0
        const d = diff.length()
        if (d < this.separation && d > 0.01) {
          _avoid.add(diff.normalize().divideScalar(d))
        }
      }

      // 4) 朝鱼群整体方向对齐
      _totalDir.copy(this.direction)

      // 合成最终移动方向
      const cohesionWeight = Math.min(1, distToCenter / this.radius) * 0.3
      const leaderWeight = 0.4
      const avoidWeight = 0.5
      const alignWeight = 0.3

      const moveX = (_toCenter.x * cohesionWeight + _toLeader.x * leaderWeight + _avoid.x * avoidWeight + _totalDir.x * alignWeight)
      const moveZ = (_toCenter.z * cohesionWeight + _toLeader.z * leaderWeight + _avoid.z * avoidWeight + _totalDir.z * alignWeight)

      if (Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01) {
        const dir = new THREE.Vector3(moveX, 0, moveZ).normalize()

        // 应用跟随强度
        const finalDir = new THREE.Vector3()
        // 混合个体随机方向和群游方向
        const fishAngle = Math.atan2(fish['moveDir'].z, fish['moveDir'].x)
        const schoolAngle = Math.atan2(dir.z, dir.x)
        let mixedAngle = fishAngle * (1 - this.followStrength) + schoolAngle * this.followStrength
        finalDir.set(Math.cos(mixedAngle), 0, Math.sin(mixedAngle)).normalize()

        // 移动
        const speed = this.schoolSpeed * (0.85 + Math.sin(info.phase + performance.now() * 0.001) * 0.15)
        pos.x += finalDir.x * speed * dt
        pos.z += finalDir.z * speed * dt

        // 面向移动方向
        fish['moveDir'].set(finalDir.x, 0, finalDir.z)
        fish.root.rotation.y = Math.atan2(finalDir.x, finalDir.z)

        // 保持在鱼群半径内 (软约束)
        if (distToCenter > this.radius * 1.5) {
          const pull = _toCenter.normalize().multiplyScalar(speed * dt * 0.5)
          pos.add(pull)
        }
      }

      // 边界约束
      const h = arenaHalf - 1.5
      if (pos.x > h) pos.x = h
      if (pos.x < -h) pos.x = -h
      if (pos.z > h) pos.z = h
      if (pos.z < -h) pos.z = -h
    }
  }

  /** 获取鱼群中某条鱼的相对偏移 (用于碰撞检测时区分不同鱼) */
  getMemberOffset(fish: EatFishFoodPawn): { x: number; z: number } | null {
    const idx = this.members.indexOf(fish)
    if (idx < 0) return null
    const info = this.memberInfo[idx]
    return { x: info.offsetX, z: info.offsetZ }
  }
}
