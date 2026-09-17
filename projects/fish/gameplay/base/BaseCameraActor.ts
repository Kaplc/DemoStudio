/**
 * BaseCameraActor — 部落冲突基地专用摄像机（继承 CameraActor）
 *
 * 摄像机基类的项目级子类：透视俯瞰基地。
 * 交互行为（滚轮缩放 / 平移 / 屏幕边缘平移）全部内聚在挂载的 CameraRigComponent 中，
 * 调用方通过 baseCamera.rig 组件直接访问（组件化调用，Actor 不转发方法）。
 * 游戏实例每 new 一次本类即创建全新的摄像机（由 GameInstance 持有并暴露给渲染器）。
 *
 * 使用：
 *   // FishBaseGameMode 构造中
 *   this.baseCamera = new BaseCameraActor()
 *   // FishGameInstance.setupBasePhase
 *   this.setupCamera(mode.baseCamera.cameraComponent, 12, 16, 18)
 *   mode.cameraManager.RegisterCamera(mode.baseCamera.cameraComponent)
 *   // 滚轮：FishBasePlayerController.OnScroll → gameMode.baseCamera.rig.zoom(delta)
 *   // 边缘平移：rig.Tick 由 World 驱动（baseCamera 已 SpawnActor 托管）
 */
import { CameraActor, CameraRigComponent } from '@/engine'

export class BaseCameraActor extends CameraActor {
  /** 摄像机云台组件（滚轮缩放 + 平移 + 屏幕边缘平移，交互逻辑内聚于此） */
  readonly rig: CameraRigComponent

  constructor() {
    // 透视相机：俯瞰基地（FishGameInstance.setupBasePhase 会再设位置 12,16,18）
    super('BaseCamera', 'perspective')
    this.cameraComponent.fov = 35
    this.cameraComponent.near = 0.1
    this.cameraComponent.far = 200
    this.cameraComponent.priority = 10
    this.cameraComponent.SetView(35, 0.1, 200)
    // 挂载云台组件（缩放/平移/边缘检测逻辑）
    this.rig = new CameraRigComponent(this, 'CameraRig')
    this.addComponent(this.rig)
    // 开启 tick：驱动云台边缘平移检测
    this.enableTick()
  }
}
