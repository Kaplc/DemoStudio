/**
 * StarScrollPanComponent — 星图滚轮落点平移组件（挂 SolarCameraActor）
 *
 * warm 滚轮镜头控制的唯一实现（2026-09-18/19 定版，自 GameMode 收编）：
 * 每滚重算目标——光标命中本系天体 → 相机沿「相机位置 → 对中停止点」连线平移一个
 * rig.step；光标空手 → 吸附**空目标**：光标射线与黄道平面（y = eclipticY）的交点，
 * 走同一套平移语义（空目标 r = 0 → 对中停止距离取下限 24）。
 * 拉近（delta < 0）滚向目标、拉远（delta > 0）滚离目标；朝向完全固定
 * （只 syncCameraTransform 写回位置，绝不重摆 lookAt）= 真平移。
 * **目标缓存（2026-09-18 用户口径：右键 = 环绕滚轮选定的目标观察）**：滚动命中
 * 目标即写 rig.target = 目标点（天体球心 / 黄道面落点）——地球视角云台本就是
 * orbitMode（右键拖拽绕 target 球面环绕 + lookAt 居中），缓存后右键即环绕该目标。
 * 射线不交黄道面（指向天际）时滚动无效果（普通视线缩放已移除）。
 * 无粘滞残留（2026-09-18 用户口径：粘滞已移除，每次滚动重新计算目标）：
 * 光标悬在天体投影盘内则逐滚天然持续命中（盘半径与光标偏移同随距离缩放，
 * 比例不变）；天体漂出拾取圈即断追，后续滚动改走空目标。
 *
 * 对中停止点：stopPoint = 球心 − 视线方向̂ × floor（floor = max(24, r×1.15)，
 * 同 applyZoomFloor 口径）——恰在停止半径球面上；相机到该点时球心到相机连线
 * 恰等于视线方向 → 目标对齐屏幕正中心。视线冻结期间该点静止 → 逐滚直线收敛。
 *
 * 自给自足：自己订阅滚轮输入（bindInput，同 CameraRigComponent 模式）、自己
 * 维护光标屏幕位（setMouseScreen 由 Controller.OnPointerMoveScreen 喂）、
 * 自己做屏幕空间拾取（60px 圈 + 投影圆盘，tol = B.map.focusSnapTolerance）。
 * warm 状态经 source 注入（候选天体 + 模式门槛），组件不含 GameMode 依赖。
 */
import * as THREE from 'three'
import { Component, PhySys, logger, type InputComponent } from '@/engine'
import type { Actor } from '@/engine'
import { B } from '../core/balance'
import type { SolarCameraActor } from './SolarCameraActor'

/** 可拾取天体：id、球心实时位、显示半径 */
export interface StarScrollCandidate {
  id: string
  pos: THREE.Vector3
  r: number
}

/** 空目标（黄道面落点）的候选 id（日志分支用，不会与天体 id 撞名） */
const ECLIPTIC_ID = '#ecliptic'

/** warm 状态注入（GameMode 装配期赋值）：组件不直接依赖 GameMode */
export interface StarScrollPanSource {
  /** 候选天体（聚焦行星 + 本系卫星），球心取 Actor 实时位 */
  candidates(): StarScrollCandidate[]
  /** 滚轮控制是否允许（行星系视角且非切换中；瞄准滑移由组件自查 isAiming） */
  allowed(): boolean
}

export class StarScrollPanComponent extends Component {
  /** warm 状态注入（GameMode 构造后赋值；null = 滚轮不可用） */
  public source: StarScrollPanSource | null = null

  /** 黄道平面世界高度（天体轨道/轨道装饰线所在平面；星图布局全在 y=0） */
  public eclipticY = 0

  private mouseX = -1
  private mouseY = -1
  private unsubScroll: (() => void) | null = null

  constructor(owner: Actor, name = 'StarScrollPan') {
    super(owner)
    this.name = name
  }

  private get actor(): SolarCameraActor {
    return this.owner as SolarCameraActor
  }

  override EndPlay(): void {
    this.unsubScroll?.()
    this.unsubScroll = null
    super.EndPlay()
  }

  /** 记录最近光标屏幕坐标（client 坐标；Controller.OnPointerMoveScreen 转发） */
  setMouseScreen(sx: number, sy: number): void {
    this.mouseX = sx
    this.mouseY = sy
  }

  /** 订阅 Controller 的滚轮输入（装配期调用，同 rig.bindInput 时机） */
  bindInput(input: InputComponent | null): void {
    this.unsubScroll?.()
    this.unsubScroll = null
    if (!input) return
    this.unsubScroll = input.BindScroll((delta) => this.onScroll(delta))
    logger.info(`[StarScrollPan] bindInput: 滚轮落点平移订阅完成（owner=${this.owner.root.name}）`)
  }

  /** 滚轮入口（InputSys 时序：UI 仲裁在此前已完成，进来的都是场景滚轮） */
  onScroll(delta: number): void {
    if (delta === 0 || this.mouseX < 0 || this.mouseY < 0) return
    const actor = this.actor
    if (!this.source || !this.source.allowed()) return
    // 注视点被瞄准滑移（双击聚焦）占用时让位：滑移 own 相机位置
    if (actor.isAiming()) return
    // 目标解析（每滚重算，无粘滞残留）：天体命中优先；空手 → 光标射线 ∩ 黄道平面交点
    const body = this.pickBody(this.mouseX, this.mouseY)
    const target = body ?? this.pickEclipticPoint()
    if (!target) return // 射线指向天际/平行黄道面：滚动无效果
    // 目标缓存（选中即写，与本滚是否实际推进无关）：rig.target = 目标点
    // （天体球心 / 黄道面落点）→ 右键拖拽绕该点环绕观察（引擎 orbitRotate lookAt 居中）
    actor.rig.target.copy(target.pos)
    const cam = actor.camera
    const toStop = stopPointOf(target, cam).sub(cam.position)
    const reach = toStop.length()
    if (reach < 1) return // 已在对中停止点：本滚消费掉
    const sign = delta < 0 ? 1 : -1
    // 步长封顶：拉近最多推进到停止点；拉远不超 maxDistance（按到目标点距离计量）
    const limit = sign > 0
      ? reach
      : Math.max(0, actor.rig.maxDistance - cam.position.distanceTo(target.pos))
    const step = Math.min(actor.rig.step, limit)
    if (step < 1e-3) return
    const dir = toStop.divideScalar(reach)
    cam.position.addScaledVector(dir, sign * step)
    // 只写回位置、不重摆 lookAt：朝向固定 = 真平移（重摆会变成绕注视点"转"过去）
    actor.syncCameraTransform()
    const label = target.id === ECLIPTIC_ID
      ? `黄道落点(${target.pos.x.toFixed(0)},${target.pos.z.toFixed(0)})`
      : target.id
    logger.info(`[StarScrollPan] 落点平移 → ${label}（${sign > 0 ? '进' : '退'} ${step.toFixed(1)}，距对中停止点余 ${reach.toFixed(0)}，朝向固定）`)
  }

  /** 屏幕空间拾取：光标 60px 圈命中候选（中心入圈或光标在投影圆盘内），就近胜出；
   *  无粘滞（每滚重算）。 */
  private pickBody(screenX: number, screenY: number): StarScrollCandidate | null {
    const source = this.source
    if (!source) return null
    const el = PhySys.viewportElement
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const cam = this.actor.camera
    cam.updateMatrixWorld()
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const v = new THREE.Vector3()
    const tol = B.map.focusSnapTolerance
    const hovered = source.candidates()
    let best: StarScrollCandidate | null = null
    let bestDist = Infinity
    for (const cand of hovered) {
      v.copy(cand.pos).project(cam)
      // NDC z 出 [-1,1] = 球心在相机前/后界之外（背面/被裁剪），像素坐标不可信
      if (v.z < -1 || v.z > 1) continue
      const cx = rect.left + ((v.x + 1) / 2) * rect.width
      const cy = rect.top + ((1 - v.y) / 2) * rect.height
      const ex = v.copy(cand.pos).addScaledVector(right, cand.r).project(cam)
      const px = rect.left + ((ex.x + 1) / 2) * rect.width
      const py = rect.top + ((1 - ex.y) / 2) * rect.height
      const screenR = Math.hypot(px - cx, py - cy)
      const d = Math.hypot(screenX - cx, screenY - cy)
      // 固定像素圈：中心入圈（d ≤ tol）或光标在本体盘内（d ≤ screenR）
      if (d <= tol || d <= screenR) {
        const score = Math.min(d, screenR)
        if (score < bestDist) {
          bestDist = score
          best = cand
        }
      }
    }
    return best
  }

  /** 空目标兜底：光标射线与黄道平面（y = eclipticY）求交，交点作为空目标
   *  （r = 0 → 对中停止距离 = 下限 24，与天体同口径；到位时空目标恰居屏幕正中心）。
   *  每滚按当前光标射线重算：相机平移后射线原点随动，交点贴着光标下方地面点滑动
   *  （RTS 滚到光标地面点手感）。
   *  射线指向天际（不朝下）或平行于平面时返回 null = 滚动无效果。 */
  private pickEclipticPoint(): StarScrollCandidate | null {
    const el = PhySys.viewportElement
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const cam = this.actor.camera
    cam.updateMatrixWorld()
    const ndc = new THREE.Vector2(
      ((this.mouseX - rect.left) / rect.width) * 2 - 1,
      -((this.mouseY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, cam)
    const hit = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.eclipticY)
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    return { id: ECLIPTIC_ID, pos: hit, r: 0 }
  }
}

/** 对中停止点 = 球心沿当前视线反方向退 floor（恰在停止半径球面上；
 *  相机到该点时球心到相机连线 = 视线方向 → 目标对齐屏幕正中心） */
function stopPointOf(cand: StarScrollCandidate, cam: THREE.Camera): THREE.Vector3 {
  const view = new THREE.Vector3()
  cam.getWorldDirection(view)
  const floor = Math.max(24, cand.r * 1.15)
  return cand.pos.clone().addScaledVector(view, -floor)
}
