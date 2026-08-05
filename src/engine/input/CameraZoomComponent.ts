/**
 * CameraZoomComponent — 滚轮驱动的相机缩放组件
 *
 * 挂载到与 CameraComponent 同一 Actor 上，沿视线方向（绕注视目标）拉近/拉远相机，
 * 适用于 RTS / 基地等俯瞰相机的滚轮缩放。
 *
 * 驱动方式：输入仍由 PlayerController.OnScroll 路由，控制器调用 zoom(delta)
 * 即可；本组件只负责缩放逻辑与参数（目标点 / 距离上下限 / 步长）。
 *
 * delta 约定（与 PlayerController.OnScroll 一致）：
 *   delta > 0（向下滚）→ 拉远；delta < 0（向上滚）→ 拉近。
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import { CameraComponent } from './CameraComponent'

export class CameraZoomComponent extends Component {
  /** 注视目标，缩放始终绕该点拉近/拉远（默认世界原点） */
  public target = new THREE.Vector3(0, 0, 0)
  /** 最近距离（世界单位） */
  public minDistance = 10
  /** 最远距离（世界单位） */
  public maxDistance = 50
  /** 每次滚动的步长（世界单位） */
  public step = 3

  /** 同一 Actor 上的 CameraComponent（BeginPlay 时查找） */
  private _camera: CameraComponent | null = null

  constructor(owner: Actor, name = 'CameraZoom') {
    super(owner)
    this.name = name
  }

  override getProperties(): Record<string, unknown> {
    return {
      Target: [this.target.x, this.target.y, this.target.z],
      MinDistance: this.minDistance,
      MaxDistance: this.maxDistance,
      Step: this.step,
    }
  }

  override BeginPlay() {
    super.BeginPlay()
    this._camera = this.owner.getComponent(CameraComponent)
  }

  /**
   * 滚轮缩放：沿当前视线方向把相机移动到新距离，并重新对准目标保持画面居中。
   * 距离被限制在 [minDistance, maxDistance] 范围内。
   */
  zoom(delta: number) {
    const cam = this._camera?.camera
    if (!cam) return
    // 相机当前位置相对注视目标的方向与距离
    const dir = cam.position.clone().sub(this.target)
    const distance = dir.length()
    if (distance < 1e-3) return
    dir.normalize()
    const sign = delta > 0 ? 1 : -1
    const next = THREE.MathUtils.clamp(distance + sign * this.step, this.minDistance, this.maxDistance)
    if (Math.abs(next - distance) < 1e-3) return
    // 沿同一视线方向移动到新距离，并重新对准目标保持画面居中
    cam.position.copy(this.target).addScaledVector(dir, next)
    cam.lookAt(this.target)
    // 写回 Actor root，否则每帧 SyncFromActor 会把相机位置覆盖回去
    this._camera!.SyncToActor()
  }
}
