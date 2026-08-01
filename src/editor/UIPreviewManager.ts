/**
 * UIPreviewManager — UI 资产（widget）专用预览管理器
 *
 * 为 .widget.json 资产提供 2D 正面预览（模仿运行时 UICamera 的正交渲染）：
 *  - 独立 THREE.Scene + OrthographicCamera（Z 正对 UI，无透视变形）
 *  - 专用 WebGLRenderer（无光照/网格辅助——UI 用 MeshBasicMaterial 不需要光照）
 *  - 交互：左键/右键平移 · 滚轮缩放（调 zoom）· WASD 平面平移
 *  - 内置 World + UIManager 实例化 widget 蓝图
 *  - fitToActor 只以根 Actor 直接挂载的画布 mesh 为基准（忽略子文本过大的 worldWidth）
 *  - 自动清理（dispose）
 *
 * 与 BlueprintPreviewManager 保持同一套公开接口（loadBlueprint / getActorTree /
 * collectSaveData / selectActor / focusActor / activate / resize / dispose），
 * 便于 BlueprintEditor 与 Outline 无缝切换使用。
 */
import * as THREE from 'three'
import { World } from '../engine'
import { logger } from '../engine'
import { BlueprintRegistry } from '../engine'
import { Actor } from '../engine/gameplay/entity/Actor'
import { CanvasUIComponent } from '../engine/gameplay/rendering/CanvasUIComponent'
import { UITransformComponent } from '../engine/gameplay/ui/UITransformComponent'
import { select, notifySelectionChange } from './SelectionManager'
import { TransformGizmo } from './TransformGizmo'
import { AssetPreviewManager } from './AssetPreviewManager'
import type { SceneTreeNode } from './SelectionManager'

export class UIPreviewManager {
  readonly scene: THREE.Scene
  /** 编辑器覆盖层：gizmo / 选中包围盒 / 把手 / 标签专用。渲染顺序在主场景和 UI 场景之后，永远最顶层 */
  readonly overlayScene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World
  readonly gizmo: TransformGizmo

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  private _currentWidgetPath: string | null = null

  /** 当前预览 widget JSON 的可变深拷贝。loadWidget 时建立，collectSaveData 据此生成保存数据。 */
  private _jsonTree: Record<string, unknown> | null = null

  /** Actor → JSON 节点映射（以对象引用为 key），由 loadWidget 在 spawn 后构建 */
  private _actorJsonMap: Map<Actor, Record<string, unknown>> | null = null

  /** 大纲树缓存：结构不变时复用 */
  private _actorTreeCache: SceneTreeNode[] | null = null

  // ─── 输入状态 ───
  private isLeftDown = false
  private isRightDown = false
  private prevMouseX = 0
  private prevMouseY = 0
  // ─── 点击判定：按下后移动超过阈值才算平移，否则 mouseup 时视为点击拾取 ───
  private potentialClick = false
  private pressX = 0
  private pressY = 0

  // ─── WASD ───
  private wasdKeys = new Set<string>()
  private wasdSpeed = 5

  // ─── 树变化回调 ───
  private _onChangeCallbacks: Array<() => void> = []

  // ─── 选中包围盒（显示当前节点的大小范围）───
  private boundsHelper: THREE.BoxHelper | null = null
  private boundsLabel: THREE.Sprite | null = null
  private boundsTarget: Actor | null = null
  private boundsCanvas = document.createElement('canvas')
  private boundsCtx: CanvasRenderingContext2D

  // ─── 包围盒 4 角拖拽把手（拖动实时调整范围大小）───
  private cornerHandleGroup: THREE.Group | null = null
  private cornerHandles: THREE.Mesh[] = []
  private draggingCornerIndex: number | null = null
  private dragCenter = new THREE.Vector3()
  private raycaster = new THREE.Raycaster()
  private _mouseWorld = new THREE.Vector3()
  private _ndc = new THREE.Vector2()

  // ─── 节点拖动（选中节点后，在节点范围内按住左键拖动调整位置）───
  private draggingActor: Actor | null = null
  private dragStartWorld = new THREE.Vector3()
  private dragStartActorPos = new THREE.Vector3()

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

    // ─── 渲染器 ───
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)

    // ─── 场景 ───
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)

    // ─── 编辑器覆盖层：gizmo/包围盒/把手挂这里，渲染永远在 UI 之上 ───
    this.overlayScene = new THREE.Scene()

    // ─── 正交相机：Z 正对 UI，世界坐标与视口 1:1 ───
    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.OrthographicCamera(-aspect * 5, aspect * 5, 5, -5, 0.1, 200)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)

    // ─── 输入 ───
    this.setupMouse()

    // ─── TransformGizmo（挂覆盖层，保证始终在 UI 之上）───
    this.gizmo = new TransformGizmo()
    this.gizmo.setup(this.overlayScene, this.camera, this.renderer)

    // ─── 选中包围盒（大小范围显示）───
    this.boundsCanvas.width = 512
    this.boundsCanvas.height = 96
    this.boundsCtx = this.boundsCanvas.getContext('2d')!

    // ─── World ───
    this.world = new World(this.scene)

    // ─── 启动渲染循环 ───
    this.start()
  }

  /** 处理 WASD 按键按下 */
  onWASDKeyDown(key: string) {
    this.wasdKeys.add(key.toLowerCase())
  }

  /** 处理 WASD 按键释放 */
  onWASDKeyUp(key: string) {
    this.wasdKeys.delete(key.toLowerCase())
  }

  /** 清除所有按键状态 */
  clearWASDKeys() {
    this.wasdKeys.clear()
  }

  /** 外部调用：保存后恢复摄像机位姿（UI 模式四元数恒为正面，主要恢复位置） */
  restoreCamera(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.camera.position.copy(pos)
    this.camera.quaternion.copy(quat)
  }

  private setupMouse() {
    const canvas = this.renderer.domElement

    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // 优先检测包围盒角把手（命中则进入拖拽，不再触发平移/点击）
        const handleIndex = this.pickCornerHandle(e)
        if (handleIndex >= 0) {
          this.draggingCornerIndex = handleIndex
          const box = new THREE.Box3().setFromObject(this.boundsTarget!.root)
          box.getCenter(this.dragCenter)
          return
        }
        // 其次：点中当前选中节点的范围 → 进入节点拖动（调整位置）
        if (this.boundsTarget && this.pickBoundsTargetMesh(e)) {
          this.draggingActor = this.boundsTarget
          this.dragStartWorld.copy(this.mouseToWorld(e))
          this.dragStartActorPos.copy(this.boundsTarget.position)
          this.potentialClick = false
          logger.info(`[UIPreview] 开始拖动节点: ${this.boundsTarget.name}`)
          return
        }
        this.isLeftDown = true
        this.potentialClick = true
        this.pressX = e.clientX
        this.pressY = e.clientY
        this.prevMouseX = e.clientX
        this.prevMouseY = e.clientY
      }
      if (e.button === 2) {
        this.isRightDown = true
        this.prevMouseX = e.clientX
        this.prevMouseY = e.clientY
      }
    })

    window.addEventListener('mousemove', (e) => {
      // 角把手拖拽：实时调整范围大小（以中心为基准，把手跟随鼠标）
      if (this.draggingCornerIndex !== null && this.boundsTarget) {
        const world = this.mouseToWorld(e)
        this.resizeBoundsByCorner(this.draggingCornerIndex, world.x, world.y)
        return
      }

      // 节点拖动：实时移动选中节点位置（跟随鼠标世界坐标位移）
      if (this.draggingActor) {
        const world = this.mouseToWorld(e)
        this.draggingActor.setPosition(
          this.dragStartActorPos.x + (world.x - this.dragStartWorld.x),
          this.dragStartActorPos.y + (world.y - this.dragStartWorld.y),
          this.dragStartActorPos.z,
        )
        // 通知 Inspector/选中状态实时刷新（包围盒由渲染循环 updateBounds 每帧跟随）
        notifySelectionChange()
        return
      }

      // 移动超过阈值 → 取消点击判定（转为平移）
      if (this.isLeftDown && this.potentialClick) {
        const dx = e.clientX - this.pressX
        const dy = e.clientY - this.pressY
        if (Math.hypot(dx, dy) > 4) this.potentialClick = false
      }

      if (!this.isLeftDown && !this.isRightDown) return

      const dx = e.clientX - this.prevMouseX
      const dy = e.clientY - this.prevMouseY
      this.prevMouseX = e.clientX
      this.prevMouseY = e.clientY

      // UI 模式：左键/右键均为平移（保持正面观察）
      const panSpeed = 0.03
      this.camera.position.x -= dx * panSpeed
      this.camera.position.y += dy * panSpeed
    })

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isLeftDown = false
        if (this.draggingCornerIndex !== null) {
          // 拖拽结束：把手回位并通知变更（保存按钮/大纲刷新）
          this.draggingCornerIndex = null
          this.notifyChange()
        } else if (this.draggingActor) {
          // 节点拖动结束：通知变更（保存按钮/大纲刷新）
          logger.info(`[UIPreview] 结束拖动节点: ${this.draggingActor.name} → (${this.draggingActor.position.x.toFixed(2)}, ${this.draggingActor.position.y.toFixed(2)}, ${this.draggingActor.position.z.toFixed(2)})`)
          this.draggingActor = null
          this.notifyChange()
        } else if (this.potentialClick) {
          // 点击拾取：命中 UI 元素则选中，空白处取消选中
          this.potentialClick = false
          const actor = this.pickActor(e)
          this.selectActor(actor)
        }
      }
      if (e.button === 2) this.isRightDown = false
    })

    // 滚轮缩放（正交相机调 zoom）
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.camera.zoom *= 1 - e.deltaY * 0.001
      this.camera.zoom = Math.max(0.1, Math.min(20, this.camera.zoom))
      this.camera.updateProjectionMatrix()
    }, { passive: false })
  }

  /** 射线检测 4 角把手，返回命中下标（-1 = 未命中） */
  private pickCornerHandle(e: MouseEvent): number {
    if (!this.boundsTarget || this.cornerHandles.length === 0) return -1
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this._ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.cornerHandles, false)
    if (hits.length === 0) return -1
    return this.cornerHandles.indexOf(hits[0].object as THREE.Mesh)
  }

  /** 检测鼠标是否命中当前选中节点（boundsTarget）范围内的 mesh（用于节点拖动判定） */
  private pickBoundsTargetMesh(e: MouseEvent): boolean {
    if (!this.boundsTarget) return false
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this._ndc, this.camera)
    // 收集选中节点 root 下的所有 mesh（画布/图片/按钮/文本均为 mesh）
    const meshes: THREE.Object3D[] = []
    this.boundsTarget.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj)
    })
    if (meshes.length === 0) return false
    const hits = this.raycaster.intersectObjects(meshes, false)
    return hits.length > 0
  }

  /** 鼠标屏幕坐标 → 世界坐标（z=0 平面，正交相机投影方向平行 z 轴，直接取 unproject 的 x/y） */
  private mouseToWorld(e: MouseEvent): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    return this._mouseWorld.set(this._ndc.x, this._ndc.y, 0).unproject(this.camera)
  }

  /**
   * 点击拾取 UI 元素：raycast 命中 mesh → 向上找到所属 Actor。
   * 命中多个时取 distance 最近的（zOrder 大的 panel z 更靠前，距离更近），
   * 即视觉上最前面的元素。未命中返回 null。
   */
  private pickActor(e: MouseEvent): Actor | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this._ndc, this.camera)

    // 收集所有 Actor root 下的 Mesh，建立 mesh → actor 映射
    const meshes: THREE.Mesh[] = []
    const actorByMesh = new Map<THREE.Object3D, Actor>()
    for (const actor of this.world.GetAllActors()) {
      actor.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes.push(obj as THREE.Mesh)
          actorByMesh.set(obj, actor)
        }
      })
    }
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    logger.info(`[UIPreview] 点击拾取: ${hits[0].object.name || 'mesh'} → ${actorByMesh.get(hits[0].object)?.name ?? '?'}`)
    return actorByMesh.get(hits[0].object) ?? null
  }

  /** 按角把手下标 + 鼠标世界坐标调整范围大小（保持中心不变） */
  private resizeBoundsByCorner(cornerIndex: number, wx: number, wy: number) {
    const ui = this.boundsTarget!.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
    if (!ui) return
    const uiTf = this.boundsTarget!.getComponent(UITransformComponent)
    if (!uiTf) return
    // 角方向因子：TL/TR/BL/BR
    const fx = cornerIndex === 0 || cornerIndex === 2 ? -1 : 1
    const fy = cornerIndex === 0 || cornerIndex === 1 ? 1 : -1
    const newW = Math.max(0.1, Math.abs(wx - this.dragCenter.x) * 2)
    const newH = Math.max(0.1, Math.abs(wy - this.dragCenter.y) * 2)
    // 尺寸权威在 uitransform：设置尺寸 + 重算锚点位置（保持锚点语义）
    uiTf.setWorldSize(newW, newH)
    uiTf.applyAnchor()
    void fx
    void fy
  }

  // ═══════════════════════════════════
  //  widget 加载
  // ═══════════════════════════════════

  /** 加载 widget 蓝图到预览场景（与 BlueprintPreviewManager.loadBlueprint 同接口） */
  loadBlueprint(path: string): boolean {
    this.clearPreview()

    // 持有蓝图 JSON 的可变深拷贝
    const asset = BlueprintRegistry.get(path)
    this._jsonTree = asset ? (JSON.parse(JSON.stringify(asset)) as Record<string, unknown>) : null

    const actor = this.world.SpawnActorFromBlueprint(path, undefined)
    if (!actor) {
      logger.warn(`[UIPreview] SpawnActorFromBlueprint("${path}") 失败`)
      return false
    }

    // 构建 Actor.uid → JSON 节点映射（跳过 ref 实例，它们属于另一文件）
    if (!this._jsonTree) return false
    this._actorJsonMap = new Map()
    const buildMapping = (a: Actor, jsonNode: Record<string, unknown>) => {
      this._actorJsonMap!.set(a, jsonNode)
      const childActors = a.getChildren().filter((c) => !c.isRefInstance)
      const jsonChildren = (jsonNode.children as Array<Record<string, unknown>> | undefined) ?? []
      for (let i = 0; i < Math.min(childActors.length, jsonChildren.length); i++) {
        buildMapping(childActors[i], jsonChildren[i])
      }
    }
    buildMapping(actor, this._jsonTree)

    this.world.BeginPlay()
    this.world.manualTick(0)

    this._currentWidgetPath = path

    this.fitToWidget(actor.root)
    this.notifyChange()

    logger.info(`[UIPreview] 加载 UI 资产预览: ${path}`)
    return true
  }

  clearPreview() {
    select(null)
    this.gizmo.detach()
    this.world.DestroyAllActors()
    this._currentWidgetPath = null
    this._jsonTree = null
    this._actorJsonMap = null
    this._actorTreeCache = null
    this.notifyChange()
  }

  get currentWidgetId(): string | null {
    return this._currentWidgetPath
  }

  /** 兼容 Outline 的 currentBlueprintId 访问 */
  get currentBlueprintId(): string | null {
    return this._currentWidgetPath
  }

  getActorTree(): SceneTreeNode[] {
    if (this._actorTreeCache) return this._actorTreeCache

    const result: SceneTreeNode[] = []

    function walk(obj: THREE.Object3D, depth: number) {
      if (!obj.visible && obj.type !== 'Scene') return
      if (obj.name === 'TransformGizmo' || obj.name === '__bp_focus_marker__') return

      const isRoot = obj.type === 'Scene'
      if (!isRoot) {
        const actorRef = (obj as any).userData?.actorRef as Actor | undefined
        if (!actorRef) return
        result.push({
          depth,
          name: obj.name || obj.type,
          actor: actorRef,
        })
        if (actorRef.isRefInstance) return
      }

      const nextDepth = isRoot ? depth : depth + 1
      for (const child of obj.children) {
        walk(child, nextDepth)
      }
    }

    walk(this.scene, 0)
    // UI 独立场景（widget Actor 挂载于此，与主场景分离，由 UIManager 持有）
    walk(this.world.ui.scene, 0)
    this._actorTreeCache = result
    return result
  }

  /**
   * 收集保存数据：遍历大纲 Actor，通过 _actorJsonMap 把实时 transform 回写到各 Actor
   * 对应的 JSON 节点，返回一份干净的深拷贝供写入磁盘。
   */
  collectSaveData(): Record<string, unknown> | null {
    if (!this._jsonTree || !this._actorJsonMap) return null

    for (const treeNode of this.getActorTree()) {
      const actor = treeNode.actor
      const jsonNode = actor ? this._actorJsonMap.get(actor) : undefined
      if (!actor || !jsonNode) continue
      jsonNode.position = [actor.position.x, actor.position.y, actor.position.z]
      jsonNode.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
      jsonNode.scale = [actor.scale.x, actor.scale.y, actor.scale.z]

      // 范围大小：从 uitransform 读取实时世界尺寸，回写到 JSON 的 uitransform 节点（角把手拖拽的结果可保存）
      const uiTf = actor.getComponent(UITransformComponent)
      if (!uiTf) continue
      const jsonComps = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
      const target = jsonComps.find((c) => c.baseClass === 'uitransform')
      if (target) {
        const [ww, wh] = uiTf.getWorldSize()
        const props = (target.properties ?? {}) as Record<string, unknown>
        props.worldWidth = ww
        props.worldHeight = wh
      }
    }

    return JSON.parse(JSON.stringify(this._jsonTree)) as Record<string, unknown>
  }

  /**
   * 相机适配：只以根 Actor 直接挂载的 mesh（画布/面板）为基准，
   * 子元素（文本等 worldWidth 可能过大）不参与包围盒计算。按包围盒居中 + 自适应 zoom。
   */
  private fitToWidget(root: THREE.Object3D) {
    const box = new THREE.Box3()
    let hasMesh = false
    const collect = (obj: THREE.Object3D) => {
      for (const child of obj.children) {
        if (child instanceof THREE.Mesh) {
          box.expandByObject(child)
          hasMesh = true
        }
      }
    }
    collect(root)
    // 若根无直接 mesh（如纯容器），退化为整体包围盒
    if (!hasMesh) box.setFromObject(root)

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    if (size.length() < 0.01) {
      this.camera.position.set(0, 0, 10)
      this.camera.lookAt(0, 0, 0)
      return
    }

    // 正交相机：按包围盒居中并自适应（保留 20% 边距）
    const aspect = this.container.clientWidth / this.container.clientHeight
    const maxDim = Math.max(size.x, size.y)
    const targetViewH = maxDim * 1.2
    this.camera.left = (-targetViewH * aspect) / 2
    this.camera.right = (targetViewH * aspect) / 2
    this.camera.top = targetViewH / 2
    this.camera.bottom = -targetViewH / 2
    this.camera.zoom = 1
    this.camera.position.set(center.x, center.y, 10)
    this.camera.lookAt(center)
    this.camera.updateProjectionMatrix()
  }

  resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return

    // 正交相机按宽高比调整视口水平范围
    const aspect = width / height
    const viewH = this.camera.top - this.camera.bottom
    this.camera.left = (-viewH * aspect) / 2
    this.camera.right = (viewH * aspect) / 2
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  // ═══════════════════════════════════
  //  渲染循环
  // ═══════════════════════════════════

  private start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.updateWASD(dt)
      if (this.gizmo.visible) this.gizmo.syncTransform()
      if (this.boundsTarget) this.updateBounds()
      // 第 1 层：主场景（清屏）
      this.renderer.render(this.scene, this.camera)
      // 第 2 层：UI 独立场景叠加渲染（widget Actor 与主场景分离，场景由 UIManager 持有）
      if (this.world.ui.scene) {
        const prevAutoClear = this.renderer.autoClear
        this.renderer.autoClear = false
        this.renderer.clearDepth()
        this.renderer.render(this.world.ui.scene, this.camera)
        this.renderer.autoClear = prevAutoClear
      }
      // 第 3 层：编辑器覆盖层（gizmo/包围盒/把手/标签）——始终最顶层，不被 UI 面板遮挡
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

  private stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /** WASD 平面平移（无飞行，保持正面观察） */
  private updateWASD(dt: number) {
    if (this.wasdKeys.size === 0) return

    const speed = this.wasdSpeed * dt
    if (this.wasdKeys.has('w')) this.camera.position.y += speed
    if (this.wasdKeys.has('s')) this.camera.position.y -= speed
    if (this.wasdKeys.has('a')) this.camera.position.x -= speed
    if (this.wasdKeys.has('d')) this.camera.position.x += speed
  }

  dispose() {
    this.stop()
    select(null)
    this.gizmo.dispose()
    this.detachBounds()
    if (this.boundsHelper) {
      this.overlayScene.remove(this.boundsHelper)
      this.boundsHelper.dispose()
      this.boundsHelper = null
    }
    if (this.boundsLabel) {
      this.overlayScene.remove(this.boundsLabel)
      ;(this.boundsLabel.material as THREE.SpriteMaterial).dispose()
      this.boundsLabel = null
    }
    // 清理角把手
    if (this.cornerHandleGroup) {
      this.overlayScene.remove(this.cornerHandleGroup)
      for (const h of this.cornerHandles) {
        h.geometry.dispose()
        ;(h.material as THREE.MeshBasicMaterial).dispose()
      }
      this.cornerHandles = []
      this.cornerHandleGroup = null
    }
    this.boundsTarget = null
    this.draggingCornerIndex = null
    this.world.DestroyAllActors()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this._actorJsonMap = null
    this._jsonTree = null
    this._actorTreeCache = null
    this._currentWidgetPath = null
  }

  // ═══════════════════════════════════
  //  选中 & 聚焦
  // ═══════════════════════════════════

  selectActor(actor: Actor | null) {
    if (actor) {
      select(actor)
      // UI 预览不显示坐标轴 gizmo，只显示范围包围盒（4 角可拖把手调整大小）
      this.gizmo.detach()
      this.attachBounds(actor)
    } else {
      select(null)
      this.gizmo.detach()
      this.detachBounds()
    }
  }

  // ═══════════════════════════════════
  //  选中包围盒（显示当前节点的大小范围）
  // ═══════════════════════════════════

  /** 挂载选中包围盒（线框 + 尺寸标签 + 4 角拖拽把手）到 Actor。全部挂在 overlayScene，保证不被 UI 面板遮挡 */
  private attachBounds(actor: Actor) {
    this.boundsTarget = actor
    if (!this.boundsHelper) {
      this.boundsHelper = new THREE.BoxHelper(new THREE.Object3D(), 0x00e5ff)
      const mat = this.boundsHelper.material as THREE.LineBasicMaterial
      mat.depthTest = false
      mat.depthWrite = false
      mat.transparent = true
      mat.opacity = 0.9
      this.boundsHelper.renderOrder = 998
      this.overlayScene.add(this.boundsHelper)
    }
    if (!this.boundsLabel) {
      const tex = new THREE.CanvasTexture(this.boundsCanvas)
      const mat = new THREE.SpriteMaterial({
        map: tex,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      })
      this.boundsLabel = new THREE.Sprite(mat)
      this.boundsLabel.renderOrder = 998
      this.overlayScene.add(this.boundsLabel)
    }
    this.ensureCornerHandles()
    this.updateBounds()
  }

  /** 创建/复用 4 角拖拽把手（TL/TR/BL/BR，青色方块）。挂在 overlayScene，始终在 UI 面板之上 */
  private ensureCornerHandles() {
    if (this.cornerHandleGroup) return
    const group = new THREE.Group()
    group.name = '__ui_bounds_handles__'
    const geo = new THREE.PlaneGeometry(0.22, 0.22)
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 999
      mesh.visible = false
      group.add(mesh)
      this.cornerHandles.push(mesh)
    }
    this.cornerHandleGroup = group
    this.overlayScene.add(group)
  }

  /** 移除选中包围盒 */
  private detachBounds() {
    this.draggingCornerIndex = null
    this.boundsTarget = null
    if (this.boundsHelper) this.boundsHelper.visible = false
    if (this.boundsLabel) this.boundsLabel.visible = false
    for (const h of this.cornerHandles) h.visible = false
  }

  /** 每帧更新包围盒几何与尺寸标签（跟随节点变换） */
  private updateBounds() {
    if (!this.boundsTarget || !this.boundsHelper) return
    const root = this.boundsTarget.root
    this.boundsHelper.setFromObject(root)
    this.boundsHelper.update()
    this.boundsHelper.visible = true

    // 尺寸标签：计算世界包围盒，绘制 "W × H" 文本
    if (!this.boundsLabel) return
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    // 绘制标签画布
    const ctx = this.boundsCtx
    const cw = this.boundsCanvas.width
    const ch = this.boundsCanvas.height
    ctx.clearRect(0, 0, cw, ch)
    const text = `${size.x.toFixed(2)} × ${size.y.toFixed(2)}`
    ctx.font = 'bold 40px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const tw = ctx.measureText(text).width
    ctx.fillRect(cw / 2 - tw / 2 - 14, ch / 2 - 26, tw + 28, 52)
    ctx.fillStyle = '#00e5ff'
    ctx.fillText(text, cw / 2, ch / 2)

    const tex = this.boundsLabel.material.map as THREE.CanvasTexture
    tex.needsUpdate = true

    // 标签放在包围盒右上角外侧（保持固定屏幕大小）
    const labelScale = 1.2
    this.boundsLabel.scale.set(cw / 96 * labelScale * 0.12, ch / 96 * labelScale * 0.12, 1)
    this.boundsLabel.position.set(box.max.x + 0.3, box.max.y + 0.25, 0.01)
    this.boundsLabel.visible = true

    // 4 角把手跟随包围盒顶点（TL/TR/BL/BR）
    const z = 0.02
    const corners: [number, number][] = [
      [box.min.x, box.max.y],
      [box.max.x, box.max.y],
      [box.min.x, box.min.y],
      [box.max.x, box.min.y],
    ]
    for (let i = 0; i < this.cornerHandles.length; i++) {
      this.cornerHandles[i].position.set(corners[i][0], corners[i][1], z)
      this.cornerHandles[i].visible = true
    }
  }

  /** 将本实例登记为全局活动实例（供 Outline/Inspector 读取），并通知 UI 刷新 */
  activate(assetPath?: string): void {
    if (assetPath) AssetPreviewManager.setActive(assetPath)
    this.notifyChange()
    notifySelectionChange()
  }

  focusActor(actor: Actor) {
    this.selectActor(actor)
    this.fitToWidget(actor.root)
  }

  /** 按名称查找并聚焦 */
  focusOnActor(actorName: string): boolean {
    const allActors = this.world.GetAllActors()
    for (const actor of allActors) {
      if (actor.name === actorName || actor.root.name === actorName || String(actor.blueprintRef?.id) === actorName) {
        this.focusActor(actor)
        return true
      }
    }
    logger.warn(`[UIPreview] focusOnActor("${actorName}"): 未找到匹配 Actor`)
    return false
  }
}
