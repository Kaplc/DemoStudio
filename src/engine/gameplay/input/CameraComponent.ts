import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'

/** 摄像机投影模式 */
export type CameraMode = 'perspective' | 'orthographic'

/**
 * CameraComponent — Actor 可挂载的摄像机组件
 * 支持两种投影:
 *   'perspective'  — 透视(3D 场景默认)
 *   'orthographic' — 正交(2D 场景,无近大远小)
 *
 * 构造签名保持向后兼容:第二参数仍为 name(snake/eatfish 用 new CameraComponent(this, 'GameCamera')),
 * mode 作为第三参数,默认 'perspective'。2D 项目传 'orthographic'。
 */
export class CameraComponent extends Component {
  public mode: CameraMode
  public readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  public priority = 0

  /** 透视:视场角(度) */
  public fov = 60
  /** 正交:半高(世界单位),宽度 = orthoSize × aspect */
  public orthoSize = 5
  public near = 0.1
  public far = 200

  /** 投影用 aspect(由 SetAspect 维护,正交时用于推算左右边界) */
  private aspect = 16 / 9

  constructor(owner: Actor, name = 'CameraComponent', mode: CameraMode = 'perspective') {
    super(owner)
    this.name = name
    this.mode = mode
    this.camera = this.createCamera()
  }

  /** 按 mode 创建对应相机 */
  private createCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    if (this.mode === 'orthographic') {
      const halfH = this.orthoSize
      const halfW = halfH * this.aspect
      return new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, this.near, this.far)
    }
    return new THREE.PerspectiveCamera(this.fov, this.aspect, this.near, this.far)
  }

  /** 按当前 mode 重算投影矩阵(mode/参数变更后调用) */
  private applyProjection() {
    const cam = this.camera
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.fov = this.fov
      cam.aspect = this.aspect
    } else {
      const halfH = this.orthoSize
      const halfW = halfH * this.aspect
      cam.left = -halfW
      cam.right = halfW
      cam.top = halfH
      cam.bottom = -halfH
    }
    cam.near = this.near
    cam.far = this.far
    cam.updateProjectionMatrix()
  }

  /** 从 Actor 的 root 同步位置/旋转到摄像机 */
  SyncFromActor() {
    this.owner.root.getWorldPosition(this.camera.position)
    this.owner.root.getWorldQuaternion(this.camera.quaternion)
  }

  /** 从摄像机同步回 Actor */
  SyncToActor() {
    this.owner.root.position.copy(this.camera.position)
    this.owner.root.quaternion.copy(this.camera.quaternion)
  }

  /** 设置透视参数 */
  SetView(fov: number, near: number, far: number) {
    this.fov = fov
    this.near = near
    this.far = far
    this.applyProjection()
  }

  /** 设置正交参数(size = 半高世界单位) */
  SetOrtho(size: number, near: number, far: number) {
    this.orthoSize = size
    this.near = near
    this.far = far
    this.applyProjection()
  }

  /** 更新投影矩阵(视口宽高变化时调用) */
  SetAspect(aspect: number) {
    this.aspect = aspect
    this.applyProjection()
  }

  override EndPlay() {
    super.EndPlay()
  }
}
