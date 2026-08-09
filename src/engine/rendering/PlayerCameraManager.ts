/**
 * PlayerCameraManager — 管理游戏摄像机
 * 模仿 UE PlayerCameraManager，控制哪个摄像机是活跃的
 * Game 视口从此处读取摄像机进行渲染
 *
 * 继承 BObject：纳入引擎对象体系（构造自动注册到 ObjectRegistry，
 * 由 GameMode.EndPlay 驱动 EndPlay 终态化 —— 泄漏诊断可见）。
 */
import * as THREE from 'three'
import { CameraComponent } from './CameraComponent'
import { BObject } from '../entity/BObject'
import { logger } from '../Logger'

export class PlayerCameraManager extends BObject {
  /** 所有注册的摄像机 */
  private cameras: CameraComponent[] = []
  /** 当前活跃摄像机 */
  private activeCamera: CameraComponent | null = null

  /** 默认摄像机蓝图（由子类重写） */
  protected defaultFov = 60
  protected defaultDistance = 10

  constructor() {
    super('PlayerCameraManager')
  }

  /** 注册一个摄像机 */
  RegisterCamera(cam: CameraComponent) {
    this.cameras.push(cam)
    // 反向引用：组件 EndPlay 时自动从管理器注销
    cam.cameraManager = this
    // 按优先级自动选最高
    if (!this.activeCamera || cam.priority >= this.activeCamera.priority) {
      this.SetActiveCamera(cam)
    }
  }

  /** 注销摄像机 */
  UnregisterCamera(cam: CameraComponent) {
    this.cameras = this.cameras.filter((c) => c !== cam)
    if (cam.cameraManager === this) cam.cameraManager = null
    if (this.activeCamera === cam) {
      this.activeCamera = this.cameras.length > 0 ? this.cameras[0] : null
    }
  }

  /** 设置活跃摄像机 */
  SetActiveCamera(cam: CameraComponent) {
    this.activeCamera = cam
  }

  /** 获取当前活跃摄像机 */
  GetActiveCamera(): CameraComponent | null {
    return this.activeCamera
  }

  /** 获取当前活跃摄像机的 THREE.Camera 对象（渲染器委托直接使用；无活跃相机返回 null） */
  GetActiveCameraObject(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    return this.activeCamera?.camera ?? null
  }

  /** 同步摄像机 Transform（每帧调用） */
  UpdateCamera() {
    if (this.activeCamera && this.activeCamera.bEnabled) {
      this.activeCamera.SyncFromActor()
    } else {
      logger.debug('[CameraMgr] UpdateCamera: 无活跃相机')
    }
  }

  /** 将外部渲染器的摄像机与游戏摄像机同步 */
  ApplyToRenderer(gameCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    if (!this.activeCamera || !this.activeCamera.bEnabled) {
      return
    }
    const cam = this.activeCamera.camera
    gameCamera.position.copy(cam.position)
    gameCamera.quaternion.copy(cam.quaternion)

    if (gameCamera instanceof THREE.PerspectiveCamera && cam instanceof THREE.PerspectiveCamera) {
      // 透视:同步 fov/near/far/aspect
      gameCamera.fov = cam.fov
      gameCamera.near = cam.near
      gameCamera.far = cam.far
      if (aspect > 0) gameCamera.aspect = aspect
    } else if (gameCamera instanceof THREE.OrthographicCamera && cam instanceof THREE.OrthographicCamera) {
      // 正交:按源相机 orthoSize + aspect 重算 frustum(orthoSize 为半高)
      const halfH = this.activeCamera.orthoSize
      const halfW = halfH * (aspect > 0 ? aspect : 1)
      gameCamera.left = -halfW
      gameCamera.right = halfW
      gameCamera.top = halfH
      gameCamera.bottom = -halfH
      gameCamera.near = cam.near
      gameCamera.far = cam.far
      gameCamera.zoom = cam.zoom
    }
    gameCamera.updateProjectionMatrix()
  }

  /** 没有活跃摄像机时使用一个默认位置 */
  GetDefaultView(): { position: THREE.Vector3; target: THREE.Vector3 } {
    return {
      position: new THREE.Vector3(12, 16, 12),
      target: new THREE.Vector3(0, 0, 0),
    }
  }

  /** 清空所有摄像机 */
  Clear() {
    this.cameras = []
    this.activeCamera = null
  }
}
