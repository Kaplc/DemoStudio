/**
 * AnchorGizmo — UI 锚点编辑 gizmo（Unity Anchor 风格）
 *
 * 选中 UI 节点时显示：
 *  - 父容器范围：白色半透明线框（opacity 0.5），标出锚点所在的父画布边界
 *  - 锚点图标：
 *      - 普通锚点（top-left / center 等单点锚）：4 个小三角形尖角聚合在锚点位置（风车形）
 *        ——锚点位置 = 父容器上的参考点（top-left → 父左上角，center → 父中心），
 *        与元素自身尺寸、anchorOffset 无关（Unity Anchor 语义）
 *      - stretch（全锚）：4 个小三角形分布在矩形四角，尖角指向矩形内部
 * 全部挂在编辑器 overlayScene，始终渲染在 UI 之上。
 */
import * as THREE from 'three'
import type { Actor } from '../engine/entity/Actor'
import { UITransformComponent, type AnchorPreset } from '../engine/ui/UITransformComponent'
import { CanvasUIComponent } from '../engine/rendering/CanvasUIComponent'
import { gizmos } from '../engine'
import { logger } from '../engine/Logger'

/** 锚点 → 方向因子（x: -1 左/0 中/+1 右，y: -1 下/0 中/+1 上） */
const ANCHOR_FACTORS: Record<AnchorPreset, [number, number]> = {
  'top-left': [-1, 1], 'top-center': [0, 1], 'top-right': [1, 1],
  'middle-left': [-1, 0], 'middle-center': [0, 0], 'center': [0, 0], 'middle-right': [1, 0],
  'bottom-left': [-1, -1], 'bottom-center': [0, -1], 'bottom-right': [1, -1],
  // stretch 走专用分支（四角三角形），不经过方向因子（占位）
  'stretch': [0, 0],
}

/** 三角形朝向（尖角方向）：朝上/下/左/右 */
type TriDir = 'up' | 'down' | 'left' | 'right'

/** 复用临时向量（getWorldPosition 出参，避免每帧 new 产生 GC 压力） */
const _tmpV1 = new THREE.Vector3()

export class AnchorGizmo {
  readonly group: THREE.Group

  /** 父容器范围线框（白色半透明） */
  private parentBounds: THREE.LineSegments | null = null
  /** 4 个小三角形（Unity 锚点图标） */
  private triangles: THREE.Mesh[] = []
  /** 三角形目标屏幕尺寸（px，短边） */
  private static readonly TRI_PX = 13
  /** 非 stretch 时三角形中心到锚点的距离（相对三角形尺寸的倍数）：0.5 = 半个三角形高，尖端恰好汇聚于锚点中心 */
  private static readonly GAP = 0.5

  private _target: Actor | null = null

  /** 全局 gizmos 开关委托取消函数（构造注册，dispose 取消；委托驱动显隐） */
  private _unsubGizmosToggle: (() => void) | null = null

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'AnchorGizmo'
    this.group.visible = false
    this.group.renderOrder = 997
    this.buildParentBounds()
    this.buildTriangles()

    // 监听全局 gizmos 开关（编辑器按钮 setEnabled → 委托触发关闭/显示），
    // 注册时立即回调当前值（同步初始状态）
    this._unsubGizmosToggle = gizmos.onEnabledChanged((v) => {
      if (this._target) this.group.visible = v
    })
  }

  // ─────────────────────────────────────
  //  构建
  // ─────────────────────────────────────

  /** 父容器范围：白色线框（透明度 0.5），单位几何，scale 控制尺寸 */
  private buildParentBounds() {
    const geo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1))
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.5,
    })
    const lines = new THREE.LineSegments(geo, mat)
    lines.renderOrder = 997
    this.group.add(lines)
    this.parentBounds = lines
  }

  /** 4 个空心小三角形：等腰三角形外轮廓 + 内缩孔（环形边框），scale/rotation 控制大小与朝向 */
  private buildTriangles() {
    // 外三角形：底边 1×1 等腰，尖角朝 +Y；质心 = (0, −1/6)
    const shape = new THREE.Shape()
    shape.moveTo(-0.5, -0.5)
    shape.lineTo(0.5, -0.5)
    shape.lineTo(0, 0.5)
    shape.closePath()
    // 内缩孔（0.6× 质心缩放）：形成空心环形，边框厚度 ≈ 0.13~0.27
    const hole = new THREE.Path()
    hole.moveTo(-0.3, -0.3667)
    hole.lineTo(0, 0.2333)
    hole.lineTo(0.3, -0.3667)
    hole.closePath()
    shape.holes.push(hole)
    const geo = new THREE.ShapeGeometry(shape)
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 997
      mesh.visible = false
      this.group.add(mesh)
      this.triangles.push(mesh)
    }
  }

  // ─────────────────────────────────────
  //  生命周期
  // ─────────────────────────────────────

  /** 挂载到目标 Actor（显示 gizmo；跟随全局 gizmos.enabled 开关） */
  attach(actor: Actor) {
    this._target = actor
    this.group.visible = gizmos.enabled
    // ⚠️ 排查日志：选中时打印局部 vs 世界坐标对照——子节点三者不同会导致 gizmo 画错位
    const _local = actor.root.position
    actor.root.updateWorldMatrix(true, false)
    const _world = actor.root.getWorldPosition(new THREE.Vector3())
    const _parent = actor.parent
    const _uiTf = actor.getComponent(UITransformComponent)
    logger.info(
      `[AnchorGizmo] attach "${actor.name}" ` +
      `local=(${_local.x.toFixed(3)},${_local.y.toFixed(3)}) ` +
      `world=(${_world.x.toFixed(3)},${_world.y.toFixed(3)}) ` +
      `${_parent ? `parent="${_parent.name}"` : '根'} ` +
      `anchor=${_uiTf?.anchor ?? 'null'}`,
    )
    this.update(0)
  }

  /** 分离（隐藏） */
  detach() {
    this._target = null
    this.group.visible = false
  }

  get visible(): boolean {
    return this.group.visible
  }

  /** 释放资源 */
  dispose() {
    // 取消全局 gizmos 开关委托
    this._unsubGizmosToggle?.()
    this._unsubGizmosToggle = null
    this.detach()
    this.parentBounds?.geometry.dispose()
    ;(this.parentBounds?.material as THREE.Material | undefined)?.dispose()
    const g = this.triangles[0]?.geometry
    g?.dispose()
    for (const t of this.triangles) {
      ;(t.material as THREE.Material).dispose()
    }
    this.triangles = []
    this.parentBounds = null
  }

  // ─────────────────────────────────────
  //  更新（每帧跟随）
  // ─────────────────────────────────────

  /**
   * 每帧调用：父容器范围 + 锚点图标跟随目标
   * @param worldPerPx 当前 zoom 下 1px 对应的世界距离（屏幕恒定尺寸用）
   */
  update(worldPerPx: number) {
    const actor = this._target
    // 防御：worldPerPx 非有限值（如隐藏视口 clientHeight=0 → Infinity）时跳过，避免三角形位置变 Infinity
    if (!actor || !isFinite(worldPerPx) || worldPerPx <= 0) return
    const uiTf = actor.getComponent(UITransformComponent)
    if (!uiTf) {
      this.parentBounds!.visible = false
      for (const t of this.triangles) t.visible = false
      return
    }

    // ─── 父容器范围：最近的父容器（与 applyAnchor 的 findContainerSize 语义一致：
    // 父 Actor 显式 uitransform 尺寸优先，markerOnly 容器也算；兜底真实画布），白色半透明线框 ───
    // ⚠️ 关键：parentBounds/triangles 直接挂在 overlayScene 根下（无父变换），其 position 世界坐标 = 本地坐标，
    //    必须用 getWorldPosition（世界坐标）。子节点选中时父容器在世界非原点，读 root.position（局部）
    //    会画在错误位置。
    const container = this.findParentContainer(actor)
    if (container) {
      const [cw, ch] = container.size
      container.actor.root.updateWorldMatrix(true, false)
      const p = container.actor.root.getWorldPosition(_tmpV1)
      this.parentBounds!.visible = true
      this.parentBounds!.position.set(p.x, p.y, -0.02)
      this.parentBounds!.scale.set(cw, ch, 1)
    } else {
      this.parentBounds!.visible = false
    }

    // ─── 锚点图标 ───
    const anchor = uiTf.anchor
    if (!anchor) {
      // 无锚点：只显示父容器范围
      for (const t of this.triangles) t.visible = false
      return
    }

    // 三角形屏幕恒定尺寸（几何单位 1×1 → scale = 目标像素 × wpp）
    const size = AnchorGizmo.TRI_PX * worldPerPx

    if (anchor === 'stretch') {
      // 全锚：4 个小三角形在矩形四角，尖角指向矩形中心（对角线方向）
      this.layoutStretch(actor, uiTf, size)
    } else {
      // 单点锚：4 个小三角形在锚点位置聚合，尖角指向中心（风车形）
      this.layoutPoint(actor, uiTf, container, size)
    }
  }

  /** stretch 布局：四角三角形，尖端精确对齐矩形四角（本体在矩形外侧，尖端指向内部触角） */
  private layoutStretch(actor: Actor, uiTf: UITransformComponent, size: number) {
    const [sw, sh] = uiTf.getWorldSize()
    // ⚠️ 用世界坐标（gizmo 挂 overlayScene 根下，position 是世界语义；root.position 是局部）
    actor.root.updateWorldMatrix(true, false)
    const wp = actor.root.getWorldPosition(_tmpV1)
    const cx = wp.x
    const cy = wp.y
    const hw = sw / 2
    const hh = sh / 2
    // 中心偏移 = 尖端矢量（0.5×size 沿对角方向）取反：尖端恰好落在角点，三角形本体在矩形外侧
    // 尖端矢量 = (0.5×sinθ, 0.5×cosθ)×size，对角线方向分量 = 0.5×√2/2×size
    const diag = -size * 0.5 * 0.7071
    const corners: { x: number; y: number; rot: number }[] = [
      // TL：尖朝右下（+X,−Y 对角），尖端触角 (−hw, +hh)
      { x: cx - hw + diag, y: cy + hh - diag, rot: -Math.PI * 0.75 },
      // TR：尖朝左下（−X,−Y 对角），尖端触角 (+hw, +hh)
      { x: cx + hw - diag, y: cy + hh - diag, rot: Math.PI * 0.75 },
      // BL：尖朝右上（+X,+Y 对角），尖端触角 (−hw, −hh)
      { x: cx - hw + diag, y: cy - hh + diag, rot: -Math.PI * 0.25 },
      // BR：尖朝左上（−X,+Y 对角），尖端触角 (+hw, −hh)
      { x: cx + hw - diag, y: cy - hh + diag, rot: Math.PI * 0.25 },
    ]
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i]
      const c = corners[i]
      t.visible = true
      t.position.set(c.x, c.y, 0.02)
      t.rotation.z = c.rot
      t.scale.set(size, size, 1)
    }
  }

  /** 单点锚布局：4 个三角形围绕锚点位置，尖角指向中心 */
  private layoutPoint(
    actor: Actor,
    uiTf: UITransformComponent,
    container: { actor: Actor; size: [number, number] } | null,
    size: number,
  ) {
    // 锚点 = 父容器上的参考点（Unity 语义）：父中心 + 方向因子 × 父半尺寸。
    // 与自身尺寸、anchorOffset 无关——锚点图标标示"锚在父控件上的哪个位置"
    // （top-left 锚点 → 父控件左上角，center → 父中心，bottom-right → 父右下角）。
    const anchor = uiTf.anchor!
    const [fx, fy] = ANCHOR_FACTORS[anchor]
    let x: number
    let y: number
    if (container) {
      const [cw, ch] = container.size
      // ⚠️ 用世界坐标（gizmo 挂 overlayScene 根下，position 是世界语义；root.position 是局部）
      container.actor.root.updateWorldMatrix(true, false)
      const pp = container.actor.root.getWorldPosition(_tmpV1)
      x = pp.x + fx * (cw / 2)
      y = pp.y + fy * (ch / 2)
    } else {
      // 无父容器：锚点退化显示在元素当前位置
      actor.root.updateWorldMatrix(true, false)
      const wp = actor.root.getWorldPosition(_tmpV1)
      x = wp.x
      y = wp.y
    }

    // 三角形中心到锚点距离 = 半个三角形高：4 个箭头尖端汇聚于锚点中心（Unity 锚点样式）
    const d = size * AnchorGizmo.GAP
    const dirs: { dx: number; dy: number; dir: TriDir }[] = [
      { dx: 0, dy: d, dir: 'down' },   // 上三角：尖朝下
      { dx: 0, dy: -d, dir: 'up' },    // 下三角：尖朝上
      { dx: -d, dy: 0, dir: 'right' }, // 左三角：尖朝右
      { dx: d, dy: 0, dir: 'left' },   // 右三角：尖朝左
    ]
    const ROT: Record<TriDir, number> = {
      up: 0,
      down: Math.PI,
      left: Math.PI / 2,
      right: -Math.PI / 2,
    }
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i]
      const c = dirs[i]
      t.visible = true
      t.position.set(x + c.dx, y + c.dy, 0.02)
      t.rotation.z = ROT[c.dir]
      t.scale.set(size, size, 1)
    }
  }

  /**
   * 向上查找最近的父容器（与 applyAnchor 的 findContainerSize 语义一致）：
   *   1. 父 Actor 的 UITransformComponent 且 worldSizeExplicit（显式设置了 worldWidth/worldHeight）
   *      —— markerOnly 容器（如 TopBar/BottomBar）也有明确世界尺寸，它就是子元素的布局容器
   *   2. 父 Actor 上的真实画布（非 markerOnly CanvasUIComponent），兜底
   */
  private findParentContainer(actor: Actor): { actor: Actor; size: [number, number] } | null {
    let p = actor.parent
    while (p) {
      // 1. 父 Actor 显式设置的 uitransform 尺寸 → 容器基准
      const tf = p.getComponent(UITransformComponent)
      if (tf && tf.worldSizeExplicit) {
        return { actor: p, size: tf.getWorldSize() }
      }
      // 2. 兜底：真实画布（非仅标记）——markerOnly 组件只作 UI 标识，不作为容器
      const comp = p.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
      if (comp) {
        return { actor: p, size: comp.getWorldSize() }
      }
      p = p.parent
    }
    return null
  }
}
