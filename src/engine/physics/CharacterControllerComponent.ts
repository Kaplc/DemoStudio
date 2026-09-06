/**
 * CharacterControllerComponent — 第三人称角色控制器（A2）
 *
 * 输入 → 期望速度 → cannon body 速度注入（与 TroopMoveComponent 同一物理形态，
 * 但面向重力世界）：物理世界需配置重力（场景 gravity 字段 / physics.setGravity），
 * 胶囊体锁旋转（cannon fixedRotation，视觉朝向由本组件驱动 owner.root.rotation.y）。
 *
 * 能力：
 *  - setMoveInput(x, z)：世界系移动输入（相机相对换算由调用方/子类完成；
 *    Pawn.MoveForward/MoveRight 默认实现会写入本组件）
 *  - jump()：地面起跳（velocity.y = jumpSpeed）
 *  - dodge()：翻滚冲刺（固定方向 + 时长窗口 + 冷却；isDodging 可接无敌帧）
 *  - knockback(ix, iy, iz)：受击冲击（直接叠加速度）
 *  - 地面检测：碰撞事件驱动（接触对方中心低于自身即视为地面，见 isGroundLike）
 *
 * 前置条件（游戏代码负责配置碰撞体）：
 *  - owner 挂 CapsuleColliderComponent（或任意 ColliderComponent），bodyType='dynamic'、
 *    lockY=false（y 需参与重力模拟）、linearDamping 建议 0（水平速度由本组件全权控制）
 */
import * as THREE from 'three'
import { ActorComponent } from '../entity/ActorComponent'
import { logger } from '../Logger'
import { ColliderComponent } from './ColliderComponent'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'

/** 朝向插值用：角度差归一到 [-π, π] */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export class CharacterControllerComponent extends ActorComponent {
  // ─── 可调参数（蓝图/Inspector 可编辑）───
  /** 最大水平移动速度（米/秒） */
  speed = 6
  /** 水平速度趋近期望值的加速度（米/秒²，越大越跟手） */
  acceleration = 40
  /** 起跳初速度（米/秒，配合世界重力决定跳高） */
  jumpSpeed = 8
  /** 翻滚冲刺速度 */
  dodgeSpeed = 12
  /** 翻滚时长（秒） */
  dodgeDuration = 0.25
  /** 翻滚冷却（秒，从翻滚开始计） */
  dodgeCooldown = 0.8
  /** 朝向插值速度（越大转身越快；0 = 不转向） */
  turnSpeed = 12
  /** 移动输入是否相对当前活跃相机（默认 true：取活跃相机水平朝向为 forward） */
  cameraRelative = true

  // ─── 运行状态 ───
  private _moveInput = new THREE.Vector2() // 调用方设置的世界系输入（Tick 消费，不清零——持续按键语义）
  private _grounded = false
  private _dodgeTimer = 0
  private _dodgeCdTimer = 0
  private _dodgeDir = new THREE.Vector3()
  private _collider: ColliderComponent | null = null

  constructor(owner: Actor) {
    super(owner)
    this.name = 'CharacterControllerComponent'
  }

  /** owner 上的碰撞体（懒查找并缓存；动态添加碰撞体后可用 recaptureCollider 重查） */
  get collider(): ColliderComponent | null {
    if (!this._collider || !this._collider.body) {
      this._collider =
        (this.owner.getAllComponents().find((c) => c instanceof ColliderComponent) as ColliderComponent | undefined) ??
        null
    }
    return this._collider
  }

  /** 是否在地面（碰撞事件驱动；离地经 Exit 事件清除） */
  get isGrounded(): boolean {
    return this._grounded
  }

  /** 是否处于翻滚窗口 */
  get isDodging(): boolean {
    return this._dodgeTimer > 0
  }

  /** 当前水平速度大小（诊断/AI） */
  get horizontalSpeed(): number {
    const body = this.collider?.body
    return body ? Math.hypot(body.velocity.x, body.velocity.z) : 0
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const col = this.collider
    if (!col) {
      logger.warn(`[CharacterController] ${this.owner.name} 未挂碰撞体，控制器不生效`)
      return
    }
    if (col.bodyType !== 'dynamic') {
      logger.warn(`[CharacterController] ${this.owner.name} 碰撞体非 dynamic，控制器不生效`)
      return
    }
    if (col.lockY) {
      logger.warn(`[CharacterController] ${this.owner.name} 碰撞体 lockY=true，重力移动无效（建议 lockY=false）`)
    }
    const body = col.body
    if (body) {
      body.allowSleep = false // 角色随时要响应输入/重力，禁休眠
      body.linearDamping = 0 // 水平速度全权由本组件控制，阻尼会拖累跳跃
    }
    // 地面检测：接触对方中心明显低于自身 → 地面
    col.onCollisionEnter = (e) => this._probeGround(e)
    col.onCollisionStay = (e) => this._probeGround(e)
    col.onCollisionExit = (e) => {
      if (this._isGroundLike(e.other)) this._grounded = false
    }
  }

  /** 碰撞事件 → 地面判定（对方中心低于自身 0.05 即视为可站立） */
  private _probeGround(e: { other: ColliderComponent }): void {
    const body = this.collider?.body
    const other = e.other.body
    if (!body || !other) return
    if (e.other.isTrigger) return // 触发体不算地面
    if (other.position.y < body.position.y - 0.05) {
      this._grounded = true
    }
  }

  private _isGroundLike(other: ColliderComponent): boolean {
    const body = this.collider?.body
    const ob = other.body
    if (!body || !ob) return false
    return ob.position.y < body.position.y - 0.05
  }

  // ─── 输入 API（Pawn / PlayerController 调用）───

  /**
   * 设置移动输入（x=右, z=前；世界系或相机系由 cameraRelative 决定）。
   * 与按键 pressed/released 配对使用：pressed 置 1、released 置 0。
   */
  setMoveInput(x: number, z: number): void {
    this._moveInput.set(x, z)
  }

  /** 立即停止移动输入（暂停/失焦用） */
  clearMoveInput(): void {
    this._moveInput.set(0, 0)
  }

  /** 起跳（仅地面生效） */
  jump(): boolean {
    if (!this._grounded || this.isDodging) return false
    const body = this.collider?.body
    if (!body) return false
    body.wakeUp()
    body.velocity.y = this.jumpSpeed
    this._grounded = false
    return true
  }

  /**
   * 翻滚冲刺：dirX/dirZ 缺省时取当前输入方向或面朝方向。
   * 返回是否成功启动（冷却中/已在翻滚时 false）。
   */
  dodge(dirX?: number, dirZ?: number): boolean {
    if (this.isDodging || this._dodgeCdTimer > 0) return false
    const body = this.collider?.body
    if (!body) return false
    let dx = dirX ?? this._moveInput.x
    let dz = dirZ ?? this._moveInput.y
    if (dx === 0 && dz === 0) {
      // 无输入方向：沿自身面朝方向
      const yaw = this.owner.root.rotation.y
      dx = Math.sin(yaw)
      dz = Math.cos(yaw)
    }
    const len = Math.hypot(dx, dz)
    if (len < 1e-4) return false
    this._dodgeDir.set(dx / len, 0, dz / len)
    this._dodgeTimer = this.dodgeDuration
    this._dodgeCdTimer = this.dodgeCooldown
    return true
  }

  /** 受击冲击（叠加速度；数量级参考 mass≈1 时 6≈一次明显击退） */
  knockback(ix: number, iy: number, iz: number): void {
    const body = this.collider?.body
    if (!body) return
    body.wakeUp()
    body.velocity.x += ix
    body.velocity.y += iy
    body.velocity.z += iz
  }

  // ─── 每帧驱动 ───

  override Tick(dt: number): void {
    const body = this.collider?.body
    if (!body || dt <= 0) return

    // 计时器推进
    if (this._dodgeTimer > 0) this._dodgeTimer = Math.max(0, this._dodgeTimer - dt)
    if (this._dodgeCdTimer > 0) this._dodgeCdTimer = Math.max(0, this._dodgeCdTimer - dt)

    // 期望水平速度
    let desiredX = 0
    let desiredZ = 0
    if (this.isDodging) {
      // 翻滚：固定方向匀速（忽略输入）
      desiredX = this._dodgeDir.x * this.dodgeSpeed
      desiredZ = this._dodgeDir.z * this.dodgeSpeed
    } else {
      let ix = this._moveInput.x
      let iz = this._moveInput.y
      if (this.cameraRelative) {
        // 相机水平朝向 → forward/right 基向量
        const cam = this._activeCamera()
        if (cam) {
          const fwd = new THREE.Vector3()
          cam.getWorldDirection(fwd)
          fwd.y = 0
          if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
          fwd.normalize()
          const right = new THREE.Vector3(fwd.z, 0, -fwd.x) // forward × up 的水平右向
          desiredX = right.x * ix + fwd.x * iz
          desiredZ = right.z * ix + fwd.z * iz
        } else {
          desiredX = ix
          desiredZ = iz
        }
      } else {
        desiredX = ix
        desiredZ = iz
      }
      const inputLen = Math.hypot(desiredX, desiredZ)
      if (inputLen > 1) {
        desiredX /= inputLen
        desiredZ /= inputLen
      }
      desiredX *= this.speed
      desiredZ *= this.speed
    }

    // 水平速度按加速度趋近期望（y 保留重力域，不碰）
    body.wakeUp()
    const curX = body.velocity.x
    const curZ = body.velocity.z
    const maxDelta = this.acceleration * dt
    const dx = desiredX - curX
    const dz = desiredZ - curZ
    const dl = Math.hypot(dx, dz)
    if (dl <= maxDelta || dl < 1e-6) {
      body.velocity.x = desiredX
      body.velocity.z = desiredZ
    } else {
      body.velocity.x = curX + (dx / dl) * maxDelta
      body.velocity.z = curZ + (dz / dl) * maxDelta
    }

    // 朝向：面朝水平速度方向（body fixedRotation，视觉旋转写在 root 上）
    const hSpeed = Math.hypot(body.velocity.x, body.velocity.z)
    if (this.turnSpeed > 0 && hSpeed > 0.3) {
      const targetYaw = Math.atan2(body.velocity.x, body.velocity.z)
      const cur = this.owner.root.rotation.y
      this.owner.root.rotation.y = cur + angleDelta(cur, targetYaw) * Math.min(1, this.turnSpeed * dt)
    }
  }

  /** 当前活跃相机（相机相对移动用；无 GameMode/相机时回退世界系） */
  private _activeCamera(): THREE.Camera | null {
    const gm = this.owner.world?.gameMode
    return gm?.cameraManager.GetActiveCamera()?.camera ?? null
  }

  override getProperties(): Record<string, unknown> {
    return {
      speed: this.speed,
      grounded: this._grounded,
      dodging: this.isDodging,
      horizontalSpeed: Math.round(this.horizontalSpeed * 100) / 100,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      { key: 'speed', type: 'number', min: 0, step: 0.5, get: () => this.speed, set: (v) => { this.speed = v as number } },
      { key: 'acceleration', type: 'number', min: 1, step: 5, get: () => this.acceleration, set: (v) => { this.acceleration = v as number } },
      { key: 'jumpSpeed', type: 'number', min: 0, step: 0.5, get: () => this.jumpSpeed, set: (v) => { this.jumpSpeed = v as number } },
      { key: 'dodgeSpeed', type: 'number', min: 0, step: 0.5, get: () => this.dodgeSpeed, set: (v) => { this.dodgeSpeed = v as number } },
      { key: 'dodgeDuration', type: 'number', min: 0.05, step: 0.05, get: () => this.dodgeDuration, set: (v) => { this.dodgeDuration = v as number } },
      { key: 'dodgeCooldown', type: 'number', min: 0, step: 0.1, get: () => this.dodgeCooldown, set: (v) => { this.dodgeCooldown = v as number } },
      { key: 'turnSpeed', type: 'number', min: 0, step: 1, get: () => this.turnSpeed, set: (v) => { this.turnSpeed = v as number } },
      { key: 'cameraRelative', type: 'boolean', get: () => this.cameraRelative, set: (v) => { this.cameraRelative = !!v } },
    ]
  }
}
