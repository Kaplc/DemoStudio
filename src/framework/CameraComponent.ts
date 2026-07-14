import * as THREE from 'three'
import { Component } from './Component'
import type { Actor } from './Actor'

export class CameraComponent extends Component {
  public readonly camera: THREE.PerspectiveCamera
  public priority = 0

  /** 视场角（度） */
  public fov = 60
  public near = 0.1
  public far = 200

  constructor(owner: Actor, name = 'CameraComponent') {
    super(owner)
    this.name = name
    this.camera = new THREE.PerspectiveCamera(this.fov, 16 / 9, this.near, this.far)
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

  /** 设置摄像机视角参数 */
  SetView(fov: number, near: number, far: number) {
    this.fov = fov
    this.near = near
    this.far = far
    this.camera.fov = fov
    this.camera.near = near
    this.camera.far = far
    this.camera.updateProjectionMatrix()
  }

  /** 更新投影矩阵（视口宽高变化时调用） */
  SetAspect(aspect: number) {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  override EndPlay() {
    super.EndPlay()
  }
}
