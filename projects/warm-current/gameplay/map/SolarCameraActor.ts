/**
 * SolarCameraActor — 太阳系战略地图云台相机（群星式：滚轮跨数量级缩放 + 聚焦环绕/自由平移双语义）
 *
 * 与 hoi4 的 Hoi4CameraActor 同款结构：CameraActor 载体 + CameraRigComponent 云台。
 * 差异：缩放步长随距离自适应（step = 距离 × 8%），拉远看全星图、拉近看单颗星球
 * 都保持接近恒定的屏幕手感（固定步长在远距离会显得"滚不动"、近距离又太跳）。
 * 交互语义由 GameMode.applyFocusCameraMode 随视图切换（2026-09-15 聚焦环绕改版）：
 * 行星系聚焦 = 右键拖拽绕聚焦天体环绕（orbitMode，边缘平移关）；太阳系全景 = 自由平移。
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
    // 星图轨道半径：外行星按 AU×250（海王星轨道 7517px），内系统手动重排防拥挤（见 star_map 配置注释）；
    // 拉远上限 12000 = 全系统入画 + 余量；
    // 拉近下限：GameMode.applyViewMode 按聚焦天体半径动态贴合（×1.15 贴地缩放），此处 60 仅装配期兜底
    this.rig.minDistance = 60
    this.rig.maxDistance = 12000
    // 平移上限 9000：可拖到海王星（轨道 7525）外缘
    this.rig.panLimit = 9000
    this.rig.edgePanSpeed = 60
  }

  /** 斜视角就位（up = 世界 +Y；开局由 focusSolarSystem('earth') 立即重取景到地月系）。
   *  2026-09-14 视角锁定地球系：垂直俯视机位（focusOn）已退役，全游戏恒斜视角。 */
  place(): void {
    this.observeFocus(0, 0, 3400)
    logger.info('[SolarCamera] 就位：斜视角 target(0,0,0) dist=3400 pitch=35°')
  }

  /** 斜视角取景（默认仰角 35°）对准 (wx, wz)，距离 d 夹紧到缩放范围。
   *  targetY = 注视高度（默认 0 = 地面；全息勘探取行星球心，环绕旋转绕球心走）。
   *  行星系默认取景与行星观察共用本机位（右键拖拽 orbitMode = true 时绕行星环绕）；
   *  GameMode 退出观察/复位取景也走本方法（垂直俯视 focusOn 已于 2026-09-14 移除）。 */
  observeFocus(wx: number, wz: number, d: number, pitch = THREE.MathUtils.degToRad(35), targetY = 0): void {
    this.rig.target.set(wx, targetY, wz)
    const dd = THREE.MathUtils.clamp(d, this.rig.minDistance, this.rig.maxDistance)
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(wx, targetY + Math.sin(pitch) * dd, wz + Math.cos(pitch) * dd)
    this.camera.lookAt(this.rig.target)
    this.SyncToActor()
    logger.info(`[SolarCamera] 行星观察 target(${wx.toFixed(0)}, ${targetY.toFixed(0)}, ${wz.toFixed(0)}) dist=${dd.toFixed(0)} pitch=${THREE.MathUtils.radToDeg(pitch).toFixed(0)}°`)
  }


  override Tick(dt: number): void {
    // 缩放步长随距离自适应：远看大步进（1 滚 ≈ 8% 距离），近看细步进（下限 6）
    this.rig.step = Math.max(6, this.camera.position.distanceTo(this.rig.target) * 0.08)
    super.Tick(dt)
  }
}
