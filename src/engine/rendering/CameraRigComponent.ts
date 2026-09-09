/**
 * CameraRigComponent — 摄像机云台组件（滚轮缩放 + 平移 + 屏幕边缘平移 + 右键拖拽平移）
 *
 * 挂载到摄像机 Actor 上（与 CameraComponent 同一 Actor），集中管理俯瞰相机
 * （RTS / 基地类）的交互行为：
 *  - zoom(delta)：沿视线方向绕注视目标拉近/拉远（滚轮）
 *  - pan(dx, dz)：水平平移注视目标与相机（含边界限制）
 *  - 屏幕边缘平移：鼠标贴近视口边缘时持续平移（部落冲突风格边缘滚动）
 *  - 右键拖拽平移：按住右键拖动地图（屏幕位移 → 世界位移，跟手比例）
 *
 * 驱动方式：
 *  - 滚轮：PlayerController.OnScroll → rig.zoom(delta)
 *  - 右键平移：rig.bindInput(input) 订阅 InputComponent 的鼠标按钮/指针移动事件
 *    （InputSys.handlePointerDown/Move 广播），无需覆写 Controller
 *  - 边缘平移：外部每帧调用 rig.Tick(dt)（或由持有方在 GameMode.Tick 中驱动），
 *    鼠标位置由 rig.setMouseScreen(sx, sy) 注入（PlayerController.OnPointerMoveScreen 转发）
 *
 * delta 约定（与 PlayerController.OnScroll 一致）：
 *   delta > 0（向下滚）→ 拉远；delta < 0（向上滚）→ 拉近。
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import { CameraComponent } from './CameraComponent'
import { PhySys } from '../physics/PhySys'
import type { InputComponent } from '../input/InputComponent'
import { logger } from '../Logger'

/** 屏幕边缘触发平移的宽度（像素） */
const EDGE_PAN_SIZE = 40
/** 边缘平移最大速度（世界单位/秒，贴边时达到） */
const EDGE_PAN_SPEED = 10

/** 边缘平移复用的临时向量 */
const _tmpForward = new THREE.Vector3()
const _tmpRight = new THREE.Vector3()
const _tmpTop = new THREE.Vector3()

export class CameraRigComponent extends Component {
  /** 注视目标（缩放/平移围绕该点），默认世界原点 */
  public target = new THREE.Vector3(0, 0, 0)
  /** 最近距离（世界单位） */
  public minDistance = 10
  /** 最远距离（世界单位） */
  public maxDistance = 50
  /** 每次滚动的步长（世界单位） */
  public step = 3
  /** 平移边界：target 可移动的世界范围（x/z 各 ±panLimit） */
  public panLimit = 20

  /** 屏幕边缘触发平移的宽度（像素） */
  public edgePanSize = EDGE_PAN_SIZE
  /** 边缘平移最大速度（世界单位/秒，贴边时达到） */
  public edgePanSpeed = EDGE_PAN_SPEED
  /** 屏幕边缘平移总开关（默认 true；false = 屏蔽"鼠标移到边缘自动平移摄像机"，右键拖拽平移不受影响） */
  public edgePanEnabled = true
  /** 右键拖拽平移灵敏度（1 = 拖动一个视口高度移动对应世界跨度，数值越大移动越快） */
  public rightPanSensitivity = 1

  /** 轨道环绕模式（true = 右键拖拽变为绕 target 球面旋转，false = 默认平移；行星观察视角用） */
  public orbitMode = false
  /** 轨道旋转灵敏度（弧度/像素） */
  public orbitSensitivity = 0.005
  /** 轨道仰角范围（弧度，限制在极点内侧避免 up 向量退化翻转） */
  public orbitPitchMin = -Math.PI / 2 + 0.15
  public orbitPitchMax = Math.PI / 2 - 0.15


  /** 同一 Actor 上的 CameraComponent（BeginPlay 时查找） */
  private _camera: CameraComponent | null = null

  /** 滚轮输入订阅（Controller 的 InputComponent）取消函数 */
  private unsubScroll: (() => void) | null = null
  /** 鼠标按钮输入订阅（右键按下/释放）取消函数 */
  private unsubMouseButton: (() => void) | null = null
  /** 指针移动输入订阅（右键拖拽中）取消函数 */
  private unsubPointerMove: (() => void) | null = null

  /** 最近鼠标屏幕坐标（client 坐标，由 controller 转发更新；-1 = 未记录） */
  private mouseX = -1
  private mouseY = -1

  /** 右键拖拽平移中 */
  private rightDragging = false
  /** 轨道旋转左键拖拽中（orbitMode 下左键环绕；右键环绕复用 rightDragging） */
  private orbitDragging = false

  /** 右键拖拽上一次记录的鼠标坐标（client 坐标；-1 = 未记录） */
  private dragLastX = -1
  private dragLastY = -1

  /** 右键平移开始回调（外部订阅：如基地 GameMode 取消放置模式） */
  onRightPanStart: (() => void) | null = null

  constructor(owner: Actor, name = 'CameraRig') {
    super(owner)
    this.name = name
  }

  override getProperties(): Record<string, unknown> {
    return {
      Target: [this.target.x, this.target.y, this.target.z],
      MinDistance: this.minDistance,
      MaxDistance: this.maxDistance,
      Step: this.step,
      PanLimit: this.panLimit,
      EdgePanSize: this.edgePanSize,
      EdgePanSpeed: this.edgePanSpeed,
      EdgePanEnabled: this.edgePanEnabled,
      RightPanSensitivity: this.rightPanSensitivity,
    }
  }

  /**
   * 设置屏幕边缘平移总开关（false = 屏蔽"鼠标移到边缘自动平移摄像机"）。
   * 关闭后 Tick 直接跳过边缘检测，右键拖拽平移/滚轮缩放不受影响。
   */
  setEdgePanEnabled(enabled: boolean): void {
    if (this.edgePanEnabled === enabled) return
    this.edgePanEnabled = enabled
    logger.info(`[CameraRig] 边缘平移已${enabled ? '开启' : '屏蔽'}（owner=${this.owner.root.name}）`)
  }

  override BeginPlay() {
    super.BeginPlay()
    this.resolveCamera()
  }

  /** 惰性解析同 Actor 的 CameraComponent（BeginPlay 前调用 zoom/pan 也能工作，便于装配期/单测驱动） */
  private resolveCamera(): CameraComponent | null {
    if (!this._camera) this._camera = this.owner.getComponent(CameraComponent)
    return this._camera
  }

  override EndPlay() {
    // 取消滚轮 / 鼠标按钮 / 指针移动输入订阅
    this.unsubScroll?.()
    this.unsubScroll = null
    this.unsubMouseButton?.()
    this.unsubMouseButton = null
    this.unsubPointerMove?.()
    this.unsubPointerMove = null
    this.rightDragging = false
    this.orbitDragging = false
    super.EndPlay()

  }

  /**
   * 订阅 Controller 的输入组件事件：
   *  - 滚轮（InputSys.handleScroll → InputComponent.ProcessScroll → 本回调 zoom）
   *  - 鼠标按钮（InputSys.handlePointerDown/Up → ProcessMouseButton → 右键按下/释放）
   *  - 指针移动（InputSys.handlePointerMove → ProcessPointerMove → 右键拖拽平移）
   * 组件销毁（EndPlay）时自动取消订阅。
   */
  bindInput(input: InputComponent | null): void {
    // 先取消旧订阅
    this.unsubScroll?.()
    this.unsubScroll = null
    this.unsubMouseButton?.()
    this.unsubMouseButton = null
    this.unsubPointerMove?.()
    this.unsubPointerMove = null
    if (!input) return
    // 滚轮缩放：delta 约定与 PlayerController.OnScroll 一致（正=拉远，负=拉近）
    this.unsubScroll = input.BindScroll((delta) => this.zoom(delta))
    // 鼠标按钮：右键按下开始拖拽平移，右键释放结束；
    // 轨道模式（orbitMode）下左键按下/释放驱动环绕旋转（行星观察视角：左键拖 = 环绕）
    this.unsubMouseButton = input.BindMouseButton((button, eventType) => {
      if (button === 2) {
        if (eventType === 'pressed') this.beginRightPan()
        else this.endRightPan()
        return
      }
      if (button === 0) {
        if (this.orbitMode && eventType === 'pressed') {
          this.orbitDragging = true
          this.dragLastX = this.mouseX
          this.dragLastY = this.mouseY
        } else if (eventType === 'released') {
          // 释放无条件清拖拽态（不判 orbitMode：观察中 Esc 退出后松键也须清，防悬停旋转残留）
          this.orbitDragging = false
          this.dragLastX = -1
          this.dragLastY = -1
        }
      }

    })

    // 指针移动：右键按住期间按屏幕位移平移（跟手拖拽地图）
    this.unsubPointerMove = input.BindPointerMove((sx, sy) => this.onRightPanMove(sx, sy))
  }

  /** 记录最近鼠标屏幕坐标（client 坐标；由 PlayerController.OnPointerMoveScreen 转发） */
  setMouseScreen(sx: number, sy: number): void {
    this.mouseX = sx
    this.mouseY = sy
  }

  /**
   * 滚轮缩放：沿当前视线方向把相机移动到新距离，并重新对准目标保持画面居中。
   * 距离被限制在 [minDistance, maxDistance] 范围内；缩放后写回 Actor root，
   * 避免每帧 SyncFromActor 把相机位置覆盖回去。
   * delta 约定（与 PlayerController.OnScroll 一致）：delta > 0（向下滚）→ 拉远；< 0 → 拉近。
   */
  zoom(delta: number): void {
    const cam = this.resolveCamera()?.camera
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

  /**
   * 平移：沿水平方向移动注视目标与相机（保持相对方向/距离不变）。
   * target 被限制在 [−panLimit, panLimit] 范围内，避免移出基地。
   * 平移后写回 Actor root，避免每帧 SyncFromActor 把相机位置覆盖回去。
   * @param dx 世界 X 方向位移（单位：世界单位）
   * @param dz 世界 Z 方向位移
   */
  pan(dx: number, dz: number): void {
    const cam = this.resolveCamera()?.camera
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
    this._camera!.SyncToActor()
  }

  /**
   * 每帧驱动（由持有方调用，如 GameMode.Tick → cameraActor.Tick(dt)）：
   * 鼠标位于视口边缘 EDGE_PAN_SIZE 像素内时，按贴近程度（0→1）
   * 以 EDGE_PAN_SPEED 速度平移基地相机（部落冲突风格边缘滚动）。
   * 方向：鼠标靠右 → 画面右移；靠上 → 画面顶部方向（水平面）移动。
   */
  override Tick(dt: number): void {
    super.Tick(dt)
    // 总开关：屏蔽"鼠标移到边缘自动平移摄像机"
    if (!this.edgePanEnabled) return
    // 右键拖拽平移中 → 屏蔽屏幕边缘平移（避免拖拽时鼠标贴近边缘导致画面乱跳）
    if (this.rightDragging) return
    if (this.mouseX < 0 || this.mouseY < 0) return
    const cam = this._camera?.camera
    if (!cam) return
    const el = PhySys.viewportElement
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    // 鼠标在视口内的相对坐标
    const x = this.mouseX - rect.left
    const y = this.mouseY - rect.top
    // 各方向边缘强度：0（内缘）→ 1（贴边）
    const size = this.edgePanSize
    const left = x < size ? (size - x) / size : 0
    const right = x > rect.width - size ? (x - (rect.width - size)) / size : 0
    const top = y < size ? (size - y) / size : 0
    const bottom = y > rect.height - size ? (y - (rect.height - size)) / size : 0
    const ix = right - left
    const iy = top - bottom
    if (Math.abs(ix) < 1e-3 && Math.abs(iy) < 1e-3) return

    // 屏幕方向 → 世界水平方向：
    // 右 = 相机局部 +X 投影到水平面；上（画面顶部）= 相机视线方向投影到水平面
    // （俯瞰相机看向地图中心，屏幕顶部对应视线方向的水平投影，取反会导致上下颠倒）
    _tmpRight.set(1, 0, 0).applyQuaternion(cam.quaternion)
    _tmpRight.y = 0
    _tmpRight.normalize()
    this.computeScreenUp(cam)
    _tmpRight.multiplyScalar(ix)
    _tmpTop.multiplyScalar(iy)
    const vx = _tmpRight.x + _tmpTop.x
    const vz = _tmpRight.z + _tmpTop.z
    if (Math.abs(vx) < 1e-6 && Math.abs(vz) < 1e-6) return

    // 速度 = 最大边缘强度 × 最大速度（斜向时取 max，避免归一化后变慢）
    const intensity = Math.max(Math.abs(ix), Math.abs(iy))
    const len = Math.hypot(vx, vz)
    const speed = this.edgePanSpeed * intensity * dt
    this.pan((vx / len) * speed, (vz / len) * speed)
  }

  // ════════════════════════════════════════════
  //   右键拖拽平移
  // ════════════════════════════════════════════

  /**
   * 右键按下：开始拖拽平移（记录起始鼠标位置）。
   * 残留右拖状态（如拖拽中窗口失焦 mouseup 丢失 → rightDragging 残留 true）时
   * 强制重置并重新开始，保证 onRightPanStart（外部取消放置模式等）每次都触发，
   * 否则放置模式将无法用右键取消。
   */
  beginRightPan(): void {
    if (this.rightDragging) {
      this.dragLastX = this.mouseX
      this.dragLastY = this.mouseY
      this.onRightPanStart?.()
      return
    }
    this.rightDragging = true
    // 以最近一次记录的鼠标位置为拖拽起点（若无记录，首次 move 时初始化）
    this.dragLastX = this.mouseX
    this.dragLastY = this.mouseY
    // 通知外部（如基地 GameMode 取消放置模式：右键平移与放置模式互斥）
    this.onRightPanStart?.()
  }

  /** 右键释放：结束拖拽平移 */
  endRightPan(): void {
    this.rightDragging = false
    this.dragLastX = -1
    this.dragLastY = -1
  }

  /**
   * 轨道环绕（orbitMode 下右键拖拽消费）：相机绕 target 沿球面旋转。
   * yaw 无限位（水平环绕），pitch 夹紧在 [orbitPitchMin, orbitPitchMax]
   * 避免越过极点导致 lookAt 的 up 向量退化翻转。距离保持不变（缩放走滚轮）。
   * @param deltaYaw 水平旋转增量（弧度，正 = 相机绕 target 向右环绕）
   * @param deltaPitch 仰角增量（弧度，正 = 相机升高）
   */
  private orbitRotate(deltaYaw: number, deltaPitch: number): void {
    const cam = this.resolveCamera()?.camera
    if (!cam) return
    const dir = cam.position.clone().sub(this.target)
    const distance = dir.length()
    if (distance < 1e-6) return
    // 当前球面坐标（Y-up：yaw 绕世界 Y 轴，pitch 为相对水平面的仰角）
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y / distance, -1, 1))
    const yaw = Math.atan2(dir.x, dir.z)
    const nextPitch = THREE.MathUtils.clamp(pitch + deltaPitch, this.orbitPitchMin, this.orbitPitchMax)
    const nextYaw = yaw + deltaYaw
    const horiz = Math.cos(nextPitch) * distance
    cam.position.set(
      this.target.x + horiz * Math.sin(nextYaw),
      this.target.y + Math.sin(nextPitch) * distance,
      this.target.z + horiz * Math.cos(nextYaw),
    )
    // up 用世界 +Y：斜视角下行星北极朝屏幕上方（垂直俯视由 focusOn 复位为 -Z）
    cam.up.set(0, 1, 0)
    cam.lookAt(this.target)
    // 写回 Actor root，否则每帧 SyncFromActor 会把相机位置覆盖回去
    this._camera!.SyncToActor()
  }


  /**
   * 右键拖拽中移动：把屏幕位移换算成世界水平位移并平移（跟手拖拽地图）。
   * 方向与边缘平移一致：屏幕右 → 相机局部 +X 的水平投影；屏幕下 → 视线方向水平投影。
   * 缩放比例基于相机距离与视口高度：拖动一个视口高度 = 移动该距离下视口的世界跨度。
   */
  onRightPanMove(sx: number, sy: number): void {
    // 轨道环绕模式：左键或右键拖拽 → 绕 target 球面旋转（水平拖 = 经度，垂直拖 = 仰角）
    if (this.orbitMode) {
      if (!this.rightDragging && !this.orbitDragging) return
      // 起点未记录（按下时鼠标尚未移动过）→ 以本次位置为起点，跳过首帧跳变
      if (this.dragLastX < 0 || this.dragLastY < 0) {
        this.dragLastX = sx
        this.dragLastY = sy
        return
      }
      const dx = sx - this.dragLastX
      const dy = sy - this.dragLastY
      this.dragLastX = sx
      this.dragLastY = sy
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return
      this.orbitRotate(dx * this.orbitSensitivity, dy * this.orbitSensitivity)
      return
    }

    if (!this.rightDragging) return
    const cam = this._camera?.camera
    if (!cam) return
    // 起点未记录（按下时鼠标尚未移动过）→ 以本次位置为起点
    if (this.dragLastX < 0 || this.dragLastY < 0) {
      this.dragLastX = sx
      this.dragLastY = sy
      return
    }
    const scale = this.rightPanScale(cam)

    const dx = (sx - this.dragLastX) * scale
    const dy = (sy - this.dragLastY) * scale
    this.dragLastX = sx
    this.dragLastY = sy
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return



    // 屏幕方向 → 世界水平方向（按摄像机自身面朝方向映射）：
    // 屏幕右 = 相机局部 +X 的水平投影；屏幕下 = 相机面朝方向（forward）的水平投影
    // 拖拽跟手：鼠标向右拖 → 场景内容向右移动（相机沿屏幕右反方向平移），
    // 故仅对屏幕右方向（dx 贡献）取反；屏幕下方向（dy 贡献）保持（上下本来就与跟手一致）。
    // 注意：取反必须按屏幕轴（对 dx/dy 贡献分别处理），不能对整个世界 X 分量取反，
    // 否则相机有偏航（如基地相机 12,16,18 看向原点）时上下方向会被一并反掉导致扭曲。
    _tmpRight.set(1, 0, 0).applyQuaternion(cam.quaternion)
    _tmpRight.y = 0
    _tmpRight.normalize()
    this.computeScreenUp(cam)
    this.pan(
      -_tmpRight.x * dx + _tmpTop.x * dy,
      -_tmpRight.z * dx + _tmpTop.z * dy,
    )
  }

  /**
   * 求屏幕上方对应的水平世界方向（写入 _tmpTop）：视线方向的水平投影。
   * 垂直俯视时视线无水平分量（投影为零向量，normalize 会得 NaN），
   * 退化为相机局部 +Y 的水平投影（由相机 up 轴决定，正俯视下即屏幕上方指向）。
   */
  private computeScreenUp(cam: THREE.Camera): void {
    cam.getWorldDirection(_tmpForward)
    _tmpTop.set(_tmpForward.x, 0, _tmpForward.z)
    if (_tmpTop.lengthSq() < 1e-8) {
      _tmpTop.set(0, 1, 0).applyQuaternion(cam.quaternion)
      _tmpTop.y = 0
      if (_tmpTop.lengthSq() < 1e-8) _tmpTop.set(0, 0, -1)
    }
    _tmpTop.normalize()
  }

  /**
   * 像素 → 世界单位换算：该距离下视口高度对应的世界跨度 ÷ 视口像素高度。
   * 相机拉近时比例自动变小（拖动更精细），拉远时变大（跟手不慢）。
   */
  private rightPanScale(cam: THREE.Camera): number {
    const el = PhySys.viewportElement
    const h = el?.clientHeight ?? 600
    if (h <= 0) return 0.001
    const distance = cam.position.distanceTo(this.target)
    const fov = (cam as THREE.PerspectiveCamera).fov ?? 45
    // 视口高度对应的世界跨度 ≈ 2·distance·tan(fov/2)
    const worldPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / h
    return worldPerPixel * this.rightPanSensitivity
  }
}
