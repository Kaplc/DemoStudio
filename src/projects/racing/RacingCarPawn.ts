/**
 * RacingCarPawn — 赛车角色
 * 物理模拟：加速、刹车、转向阻力、漂移
 *
 * 视觉构建：在 BeginPlay()（actor.world 已就绪）中通过 world 工厂创建
 * MeshStandardMaterial / BoxGeometry / SphereGeometry / CylinderGeometry / Mesh
 * —— 避免项目代码裸 new THREE.<几何体/网格/材质> 触发 CodeLint 违规。
 */
import * as THREE from 'three'
import { Pawn, logger, gizmos } from '@/engine'
import { DEFAULT_CONFIG } from './types'
import type { GameConfig } from './types'

const _forward = new THREE.Vector3()
const _boxMin = new THREE.Vector3()
const _boxMax = new THREE.Vector3()

export class RacingCarPawn extends Pawn {
  private config: GameConfig

  /** 当前速度 (沿前进方向, 正值向前) */
  public speed = 0
  /** 当前转向角 (-maxSteerAngle ~ +maxSteerAngle) */
  public steerAngle = 0
  /** 油门输入 (0~1) */
  public throttleInput = 0
  /** 刹车输入 (0~1) */
  public brakeInput = 0
  /** 转向输入 (-1~1, 负=左, 正=右) */
  public steerInput = 0

  /** 计时器 */
  public lapCount = 0
  public raceTime = 0
  public bestLapTime = Infinity
  public currentLapTime = 0
  public finished = false

  /** 上一个检查点通过时间 */
  private checkpointTimes: number[] = []
  private checkpointPassed: boolean[] = []

  // 3D 对象
  private carBody!: THREE.Group
  private bodyMesh!: THREE.Mesh
  private bodyMat!: THREE.MeshStandardMaterial
  private roofMat!: THREE.MeshStandardMaterial
  private windowMat!: THREE.MeshStandardMaterial
  private wheelMat!: THREE.MeshStandardMaterial
  private lightMat!: THREE.MeshStandardMaterial
  private spoilerMat!: THREE.MeshStandardMaterial

  // 车轮
  private wheels: THREE.Mesh[] = []
  private wheelPositions: { x: number; z: number }[] = [
    { x: -0.7, z: -1.2 },  // 左后
    { x: 0.7, z: -1.2 },   // 右后
    { x: -0.7, z: 1.2 },   // 左前
    { x: 0.7, z: 1.2 },    // 右前
  ]

  // 轮胎痕迹
  private trailPositions: THREE.Vector3[] = []
  private trailTimer = 0

  constructor() {
    super('RacingCarPawn')
    this.config = { ...DEFAULT_CONFIG }
  }

  /** 构建 3D 视觉（BeginPlay 时 actor.world 已就绪；此阶段才创建 THREE 资源） */
  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return

    // ─── 材质 ───
    this.bodyMat = w.createStandardMaterial({
      color: 0xe53935,
      roughness: 0.2,
      metalness: 0.6,
    })
    this.roofMat = w.createStandardMaterial({
      color: 0xc62828,
      roughness: 0.3,
      metalness: 0.4,
    })
    this.windowMat = w.createStandardMaterial({
      color: 0x1a237e,
      roughness: 0.0,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
    })
    this.wheelMat = w.createStandardMaterial({
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.0,
    })
    this.lightMat = w.createStandardMaterial({
      color: 0xffffcc, roughness: 0.1, metalness: 0.0, emissive: 0xffffaa, emissiveIntensity: 0.2,
    })
    this.spoilerMat = w.createStandardMaterial({
      color: 0x111111, roughness: 0.5, metalness: 0.0,
    })

    // ─── 构建车身 ───
    this.carBody = w.createGroup()

    // 底盘 (箱体)
    const chassisGeo = w.createBoxGeometry(1.6, 0.3, 2.8)
    const chassis = w.createCustomMesh(chassisGeo, this.bodyMat)
    chassis.position.set(0, 0.25, 0)
    chassis.castShadow = true
    this.carBody.add(chassis)

    // 车身 (上部)
    const bodyGeo = w.createBoxGeometry(1.4, 0.35, 1.8)
    this.bodyMesh = w.createCustomMesh(bodyGeo, this.roofMat)
    this.bodyMesh.position.set(0, 0.55, -0.2)
    this.bodyMesh.castShadow = true
    this.carBody.add(this.bodyMesh)

    // 挡风玻璃
    const glassGeo = w.createBoxGeometry(1.2, 0.25, 0.1)
    const glassF = w.createCustomMesh(glassGeo, this.windowMat)
    glassF.position.set(0, 0.6, 0.95)
    this.carBody.add(glassF)

    const glassR = w.createCustomMesh(glassGeo, this.windowMat)
    glassR.position.set(0, 0.6, -1.3)
    this.carBody.add(glassR)

    // 前保险杠 / 车灯
    const lightGeo = w.createSphereGeometry(0.12, 8, 8)
    for (let side of [-1, 1]) {
      const light = w.createCustomMesh(lightGeo, this.lightMat)
      light.position.set(side * 0.5, 0.25, 1.45)
      light.scale.set(1, 0.5, 0.3)
      this.carBody.add(light)
    }

    // 尾翼
    const spoilerGeo = w.createBoxGeometry(1.2, 0.05, 0.2)
    const spoiler = w.createCustomMesh(spoilerGeo, this.spoilerMat)
    spoiler.position.set(0, 0.8, -1.4)
    this.carBody.add(spoiler)

    // 车轮
    const wheelGeo = w.createCylinderGeometry(0.22, 0.22, 0.15, 12)
    for (const wp of this.wheelPositions) {
      const wheel = w.createCustomMesh(wheelGeo, this.wheelMat)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(wp.x, 0.15, wp.z)
      wheel.castShadow = true
      this.carBody.add(wheel)
      this.wheels.push(wheel)
    }

    this.root.add(this.carBody)
    this.root.position.y = 0.15
  }

  InitGame() {
    this.speed = 0
    this.steerAngle = 0
    this.lapCount = 0
    this.raceTime = 0
    this.bestLapTime = Infinity
    this.currentLapTime = 0
    this.finished = false
    this.throttleInput = 0
    this.brakeInput = 0
    this.steerInput = 0
    this.setPosition(0, 0.15, -this.config.trackRadius + 3)
    this.root.rotation.set(0, 0, 0)
    this.trailPositions = []
  }

  override Tick(dt: number) {
    super.Tick(dt)
    if (this.finished) return

    // ─── 物理模拟 ───

    // 转向输入 → 转向角
    if (Math.abs(this.steerInput) > 0.01) {
      this.steerAngle += this.steerInput * this.config.steerSpeed * dt
      this.steerAngle = Math.max(-this.config.maxSteerAngle,
        Math.min(this.config.maxSteerAngle, this.steerAngle))
    } else {
      // 回正
      if (Math.abs(this.steerAngle) > 0.01) {
        const returnAmt = this.config.steerReturnSpeed * dt
        if (Math.abs(this.steerAngle) < returnAmt) {
          this.steerAngle = 0
        } else {
          this.steerAngle -= Math.sign(this.steerAngle) * returnAmt
        }
      }
    }

    // 加速度
    if (this.throttleInput > 0) {
      this.speed += this.config.acceleration * this.throttleInput * dt
    }
    if (this.brakeInput > 0) {
      if (this.speed > 0) {
        this.speed -= this.config.brakeDecel * this.brakeInput * dt
      } else {
        this.speed -= this.config.brakeDecel * this.brakeInput * dt * 0.3
      }
    }
    // 摩擦减速
    if (this.throttleInput <= 0 && this.brakeInput <= 0) {
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - this.config.friction * dt)
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + this.config.friction * dt)
      }
    }
    // 限速
    this.speed = Math.max(-this.config.maxSpeed * 0.4,
      Math.min(this.config.maxSpeed, this.speed))

    // 转向 + 移动（基于当前速度的前轮转向模型）
    if (Math.abs(this.speed) > 0.1) {
      const speedFactor = Math.min(1, Math.abs(this.speed) / 10)
      const turnAmount = this.steerAngle * speedFactor * dt
      this.root.rotation.y += Math.sign(this.speed) * turnAmount
    }

    // 前进
    _forward.set(0, 0, 1).applyQuaternion(this.root.quaternion)
    this.root.position.x += _forward.x * this.speed * dt
    this.root.position.z += _forward.z * this.speed * dt

    // 车身动态倾斜
    const tiltTarget = -this.steerInput * 0.15 * Math.min(1, Math.abs(this.speed) / 10)
    if (this.carBody) {
      this.carBody.rotation.z += (tiltTarget - this.carBody.rotation.z) * 5 * dt
    }

    // 保持在 y=0.15
    this.root.position.y = 0.15

    // ─── 赛道边界约束 ───
    this.constrainToTrack()

    // ─── 计时 ───
    this.raceTime += dt
    this.currentLapTime += dt

    // 轮胎痕迹
    if (Math.abs(this.speed) > 5 && Math.abs(this.steerInput) > 0.3) {
      this.trailTimer += dt
      if (this.trailTimer > 0.15) {
        this.trailTimer = 0
        this.trailPositions.push(this.position.clone())
      }
    }
  }

  /** 约束到赛道范围 */
  private constrainToTrack() {
    const pos = this.root.position
    const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z)
    const inner = this.config.trackRadius - this.config.trackWidth / 2
    const outer = this.config.trackRadius + this.config.trackWidth / 2

    if (dist < inner - 0.5) {
      // 在内侧草地 — 减速 + 推回
      this.speed *= 0.85
      const dir = Math.atan2(pos.z, pos.x)
      pos.x = (inner - 0.5) * Math.cos(dir)
      pos.z = (inner - 0.5) * Math.sin(dir)
    } else if (dist > outer + 0.5) {
      this.speed *= 0.85
      const dir = Math.atan2(pos.z, pos.x)
      pos.x = (outer + 0.5) * Math.cos(dir)
      pos.z = (outer + 0.5) * Math.sin(dir)
    }
  }

  /** 获取当前速度的 km/h 近似值 (游戏单位/s * 3.6) */
  getSpeedKmh(): number {
    return Math.round(Math.abs(this.speed) * 3.6)
  }

  /** 检查是否通过某个角度检查点 */
  checkCheckpoint(angleRad: number, currentTime: number): boolean {
    const pos = this.root.position
    const carAngle = Math.atan2(pos.z, pos.x)
    // 归一化角度差
    let diff = carAngle - angleRad
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    return Math.abs(diff) < 0.3
  }

  /** 完成一圈 */
  completeLap() {
    const lapTime = this.currentLapTime
    if (lapTime > 1) { // 排除极短圈
      if (lapTime < this.bestLapTime) {
        this.bestLapTime = lapTime
      }
      this.lapCount++
      logger.info(`[Racing] 完成第 ${this.lapCount} 圈! 用时: ${lapTime.toFixed(2)}s`)
    }
    this.currentLapTime = 0
  }

  /** 获取当前圈数进度 (0~1, 基于角度) */
  getLapProgress(): number {
    const pos = this.root.position
    const angle = Math.atan2(pos.z, pos.x)
    // 从 -PI~PI 映射到 0~1
    return (angle + Math.PI) / (Math.PI * 2)
  }

  // ═══ Gizmos ═══

  override OnDrawGizmos() {
    // 速度向量
    gizmos.color = 0xff4444
    _forward.set(0, 0, 1).applyQuaternion(this.root.quaternion)
    gizmos.DrawRay(this.position, _forward, Math.max(1, Math.abs(this.speed) * 0.3))

    // 车身包围盒
    gizmos.color = 0x44ff44
    _boxMin.set(-0.9, 0, -1.5)
    _boxMax.set(0.9, 0.7, 1.5)
    _boxMin.add(this.position)
    _boxMax.add(this.position)
    gizmos.DrawWireBox(_boxMin, _boxMax)

    // 轮胎痕迹
    gizmos.color = 0x333333
    for (let i = 1; i < this.trailPositions.length; i++) {
      gizmos.DrawLine(this.trailPositions[i - 1], this.trailPositions[i])
    }
  }

  override EndPlay() {
    if (this.bodyMat) this.bodyMat.dispose()
    if (this.roofMat) this.roofMat.dispose()
    if (this.windowMat) this.windowMat.dispose()
    if (this.wheelMat) this.wheelMat.dispose()
    if (this.lightMat) this.lightMat.dispose()
    if (this.spoilerMat) this.spoilerMat.dispose()
    super.EndPlay()
  }

  override destroy() {
    if (this.bodyMat) this.bodyMat.dispose()
    if (this.roofMat) this.roofMat.dispose()
    if (this.windowMat) this.windowMat.dispose()
    if (this.wheelMat) this.wheelMat.dispose()
    if (this.lightMat) this.lightMat.dispose()
    if (this.spoilerMat) this.spoilerMat.dispose()
    super.destroy()
  }
}