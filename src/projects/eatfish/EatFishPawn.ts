/**
 * EatFishPawn — 玩家鱼角色
 * 自由 3D 游泳，通过 WASD 控制方向，吃小鱼长大
 */
import * as THREE from 'three'
import { Pawn, logger, gizmos, ConfigRegistry } from '@/engine'
import type { GameConfig } from './types'

// ─── 复用临时对象 ───
const _forward = new THREE.Vector3()
const _toTarget = new THREE.Vector3()
const _pos = new THREE.Vector3()

export class EatFishPawn extends Pawn {
  private config: GameConfig

  /** 当前移动速度倍率 (0~1) */
  public speedFactor = 1
  /** 当前鱼的大小 */
  public fishScale: number
  /** 是否无敌（刚生成时） */
  public invincible = true
  /** 无敌倒计时 */
  private invincibleTimer = 0

  // 3D 对象
  private bodyGroup: THREE.Group
  private bodyMesh: THREE.Mesh
  private tailMesh: THREE.Mesh
  private finLeft: THREE.Mesh
  private finRight: THREE.Mesh
  private eyeLeft: THREE.Mesh
  private eyeRight: THREE.Mesh

  // 材质
  private bodyMat: THREE.MeshStandardMaterial
  private tailMat: THREE.MeshStandardMaterial
  private finMat: THREE.MeshStandardMaterial
  private eyeMat: THREE.MeshStandardMaterial

  // 动画
  private swimTime = 0
  private invincibleFlash = 0

  constructor() {
    super('EatFishPawn')
    this.config = { ...ConfigRegistry.getConfig<GameConfig>('eatfish') }
    this.fishScale = this.config.playerInitialScale

    // ─── 材质 ───
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      roughness: 0.3,
      metalness: 0.4,
      emissive: 0x29b6f6,
      emissiveIntensity: 0.15,
    })
    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0x29b6f6,
      roughness: 0.4,
      metalness: 0.3,
    })
    this.finMat = new THREE.MeshStandardMaterial({
      color: 0x81d4fa,
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 0.7,
    })
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.0,
    })

    // ─── 构建鱼的身体 ───
    this.bodyGroup = new THREE.Group()

    // 身体（椭球）
    const bodyGeo = new THREE.SphereGeometry(0.5, 16, 12)
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    this.bodyMesh.scale.set(1.4, 0.7, 0.5)
    this.bodyMesh.position.set(0, 0, 0)
    this.bodyGroup.add(this.bodyMesh)

    // 尾巴
    const tailGeo = new THREE.ConeGeometry(0.25, 0.5, 8)
    this.tailMesh = new THREE.Mesh(tailGeo, this.tailMat)
    this.tailMesh.rotation.x = Math.PI / 2
    this.tailMesh.position.set(0, 0, -0.7)
    this.bodyGroup.add(this.tailMesh)

    // 背鳍
    const finGeo = new THREE.ConeGeometry(0.08, 0.25, 4)
    this.finLeft = new THREE.Mesh(finGeo, this.finMat)
    this.finLeft.rotation.z = Math.PI / 3
    this.finLeft.position.set(-0.35, 0.15, -0.1)
    this.bodyGroup.add(this.finLeft)

    this.finRight = new THREE.Mesh(finGeo, this.finMat)
    this.finRight.rotation.z = -Math.PI / 3
    this.finRight.position.set(0.35, 0.15, -0.1)
    this.bodyGroup.add(this.finRight)

    // 眼睛
    const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8)
    const pupilGeo = new THREE.SphereGeometry(0.05, 8, 8)
    const pupilMat = new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.1, metalness: 0.0,
    })

    this.eyeLeft = new THREE.Mesh(eyeGeo, this.eyeMat)
    this.eyeLeft.position.set(-0.25, 0.2, 0.45)
    this.bodyGroup.add(this.eyeLeft)
    const pupilL = new THREE.Mesh(pupilGeo, pupilMat)
    pupilL.position.set(-0.02, 0, 0.05)
    this.eyeLeft.add(pupilL)

    this.eyeRight = new THREE.Mesh(eyeGeo, this.eyeMat)
    this.eyeRight.position.set(0.25, 0.2, 0.45)
    this.bodyGroup.add(this.eyeRight)
    const pupilR = new THREE.Mesh(pupilGeo, pupilMat)
    pupilR.position.set(0.02, 0, 0.05)
    this.eyeRight.add(pupilR)

    // 鱼默认朝向 +Z（鼻子朝前）
    this.root.add(this.bodyGroup)
    this.applyScale()

    // 初始位置
    this.setPosition(0, 0.5, 0)
  }

  InitGame() {
    this.fishScale = this.config.playerInitialScale
    this.speedFactor = 1
    this.invincible = true
    this.invincibleTimer = this.config.invincibleTime
    this.swimTime = 0
    this.invincibleFlash = 0
    this.applyScale()
    this.setPosition(0, 0.5, 0)
    this.root.rotation.set(0, 0, 0)
  }

  override Tick(dt: number) {
    super.Tick(dt)

    // 无敌计时
    if (this.invincible) {
      this.invincibleTimer -= dt
      this.invincibleFlash += dt
      if (this.invincibleTimer <= 0) {
        this.invincible = false
        this.bodyGroup.visible = true
      } else {
        // 闪烁效果
        this.bodyGroup.visible = Math.floor(this.invincibleFlash * 8) % 2 === 0
      }
    }

    // 游泳动画：尾巴摆动 + 身体微摆
    this.swimTime += dt * (8 + this.speedFactor * 4)
    const tailSwing = Math.sin(this.swimTime) * 0.3
    this.tailMesh.rotation.z = tailSwing
    this.bodyMesh.rotation.z = Math.sin(this.swimTime * 0.5) * 0.05

    // 向前移动
    _forward.set(0, 0, 1).applyQuaternion(this.root.quaternion)
    const speed = this.config.playerSpeed * this.speedFactor
    this.root.position.x += _forward.x * speed * dt
    this.root.position.z += _forward.z * speed * dt

    // 保持在水面高度
    this.root.position.y = 0.5 + Math.sin(this.swimTime * 0.3) * 0.1

    // 竞技场边界约束
    const half = this.config.arenaHalf
    const margin = 1.5
    this.root.position.x = Math.max(-half + margin, Math.min(half - margin, this.root.position.x))
    this.root.position.z = Math.max(-half + margin, Math.min(half - margin, this.root.position.z))
  }

  /** 左转（逆时针） */
  TurnLeft(dt: number) {
    this.root.rotation.y += this.config.playerRotateSpeed * dt
  }

  /** 右转（顺时针） */
  TurnRight(dt: number) {
    this.root.rotation.y -= this.config.playerRotateSpeed * dt
  }

  /** 加速 */
  SpeedUp() {
    this.speedFactor = Math.min(1.5, this.speedFactor + 0.15)
  }

  /** 减速 */
  SpeedDown() {
    this.speedFactor = Math.max(0.3, this.speedFactor - 0.1)
  }

  /** 重置速度 */
  ResetSpeed() {
    this.speedFactor = Math.max(0.5, this.speedFactor - 0.02)
  }

  /** 吃鱼长大 */
  Grow(amount: number) {
    this.fishScale += amount
    this.applyScale()
  }

  /** 获取当前鱼的大小 */
  getScale(): number {
    return this.fishScale
  }

  /** 应用缩放 */
  private applyScale() {
    this.bodyGroup.scale.set(this.fishScale, this.fishScale, this.fishScale)
  }

  /** 向前方向向量 */
  getForward(): THREE.Vector3 {
    return _forward.set(0, 0, 1).applyQuaternion(this.root.quaternion)
  }

  override EndPlay() {
    // 材质清理由 destroy 处理
    super.EndPlay()
  }

  override destroy() {
    this.bodyMat.dispose()
    this.tailMat.dispose()
    this.finMat.dispose()
    this.eyeMat.dispose()
    super.destroy()
  }

  // ═══ Gizmos 调试绘制 ═══

  override OnDrawGizmos() {
    // 绘制鱼的前方向
    gizmos.color = 0x4fc3f7
    const fwd = this.getForward()
    gizmos.DrawRay(this.position, fwd, 2)

    // 无敌时绘制金色光环
    if (this.invincible) {
      gizmos.color = 0xffd700
      gizmos.DrawWireSphere(this.position, 1.2 * this.fishScale, 16)
    }
  }
}
