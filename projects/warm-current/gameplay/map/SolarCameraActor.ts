/**
 * SolarCameraActor — 太阳系战略地图云台相机（群星式：滚轮跨数量级缩放 + 右键/边缘平移）
 *
 * 与 hoi4 的 Hoi4CameraActor 同款结构：CameraActor 载体 + CameraRigComponent 云台。
 * 差异：缩放步长随距离自适应（step = 距离 × 8%），拉远看全星图、拉近看单颗星球
 * 都保持接近恒定的屏幕手感（固定步长在远距离会显得"滚不动"、近距离又太跳）。
 * 生命周期对齐 hoi4：GameMode 构造时创建（不托管），BeginPlay 由 World spawn。
 * 缩放边界：默认太阳系全景 60~12000；GameMode.applyViewMode 按视图模式切换
 * （地球系视图锁死地月尺度，滚轮只见地月——边界数值在 GameMode，本类只管机位数学）。
 */
import * as THREE from 'three'
import { CameraActor, CameraRigComponent, logger } from '@/engine'

export class SolarCameraActor extends CameraActor {
  readonly rig: CameraRigComponent

  constructor(canvasW: number, canvasH: number) {
    super('SolarCamera', 'perspective')
    // 远裁剪面拉满（等效关掉视野距离裁剪）：全景拉远+平移到边缘时，远端天体不再被 far 面切掉
    this.cameraComponent.SetView(50, 2, 500000)
    this.cameraComponent.priority = 10
    // 每帧驱动：自适应缩放步长（Tick 里按当前距离刷新 rig.step）
    this.enableTick()

    this.rig = new CameraRigComponent(this, 'SolarRig')
    this.rig.target = new THREE.Vector3(0, 0, 0)
    // 真实比例星图：海王星轨道 7525px（AU×250），拉远上限 12000 = 全系统入画 + 余量；
    // 拉近下限 60：贴近单颗星球（r 11~96）仍留画面余量
    this.rig.minDistance = 60
    this.rig.maxDistance = 12000
    // 平移上限 9000：可拖到海王星（轨道 7525）外缘
    this.rig.panLimit = 9000
    this.rig.edgePanSpeed = 60
  }

  /** 取景聚焦：目标点移到 (wx, wz)，距离 d 夹紧到缩放范围（机位数学归相机 Actor） */
  focusOn(wx: number, wz: number, d: number): void {
    this.rig.target.set(wx, 0, wz)
    const dd = THREE.MathUtils.clamp(d, this.rig.minDistance, this.rig.maxDistance)
    this.camera.up.set(0, 0, -1) // 保持"北"朝屏幕上方
    this.camera.position.set(wx, dd, wz)
    this.camera.lookAt(this.rig.target)
    this.SyncToActor()
    logger.info(`[SolarCamera] 聚焦 target(${wx.toFixed(0)}, ${wz.toFixed(0)}) dist=${dd.toFixed(0)}`)
  }

  /** 垂直俯视就位（up = 世界 -Z，画布"北"朝屏幕上方；开局对准太阳） */
  place(): void {
    this.rig.target.set(0, 0, 0)
    const d = 3400 // 开局见内太阳系全景（火星轨道 381 舒适入画，木星轨道 1301 可见外圈）
    this.camera.up.set(0, 0, -1)
    this.camera.position.set(0, d, 0)
    this.camera.lookAt(this.rig.target)
    this.SyncToActor()
    logger.info('[SolarCamera] 就位：垂直俯视 target(0,0,0) dist=3400')
  }

  override Tick(dt: number): void {
    // 缩放步长随距离自适应：远看大步进（1 滚 ≈ 8% 距离），近看细步进（下限 6）
    this.rig.step = Math.max(6, this.camera.position.distanceTo(this.rig.target) * 0.08)
    super.Tick(dt)
  }
}
