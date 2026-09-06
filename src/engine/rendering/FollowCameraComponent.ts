/**
 * FollowCameraComponent — 第三人称跟随相机（A4）
 *
 * 挂在相机 Actor（含 CameraComponent）上，每帧把 owner.root（相机权威位姿）
 * 阻尼跟随 target Actor：位置 = target + offset，朝向 lookAt target + lookAtHeight。
 * PlayerCameraManager.UpdateCamera（GameMode.Tick 内）随后把 root 同步进相机。
 *
 * 附加能力：
 *  - shake(intensity, duration)：受击屏震（随时间衰减的随机偏移，叠加在阻尼位上）
 *  - snapToTarget()：设置目标后瞬移到位（开局对齐，避免从原点飞过去）
 *
 * 与 CameraRigComponent（RTS 云台）互补：本组件面向第三人称跟随，不做输入绑定。
 */
import * as THREE from 'three'
import { ActorComponent } from '../entity/ActorComponent'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'

export class FollowCameraComponent extends ActorComponent {
  /** 跟随目标（通常为玩家 Pawn） */
  target: Actor | null = null
  /** 相机相对目标的偏移（世界系；[0, h, d] = 目标后上方） */
  offset: [number, number, number] = [0, 7, 9]
  /** 位置阻尼系数（指数趋近，越大越跟手） */
  followSpeed = 6
  /** 注视点相对目标的高度抬升 */
  lookAtHeight = 1.2
  /** 注视点阻尼系数（0 = 立即跟随） */
  lookAtSpeed = 8

  // ─── 屏震状态 ───
  private _shakeDuration = 0
  private _shakeTime = 0
  private _shakeIntensity = 0

  /** 阻尼基准位（不含震动偏移） */
  private _basePos = new THREE.Vector3()
  /** 注视点平滑位 */
  private _lookPos = new THREE.Vector3()
  private _hasBase = false

  private _tmpDesired = new THREE.Vector3()
  private _tmpTarget = new THREE.Vector3()
  private _tmpLook = new THREE.Vector3()

  constructor(owner: Actor) {
    super(owner)
    this.name = 'FollowCameraComponent'
  }

  /** 设置跟随目标（可选立即对齐） */
  setTarget(actor: Actor | null, snap = false): void {
    this.target = actor
    if (snap) this.snapToTarget()
  }

  /** 瞬移到目标期望位（去掉首帧阻尼飞行） */
  snapToTarget(): void {
    if (!this.target) return
    this._tmpTarget.setFromMatrixPosition(this.target.root.matrixWorld)
    this._basePos.set(
      this._tmpTarget.x + this.offset[0],
      this._tmpTarget.y + this.offset[1],
      this._tmpTarget.z + this.offset[2],
    )
    this._lookPos.copy(this._tmpTarget)
    this._hasBase = true
    this._applyToRoot(0)
  }

  /** 受击屏震：intensity 为最大偏移（米），duration 秒内线性衰减 */
  shake(intensity: number, duration: number): void {
    if (intensity <= 0 || duration <= 0) return
    // 取更强的一次（不打断进行中的更强震动）
    if (intensity >= this._shakeIntensity || this._shakeTime <= 0) {
      this._shakeIntensity = intensity
      this._shakeDuration = duration
      this._shakeTime = duration
    }
  }

  override Tick(dt: number): void {
    if (!this.target || dt <= 0) return
    this._tmpTarget.setFromMatrixPosition(this.target.root.matrixWorld)

    // 位置指数阻尼：base += (desired - base) * (1 - e^(-k·dt)) ≈ min(1, k·dt)
    this._tmpDesired.set(
      this._tmpTarget.x + this.offset[0],
      this._tmpTarget.y + this.offset[1],
      this._tmpTarget.z + this.offset[2],
    )
    if (!this._hasBase) {
      this._basePos.copy(this._tmpDesired)
      this._lookPos.copy(this._tmpTarget)
      this._hasBase = true
    }
    const pLerp = Math.min(1, this.followSpeed * dt)
    this._basePos.lerp(this._tmpDesired, pLerp)
    // 注视点阻尼（0 = 立即）
    const lLerp = this.lookAtSpeed > 0 ? Math.min(1, this.lookAtSpeed * dt) : 1
    this._lookPos.lerp(this._tmpTarget, lLerp)

    this._applyToRoot(dt)
  }

  /** 阻尼位 + 震动偏移 → owner.root（位置 + lookAt 朝向） */
  private _applyToRoot(dt: number): void {
    const shakeOff = this._computeShakeOffset(dt)
    this.owner.root.position.set(
      this._basePos.x + shakeOff.x,
      this._basePos.y + shakeOff.y,
      this._basePos.z + shakeOff.z,
    )
    this._tmpLook.set(
      this._lookPos.x + shakeOff.x * 0.5,
      this._lookPos.y + this.lookAtHeight + shakeOff.y * 0.5,
      this._lookPos.z + shakeOff.z * 0.5,
    )
    this.owner.root.lookAt(this._tmpLook)
  }

  /** 当前帧震动偏移（线性衰减 × 伪随机抖动） */
  private _computeShakeOffset(dt: number): THREE.Vector3 {
    const out = new THREE.Vector3()
    if (this._shakeTime <= 0) return out
    this._shakeTime = Math.max(0, this._shakeTime - dt)
    const amp = this._shakeIntensity * (this._shakeDuration > 0 ? this._shakeTime / this._shakeDuration : 0)
    if (amp <= 0) return out
    out.set(
      (Math.random() - 0.5) * 2 * amp,
      (Math.random() - 0.5) * 2 * amp,
      (Math.random() - 0.5) * 2 * amp,
    )
    return out
  }

  override getProperties(): Record<string, unknown> {
    return {
      target: this.target?.name ?? '（无）',
      shaking: this._shakeTime > 0,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'offset', type: 'vec3',
        get: () => [this.offset[0], this.offset[1], this.offset[2]] as [number, number, number],
        set: (v) => { const a = v as [number, number, number]; this.offset = [a[0], a[1], a[2]] },
      },
      { key: 'followSpeed', type: 'number', min: 0.5, step: 0.5, get: () => this.followSpeed, set: (v) => { this.followSpeed = v as number } },
      { key: 'lookAtHeight', type: 'number', step: 0.1, get: () => this.lookAtHeight, set: (v) => { this.lookAtHeight = v as number } },
      { key: 'lookAtSpeed', type: 'number', min: 0, step: 1, get: () => this.lookAtSpeed, set: (v) => { this.lookAtSpeed = v as number } },
    ]
  }
}
