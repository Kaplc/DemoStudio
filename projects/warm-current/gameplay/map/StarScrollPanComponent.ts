/**
 * StarScrollPanComponent — 星图滚轮落点平移组件（挂 SolarCameraActor）
 *
 * warm 滚轮镜头控制的唯一实现（2026-09-18/19 定版，自 GameMode 收编）：
 * 每滚重算目标——光标命中本系天体 → 相机沿「相机位置 → 停止点」连线平移一个
 * rig.step；光标空手 → 吸附**空目标**：光标射线与黄道平面（y = eclipticY）的交点，
 * 走同一套平移语义（空目标 r = 0 → 停止距离取下限 24）。
 * **拉近（delta < 0）锁定目标并滚向它；拉远（delta > 0）不重新锁定**——与拉近
 * 同构的平行线停止点：最远停止点 = 注视点(当前锁定)沿视线反方向退 maxDistance，
 * 相机滚到该点时目标恰好对齐屏幕正中心；锁谁由前滚决定，后滚只负责退到对齐点。
 * 朝向完全固定（只 syncCameraTransform 写回位置，绝不重摆 lookAt）= 真平移。
 * **目标缓存（2026-09-18 用户口径：右键 = 环绕滚轮选定的目标观察）**：拉近命中
 * 目标即写 rig.target = 目标点（天体球心 / 黄道面落点）——地球视角云台本就是
 * orbitMode（右键拖拽绕 target 球面环绕）+ orbitKeepOffset 不回中，缓存后右键即环绕该目标
 * （目标屏幕位保持：偏轴不甩回中心、居中依旧居中）。
 * 射线不交黄道面（指向天际）时滚动无效果（普通视线缩放已移除）。
 * 无粘滞残留（2026-09-18 用户口径：粘滞已移除，每次滚动重新计算目标）：
 * 光标悬在天体投影盘内则逐滚天然持续命中（盘半径与光标偏移同随距离缩放，
 * 比例不变）；天体漂出拾取圈即断追，后续滚动改走空目标。
 *
 * 拉近两段式（2026-09-20 用户口径：视口对齐提前于最近距离完成）：
 * 阶段一（距离 > 对齐距离）滚向**对齐停止点** = 球心 − 视线方向̂ × alignDist
 * （B.map.scrollAlignDistance，生效值不低于最近停止距离）——相机从外侧逼近时恰在
 * 对齐球面边界处完成对齐：目标对齐屏幕正中心且距离 = alignDist；阶段二（已对齐）
 * 沿「相机 → 目标」方向直进（目标保持居中），到**最近停止距离** floor = max(24,
 * r×1.15) 封顶。视线冻结期间停止点静止 → 逐滚直线收敛。
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
    if (this.markGroup) {
      this.markGroup.removeFromParent()
      for (const m of this.markMats) m.dispose()
      for (const g of this.markGeos) g.dispose()
      this.markGroup = null
      this.markMats = []
      this.markGeos = []
    }
    super.EndPlay()
  }

  /** 拉近两段式对齐距离（B.map.scrollAlignDistance 透传；e2e 断言同源读取用） */
  get alignDistance(): number {
    return B.map.scrollAlignDistance
  }

  /** 记录最近光标屏幕坐标（client 坐标；Controller.OnPointerMoveScreen 转发） */
  setMouseScreen(sx: number, sy: number): void {
    this.mouseX = sx
    this.mouseY = sy
  }

  // ════════════════════════════════════════════
  //  目标标记 gizmo（2026-09-18 用户口径：gizmo 显示目标位置）
  //  青色准星（细环 + 四刻度 + 中心菱形）恒绘制在最上层（depthTest off），
  //  逐帧贴 rig.target（= 滚轮缓存目标）并按相机距离定标（恒定屏幕占比 ~7%，
  //  远近不缩没/不糊屏）；直挂渲染场景（相机 Actor root 随机位走，不能当父级）。
  // ════════════════════════════════════════════

  private markGroup: THREE.Group | null = null
  private markMats: THREE.Material[] = []
  private markGeos: THREE.BufferGeometry[] = []

  override BeginPlay(): void {
    super.BeginPlay()
    this.buildTargetMark()
  }

  private buildTargetMark(): void {
    const world = this.owner.world
    const factory = world?.factory
    const scene = world?.gameRenderer?.scene
    if (!factory || !scene) {
      logger.warn('[StarScrollPan] 目标标记未创建（工厂/渲染场景不可用）')
      return
    }
    const mat = factory.createMeshBasicMaterial({
      color: 0x53d9ff, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    })
    this.markMats.push(mat)
    const ringGeo = factory.createRingGeometry(0.94, 1, 64)
    const tickGeo = factory.createPlaneGeometry(0.05, 0.22)
    const dotGeo = factory.createOctahedronGeometry(0.09)
    this.markGeos.push(ringGeo, tickGeo, dotGeo)
    const groupObj = factory.createGroup()
    groupObj.owner = this.owner // 孤儿诊断豁免（同 StarMapRenderComponent.own 口径）
    const group = groupObj.object
    group.name = 'WarmTargetMark'
    const ring = factory.createMesh(ringGeo, mat)
    ring.object.renderOrder = 999
    group.add(ring.object)
    for (let i = 0; i < 4; i++) {
      const tick = factory.createMesh(tickGeo, mat)
      const ang = (i * Math.PI) / 2
      tick.object.position.set(Math.cos(ang) * 1.16, Math.sin(ang) * 1.16, 0)
      tick.object.rotation.z = ang - Math.PI / 2
      tick.object.renderOrder = 999
      group.add(tick.object)
    }
    const dot = factory.createMesh(dotGeo, mat)
    dot.object.renderOrder = 999
    group.add(dot.object)
    scene.add(group)
    this.markGroup = group
    logger.info('[StarScrollPan] 目标标记 gizmo 已挂载（跟随 rig.target）')
  }

  override Tick(dt: number): void {
    super.Tick(dt)
    // 实时 roll 修正（2026-09-20 用户口径）：warm 相机恒定世界 up 无滚转，
    // 任何来源（历史环绕/同步滞后）累积的 roll 每帧归零——视轴不受影响
    this.actor.rig.scrubRoll()
    const mark = this.markGroup
    if (!mark) return
    const cam = this.actor.camera
    mark.position.copy(this.actor.rig.target)
    // 广告牌化：准星始终正对镜头（相机无父子变换，quaternion 即世界朝向）
    mark.quaternion.copy(cam.quaternion)
    // 恒定屏幕占比定标：直径 2s ≈ 7% 视口高（fov50 → 视口高 ≈ 0.93×距离）
    mark.scale.setScalar(Math.max(1e-3, cam.position.distanceTo(this.actor.rig.target) * 0.035))
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
    const cam = actor.camera
    // 拉远（delta > 0）不重新锁定目标（2026-09-20 用户口径）：锁定保持不变，
    // 与拉近同构的平行线停止点语义——最远停止点 = 注视点沿视线反方向退 maxDistance，
    // 相机到该点时注视点到相机连线恰等于视线方向 → 滚到最远目标恰好对齐屏幕正中心。
    // 视线冻结期间该点静止 → 逐滚直线收敛。只写回位置不重摆 lookAt，朝向固定。
    if (delta > 0) {
      const toFar = stopPointOf(actor.rig.target, cam, actor.rig.maxDistance).sub(cam.position)
      const reach = toFar.length()
      if (reach < 1) return // 已在最远对齐停止点：本滚消费掉
      const step = Math.min(actor.rig.step, reach)
      cam.position.addScaledVector(toFar.divideScalar(reach), step)
      actor.syncCameraTransform()
      logger.info(`[StarScrollPan] 拉远退向对齐点 ${step.toFixed(1)}（锁定保持，距注视点 ${cam.position.distanceTo(actor.rig.target).toFixed(0)}/上限 ${actor.rig.maxDistance.toFixed(0)}，朝向固定）`)
      return
    }
    // 拉近（delta < 0）：拾取 + 锁定 + 两段式平移。目标解析（每滚重算，无粘滞残留）：
    // 天体命中优先；空手 → 光标射线 ∩ 黄道平面交点
    const body = this.pickBody(this.mouseX, this.mouseY)
    const target = body ?? this.pickEclipticPoint()
    if (!target) return // 射线指向天际/平行黄道面：滚动无效果
    // 目标缓存（选中即写，与本滚是否实际推进无关）：rig.target = 目标点
    // （天体球心 / 黄道面落点）→ 右键拖拽绕该点环绕观察（orbitKeepOffset 不回中）
    actor.rig.target.copy(target.pos)
    const floor = Math.max(24, target.r * 1.15)
    // 对齐距离（2026-09-20 用户口径：视口对齐提前在最近距离前完成）——生效值不低于
    // 最近停止距离，否则直进段没有余地
    const alignDist = Math.max(B.map.scrollAlignDistance, floor)
    const label = target.id === ECLIPTIC_ID
      ? `黄道落点(${target.pos.x.toFixed(0)},${target.pos.z.toFixed(0)})`
      : target.id
    if (cam.position.distanceTo(target.pos) - alignDist > 0.5) {
      // 阶段一（未对齐）：滚向对齐停止点（注视点 − 视线̂ × alignDist）。相机从外侧
      // 逼近时恰在边界处（距离 = alignDist）完成对齐——直线段与对齐球面只交于该点。
      // 0.5 容差吸收恰好落点时的浮点尘埃：差半个单位内视为已对齐，交由直进段推进
      // （否则 reach≈1e-13 的边界滚动会因 reach<1 空转、永久卡在对齐球面上）
      const toStop = stopPointOf(target.pos, cam, alignDist).sub(cam.position)
      const reach = toStop.length()
      if (reach < 1e-6) return // 数值零距保护（理论上不可达：外侧 0.5 以上 reach ≥ 0.5）
      const step = Math.min(actor.rig.step, reach)
      cam.position.addScaledVector(toStop.divideScalar(reach), step)
      // 只写回位置、不重摆 lookAt：朝向固定 = 真平移（重摆会变成绕注视点"转"过去）
      actor.syncCameraTransform()
      logger.info(`[StarScrollPan] 落点平移 → ${label}（进 ${step.toFixed(1)}，距对齐点余 ${reach.toFixed(0)}，朝向固定）`)
      return
    }
    // 阶段二（已对齐）：沿「相机 → 目标」方向直进（目标保持屏幕正中心），最近停止距离封顶
    const dist = cam.position.distanceTo(target.pos)
    const step = Math.min(actor.rig.step, Math.max(0, dist - floor))
    if (step < 1e-3) return // 已到最近停止距离：本滚消费掉
    cam.position.addScaledVector(target.pos.clone().sub(cam.position).divideScalar(dist), step)
    actor.syncCameraTransform()
    logger.info(`[StarScrollPan] 对齐直进 → ${label}（进 ${step.toFixed(1)}，距目标 ${dist.toFixed(0)}/停止 ${floor.toFixed(0)}，朝向固定）`)
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

/** 停止点 = 目标沿当前视线反方向退 dist（拉近 dist = 对中停止距离 floor，
 *  拉远 dist = maxDistance）——恰在以目标为心、半径 dist 的球面上；相机到该点时
 *  目标到相机连线 = 视线方向 → 目标对齐屏幕正中心 */
function stopPointOf(pos: THREE.Vector3, cam: THREE.Camera, dist: number): THREE.Vector3 {
  const view = new THREE.Vector3()
  cam.getWorldDirection(view)
  return pos.clone().addScaledVector(view, -dist)
}
