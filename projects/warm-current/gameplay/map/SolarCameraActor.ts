/**
 * SolarCameraActor — 太阳系战略地图云台相机（群星式：滚轮跨数量级缩放 + 聚焦环绕/自由平移双语义）
 *
 * 与 hoi4 的 Hoi4CameraActor 同款结构：CameraActor 载体 + CameraRigComponent 云台。
 * 差异：缩放步长随距离自适应（step = 距离 × 8%），拉远看全星图、拉近看单颗星球
 * 都保持接近恒定的屏幕手感（固定步长在远距离会显得"滚不动"、近距离又太跳）。
 * 聚焦滑移口径（2026-09-15 五版）：聚焦 = 原地转头看向（注视点 lerp，相机位置不动），
 * 镜头位置/远近完全归玩家滚轮与拖拽。
 * 交互语义由 GameMode.applyFocusCameraMode 随视图切换（2026-09-15 聚焦环绕改版）：
 * 行星系聚焦 = 右键拖拽绕聚焦天体环绕（orbitMode，边缘平移关）；太阳系全景 = 自由平移。
 * 生命周期对齐 hoi4：GameMode 构造时创建（不托管），BeginPlay 由 World spawn。
 * 缩放边界：默认太阳系全景 60~12000；GameMode.applyViewMode 按视图模式切换
 * （地球系视图锁死地月尺度，滚轮只见地月——边界数值在 GameMode，本类只管机位数学）。
 */
import * as THREE from 'three'
import { CameraActor, CameraRigComponent, logger } from '@/engine'

/** 瞄准滑移每帧追踪系数（0~1，指数趋近；0.6 秒内残差收敛到 1/10000 → ≈0.226/帧@60fps） */
const AIM_LERP = 1 - Math.pow(0.0001, 1 / (0.6 * 60))
/** 瞄准滑移收敛阈值（世界单位）：target 距锚点小于此值视为到位 */
const AIM_EPSILON = 1

export class SolarCameraActor extends CameraActor {
  readonly rig: CameraRigComponent

  /** 瞄准滑移锚点（返回每帧实时锚点：行星舞台 / 卫星公转实时位）；null = 无滑移 */
  private aimAnchor: (() => THREE.Vector3) | null = null

  /** 距离收拢目标（七版群星式：滑移中相机沿视线收拢到此距离）；null = 只转头不飞 */
  private aimDist: number | null = null

  /** 上一帧滑移写回的相机位置（距离收拢打断基准：zoom/orbit 只动 pos、pan 只动 target——
   *  pos 被外部改动 = 玩家接管距离/姿态 → 距离收拢彻底取消，转头继续） */
  private _aimLastPos: THREE.Vector3 | null = null

  constructor(canvasW: number, canvasH: number) {
    super('SolarCamera', 'perspective')
    // 远裁剪面拉满（等效关掉视野距离裁剪）：全景拉远+平移到边缘时，远端天体不再被 far 面切掉
    this.cameraComponent.SetView(50, 2, 500000)
    this.cameraComponent.priority = 10
    // 每帧驱动：自适应缩放步长（Tick 里按当前距离刷新 rig.step）+ 瞄准滑移推进
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
   *  行星系默认取景与退出观察复位共用本机位（垂直俯视 focusOn 已于 2026-09-14 移除）。
   *  即时取景语义：调用后立即就位，并清除进行中的瞄准滑移（系统级取景优先）。 */
  observeFocus(wx: number, wz: number, d: number, pitch = THREE.MathUtils.degToRad(35), targetY = 0): void {
    this.aimAnchor = null
    this.aimDist = null
    this._aimLastPos = null
    this.rig.target.set(wx, targetY, wz)
    const dd = THREE.MathUtils.clamp(d, this.rig.minDistance, this.rig.maxDistance)
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(wx, targetY + Math.sin(pitch) * dd, wz + Math.cos(pitch) * dd)
    this.camera.lookAt(this.rig.target)
    this.SyncToActor()
    logger.info(`[SolarCamera] 行星观察 target(${wx.toFixed(0)}, ${targetY.toFixed(0)}, ${wz.toFixed(0)}) dist=${dd.toFixed(0)} pitch=${THREE.MathUtils.radToDeg(pitch).toFixed(0)}°`)
  }

  /** 聚焦看向目标（2026-09-15 七版，群星式滚动吸附）：
   *  记录锚点闭包后逐帧把注视点 target lerp 滑向锚点；传 wantDist 时相机沿视线方向
   *  同步收拢距离到 wantDist（边转头边飞近，视线方向保持不变）——玩家滚轮 zoom 会
   *  打断距离收拢（转头继续）；不传保持五版原地转头（相机位置全程不动）。
   *  @param anchor 实时锚点闭包：行星取舞台钉扎点，卫星取公转实时位（滑移自动跟踪漂移）
   *  @param wantDist 滑移目标距离（undefined = 只转头不飞） */
  aimAt(anchor: () => THREE.Vector3, wantDist?: number): void {
    this.aimAnchor = anchor
    // 记录滑移基准：下次 Tick 若 target 偏离基准（帧间玩家 pan）→ 接管让位
    this._aimLastTarget = this.rig.target.clone()
    if (wantDist !== undefined) {
      this.aimDist = Math.max(1, wantDist)
      // 距离收拢基准 = 当前相机位置：zoom/orbit 只动 pos、pan 只动 target，
      // 帧间 pos 偏离基准 = 玩家接管距离 → 收拢取消（转头继续）
      this._aimLastPos = this.camera.position.clone()
    } else {
      this.aimDist = null
      this._aimLastPos = null
    }
    logger.info(`[SolarCamera] 聚焦看向：滑移开始 → 锚点(${anchor().x.toFixed(0)}, ${anchor().y.toFixed(0)}, ${anchor().z.toFixed(0)})${wantDist !== undefined ? ` 距离→${Math.round(wantDist)}` : ''}`)
  }

  /** 是否有进行中的瞄准滑移（GameMode 跟随分派 / 测试断言用） */
  isAiming(): boolean {
    return this.aimAnchor !== null
  }

  /** 外部直改注视点后同步镜头朝向（原地转头）：只 lookAt + 写回，不动相机位置。
   *  卫星观察收敛后的逐帧跟随走此入口（GameMode 写 target.x/z → 本方法摆正朝向）。 */
  SyncCameraLook(): void {
    const cam = this.camera
    cam.up.set(0, 1, 0)
    cam.lookAt(this.rig.target)
    this.cameraComponent.SyncToActor()
  }

  override Tick(dt: number): void {
    // 缩放步长随距离自适应：远看大步进（1 滚 ≈ 8% 距离），近看细步进（下限 6）
    this.rig.step = Math.max(6, this.camera.position.distanceTo(this.rig.target) * 0.08)
    // 瞄准滑移推进（2026-09-15 五版）：只把注视点 target lerp 向锚点，相机位置不动
    // （原地转头，lookAt 随注视点摆动）。玩家右键平移/环绕直接改 target 或机位 →
    // 目标点偏离滑移预期 → 视为接管，滑移让位（不被拉回）；
    // 滚轮缩放沿视线动相机、不改 target，与滑移天然共存。
    if (this.aimAnchor) {
      const goal = this.aimAnchor()
      const expected = this._aimLastTarget
      const dragged = expected !== null && this.rig.target.distanceToSquared(expected) > 1e-4
      if (dragged) {
        this.aimAnchor = null
        this.aimDist = null
        this._aimLastPos = null
        logger.info('[SolarCamera] 聚焦看向：玩家接管，滑移让位')
      } else {
        const cam = this.camera
        const alpha = Math.min(1, AIM_LERP * (dt / (1 / 60)))
        // 距离收拢打断检测（前置）：基准 = 上帧滑移写回的相机位置。
        // zoom/orbit 只动 pos、pan 只动 target（target 有独立接管检测），
        // pos 被外部改动 = 玩家接管距离/姿态 → 收拢彻底取消（转头继续）。
        if (this.aimDist !== null && this._aimLastPos !== null
          && cam.position.distanceToSquared(this._aimLastPos) > 1e-4) {
          this.aimDist = null
          this._aimLastPos = null
          logger.info('[SolarCamera] 聚焦看向：玩家缩放/环绕接管，距离收拢取消')
        }
        // 帧首视线几何：收拢沿"本帧开始时的视线方向"平移——注视点与相机各自 lerp 后
        // (pos-target) 方向每帧恒等，视线方向数学上精确不变（群星式直线飞近）
        const dirFrame = cam.position.clone().sub(this.rig.target).normalize()
        const dFrame = cam.position.distanceTo(this.rig.target)
        // 注视点滑移
        this.rig.target.lerp(goal, alpha)
        // 距离收拢（七版群星式）：距离 lerp 向 wantDist，沿帧首视线方向走
        let distDone = true
        if (this.aimDist !== null) {
          const dNext = THREE.MathUtils.lerp(dFrame, this.aimDist, alpha)
          cam.position.copy(this.rig.target).addScaledVector(dirFrame, dNext)
          distDone = Math.abs(dNext - this.aimDist) < 0.5
        }
        // 双条件收敛：注视点与距离都到位才结束（距离初始差距通常远大于注视点，
        // 单看注视点会提前结束导致距离停在半路）
        if (this.rig.target.distanceTo(goal) < AIM_EPSILON && distDone) {
          this.rig.target.copy(goal)
          if (this.aimDist !== null) cam.position.copy(this.rig.target).addScaledVector(dirFrame, this.aimDist)
          this.aimAnchor = null
          this.aimDist = null
          logger.info('[SolarCamera] 聚焦看向：滑移收敛就位')
        }
        cam.up.set(0, 1, 0)
        cam.lookAt(this.rig.target)
        this.cameraComponent.SyncToActor()
        this._aimLastTarget = this.rig.target.clone()
        if (this.aimDist !== null) this._aimLastPos = cam.position.clone()
      }
    }
    super.Tick(dt)
  }

  /** 上一帧滑移写入的 target（接管检测基准：外部改动 target = 玩家接管） */
  private _aimLastTarget: THREE.Vector3 | null = null
}
