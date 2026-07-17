/**
 * EatFishFoodPawn — 食物鱼（小鱼）
 * 支持两种模式：独立随机游动 / 鱼群编队游动
 */
import * as THREE from 'three'
import { Pawn, logger, gizmos, ConfigRegistry } from '@/engine'
import type { GameConfig } from './types'

const _dir = new THREE.Vector3()
const _pos = new THREE.Vector3()

export class EatFishFoodPawn extends Pawn {
  private config: GameConfig
  private _sizeScale: number
  /** 移动方向 (公开供 FishSchool 读写) */
  public moveDir: THREE.Vector3
  /** 数据表原型分值（DataTable 加载时由 GameMode 赋值；吃鱼时优先用，否则回退按大小计分） */
  public archetypeScore?: number
  private dirChangeTimer = 0
  private speed: number

  // 3D
  bodyGroup: THREE.Group
  private bodyMat: THREE.MeshStandardMaterial
  private tailMat: THREE.MeshStandardMaterial
  private bodyMesh: THREE.Mesh

  /** 游泳动画 */
  private swimTime = Math.random() * 10

  /** 颜色调色板 (独立模式用) */
  private static COLORS = [
    0xff7043, 0xffca28, 0x66bb6a,
    0xab47bc, 0xec407a, 0x26c6da, 0x8d6e63,
  ]

  constructor() {
    super('EatFishFoodPawn')
    this.config = { ...ConfigRegistry.getConfig<GameConfig>('eatfish') }

    this._sizeScale = this.config.foodFishMinScale +
      Math.random() * (this.config.foodFishMaxScale - this.config.foodFishMinScale)

    this.speed = this.config.foodFishSpeed * (0.5 + Math.random())

    const angle = Math.random() * Math.PI * 2
    this.moveDir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize()
    this.dirChangeTimer = Math.random() * 3

    // ─── 材质 ───
    const color = EatFishFoodPawn.COLORS[Math.floor(Math.random() * EatFishFoodPawn.COLORS.length)]
    this.bodyMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.4, metalness: 0.2,
      emissive: color, emissiveIntensity: 0.08,
    })
    this.tailMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.7),
      roughness: 0.5, metalness: 0.1,
    })

    // ─── 构建小鱼身体 ───
    this.bodyGroup = new THREE.Group()

    const bodyGeo = new THREE.SphereGeometry(0.5, 12, 10)
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    this.bodyMesh.scale.set(1.2, 0.6, 0.5)
    this.bodyGroup.add(this.bodyMesh)

    const tailGeo = new THREE.ConeGeometry(0.2, 0.35, 6)
    const tailMesh = new THREE.Mesh(tailGeo, this.tailMat)
    tailMesh.rotation.x = Math.PI / 2
    tailMesh.position.set(0, 0, -0.6)
    this.bodyGroup.add(tailMesh)

    // 眼睛
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 })
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.1 })
    const eyeGeo = new THREE.SphereGeometry(0.06, 6, 6)
    const pupilGeo = new THREE.SphereGeometry(0.04, 6, 6)
    ;[-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(side * 0.2, 0.15, 0.35)
      this.bodyGroup.add(eye)
      const pupil = new THREE.Mesh(pupilGeo, pupilMat)
      pupil.position.set(side * 0.02, 0, 0.04)
      eye.add(pupil)
    })

    this.bodyGroup.scale.set(this._sizeScale, this._sizeScale, this._sizeScale)
    this.root.add(this.bodyGroup)

    this.randomizePosition()
  }

  /** 设置身体颜色 (供鱼群调用) */
  setBodyColor(color: number) {
    this.bodyMat.color.setHex(color)
    this.bodyMat.emissive.setHex(color)
    this.tailMat.color.copy(this.bodyMat.color).multiplyScalar(0.7)
  }

  /** 根据 DataTable 原型设置鱼的全部属性（颜色/大小/速度/分值） */
  setArchetype(archetype: { color: number; scale: number; speed: number; score: number }) {
    this.setBodyColor(archetype.color)
    this._sizeScale = archetype.scale
    this.bodyGroup.scale.set(this._sizeScale, this._sizeScale, this._sizeScale)
    this.speed = archetype.speed
    this.archetypeScore = archetype.score
  }

  /** 随机位置 */
  randomizePosition() {
    const half = this.config.arenaHalf - 2
    this.setPosition(
      (Math.random() - 0.5) * 2 * half,
      0.5,
      (Math.random() - 0.5) * 2 * half,
    )
  }

  /** 获取食物鱼的大小 */
  getSizeScale(): number {
    return this._sizeScale
  }

  /** 独立游动 Tick (非鱼群模式下使用) */
  tickIndependent(dt: number) {
    // 游泳动画
    this.swimTime += dt * 6
    this.bodyMesh.rotation.z = Math.sin(this.swimTime) * 0.1

    // 随机改变方向
    this.dirChangeTimer -= dt
    if (this.dirChangeTimer <= 0) {
      const angle = Math.random() * Math.PI * 2
      this.moveDir.set(Math.sin(angle), 0, Math.cos(angle)).normalize()
      this.dirChangeTimer = 1 + Math.random() * 3
    }

    // 游动
    this.root.position.x += this.moveDir.x * this.speed * dt
    this.root.position.z += this.moveDir.z * this.speed * dt

    // 面向移动方向
    if (this.moveDir.lengthSq() > 0.01) {
      this.root.rotation.y = Math.atan2(this.moveDir.x, this.moveDir.z)
    }

    // 边界反弹
    const half = this.config.arenaHalf - 1.5
    if (this.root.position.x > half) { this.root.position.x = half; this.moveDir.x *= -1 }
    if (this.root.position.x < -half) { this.root.position.x = -half; this.moveDir.x *= -1 }
    if (this.root.position.z > half) { this.root.position.z = half; this.moveDir.z *= -1 }
    if (this.root.position.z < -half) { this.root.position.z = -half; this.moveDir.z *= -1 }

    this.root.position.y = 0.5
  }

  override Tick(dt: number) {
    super.Tick(dt)
    // 默认独立模式。如果属于鱼群，FishSchool.tick 会直接操作 position
    // 所以这里只做动画
    this.swimTime += dt * 6
    this.bodyMesh.rotation.z = Math.sin(this.swimTime) * 0.1
  }

  override OnDrawGizmos() {
    gizmos.color = 0xffff00
    gizmos.DrawWireSphere(this.position, 0.5 * this._sizeScale, 8)
  }

  override EndPlay() {
    this.bodyMat.dispose()
    this.tailMat.dispose()
    super.EndPlay()
  }
}
