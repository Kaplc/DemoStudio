/**
 * EatFishPredatorPawn — 捕食者鱼（大鱼）
 * 比玩家大，会追逐玩家。玩家必须避开它。
 */
import * as THREE from 'three'
import { Pawn, logger, gizmos, ConfigRegistry } from '@/engine'
import type { GameConfig } from './types'
import { EatFishPawn } from './EatFishPawn'

const _toPlayer = new THREE.Vector3()
const _fwd = new THREE.Vector3()

export class EatFishPredatorPawn extends Pawn {
  private config: GameConfig
  private _sizeScale: number
  private speed: number
  private moveDir: THREE.Vector3
  private roamTimer = 0
  private swimTime = 0

  // 3D
  private bodyGroup: THREE.Group
  private bodyMat: THREE.MeshStandardMaterial
  private tailMat: THREE.MeshStandardMaterial
  private mouthMat: THREE.MeshStandardMaterial

  constructor() {
    super('EatFishPredatorPawn')

    this.config = { ...ConfigRegistry.getConfig<GameConfig>('eatfish.eatfish') }

    // 捕食者比玩家初始大
    this._sizeScale = this.config.playerInitialScale * this.config.predatorScaleMultiplier +
      Math.random() * 0.5

    this.speed = this.config.predatorSpeed * (0.8 + Math.random() * 0.4)

    const angle = Math.random() * Math.PI * 2
    this.moveDir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize()
    this.roamTimer = 0

    // ─── 材质 ───
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xd32f2f,
      roughness: 0.3,
      metalness: 0.5,
      emissive: 0xb71c1c,
      emissiveIntensity: 0.2,
    })
    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0x8e0000,
      roughness: 0.4,
      metalness: 0.3,
    })
    this.mouthMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
    })

    // ─── 构建 predator 鱼身体 ───
    this.bodyGroup = new THREE.Group()

    // 身体（更大更壮）
    const bodyGeo = new THREE.SphereGeometry(0.6, 16, 12)
    const bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    bodyMesh.scale.set(1.6, 0.8, 0.7)
    this.bodyGroup.add(bodyMesh)

    // 尾巴
    const tailGeo = new THREE.ConeGeometry(0.35, 0.6, 8)
    const tailMesh = new THREE.Mesh(tailGeo, this.tailMat)
    tailMesh.rotation.x = Math.PI / 2
    tailMesh.position.set(0, 0, -0.8)
    this.bodyGroup.add(tailMesh)

    // 背鳍
    const finMat = new THREE.MeshStandardMaterial({
      color: 0x8e0000, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.7,
    })
    const finGeo = new THREE.ConeGeometry(0.12, 0.3, 4)
    ;[-1, 1].forEach((side) => {
      const fin = new THREE.Mesh(finGeo, finMat)
      fin.rotation.z = side * Math.PI / 3
      fin.position.set(side * 0.4, 0.2, -0.1)
      this.bodyGroup.add(fin)
    })

    // 嘴（牙齿）
    const mouthGeo = new THREE.ConeGeometry(0.08, 0.12, 4)
    for (let i = -1; i <= 1; i += 0.5) {
      const tooth = new THREE.Mesh(mouthGeo, this.mouthMat)
      tooth.position.set(i * 0.15, -0.05, 0.55)
      tooth.rotation.x = Math.PI / 3
      this.bodyGroup.add(tooth)
    }

    // 凶恶的眼睛
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xffff00, roughness: 0.1, metalness: 0.0, emissive: 0xffff00, emissiveIntensity: 0.3,
    })
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 })
    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8)
    const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8)
    ;[-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(side * 0.28, 0.25, 0.4)
      this.bodyGroup.add(eye)
      const pupil = new THREE.Mesh(pupilGeo, pupilMat)
      pupil.position.set(0, 0, 0.06)
      eye.add(pupil)
    })

    this.bodyGroup.scale.set(this._sizeScale, this._sizeScale, this._sizeScale)
    this.root.add(this.bodyGroup)

    // 随机初始位置（在边缘）
    this.randomizePosition()
  }

  randomizePosition() {
    const half = this.config.arenaHalf - 3
    const side = Math.floor(Math.random() * 4)
    switch (side) {
      case 0: this.setPosition(-half, 0.5, (Math.random() - 0.5) * 2 * half); break
      case 1: this.setPosition(half, 0.5, (Math.random() - 0.5) * 2 * half); break
      case 2: this.setPosition((Math.random() - 0.5) * 2 * half, 0.5, -half); break
      case 3: this.setPosition((Math.random() - 0.5) * 2 * half, 0.5, half); break
    }
  }

  /** 获取 predator 的大小 */
  getSizeScale(): number {
    return this._sizeScale
  }

  /** 获取 chase 范围 */
  getChaseRange(): number {
    return this.config.predatorChaseRange
  }

  override Tick(dt: number) {
    super.Tick(dt)

    // 游泳动画
    this.swimTime += dt * 6
    this.bodyGroup.children.forEach((child, i) => {
      if (i > 0 && i < 4) { // 尾巴摆动
        child.rotation.z = Math.sin(this.swimTime) * 0.2
      }
    })

    // 追逐玩家或漫游
    const player = this.findPlayer()
    let moving = false

    if (player && !player.invincible) {
      _toPlayer.copy(player.position).sub(this.root.position)
      const dist = _toPlayer.length()

      if (dist < this.config.predatorChaseRange) {
        // 追逐玩家
        _toPlayer.y = 0
        _toPlayer.normalize()
        this.moveDir.copy(_toPlayer)
        moving = true
      }
    }

    if (!moving) {
      // 漫游
      this.roamTimer -= dt
      if (this.roamTimer <= 0) {
        const angle = Math.random() * Math.PI * 2
        this.moveDir.set(Math.sin(angle), 0, Math.cos(angle)).normalize()
        this.roamTimer = 2 + Math.random() * 4
      }
    }

    // 移动
    const currentSpeed = moving ? this.speed * 1.3 : this.speed * 0.6
    this.root.position.x += this.moveDir.x * currentSpeed * dt
    this.root.position.z += this.moveDir.z * currentSpeed * dt

    // 面向移动方向
    if (this.moveDir.lengthSq() > 0.01) {
      const targetRot = Math.atan2(this.moveDir.x, this.moveDir.z)
      this.root.rotation.y = targetRot
    }

    // 边界约束
    const half = this.config.arenaHalf - 1.5
    this.root.position.x = Math.max(-half, Math.min(half, this.root.position.x))
    this.root.position.z = Math.max(-half, Math.min(half, this.root.position.z))
    // 边缘反弹漫游
    if (Math.abs(this.root.position.x) >= half || Math.abs(this.root.position.z) >= half) {
      this.roamTimer = 0
    }

    this.root.position.y = 0.5
  }

  private findPlayer(): EatFishPawn | null {
    if (!this.world) return null
    // 通过 world 查找玩家
    for (const actor of this.world.GetAllActors()) {
      if (actor instanceof EatFishPawn) return actor
    }
    return null
  }

  override OnDrawGizmos() {
    // 追逐范围
    gizmos.color = 0xff0000
    gizmos.DrawWireSphere(this.position, this.config.predatorChaseRange, 24)
    // 自身大小
    gizmos.color = 0xff4444
    gizmos.DrawWireSphere(this.position, this._sizeScale, 12)
  }

  override EndPlay() {
    this.bodyMat.dispose()
    this.tailMat.dispose()
    this.mouthMat.dispose()
    super.EndPlay()
  }
}
