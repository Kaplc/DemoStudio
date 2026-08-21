/**
 * RuntimeUIEditor — 游戏运行时 UI 场景可编辑视图（UIScene 页签专用）
 *
 * 用途：在游戏运行时显示当前运行游戏的 UI 树，并允许编辑单个 UI 节点：
 *  - 点击拾取：raycast 命中 mesh → 找到所属 UI Actor → 选中（同步全局选中 + Inspector）
 *  - 选中辅助：青色范围框 + 8 把手（可拖拽调整尺寸）+ 锚点图标（父容器范围 + 锚点位置）
 *  - 拖动：节点范围内按住左键拖动调整位置（锚点节点改 anchorOffset，普通节点改 position）
 *
 * 与 UIPreviewManager 的关键差异：
 *  - 不持有 World / 不 SpawnActorFromBlueprint：复用运行中 game world 的 UI 场景
 *  - 不写入资产文件 / 不进撤销栈：编辑直接作用于运行时 actor（热调试性质，停止游戏后丢弃）
 *  - 渲染：自己的 OrthographicCamera + WebGLRenderer，渲染 game world.ui.scene
 *
 * 视觉布局：用 contain 模式完整显示 UI 根画布（9.6×5.4，与 game UICamera 一致）。
 */
import * as THREE from 'three'
import type { Actor, World } from '../../engine'
import { logger, gizmos } from '../../engine'
import { UITransformComponent } from '../../engine/ui/UITransformComponent'
import { CanvasUIComponent } from '../../engine/rendering/CanvasUIComponent'
import {
  select, notifySelectionChange,
} from '../SelectionManager'
import { AnchorGizmo } from '../AnchorGizmo'
import { SelectionBoundsGizmo } from '../SelectionBoundsGizmo'
import type { SceneTreeNode } from '../SelectionManager'

// ─── UI 根画布世界尺寸（与 UICamera 常量保持一致） ───
const UI_CANVAS_W = 9.6
const UI_CANVAS_H = 5.4

const CORNER_CURSORS = [
  'nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize',
  'ns-resize', 'ew-resize', 'ns-resize', 'ew-resize',
] as const

export class RuntimeUIEditor {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.OrthographicCamera
  readonly overlayScene: THREE.Scene
  /** 选中辅助：锚点图标 + 范围框（可编辑模式） */
  readonly anchorGizmo: AnchorGizmo
  readonly boundsGizmo: SelectionBoundsGizmo

  /** UI 根画布视口范围框（跟随 gizmos 开关：开启时常驻显示 9.6×5.4 白色线框） */
  private viewportBounds: THREE.LineSegments | null = null
  /** gizmos 开关委托取消函数（构造注册，dispose 取消） */
  private _unsubGizmosToggle: (() => void) | null = null

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0

  /** 关联的运行中 game world（attach 时设置；由其 ui 场景提供渲染目标 + actor 来源） */
  private _world: World | null = null
  /** 大纲树缓存（结构稳定时复用；watchWorldActorChanges 触发失效） */
  private _actorTreeCache: SceneTreeNode[] | null = null

  // ─── 输入状态 ───
  private isLeftDown = false
  private prevMouseX = 0
  private prevMouseY = 0
  private potentialClick = false
  private pressX = 0
  private pressY = 0

  // ─── 选中目标 ───
  private boundsTarget: Actor | null = null
  /** 选中辅助首帧日志标记（每次新选中重置，只打一次避免刷屏） */
  private _helperLogged = false

  // ─── 8 把手拖拽（4 角 + 4 边） ───
  private draggingCornerIndex: number | null = null
  private cornerHandles: THREE.Mesh[] = []
  private cornerHandleGroup: THREE.Group | null = null
  private cornerDragWorld = new THREE.Vector3()
  private cornerFixedWorld = new THREE.Vector3()
  private cornerStartClientX = 0
  private cornerStartClientY = 0
  private cornerStartSize: [number, number] = [0, 0]

  // ─── 节点拖动 ───
  private draggingActor: Actor | null = null
  private dragStartClientX = 0
  private dragStartClientY = 0
  private dragStartActorPos = new THREE.Vector3()
  private dragViaAnchorOffset = false
  private dragStartOffset: [number, number] = [0, 0]

  // ─── 复用临时对象 ───
  private raycaster = new THREE.Raycaster()
  private _ndc = new THREE.Vector2()
  private _tmpVec = new THREE.Vector3()
  private _tmpBox = new THREE.Box3()

  // ─── WebGL 上下文丢失/恢复 ───
  private contextLost = false
  private _onContextLost: ((e: Event) => void) | null = null
  private _onContextRestored: (() => void) | null = null

  // ─── 变更回调（供 Outline 刷新） ───
  private _onChangeCallbacks: Array<() => void> = []

  onChange(cb: () => void): () => void {
    this._onChangeCallbacks.push(cb)
    return () => {
      const i = this._onChangeCallbacks.indexOf(cb)
      if (i >= 0) this._onChangeCallbacks.splice(i, 1)
    }
  }

  private notifyChange() {
    this._actorTreeCache = null
    for (const cb of this._onChangeCallbacks) cb()
  }

  constructor(container: HTMLElement) {
    this.container = container

    // ─── 渲染器（透明背景，由父容器提供底色） ───
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setClearColor(0x1a1a2e, 1)
    container.appendChild(this.renderer.domElement)

    // ─── 正交相机：contain 模式显示 UI 根画布 9.6×5.4（与游戏 UICamera 一致） ───
    this.camera = new THREE.OrthographicCamera(-UI_CANVAS_W / 2, UI_CANVAS_W / 2, UI_CANVAS_H / 2, -UI_CANVAS_H / 2, 0.1, 200)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)

    // ─── 编辑器覆盖层：gizmo/包围盒/把手挂这里，渲染永远在 UI 之上 ───
    this.overlayScene = new THREE.Scene()

    // ─── 锚点 gizmo（父容器范围 + 锚点图标） ───
    this.anchorGizmo = new AnchorGizmo()
    this.overlayScene.add(this.anchorGizmo.group)

    // ─── 选中范围框 gizmo（青色 + 8 把手 + 尺寸标签） ───
    this.boundsGizmo = new SelectionBoundsGizmo()
    this.boundsGizmo.setShowHandles(true) // 可编辑模式：显示把手
    this.overlayScene.add(this.boundsGizmo.group)

    // ─── UI 根画布视口范围框（常显白色线框 9.6×5.4，与 UI 资产预览的 Game 渲染视口范围框一致） ───
    this.ensureViewportBounds()

    // 8 个圆形把手 mesh（独立于 boundsGizmo 内部的把手，用于命中拖拽；boundsGizmo 只负责显示）
    this.ensureCornerHandles()

    // ─── 输入 ───
    this.setupMouse()

    // ─── WebGL 上下文丢失/恢复 ───
    this._onContextLost = (e: Event) => {
      e.preventDefault()
      this.contextLost = true
      this.stop()
      logger.warn('[RuntimeUIEditor] WebGL 上下文丢失，已暂停渲染')
    }
    this._onContextRestored = () => {
      logger.info('[RuntimeUIEditor] WebGL 上下文已恢复')
      this.contextLost = false
      this.start()
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false)

    // 默认未挂载到任何 game world
    this._world = null

    this.start()
  }

  // ═════════════════════════════════════════
  //  关联 game world（运行中实例）
  // ═════════════════════════════════════════

  /** 挂接到运行中 game world（渲染其 UI 场景，编辑其 UI actor） */
  attachWorld(world: World): void {
    this._world = world
    this.invalidateActorTree()
    this.fitToCanvas()
    logger.info(`[RuntimeUIEditor] 挂接到 game world（${world.ui.getAllUIActors().length} 个 UI Actor）`)
  }

  /** 解除关联（游戏停止时调用） */
  detachWorld(): void {
    this._world = null
    this.selectActor(null)
    this.invalidateActorTree()
    logger.info('[RuntimeUIEditor] 解除 game world 关联')
  }

  get world(): World | null {
    return this._world
  }

  /** 大纲树缓存失效（Actor 列表变化时调用） */
  invalidateActorTree(): void {
    this._actorTreeCache = null
  }

  // ═════════════════════════════════════════
  //  选中 / 拾取
  // ══════════════════════════════════════════════

  /** 选中 actor：同步全局选中 + 显示范围框/锚点辅助 + 通知 Inspector（画布点击拾取路径） */
  selectActor(actor: Actor | null) {
    this.boundsTarget = actor
    this._helperLogged = false
    if (actor) {
      select(actor)
      this.anchorGizmo.attach(actor)
      this.boundsGizmo.attach(actor)
      logger.info(
        `[RuntimeUIEditor] selectActor: ${actor.root.name || actor.name} → ` +
        `anchor=${this.anchorGizmo.visible} bounds=${this.boundsGizmo.visible} (gizmos=${gizmos.enabled})`,
      )
    } else {
      select(null)
      this.anchorGizmo.detach()
      this.boundsGizmo.detach()
      logger.info('[RuntimeUIEditor] selectActor: null（取消选中）')
    }
    this.notifyChange()
  }

  /**
   * 同步外部选中（来自 UI 大纲 / Inspector 的全局 select）。
   * 只更新自身 gizmo 目标，不调用 select()——避免与全局选中广播形成循环。
   */
  syncSelection(actor: Actor | null) {
    // 相同目标：无需重复操作（防抖，也避免每次 onSelectionChange 都重建）
    if (this.boundsTarget === actor) return
    this.boundsTarget = actor
    this._helperLogged = false
    if (actor) {
      this.anchorGizmo.attach(actor)
      this.boundsGizmo.attach(actor)
      logger.info(
        `[RuntimeUIEditor] syncSelection: ${actor.root.name || actor.name} → ` +
        `anchor=${this.anchorGizmo.visible} bounds=${this.boundsGizmo.visible} (gizmos=${gizmos.enabled})`,
      )
    } else {
      this.anchorGizmo.detach()
      this.boundsGizmo.detach()
      logger.info('[RuntimeUIEditor] syncSelection: null（取消选中）')
    }
    this.notifyChange()
  }

  /**
   * 点击拾取：raycast 命中 mesh → 找到所属 UI Actor。
   * 命中多个取 distance 最近的（zOrder 大者 panel z 更靠前）。
   */
  private pickActor(e: MouseEvent): Actor | null {
    if (!this._world) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this._ndc, this.camera)

    // 收集所有 UI Actor root 下的 Mesh，建立 mesh → actor 映射
    const meshes: THREE.Mesh[] = []
    const actorByMesh = new Map<THREE.Object3D, Actor>()
    for (const actor of this._world.ui.getAllUIActors()) {
      actor.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh)
          actorByMesh.set(obj, actor)
        }
      })
    }
    if (meshes.length === 0) return null
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    const hitActor = actorByMesh.get(hits[0].object) ?? null
    logger.debug(
      `[RuntimeUIEditor] pickActor: ${hits.length} hits, first=${hits[0].object.name || '(无名)'} → ` +
      `${hitActor ? hitActor.root.name || hitActor.name : 'null'}`,
    )
    return hitActor
  }

  // ══════════════════════════════════════════════
  //  包围盒计算（与 UIPreviewManager.getBoundsBox 一致语义）
  // ══════════════════════════════════════════════

  /**
   * 选中控件包围盒基准（uitransform 尺寸矩形，对角固定语义）。
   * 子节点（按钮内文本）用世界位置计算，避免父节点移动后局部坐标偏移。
   */
  private getBoundsBox(): THREE.Box3 {
    const actor = this.boundsTarget!
    const root = actor.root
    const uiTf = actor.getComponent(UITransformComponent)
    if (uiTf) {
      const [ww, wh] = uiTf.getWorldSize()
      if (ww > 0 && wh > 0) {
        root.updateWorldMatrix(true, true)
        const p = root.getWorldPosition(this._tmpVec.clone())
        return new THREE.Box3(
          new THREE.Vector3(p.x - ww / 2, p.y - wh / 2, -1),
          new THREE.Vector3(p.x + ww / 2, p.y + wh / 2, 1),
        )
      }
    }
    return new THREE.Box3().setFromObject(root)
  }

  /** 检测鼠标是否命中当前选中节点的 mesh（含宽松矩形命中） */
  private pickBoundsTargetMesh(e: MouseEvent): boolean {
    if (!this.boundsTarget) return false
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this._ndc, this.camera)
    const meshes: THREE.Object3D[] = []
    this.boundsTarget.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj)
    })
    if (meshes.length > 0) {
      const hits = this.raycaster.intersectObjects(meshes, false)
      if (hits.length > 0) return true
    }
    // 宽松矩形命中（troika 矢量文本字形之间有间隙）
    this.boundsTarget.root.updateWorldMatrix(true, true)
    const PAD = 8
    const uiTf = this.boundsTarget.getComponent(UITransformComponent)
    if (uiTf) {
      const [ww, wh] = uiTf.getWorldSize()
      if (ww > 0 && wh > 0) {
        const wp = this.boundsTarget.root.getWorldPosition(this._tmpVec.clone())
        return this.pointInScreenRect(e, rect, wp.x - ww / 2, wp.y - wh / 2, wp.x + ww / 2, wp.y + wh / 2, PAD)
      }
    }
    return false
  }

  private pointInScreenRect(
    e: MouseEvent, rect: DOMRect,
    minX: number, minY: number, maxX: number, maxY: number, pad: number,
  ): boolean {
    const corners: [number, number][] = [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]]
    let sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity
    for (const [wx, wy] of corners) {
      this._tmpVec.set(wx, wy, 0).project(this.camera)
      const sx = rect.left + (this._tmpVec.x * 0.5 + 0.5) * rect.width
      const sy = rect.top + (-this._tmpVec.y * 0.5 + 0.5) * rect.height
      sxMin = Math.min(sxMin, sx); sxMax = Math.max(sxMax, sx)
      syMin = Math.min(syMin, sy); syMax = Math.max(syMax, sy)
    }
    return e.clientX >= sxMin - pad && e.clientX <= sxMax + pad &&
           e.clientY >= syMin - pad && e.clientY <= syMax + pad
  }

  // ═════════════════════════════════════════
  //  8 把手（独立 mesh，用于命中拾取）
  // ═════════════════════════════════════════

  /**
   * UI 根画布视口范围框：白色线框（透明度 0.8），表示游戏实际渲染 UI 的世界范围
   * （= 根画布 worldWidth×worldHeight，固定 9.6×5.4，与 UI 资产预览的 viewportBounds 同风格）。
   * 跟随全局 gizmos 开关：开启时常驻显示，关闭时隐藏（与锚点/范围框 gizmo 一致）。
   */
  private ensureViewportBounds(): void {
    if (this.viewportBounds) return
    const geo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1))
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    })
    const lines = new THREE.LineSegments(geo, mat)
    lines.name = '__ui_viewport_bounds__'
    lines.renderOrder = 996 // 低于选中包围盒(998)/把手(999)，选中时不被遮挡关系干扰
    lines.scale.set(UI_CANVAS_W, UI_CANVAS_H, 1)
    this.overlayScene.add(lines)
    this.viewportBounds = lines

    // 跟随全局 gizmos 开关（编辑器按钮 setEnabled → 立即显示/隐藏；注册时同步当前值）
    this._unsubGizmosToggle ??= gizmos.onEnabledChanged((v) => {
      if (this.viewportBounds) this.viewportBounds.visible = v
    })
  }

  private ensureCornerHandles(): void {
    if (this.cornerHandleGroup) return
    const group = new THREE.Group()
    group.name = '__rtui_bounds_handles__'
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.CircleGeometry(1, 24)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, depthTest: false, depthWrite: false,
        transparent: true, opacity: 0.0, side: THREE.DoubleSide,
      })
      // 这里是不可见命中 mesh（opacity=0），仅用于 raycast 命中；
      // 可见的把手由 boundsGizmo 渲染（位置/缩放跟随同一组位置）
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 999
      mesh.visible = false
      mesh.userData.rtuiHandle = true
      group.add(mesh)
      this.cornerHandles.push(mesh)
    }
    this.cornerHandleGroup = group
    this.overlayScene.add(group)
  }

  /** 把手屏幕命中（阈值：角 14px，边 10px；命中 mesh 比 boundsGizmo 略宽松以提升手感） */
  private pickCornerHandle(e: MouseEvent): number {
    if (!this.boundsTarget || this.cornerHandles.length === 0) return -1
    if (this.cornerHandleGroup) this.cornerHandleGroup.updateWorldMatrix(true, true)
    const rect = this.renderer.domElement.getBoundingClientRect()
    const hitPx = [14, 14, 14, 14, 10, 10, 10, 10]
    let best = -1, bestDist = Infinity
    for (let i = 0; i < this.cornerHandles.length; i++) {
      const h = this.cornerHandles[i]
      if (!h.visible) continue
      const wp = h.position.clone().project(this.camera)
      const sx = rect.left + (wp.x * 0.5 + 0.5) * rect.width
      const sy = rect.top + (-wp.y * 0.5 + 0.5) * rect.height
      const dist = Math.hypot(e.clientX - sx, e.clientY - sy)
      if (dist <= hitPx[i] && dist < bestDist) {
        best = i; bestDist = dist
      }
    }
    return best
  }

  /** 把手拖拽调整尺寸（与 UIPreviewManager.resizeBoundsByCorner 同语义，但作用于运行时 actor） */
  private resizeBoundsByCorner(handleIndex: number, startX: number, startY: number, curX: number, curY: number) {
    const actor = this.boundsTarget!
    const uiTf = actor.getComponent(UITransformComponent)
    if (!uiTf) return
    const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
    const worldDx = (curX - startX) * worldPerPx
    const worldDy = -(curY - startY) * worldPerPx
    const dx = this.cornerDragWorld.x + worldDx
    const dy = this.cornerDragWorld.y + worldDy
    const fx = this.cornerFixedWorld.x
    const fy = this.cornerFixedWorld.y
    const isCorner = handleIndex < 4
    const isH = handleIndex === 5 || handleIndex === 7
    const isV = handleIndex === 4 || handleIndex === 6
    const newW = isCorner || isH ? Math.max(0.1, Math.abs(dx - fx)) : this.cornerStartSize[0]
    const newH = isCorner || isV ? Math.max(0.1, Math.abs(dy - fy)) : this.cornerStartSize[1]
    const cx = isCorner || isH ? (dx + fx) / 2 : actor.position.x
    const cy = isCorner || isV ? (dy + fy) / 2 : actor.position.y
    uiTf.setWorldSize(newW, newH)
    // 锚点节点：偏移增量写 anchorOffset（applyAnchor 重建会覆盖 position）
    if (uiTf.anchor) {
      uiTf.anchorOffset = [
        uiTf.anchorOffset[0] + (cx - actor.position.x),
        uiTf.anchorOffset[1] + (cy - actor.position.y),
      ]
      uiTf.applyAnchor()
    } else {
      actor.setPosition(cx, cy, actor.position.z)
    }
  }

  // ═════════════════════════════════════════
  //  鼠标输入（点击拾取 / 节点拖动 / 把手拖拽 / 平移 / 滚轮缩放）
  // ═════════════════════════════════════════

  private setupMouse(): void {
    const canvas = this.renderer.domElement
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    canvas.addEventListener('mouseleave', () => {
      if (this.draggingCornerIndex === null) canvas.style.cursor = ''
    })

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) {
        if (e.button === 2) {
          this.isLeftDown = false
          this.prevMouseX = e.clientX
          this.prevMouseY = e.clientY
        }
        return
      }
      // 1. 把手拖拽
      const handleIndex = this.pickCornerHandle(e)
      if (handleIndex >= 0) {
        this.draggingCornerIndex = handleIndex
        const box = this.getBoundsBox()
        const minX = box.min.x, maxX = box.max.x, minY = box.min.y, maxY = box.max.y
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
        const pts: [number, number][] = [
          [minX, maxY], [maxX, maxY], [minX, minY], [maxX, minY],
          [cx, maxY], [maxX, cy], [cx, minY], [minX, cy],
        ]
        const opp = [3, 2, 1, 0, 6, 7, 4, 5]
        this.cornerDragWorld.set(pts[handleIndex][0], pts[handleIndex][1], 0)
        this.cornerFixedWorld.set(pts[opp[handleIndex]][0], pts[opp[handleIndex]][1], 0)
        this.cornerStartClientX = e.clientX
        this.cornerStartClientY = e.clientY
        const uiTf = this.boundsTarget!.getComponent(UITransformComponent)
        if (uiTf) this.cornerStartSize = uiTf.getWorldSize()
        return
      }
      // 2. 节点拖动（点中当前选中节点范围）
      if (this.boundsTarget && this.pickBoundsTargetMesh(e)) {
        this.draggingActor = this.boundsTarget
        this.dragStartClientX = e.clientX
        this.dragStartClientY = e.clientY
        this.dragStartActorPos.copy(this.boundsTarget.position)
        const uiTf = this.boundsTarget.getComponent(UITransformComponent)
        this.dragViaAnchorOffset = !!uiTf && !!uiTf.anchor
        this.dragStartOffset = uiTf ? [...uiTf.anchorOffset] : [0, 0]
        this.potentialClick = false
        logger.info(`[RuntimeUIEditor] 开始拖动节点: ${this.boundsTarget.name}${this.dragViaAnchorOffset ? '（锚点 → anchorOffset）' : ''}`)
        return
      }
      // 3. 进入平移/点击拾取状态
      this.isLeftDown = true
      this.potentialClick = true
      this.pressX = e.clientX
      this.pressY = e.clientY
      this.prevMouseX = e.clientX
      this.prevMouseY = e.clientY
    })

    window.addEventListener('mousemove', (e) => {
      // 光标提示
      if (this.draggingCornerIndex !== null) {
        canvas.style.cursor = CORNER_CURSORS[this.draggingCornerIndex] ?? ''
      } else {
        const hoverHandle = this.boundsTarget ? this.pickCornerHandle(e) : -1
        canvas.style.cursor = hoverHandle >= 0 ? (CORNER_CURSORS[hoverHandle] ?? '') : ''
      }

      // 把手拖拽
      if (this.draggingCornerIndex !== null && this.boundsTarget) {
        this.resizeBoundsByCorner(this.draggingCornerIndex, this.cornerStartClientX, this.cornerStartClientY, e.clientX, e.clientY)
        notifySelectionChange()
        return
      }

      // 节点拖动
      if (this.draggingActor) {
        const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
        const dx = (e.clientX - this.dragStartClientX) * worldPerPx
        const dy = -(e.clientY - this.dragStartClientY) * worldPerPx
        if (this.dragViaAnchorOffset) {
          const uiTf = this.draggingActor.getComponent(UITransformComponent)
          if (uiTf) {
            uiTf.anchorOffset = [this.dragStartOffset[0] + dx, this.dragStartOffset[1] + dy]
            uiTf.applyAnchor()
          }
        } else {
          this.draggingActor.setPosition(
            this.dragStartActorPos.x + dx,
            this.dragStartActorPos.y + dy,
            this.dragStartActorPos.z,
          )
        }
        notifySelectionChange()
        return
      }

      // 移动超过阈值 → 取消点击（转为平移）
      if (this.isLeftDown && this.potentialClick) {
        const dx = e.clientX - this.pressX
        const dy = e.clientY - this.pressY
        if (Math.hypot(dx, dy) > 4) this.potentialClick = false
      }

      if (!this.isLeftDown) return
      const dx = e.clientX - this.prevMouseX
      const dy = e.clientY - this.prevMouseY
      this.prevMouseX = e.clientX
      this.prevMouseY = e.clientY

      // 左键平移（按 zoom 换算，1:1）
      const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
      this.camera.position.x -= dx * worldPerPx
      this.camera.position.y += dy * worldPerPx
    })

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return
      this.isLeftDown = false
      if (this.draggingCornerIndex !== null) {
        this.draggingCornerIndex = null
        notifySelectionChange()
      } else if (this.draggingActor) {
        logger.info(`[RuntimeUIEditor] 结束拖动节点: ${this.draggingActor.name}`)
        this.draggingActor = null
        notifySelectionChange()
      } else if (this.potentialClick) {
        this.potentialClick = false
        const actor = this.pickActor(e)
        this.selectActor(actor)
      }
    })

    // 滚轮缩放（正交相机 zoom）
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.camera.zoom *= 1 - e.deltaY * 0.001
      this.camera.zoom = Math.max(0.1, Math.min(20, this.camera.zoom))
      this.camera.updateProjectionMatrix()
    }, { passive: false })
  }

  // ═════════════════════════════════════════
  //  相机适配
  // ═════════════════════════════════════════

  /**
   * 按 UI 根画布 9.6×5.4 contain 适配相机（与游戏 UICamera 同语义）：
   * 完整显示整个画布，居中，多余空间留空（不裁切）。这是 UIScene 点击拾取
   * 与 gizmo 对齐的基础——若按「固定高度+aspect 扩宽」适配，竖长容器会把
   * 9.6 宽画布裁掉大半，点击位置与 UI 元素对不上、gizmo 也显示不出来。
   */
  private fitToCanvas(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    const scale = Math.min(w / UI_CANVAS_W, h / UI_CANVAS_H)
    const halfW = w / scale / 2
    const halfH = h / scale / 2
    this.camera.left = -halfW
    this.camera.right = halfW
    this.camera.top = halfH
    this.camera.bottom = -halfH
    this.camera.zoom = 1
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateProjectionMatrix()
  }

  resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return
    // contain 模式重算视锥（保持画布 9.6×5.4 完整可见，宽高比变化时同步）
    this.fitToCanvas()
    this.renderer.setSize(width, height)
  }

  // ═════════════════════════════════════════
  //  渲染循环
  // ═════════════════════════════════════════

  private start(): void {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      if (this.contextLost) {
        this.animationId = requestAnimationFrame(animate)
        return
      }
      const dt = (time - this.lastTime) / 1000
      this.lastTime = time

      // 更新选中辅助（包围盒/把手/锚点跟随目标）
      if (this.boundsTarget) {
        this.updateSelectionHelpers()
      }

      // 第 1 层：UI 场景（game world 的 ui.scene）— 仅在已挂接 world 时
      const uiScene = this._world?.ui.scene
      if (uiScene) {
        this.renderer.render(uiScene, this.camera)
      } else {
        this.renderer.clear()
      }

      // 第 2 层：编辑器覆盖层（gizmo/包围盒/把手）— 始终最顶层
      if (this.overlayScene.children.length > 0) {
        const prevAutoClear = this.renderer.autoClear
        this.renderer.autoClear = false
        this.renderer.clearDepth()
        this.renderer.render(this.overlayScene, this.camera)
        this.renderer.autoClear = prevAutoClear
      }

      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  /** 每帧更新选中辅助（位置同步 + worldPerPx 同步） */
  private updateSelectionHelpers(): void {
    if (!this.boundsTarget) return
    const box = this.getBoundsBox()
    const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom

    // 更新命中把手位置（与 boundsGizmo 内部把手一致）
    if (this.cornerHandleGroup) {
      const cx = (box.min.x + box.max.x) / 2
      const cy = (box.min.y + box.max.y) / 2
      const pts: [number, number][] = [
        [box.min.x, box.max.y], [box.max.x, box.max.y],
        [box.min.x, box.min.y], [box.max.x, box.min.y],
        [cx, box.max.y], [box.max.x, cy],
        [cx, box.min.y], [box.min.x, cy],
      ]
      const sizes: [number, number][] = [
        [2.5, 2.5], [2.5, 2.5], [2.5, 2.5], [2.5, 2.5],
        [1.75, 1.75], [1.75, 1.75], [1.75, 1.75], [1.75, 1.75],
      ]
      for (let i = 0; i < this.cornerHandles.length; i++) {
        const h = this.cornerHandles[i]
        h.visible = true
        h.position.set(pts[i][0], pts[i][1], 0.02)
        h.scale.set(sizes[i][0] * worldPerPx, sizes[i][1] * worldPerPx, 1)
      }
    }

    // 委托给 gizmo 自更新（位置/缩放/标签同步）
    this.anchorGizmo.update(worldPerPx)
    this.boundsGizmo.update(worldPerPx)
    // 首次（boundsTarget 刚设置时）打印一次辅助状态，确认链路完整：
    // 锚点/范围 gizmo 的 visible + 自身 group 是否在 overlayScene 中（后续不再刷屏）
    if (!this._helperLogged) {
      this._helperLogged = true
      logger.info(
        `[RuntimeUIEditor] updateSelectionHelpers: box=(${box.min.x.toFixed(2)},${box.min.y.toFixed(2)})~(${box.max.x.toFixed(2)},${box.max.y.toFixed(2)}) ` +
        `worldPerPx=${worldPerPx.toFixed(5)} ` +
        `anchor.group.visible=${this.anchorGizmo.group.visible} bounds.group.visible=${this.boundsGizmo.group.visible} ` +
        `overlayScene.children=${this.overlayScene.children.length} ` +
        `renderer=${this.renderer.domElement.width}x${this.renderer.domElement.height}`,
      )
    }
  }

  private stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  // ═════════════════════════════════════════
  //  大纲数据
  // ═════════════════════════════════════════

  getActorTree(): SceneTreeNode[] {
    if (this._actorTreeCache) return this._actorTreeCache
    const result: SceneTreeNode[] = []
    if (!this._world) return result

    const walk = (a: Actor, depth: number) => {
      result.push({ depth, name: a.root.name || a.name, actor: a })
      for (const child of a.getChildren()) walk(child, depth + 1)
    }
    for (const a of this._world.ui.getAllUIActors()) {
      if (a.parent) continue
      walk(a, 0)
    }
    this._actorTreeCache = result
    return result
  }

  // ═════════════════════════════════════════
  //  释放
  // ═════════════════════════════════════════

  dispose(): void {
    this.stop()
    if (this._onContextLost) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost, false)
      this._onContextLost = null
    }
    if (this._onContextRestored) {
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._onContextRestored, false)
      this._onContextRestored = null
    }
    if (this._world) this.detachWorld()
    select(null)
    // 取消 gizmos 开关委托（viewportBounds 显隐由它驱动）
    this._unsubGizmosToggle?.()
    this._unsubGizmosToggle = null
    this.anchorGizmo.dispose()
    this.boundsGizmo.dispose()
    // 清理视口范围框
    if (this.viewportBounds) {
      this.overlayScene.remove(this.viewportBounds)
      this.viewportBounds.geometry.dispose()
      ;(this.viewportBounds.material as THREE.LineBasicMaterial).dispose()
      this.viewportBounds = null
    }
    // 清命中把手
    if (this.cornerHandleGroup) {
      this.overlayScene.remove(this.cornerHandleGroup)
      for (const h of this.cornerHandles) {
        h.geometry.dispose()
        ;(h.material as THREE.Material).dispose()
      }
      this.cornerHandles = []
      this.cornerHandleGroup = null
    }
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    gizmos.refresh()
  }
}
