/**
 * CameraActor — 摄像机 Actor 基类
 *
 * 把"摄像机"提升为独立 Actor 实体（UE 风格 CameraActor）：
 * 内部持有 CameraComponent 作为核心组件，向外暴露摄像机参数与方法。
 * 项目继承本类实现专用摄像机行为（如基地的滚轮缩放、跟随等），
 * 替代"把 CameraComponent 直接挂到 GameMode 上"的旧用法。
 *
 * 用法：
 *   class BaseCameraActor extends CameraActor {
 *     constructor() { super('BaseCamera', 'perspective') }
 *   }
 *   // GameMode 持有并注册到 CameraManager：
 *   mode.cameraManager.RegisterCamera(actor.cameraComponent)
 *
 * 兼容性：字段名与 CameraComponent 保持一致（fov/near/far/priority/mode），
 * 子类可直接读写；方法 SetView/SetOrtho/SetAspect/SyncFromActor/SyncToActor 转发到组件。
 */
import * as THREE from 'three'
import { Actor } from '../entity/Actor'
import { CameraComponent, type CameraMode } from './CameraComponent'

export class CameraActor extends Actor {
  /** 核心摄像机组件（注册到 CameraManager / PhySys 时传它） */
  readonly cameraComponent: CameraComponent

  constructor(name = 'CameraActor', mode: CameraMode = 'perspective') {
    super(name)
    this.cameraComponent = new CameraComponent(this, `${name}Camera`, mode)
    this.addComponent(this.cameraComponent)
  }

  // ─── 便捷访问（转发到 cameraComponent）───

  /** THREE 相机对象（透视/正交） */
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.cameraComponent.camera
  }

  get mode(): CameraMode { return this.cameraComponent.mode }
  get priority(): number { return this.cameraComponent.priority }
  set priority(v: number) { this.cameraComponent.priority = v }
  get fov(): number { return this.cameraComponent.fov }
  set fov(v: number) { this.cameraComponent.fov = v }
  get orthoSize(): number { return this.cameraComponent.orthoSize }
  set orthoSize(v: number) { this.cameraComponent.orthoSize = v }
  get near(): number { return this.cameraComponent.near }
  set near(v: number) { this.cameraComponent.near = v }
  get far(): number { return this.cameraComponent.far }
  set far(v: number) { this.cameraComponent.far = v }

  /** 从 Actor 的 root 同步位置/旋转到摄像机 */
  SyncFromActor(): void { this.cameraComponent.SyncFromActor() }

  /** 从摄像机同步回 Actor root */
  SyncToActor(): void { this.cameraComponent.SyncToActor() }

  /** 设置透视参数 */
  SetView(fov: number, near: number, far: number): void {
    this.cameraComponent.SetView(fov, near, far)
  }

  /** 设置正交参数（size = 半高世界单位） */
  SetOrtho(size: number, near: number, far: number): void {
    this.cameraComponent.SetOrtho(size, near, far)
  }

  /** 更新投影矩阵（视口宽高变化时调用） */
  SetAspect(aspect: number): void {
    this.cameraComponent.SetAspect(aspect)
  }
}
