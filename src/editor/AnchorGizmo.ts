/**
 * AnchorGizmo — UI 锚点编辑 gizmo（Unity Anchor 风格）
 *
 * 选中 UI 节点时显示：
 *  - 父容器范围：白色半透明线框（opacity 0.5），标出锚点所在的父画布边界
 *  - 锚点图标：
 *      - 普通锚点（top-left / center 等单点锚）：4 个小三角形尖角聚合在锚点位置（风车形）
 *      - stretch（全锚）：4 个小三角形分布在矩形四角，尖角指向矩形内部
 * 全部挂在编辑器 overlayScene，始终渲染在 UI 之上。
 */
import * as THREE from 'three'
import type { Actor } from '../engine/entity/Actor'
import { UITransformComponent, type AnchorPreset } from '../engine/ui/UITransformComponent'
import { CanvasUIComponent } from '../engine/rendering/CanvasUIComponent'

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

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'AnchorGizmo'
    this.group.visible = false
    this.group.renderOrder = 997
    this.buildParentBounds()
    this.buildTriangles()
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

  /** 挂载到目标 Actor（显示 gizmo） */
  attach(actor: Actor) {
    this._target = actor
    this.group.visible = true
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
    if (!actor || worldPerPx <= 0) return
    const uiTf = actor.getComponent(UITransformComponent)
    if (!uiTf) {
      this.parentBounds!.visible = false
      for (const t of this.triangles) t.visible = false
      return
    }

    // ─── 父容器范围：最近的父画布（非 markerOnly），白色半透明线框 ───
    const parent = this.findParentCanvas(actor)
    if (parent) {
      const [cw, ch] = parent.getWorldSize()
      const p = parent.owner.root.position
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
      this.layoutPoint(actor, uiTf, parent, size)
    }
  }

  /** stretch 布局：四角三角形，尖端精确对齐矩形四角（本体在矩形外侧，尖端指向内部触角） */
  private layoutStretch(actor: Actor, uiTf: UITransformComponent, size: number) {
    const [sw, sh] = uiTf.getWorldSize()
    const cx = actor.root.position.x
    const cy = actor.root.position.y
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
    parent: CanvasUIComponent | null,
    size: number,
  ) {
    // 锚点位置 = applyAnchor 语义：父中心 + 方向因子 × (父半尺寸 − 自身半尺寸) + offset
    const [sw, sh] = uiTf.getWorldSize()
    let x: number
    let y: number
    const anchor = uiTf.anchor!
    const [fx, fy] = ANCHOR_FACTORS[anchor]
    const [ox, oy] = uiTf.anchorOffset
    if (parent) {
      const [cw, ch] = parent.getWorldSize()
      const pp = parent.owner.root.position
      x = pp.x + fx * (cw / 2 - sw / 2) + ox
      y = pp.y + fy * (ch / 2 - sh / 2) + oy
    } else {
      // 无父画布：锚点退化显示在元素当前位置
      x = actor.root.position.x
      y = actor.root.position.y
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

  /** 向上查找最近的父画布（非仅标记模式） */
  private findParentCanvas(actor: Actor): CanvasUIComponent | null {
    let p = actor.parent
    while (p) {
      const comp = p.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
      if (comp) return comp
      p = p.parent
    }
    return null
  }
}
