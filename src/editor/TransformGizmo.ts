/**
 * TransformGizmo — 场景编辑变换工具（对标 Unity 的 Position Gizmo）
 *
 * 在选中的对象中心显示三轴箭头（X=红, Y=绿, Z=蓝），
 * 拖拽箭头可沿对应轴移动对象，类似 Unity 的编辑器体验。
 *
 * 交互流程：
 *   1. 鼠标在 canvas 上按下 → Raycaster 检测是否命中箭头
 *   2. 命中 → 开始拖拽，临时冻结 Scene 摄像机输入
 *   3. 鼠标移动 → 将运动投影到拖拽轴上，更新目标位置
 *   4. 鼠标释放 → 结束拖拽，恢复摄像机输入
 */
import * as THREE from 'three'

// ─── 轴颜色 ───
const AXIS_COLORS = {
  x: 0xff4444,
  y: 0x44ff44,
  z: 0x4488ff,
} as const

// ─── 箭头尺寸（本地坐标） ───
const SHAFT_LENGTH = 1.0
const SHAFT_RADIUS = 0.03
const CONE_LENGTH = 0.25
const CONE_RADIUS = 0.08

/** 单条轴箭头信息 */
interface ArrowData {
  axis: THREE.Vector3
  color: number
  shaft: THREE.Mesh
  cone: THREE.Mesh
  group: THREE.Group
  /** 原始 emissive 颜色（恢复高亮用） */
  baseColor: THREE.Color
}

export class TransformGizmo {
  readonly group: THREE.Group
  private arrows: ArrowData[] = []

  // ─── 外部引用 ───
  private _scene: THREE.Scene | null = null
  private _camera: THREE.Camera | null = null
  private _renderer: THREE.WebGLRenderer | null = null
  /** 用于在拖拽期间暂时禁止 Scene 摄像机输入 */
  private _inputBlocker: (() => void) | null = null
  private _inputRestorer: (() => void) | null = null

  // ─── 目标 ───
  private _target: THREE.Object3D | null = null

  // ─── 拖拽状态 ───
  private _isDragging = false
  private _dragAxis = new THREE.Vector3()
  private _dragStartPos = new THREE.Vector3()
  private _planeHitStart = new THREE.Vector3()

  // ─── 复用对象 ───
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private _camDir = new THREE.Vector3()
  private _dragPlane = new THREE.Plane()
  private _planeHit = new THREE.Vector3()
  private _box3 = new THREE.Box3()
  private _center = new THREE.Vector3()

  // ─── 拖拽移动回调（用于实时更新 Inspector） ───
  onDragMove: (() => void) | null = null

  // ─── 缩放常量屏幕尺寸 ───
  private _screenScale = 0.08

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'TransformGizmo'
    this.group.visible = false
    this.group.renderOrder = 999
    this.buildArrows()
  }

  // ════════════════════════════════════════════
  //  构建
  // ════════════════════════════════════════════

  private buildArrows() {
    const axisDefs = [
      { dir: new THREE.Vector3(1, 0, 0), color: AXIS_COLORS.x },
      { dir: new THREE.Vector3(0, 1, 0), color: AXIS_COLORS.y },
      { dir: new THREE.Vector3(0, 0, 1), color: AXIS_COLORS.z },
    ]

    for (const { dir, color } of axisDefs) {
      const g = new THREE.Group()
      g.renderOrder = 999

      // 轴杆（圆柱）
      const shaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8)
      const shaftMat = new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      })
      const shaft = new THREE.Mesh(shaftGeo, shaftMat)
      // 圆柱默认沿 Y，将底部放在原点
      shaft.position.y = SHAFT_LENGTH / 2
      shaft.userData.gizmoAxis = true

      // 箭头头（圆锥）
      const coneGeo = new THREE.ConeGeometry(CONE_RADIUS, CONE_LENGTH, 12)
      const coneMat = new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      })
      const cone = new THREE.Mesh(coneGeo, coneMat)
      cone.position.y = SHAFT_LENGTH + CONE_LENGTH / 2
      cone.userData.gizmoAxis = true

      g.add(shaft)
      g.add(cone)

      // 将 Group 的 +Y 旋转到目标轴向
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize(),
      )
      g.quaternion.copy(quat)

      this.group.add(g)

      this.arrows.push({
        axis: dir.clone(),
        color,
        shaft,
        cone,
        group: g,
        baseColor: new THREE.Color(color),
      })
    }
  }

  // ════════════════════════════════════════════
  //  生命周期
  // ════════════════════════════════════════════

  /**
   * 初始化 Gizmo：挂载到场景，保存相机/渲染器引用
   * @param scene   共享场景
   * @param camera  Scene 视口相机
   * @param renderer Scene 视口渲染器
   * @param inputBlocker  禁止摄像机输入的回调
   * @param inputRestorer 恢复摄像机输入的回调
   */
  setup(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    inputBlocker?: () => void,
    inputRestorer?: () => void,
  ) {
    this._scene = scene
    this._camera = camera
    this._renderer = renderer
    this._inputBlocker = inputBlocker ?? null
    this._inputRestorer = inputRestorer ?? null

    if (this.group.parent !== scene) {
      this.group.removeFromParent()
      scene.add(this.group)
    }
  }

  /** 挂载到目标对象上（显示 Gizmo） */
  attach(target: THREE.Object3D) {
    this._target = target
    this._isDragging = false
    this.syncTransform()
    this.group.visible = true
  }

  /** 从目标分离（隐藏 Gizmo） */
  detach() {
    this._target = null
    this._isDragging = false
    this.group.visible = false
    this.resetArrowHighlight()
  }

  /** 每帧同步位置/缩放 */
  syncTransform() {
    if (!this._target || !this._camera) return

    // 计算目标中心
    this._box3.setFromObject(this._target)
    this._box3.getCenter(this._center)
    this.group.position.copy(this._center)

    // 常量屏幕尺寸（世界单位根据距离缩放）
    const dist = this._camera.position.distanceTo(this._center)
    const s = Math.max(dist * this._screenScale, 0.3)
    this.group.scale.setScalar(s)

    // 世界空间轴向（不跟随目标旋转）
    this.group.rotation.set(0, 0, 0)
  }

  // ════════════════════════════════════════════
  //  命中检测
  // ════════════════════════════════════════════

  /**
   * 检测鼠标位置是否命中任意轴箭头
   * @returns 命中的轴方向向量（归一化），未命中返回 null
   */
  hitTest(clientX: number, clientY: number): THREE.Vector3 | null {
    if (!this._camera || !this._renderer || !this.group.visible) return null

    const rect = this._renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.pointer, this._camera)

    // 收集所有箭头网格（shaft + cone）
    const meshes: THREE.Mesh[] = []
    for (const a of this.arrows) {
      meshes.push(a.shaft, a.cone)
    }

    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null

    // 找到命中的箭头
    const hitMesh = hits[0].object as THREE.Mesh
    for (const a of this.arrows) {
      if (a.shaft === hitMesh || a.cone === hitMesh) {
        return a.axis.clone()
      }
    }

    return null
  }

  /** 检测鼠标位置是否悬停在箭头上（用于高亮） */
  hoverTest(clientX: number, clientY: number): THREE.Vector3 | null {
    const axis = this.hitTest(clientX, clientY)
    this.updateHighlight(axis)
    return axis
  }

  /** 更新箭头高亮 */
  private updateHighlight(hoverAxis: THREE.Vector3 | null) {
    for (const a of this.arrows) {
      const isHover = hoverAxis !== null && a.axis.dot(hoverAxis) > 0.9
      const mat = a.shaft.material as THREE.MeshBasicMaterial
      mat.color.copy(isHover ? new THREE.Color(0xffffff) : a.baseColor)
      ;(a.cone.material as THREE.MeshBasicMaterial).color.copy(mat.color)
    }
  }

  /** 重置高亮 */
  resetArrowHighlight() {
    for (const a of this.arrows) {
      ;(a.shaft.material as THREE.MeshBasicMaterial).color.copy(a.baseColor)
      ;(a.cone.material as THREE.MeshBasicMaterial).color.copy(a.baseColor)
    }
  }

  // ════════════════════════════════════════════
  //  拖拽
  // ════════════════════════════════════════════

  /** 开始沿指定轴拖拽 */
  startDrag(axis: THREE.Vector3, clientX: number, clientY: number) {
    if (!this._target) return

    this._isDragging = true
    this._dragAxis.copy(axis).normalize()
    this._dragStartPos.copy(this._target.position)

    // 计算鼠标在过拖拽起点的相机垂直平面上的投影
    this._updatePlaneHit(clientX, clientY, this._dragStartPos)
    this._planeHitStart.copy(this._planeHit)

    // 冻结摄像机输入
    this._inputBlocker?.()
  }

  /** 更新拖拽（移动目标位置） */
  updateDrag(clientX: number, clientY: number) {
    if (!this._isDragging || !this._target || !this._dragAxis) return

    // 在过起点位置的相机垂直平面上计算鼠标投影
    this._updatePlaneHit(clientX, clientY, this._dragStartPos)

    // 计算平面上从起点到当前点的偏移
    const delta = new THREE.Vector3().copy(this._planeHit).sub(this._planeHitStart)
    // 将偏移投影到拖拽轴上
    const dot = delta.dot(this._dragAxis)

    // 新位置 = 起点 + 轴方向 × 投影量
    const newPos = new THREE.Vector3().copy(this._dragStartPos).addScaledVector(this._dragAxis, dot)
    this._target.position.copy(newPos)
    this.syncTransform()
    this.onDragMove?.()
  }

  /** 结束拖拽 */
  endDrag() {
    if (!this._isDragging) return
    this._isDragging = false
    this._inputRestorer?.()
    this.resetArrowHighlight()
  }

  /** 计算鼠标射线与过指定点的相机垂直平面的交点 */
  private _updatePlaneHit(clientX: number, clientY: number, planePoint: THREE.Vector3) {
    if (!this._camera || !this._renderer) return

    const rect = this._renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.pointer, this._camera)

    // 平面法线 = 视线方向
    this._camera.getWorldDirection(this._camDir)
    this._dragPlane.setFromNormalAndCoplanarPoint(this._camDir, planePoint)

    const hit = this.raycaster.ray.intersectPlane(this._dragPlane, this._planeHit)
    if (!hit) {
      // 回退：射线与平面平行时，取射线起点
      this._planeHit.copy(this.raycaster.ray.origin)
    }
  }

  // ════════════════════════════════════════════
  //  访问器
  // ════════════════════════════════════════════

  get isDragging(): boolean { return this._isDragging }
  get target(): THREE.Object3D | null { return this._target }
  get visible(): boolean { return this.group.visible }

  // ════════════════════════════════════════════
  //  清理
  // ════════════════════════════════════════════

  dispose() {
    this.detach()
    this.group.removeFromParent()
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
    this._scene = null
    this._camera = null
    this._renderer = null
  }
}
