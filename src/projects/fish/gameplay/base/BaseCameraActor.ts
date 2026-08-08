/**
 * BaseCameraActor — 部落冲突基地专用摄像机（继承 CameraActor）
 *
 * 摄像机基类的项目级子类：透视俯瞰基地 + 滚轮绕基地中心缩放。
 * 游戏实例每 new 一次本类即创建全新的摄像机（由 GameInstance 持有并暴露给渲染器）。
 *
 * 使用：
 *   // FishBaseGameMode 构造中
 *   this.baseCamera = new BaseCameraActor()
 *   // FishGameInstance.setupBasePhase
 *   this.setupCamera(mode.baseCamera.cameraComponent, 12, 16, 18)
 *   mode.cameraManager.RegisterCamera(mode.baseCamera.cameraComponent)
 *   // 滚轮：FishBasePlayerController.OnScroll → gameMode.baseCamera.zoom(delta)
 */
import * as THREE from 'three'
import { CameraActor, logger } from '@/engine'

export class BaseCameraActor extends CameraActor {
  /** 注视目标（基地中心 = 部落冲突地图原点），缩放始终绕该点拉近/拉远 */
  readonly target = new THREE.Vector3(0, 0, 0)
  /** 最近距离（世界单位） */
  minDistance = 10
  /** 最远距离（世界单位） */
  maxDistance = 50
  /** 每次滚动的步长（世界单位） */
  step = 3
  /** 平移边界：target 可移动的世界范围（x/z 各 ±panLimit） */
  panLimit = 20

  constructor() {
    // 透视相机：俯瞰基地（FishGameInstance.setupBasePhase 会再设位置 12,16,18）
    super('BaseCamera', 'perspective')
    this.cameraComponent.fov = 35
    this.cameraComponent.near = 0.1
    this.cameraComponent.far = 200
    this.cameraComponent.priority = 10
    this.cameraComponent.SetView(35, 0.1, 200)
  }

  /**
   * 平移：沿水平方向移动注视目标与相机（保持相对方向/距离不变）。
   * target 被限制在 [−panLimit, panLimit] 范围内，避免移出基地。
   * 平移后写回 Actor root，避免每帧 SyncFromActor 把相机位置覆盖回去。
   * @param dx 世界 X 方向位移（单位：世界单位）
   * @param dz 世界 Z 方向位移
   */
  pan(dx: number, dz: number): void {
    const cam = this.camera
    if (!cam || (dx === 0 && dz === 0)) return
    // 相机相对目标的偏移（保持方向与距离不变）
    const offset = cam.position.clone().sub(this.target)
    // 平移注视目标（限制边界）
    this.target.x = THREE.MathUtils.clamp(this.target.x + dx, -this.panLimit, this.panLimit)
    this.target.z = THREE.MathUtils.clamp(this.target.z + dz, -this.panLimit, this.panLimit)
    // 相机跟着目标平移（偏移量不变）
    cam.position.copy(this.target).add(offset)
    cam.lookAt(this.target)
    // 写回 Actor root，否则每帧 SyncFromActor 会把相机位置覆盖回去
    this.SyncToActor()
  }

  /**
   * 滚轮缩放：沿当前视线方向把相机移动到新距离，并重新对准目标保持画面居中。
   * 距离被限制在 [minDistance, maxDistance] 范围内；缩放后写回 Actor root，
   * 避免每帧 SyncFromActor 把相机位置覆盖回去。
   * delta 约定（与 PlayerController.OnScroll 一致）：delta > 0（向下滚）→ 拉远；< 0 → 拉近。
   */
  zoom(delta: number): void {
    const cam = this.camera
    if (!cam) {
      logger.warn('[BaseCamera] zoom: camera 为空')
      return
    }
    // 相机当前位置相对注视目标的方向与距离
    const dir = cam.position.clone().sub(this.target)
    const distance = dir.length()
    logger.info(
      `[BaseCamera] zoom: delta=${delta}, camPos=(${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)}), target=(${this.target.x}, ${this.target.y}, ${this.target.z}), distance=${distance.toFixed(2)}`,
    )
    if (distance < 1e-3) {
      logger.warn('[BaseCamera] zoom: 相机与目标重合，无法缩放')
      return
    }
    dir.normalize()
    const sign = delta > 0 ? 1 : -1
    const next = THREE.MathUtils.clamp(distance + sign * this.step, this.minDistance, this.maxDistance)
    if (Math.abs(next - distance) < 1e-3) {
      logger.warn(`[BaseCamera] zoom: 已到边界距离 ${next.toFixed(2)}，无变化`)
      return
    }
    // 沿同一视线方向移动到新距离，并重新对准目标保持画面居中
    cam.position.copy(this.target).addScaledVector(dir, next)
    cam.lookAt(this.target)
    // 写回 Actor root，否则每帧 SyncFromActor 会把相机位置覆盖回去
    this.SyncToActor()
    logger.info(`[BaseCamera] zoom: 完成 distance ${distance.toFixed(2)} -> ${next.toFixed(2)}`)
  }
}
