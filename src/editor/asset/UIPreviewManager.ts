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
import { World, EditorActorComponent } from '../../engine'
import { PreviewObjectFactoryComponent } from '../../engine'
import { getAllActors } from '../../engine'
import { logger } from '../../engine'
import { BlueprintRegistry } from '../../engine'
import { Actor } from '../../engine/entity/Actor'
import type { ActorComponent } from '../../engine/entity/ActorComponent'
import { CanvasUIComponent } from '../../engine/rendering/CanvasUIComponent'
import { UITransformComponent } from '../../engine/ui/UITransformComponent'
import { select, notifySelectionChange } from '../SelectionManager'
import { TransformGizmo } from '../TransformGizmo'
import { AnchorGizmo } from '../AnchorGizmo'
import { AssetPreviewManager } from './AssetPreviewManager'
import { BlueprintEditorService } from '../blueprintEdit/BlueprintEditorService'
import { runOp as ops_runOp } from '../blueprintEdit/BlueprintEditorService'
import { UndoManager } from '../blueprintEdit/UndoManager'
import { editorBus } from '../EditorEvents'
import { EditorEvent } from '../EditorEventNames'
import type { BlueprintAsset, BlueprintComponentDef, BlueprintChildDef } from '../../engine'
import type { SceneTreeNode } from '../SelectionManager'
import { uniqueNodeName, nextChildId, reassignChildIds } from '../blueprintEdit/nodeTemplates'
import { useEditorStore } from '../../stores/editorStore'

/** 磁盘路径（src/projects/...）→ 蓝图注册 key（asset/...） */
function diskPathToAssetKey(diskPath: string): string {
  const idx = diskPath.indexOf('/asset/')
  return idx >= 0 ? diskPath.slice(idx + 1) : diskPath
}

/** 把手悬停光标：0-3 角（TL/TR/BL/BR），4-7 边（T/R/B/L） */
const CORNER_CURSORS = [
  'nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize', // TL TR BL BR
  'ns-resize', 'ew-resize', 'ns-resize', 'ew-resize',           // T  R  B  L
] as const

export class UIPreviewManager {
  readonly scene: THREE.Scene
  /** 编辑器覆盖层：gizmo / 选中包围盒 / 把手 / 标签专用。渲染顺序在主场景和 UI 场景之后，永远最顶层 */
  readonly overlayScene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World
  readonly gizmo: TransformGizmo
  /** 预览对象工厂（编辑器预览独立 THREE 创建器，无 GameInstance 依赖；EndPlay 统一释放） */
  readonly previewFactory: PreviewObjectFactoryComponent
  /** UI 锚点 gizmo（Unity 风格：父容器范围 + 4 小三角形锚点图标） */
  readonly anchorGizmo: AnchorGizmo

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  /** 当前 widget 注册 key（asset/...）—— Outline/外部按 key 查找预览时使用 */
  private _currentWidgetKey: string | null = null
  /** 当前 widget 磁盘路径（src/projects/...）—— 服务层读盘/写盘/撤销时使用 */
  private _currentWidgetDiskPath: string | null = null

  /** 当前预览 widget JSON 的可变深拷贝。loadWidget 时建立，collectSaveData 据此生成保存数据。 */
  private _jsonTree: Record<string, unknown> | null = null

  /** Actor → JSON 节点映射（以对象引用为 key），由 loadWidget 在 spawn 后构建 */
  private _actorJsonMap: Map<Actor, Record<string, unknown>> | null = null

  // ─── 撤回系统（与 ScenePreviewManager 同构：内存栈 + 原地回滚，不重建预览）───
  /** 撤销栈 key（asset/...，activate 时建立；UndoManager 全局共享） */
  private _undoKey: string | null = null
  /** 撤回基准：最近一次已提交状态（独立深拷贝，防与 _jsonTree 同引用被写回污染） */
  private _lastCommitted: Record<string, unknown> | null = null

  /** 当前 widget 根 Actor（setViewportAspect 调整根画布尺寸用） */
  private _rootActor: Actor | null = null

  /** 当前视口比例（16/9 等；null = Free，不强制根画布尺寸） */
  private _viewportAspect: number | null = null

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

  // ─── WebGL 上下文丢失/恢复 ───
  private contextLost = false
  private _onContextLost: ((e: Event) => void) | null = null
  private _onContextRestored: (() => void) | null = null

  // ─── 选中包围盒（显示当前节点的大小范围）───
  private boundsHelper: THREE.BoxHelper | null = null
  private boundsLabel: THREE.Sprite | null = null
  private boundsTarget: Actor | null = null
  private boundsCanvas = document.createElement('canvas')
  private boundsCtx: CanvasRenderingContext2D

  // ─── Game 渲染视口范围框（常显）：显示放到 Game 时实际会被渲染的世界范围（= 根画布尺寸，跟随视口比例）───
  private viewportBounds: THREE.LineSegments | null = null

  // ─── 包围盒 8 把手拖拽（4 角 + 4 边中点，拖动实时调整范围大小）───
  private cornerHandleGroup: THREE.Group | null = null
  private cornerHandles: THREE.Mesh[] = []
  private draggingCornerIndex: number | null = null
  /** 角把手拖拽：按下瞬间记录的鼠标原始窗口坐标 */
  private cornerStartClientX = 0
  private cornerStartClientY = 0
  /** 角把手拖拽：按下瞬间被拖角/边的起始世界坐标（跟随鼠标） */
  private cornerDragWorld = new THREE.Vector3()
  /** 角把手拖拽：对角/对边（固定不动）的世界坐标 */
  private cornerFixedWorld = new THREE.Vector3()
  /** 角把手拖拽：按下瞬间控件起始尺寸 [w, h]（边把手保持另一维不变） */
  private cornerStartSize: [number, number] = [0, 0]
  private raycaster = new THREE.Raycaster()
  private _mouseWorld = new THREE.Vector3()
  private _ndc = new THREE.Vector2()

  // ─── 节点拖动（选中节点后，在节点范围内按住左键拖动调整位置）───
  private draggingActor: Actor | null = null
  /** 节点拖动：按下瞬间记录的鼠标原始窗口坐标（后续移动 = 当前窗口坐标 − 此值 → 世界增量） */
  private dragStartClientX = 0
  private dragStartClientY = 0
  private dragStartActorPos = new THREE.Vector3()
  /** 节点拖动：目标有锚点时改 anchorOffset（重建后 position 会被 applyAnchor 覆盖，offset 才是持久偏移） */
  private dragViaAnchorOffset = false
  /** 节点拖动：按下瞬间的 anchorOffset（锚点模式增量基准） */
  private dragStartOffset: [number, number] = [0, 0]

  /** 节点拖动：首帧移动日志标记（避免每帧刷屏，仅记录拖动起点 → 首帧目标对照） */
  private dragMovedLogged = false

  /** 本次拖拽的目标 Actor（把手改尺寸 / 节点拖动改位置，mousedown 记录、mouseup 提交后清空） */
  private pendingDragActor: Actor | null = null

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
    // 0 尺寸防御：隐藏页签（display:none）重建时容器尺寸为 0，
    // setSize(0,0) 会生成 0x0 canvas 且 aspect NaN → 切回后渲染失效。
    // 用兜底 1 尺寸创建，切回页签时 ResizeObserver/resize() 恢复真实尺寸。
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)

    // ─── World ───
    // 必须先建 World：SceneComponent 持有 actor 挂载场景，预览场景直接复用 world.scene，
    // 保证渲染/大纲遍历与 actor 挂载在同一个 THREE.Scene（否则大纲看不到节点、预览渲染为空）
    this.world = new World()

    // ─── 预览对象工厂：编辑器预览独立 THREE 创建器（不依赖 GameInstance）───
    // 组件工厂（Mesh/UI 组件等）经 ThreeObjectUtils 自动分流到本工厂，对象由本组件追踪，
    // World.Destroy → EndPlay 统一释放。每次 spawn 前置位 setCurrent（见 loadBlueprint）。
    this.previewFactory = this.world.addComponent(PreviewObjectFactoryComponent)
    PreviewObjectFactoryComponent.setCurrent(this.previewFactory)

    // ─── 场景（复用 World 的 SceneComponent 场景：actor 挂载点 = 渲染场景 = 大纲遍历场景）───
    this.scene = this.world.scene
    this.scene.background = new THREE.Color(0x1a1a2e)

    // ─── 编辑器覆盖层：gizmo/包围盒/把手挂这里，渲染永远在 UI 之上 ───
    this.overlayScene = new THREE.Scene()

    // ─── 正交相机：Z 正对 UI，世界坐标与视口 1:1 ───
    const aspect = w / h
    this.camera = new THREE.OrthographicCamera(-aspect * 5, aspect * 5, 5, -5, 0.1, 200)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)

    // ─── 输入 ───
    this.setupMouse()

    // ─── TransformGizmo（挂覆盖层，保证始终在 UI 之上）───
    this.gizmo = new TransformGizmo()
    this.gizmo.setup(this.overlayScene, this.camera, this.renderer)

    // ─── AnchorGizmo（UI 锚点：父容器范围 + 锚点图标，挂覆盖层）───
    this.anchorGizmo = new AnchorGizmo()
    this.overlayScene.add(this.anchorGizmo.group)

    // ─── 选中包围盒（大小范围显示）───
    this.boundsCanvas.width = 512
    this.boundsCanvas.height = 96
    this.boundsCtx = this.boundsCanvas.getContext('2d')!

    // ─── WebGL 上下文丢失/恢复：GPU 重置或内存不足时暂停渲染，恢复后重建纹理继续 ───
    this._onContextLost = (e: Event) => {
      e.preventDefault() // 阻止浏览器永久销毁上下文，允许后续恢复
      this.contextLost = true
      this.stop()
      logger.warn('[UIPreview] WebGL 上下文丢失，已暂停渲染，等待浏览器恢复…')
    }
    this._onContextRestored = () => {
      logger.info('[UIPreview] WebGL 上下文已恢复，重建纹理并恢复渲染')
      this.restoreAllTextures()
      this.contextLost = false
      this.start()
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false)

    // ─── 启动渲染循环 ───
    this.start()
  }

  /**
   * WebGL 上下文恢复后，GPU 上的纹理数据已全部失效。
   * 遍历所有场景（主场景 / UI 场景 / 覆盖层）的材质，将纹理标记 needsUpdate 强制重新上传。
   */
  private restoreAllTextures() {
    const scenes = [this.scene, this.overlayScene, this.world.ui.scene].filter(Boolean) as THREE.Scene[]
    for (const scene of scenes) {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        const mat = (mesh as THREE.Mesh).material
        if (!mat) return
        const mats = Array.isArray(mat) ? mat : [mat]
        for (const m of mats) {
          const anyMat = m as THREE.Material & Record<string, unknown>
          for (const key of Object.keys(anyMat)) {
            const value = anyMat[key]
            if (value instanceof THREE.Texture) {
              value.needsUpdate = true
            }
          }
        }
      })
    }
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

  /** 外部调用：保存后恢复摄像机位姿（UI 模式四元数恒为正面，主要恢复位置）+ zoom（正交缩放） */
  restoreCamera(pos: THREE.Vector3, quat: THREE.Quaternion, zoom?: number) {
    this.camera.position.copy(pos)
    this.camera.quaternion.copy(quat)
    if (zoom) {
      this.camera.zoom = zoom
      this.camera.updateProjectionMatrix()
    }
  }

  private setupMouse() {
    const canvas = this.renderer.domElement

    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    // 鼠标移出预览画布：未在拖拽时恢复默认光标
    canvas.addEventListener('mouseleave', () => {
      if (this.draggingCornerIndex === null) canvas.style.cursor = ''
    })

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // 优先检测包围盒把手（4 角 + 4 边，命中则进入拖拽，不再触发平移/点击）
        const handleIndex = this.pickCornerHandle(e)
        if (handleIndex >= 0) {
          this.draggingCornerIndex = handleIndex
          this.pendingDragActor = this.boundsTarget
          // 非对称缩放：记录被拖角/边与对角/对边（固定）的世界坐标。
          // 拖动中被拖点跟随鼠标、固定点不动 → 中心随之移动（Unity 拖拽行为）。
          // 包围盒基准统一用 uitransform 尺寸矩形（文本控件字形几何会随字号重排变化，不能用）
          const box = this.getBoundsBox()
          const minX = box.min.x, maxX = box.max.x, minY = box.min.y, maxY = box.max.y
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
          // 8 个把手位置：0-3 角（TL/TR/BL/BR），4-7 边中点（T/R/B/L）
          const pts: [number, number][] = [
            [minX, maxY], [maxX, maxY], [minX, minY], [maxX, minY],
            [cx, maxY], [maxX, cy], [cx, minY], [minX, cy],
          ]
          const opp = [3, 2, 1, 0, 6, 7, 4, 5] // 对角：TL↔BR, TR↔BL；对边：T↔B, R↔L
          this.cornerDragWorld.set(pts[handleIndex][0], pts[handleIndex][1], 0)
          this.cornerFixedWorld.set(pts[opp[handleIndex]][0], pts[opp[handleIndex]][1], 0)
          // 记录按下瞬间的鼠标原始窗口坐标与控件起始尺寸（增量式调整大小）
          this.cornerStartClientX = e.clientX
          this.cornerStartClientY = e.clientY
          const uiTf = this.boundsTarget!.getComponent(UITransformComponent)
          if (uiTf) this.cornerStartSize = uiTf.getWorldSize()
          // ⚠️ 排查日志：局部 vs 世界坐标对照——子节点局部≠世界时曾被错误地把世界坐标当局部写入导致瞬移
          const _t = this.boundsTarget!
          const _wp = _t.root.getWorldPosition(new THREE.Vector3())
          const _parent = _t.parent
          logger.info(
            `[UIPreview][把手] 按下 idx=${handleIndex} "${_t.name}" ` +
            `localPos=(${_t.position.x.toFixed(3)},${_t.position.y.toFixed(3)}) ` +
            `worldPos=(${_wp.x.toFixed(3)},${_wp.y.toFixed(3)}) ` +
            `${_parent ? `parent="${_parent.name}"` : '根'} ` +
            `anchor=${uiTf?.anchor ?? 'null'} 尺寸=${uiTf ? uiTf.getWorldSize().map((n) => n.toFixed(3)).join('x') : '?'}`,
          )
          return
        }
        // 其次：点中当前选中节点的范围 → 进入节点拖动（调整位置）
        if (this.boundsTarget && this.pickBoundsTargetMesh(e)) {
          this.draggingActor = this.boundsTarget
          this.pendingDragActor = this.boundsTarget
          // 记录按下瞬间的鼠标原始窗口坐标：后续移动 = 当前窗口坐标 − 起始坐标 → 世界增量
          this.dragStartClientX = e.clientX
          this.dragStartClientY = e.clientY
          this.dragStartActorPos.copy(this.boundsTarget.position)
          // 锚点节点：拖动偏移持久化到 anchorOffset（applyAnchor 重建会覆盖 position，offset 才能保留）。
          // stretch 全锚例外：offset 不参与定位（applyAnchor 恒填满容器 + position(0,0)），用 position 直接驱动
          const uiTf = this.boundsTarget.getComponent(UITransformComponent)
          this.dragViaAnchorOffset = !!uiTf && !!uiTf.anchor && uiTf.anchor !== 'stretch'
          this.dragStartOffset = uiTf ? [...uiTf.anchorOffset] : [0, 0]
          this.dragMovedLogged = false
          this.potentialClick = false
          // ⚠️ 排查日志：局部 vs 世界 vs 锚点状态对照（修改大小后再拖动出现瞬移时，检查此值）
          const _wp = this.boundsTarget.root.getWorldPosition(new THREE.Vector3())
          const _pw = this.boundsTarget.parent?.root.getWorldPosition(new THREE.Vector3())
          logger.info(
            `[UIPreview][拖动] 按下 "${this.boundsTarget.name}" ` +
            `anchor=${uiTf?.anchor ?? 'null'} offset=${JSON.stringify(this.dragStartOffset)} ` +
            `startLocal=(${this.dragStartActorPos.x.toFixed(3)},${this.dragStartActorPos.y.toFixed(3)}) ` +
            `world=(${_wp.x.toFixed(3)},${_wp.y.toFixed(3)}) ` +
            `${this.boundsTarget.parent ? `parentWorld=(${_pw!.x.toFixed(3)},${_pw!.y.toFixed(3)})` : '根'} ` +
            `${this.dragViaAnchorOffset ? '（锚点模式 → anchorOffset）' : '（position 模式）'}`,
          )
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
      // 悬停角把手 → resize 方向光标（拖拽中也保持）；未命中恢复默认
      if (this.draggingCornerIndex !== null) {
        canvas.style.cursor = CORNER_CURSORS[this.draggingCornerIndex] ?? ''
      } else {
        const hoverHandle = this.boundsTarget ? this.pickCornerHandle(e) : -1
        canvas.style.cursor = hoverHandle >= 0 ? (CORNER_CURSORS[hoverHandle] ?? '') : ''
      }

      // 角把手拖拽：实时调整范围大小（以中心为基准，屏幕增量 → 世界增量）
      if (this.draggingCornerIndex !== null && this.boundsTarget) {
        this.resizeBoundsByCorner(
          this.draggingCornerIndex,
          this.cornerStartClientX, this.cornerStartClientY,
          e.clientX, e.clientY,
        )
        return
      }

      // 节点拖动：实时移动选中节点位置（屏幕增量 → 世界增量，与 zoom 精确 1:1）
      if (this.draggingActor) {
        const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
        const dx = (e.clientX - this.dragStartClientX) * worldPerPx
        // 屏幕 y 向下为正，世界 y 向上为正 → 取反
        const dy = -(e.clientY - this.dragStartClientY) * worldPerPx
        // ⚠️ 排查日志：首帧移动打一次（此后高频不打），记录增量与目标状态对照
        if (!this.dragMovedLogged) {
          this.dragMovedLogged = true
          const wp = this.draggingActor.root.getWorldPosition(new THREE.Vector3())
          logger.info(
            `[UIPreview][拖动] 首帧移动 "${this.draggingActor.name}" ` +
            `增量=(Δ${dx.toFixed(3)},Δ${dy.toFixed(3)}) ` +
            `${this.dragViaAnchorOffset ? `offset→[${(this.dragStartOffset[0] + dx).toFixed(3)},${(this.dragStartOffset[1] + dy).toFixed(3)}]` : `local→(${(this.dragStartActorPos.x + dx).toFixed(3)},${(this.dragStartActorPos.y + dy).toFixed(3)})`} ` +
            `world=(${wp.x.toFixed(3)},${wp.y.toFixed(3)})`,
          )
        }
        if (this.dragViaAnchorOffset) {
          // 锚点模式：偏移增量写 anchorOffset（JSON 持久化此值），applyAnchor 重算位置使视觉跟随
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

      // UI 模式：左键/右键均为平移（保持正面观察）。
      // 平移速度按 zoom 换算：屏幕 1px 对应的世界距离 = 视口高 / 画布像素高 / zoom，
      // 保证放大后拖动与鼠标 1:1（固定 panSpeed 在 zoom 大时会导致"动一点画面飞很远"）
      const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
      this.camera.position.x -= dx * worldPerPx
      this.camera.position.y += dy * worldPerPx
    })

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isLeftDown = false
        if (this.draggingCornerIndex !== null) {
          // 拖拽结束：把手回位并通知变更（保存按钮/大纲刷新）
          // ⚠️ 排查日志：把手松手最终状态（与按下对照，检查 anchorOffset 是否已同步）
          const _n = this.boundsTarget
          const _wp = _n?.root.getWorldPosition(new THREE.Vector3())
          const uiTf = _n?.getComponent(UITransformComponent)
          logger.info(
            `[UIPreview][把手] 松手 "${_n?.name}" → ` +
            `local=(${_n?.position.x.toFixed(3)},${_n?.position.y.toFixed(3)}) ` +
            `world=(${_wp?.x.toFixed(3)},${_wp?.y.toFixed(3)}) ` +
            `offset=${JSON.stringify(uiTf?.anchorOffset ?? null)} ` +
            `尺寸=${uiTf ? uiTf.getWorldSize().map((n) => n.toFixed(3)).join('x') : '?'}`,
          )
          this.draggingCornerIndex = null
          this.notifyChange()
          this.commitPreviewEdit()                    // 松手 = 一个撤销点（同步工作副本，不写盘）
        } else if (this.draggingActor) {
          // 节点拖动结束：通知变更（保存按钮/大纲刷新）
          // ⚠️ 排查日志：节点拖动最终状态（与按下/首帧对照）
          const _n = this.draggingActor
          const _wp = _n.root.getWorldPosition(new THREE.Vector3())
          const uiTf = _n.getComponent(UITransformComponent)
          logger.info(
            `[UIPreview][拖动] 结束 "${_n.name}" → ` +
            `local=(${_n.position.x.toFixed(3)},${_n.position.y.toFixed(3)},${_n.position.z.toFixed(3)}) ` +
            `world=(${_wp.x.toFixed(3)},${_wp.y.toFixed(3)}) ` +
            `offset=${JSON.stringify(uiTf?.anchorOffset ?? null)} ` +
            `尺寸=${uiTf ? uiTf.getWorldSize().map((n) => n.toFixed(3)).join('x') : '?'}`,
          )
          this.draggingActor = null
          this.notifyChange()
          this.commitPreviewEdit()                    // 松手 = 一个撤销点（同步工作副本，不写盘）
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

  /** 拾取把手（8 个：4 角 + 4 边）。把手很小，用屏幕距离判定：把手中心投影到屏幕，与鼠标距离 < 阈值即命中 */
  private pickCornerHandle(e: MouseEvent): number {
    if (!this.boundsTarget || this.cornerHandles.length === 0) return -1
    // 强制刷新把手矩阵（不依赖渲染循环时序，保证悬停/按下瞬间矩阵是最新的）
    if (this.cornerHandleGroup) this.cornerHandleGroup.updateWorldMatrix(true, true)
    const rect = this.renderer.domElement.getBoundingClientRect()
    // 命中阈值（屏幕像素）：角 12px，边 8px（屏幕恒定，任意 zoom 下手感一致）
    const hitPx = [12, 12, 12, 12, 8, 8, 8, 8]
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < this.cornerHandles.length; i++) {
      const h = this.cornerHandles[i]
      if (!h.visible) continue
      // 把手世界位置 → 屏幕
      const wp = h.position.clone().project(this.camera)
      const sx = rect.left + (wp.x * 0.5 + 0.5) * rect.width
      const sy = rect.top + (-wp.y * 0.5 + 0.5) * rect.height
      const dist = Math.hypot(e.clientX - sx, e.clientY - sy)
      if (dist <= hitPx[i] && dist < bestDist) {
        best = i
        bestDist = dist
      }
    }
    return best
  }

  /**
   * 选中控件包围盒基准：
   *  - UI 控件（有 uitransform）→ 用 worldWidth/worldHeight 尺寸矩形（图片/文本统一，
   *    对角固定语义成立；文本字形几何会随字号重排变化，不能作为基准）
   *  - 非 UI 节点 → 退化用几何包围盒
   */
  private getBoundsBox(): THREE.Box3 {
    const root = this.boundsTarget!.root
    const uiTf = this.boundsTarget!.getComponent(UITransformComponent)
    if (uiTf) {
      const [ww, wh] = uiTf.getWorldSize()
      if (ww > 0 && wh > 0) {
        // 必须用世界位置：子节点（如按钮内的文本）root.position 是局部坐标，
        // 父节点移动后局部≠世界，包围盒会画在父移动前的位置
        root.updateWorldMatrix(true, true)
        const p = root.getWorldPosition(new THREE.Vector3())
        return new THREE.Box3(
          new THREE.Vector3(p.x - ww / 2, p.y - wh / 2, -1),
          new THREE.Vector3(p.x + ww / 2, p.y + wh / 2, 1),
        )
      }
    }
    return new THREE.Box3().setFromObject(root)
  }

  /** 用指定 box 直接更新线框包围盒顶点（BoxHelper 内部顶点顺序） */
  private setBoundsHelperBox(box: THREE.Box3) {
    if (!this.boundsHelper) return
    const position = this.boundsHelper.geometry.attributes.position as THREE.BufferAttribute
    const a = position.array as Float32Array
    const min = box.min, max = box.max
    a[0] = max.x; a[1] = max.y; a[2] = max.z
    a[3] = min.x; a[4] = max.y; a[5] = max.z
    a[6] = min.x; a[7] = min.y; a[8] = max.z
    a[9] = max.x; a[10] = min.y; a[11] = max.z
    a[12] = max.x; a[13] = max.y; a[14] = min.z
    a[15] = min.x; a[16] = max.y; a[17] = min.z
    a[18] = min.x; a[19] = min.y; a[20] = min.z
    a[21] = max.x; a[22] = min.y; a[23] = min.z
    position.needsUpdate = true
    this.boundsHelper.geometry.computeBoundingSphere()
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
    // 有 mesh 才做精确射线命中；纯容器节点（markerOnly 无位图画布，如滚动列表
    // GM_CmdList）没有任何 mesh，不能因 meshes 为空直接 return false——
    // 下方 worldSize 矩形宽松判定才是这类节点的拖动入口（包围盒可见即可拖）
    if (meshes.length > 0) {
      const hits = this.raycaster.intersectObjects(meshes, false)
      if (hits.length > 0) return true
    }

    // 宽松命中：raycast 未命中（如 troika 矢量文本字形之间有间隙、笔画区域很小）时，
    // 用控件自身的世界尺寸矩形（uitransform worldWidth/worldHeight）投影到屏幕 + padding 判定，
    // 保证文本控件在文字整体区域（含间隙与周边空白）内都能拖动，而不是误判为相机平移
    this.boundsTarget.root.updateWorldMatrix(true, true)
    const PAD = 8
    const uiTf = this.boundsTarget.getComponent(UITransformComponent)
    if (uiTf) {
      const [ww, wh] = uiTf.getWorldSize()
      if (ww > 0 && wh > 0) {
        // 世界位置（子节点局部坐标在父移动后会偏）
        const wp = this.boundsTarget.root.getWorldPosition(new THREE.Vector3())
        const cx = wp.x
        const cy = wp.y
        if (this.pointInScreenRect(e, rect, cx - ww / 2, cy - wh / 2, cx + ww / 2, cy + wh / 2, PAD)) {
          return true
        }
      }
    }
    // fallback：无 uitransform 或无有效尺寸时，用 mesh 几何包围盒（如纯 3D 节点）
    for (const obj of meshes) {
      const mesh = obj as THREE.Mesh
      const geo = mesh.geometry
      if (!geo) continue
      if (!geo.boundingBox) geo.computeBoundingBox()
      if (!geo.boundingBox) continue
      const box = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
      if (this.pointInScreenRect(e, rect, box.min.x, box.min.y, box.max.x, box.max.y, PAD)) {
        return true
      }
    }
    return false
  }

  /** 判断鼠标是否落在世界轴对齐矩形 [minX,minY]–[maxX,maxY] 投影到屏幕后的范围内（+padding） */
  private pointInScreenRect(
    e: MouseEvent,
    rect: DOMRect,
    minX: number, minY: number, maxX: number, maxY: number,
    pad: number,
  ): boolean {
    const corners: [number, number][] = [
      [minX, minY], [minX, maxY],
      [maxX, minY], [maxX, maxY],
    ]
    let sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity
    for (const [wx, wy] of corners) {
      this._mouseWorld.set(wx, wy, 0).project(this.camera)
      const sx = rect.left + (this._mouseWorld.x * 0.5 + 0.5) * rect.width
      const sy = rect.top + (-this._mouseWorld.y * 0.5 + 0.5) * rect.height
      sxMin = Math.min(sxMin, sx); sxMax = Math.max(sxMax, sx)
      syMin = Math.min(syMin, sy); syMax = Math.max(syMax, sy)
    }
    return e.clientX >= sxMin - pad && e.clientX <= sxMax + pad &&
           e.clientY >= syMin - pad && e.clientY <= syMax + pad
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
    for (const actor of getAllActors()) {
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

  /**
   * 把手拖拽调整范围大小（非对称：被拖点跟随鼠标，对角/对边固定不动，中心随拖点移动）。
   * 基于按下瞬间记录的起始窗口坐标 + 被拖点/固定点世界坐标做增量计算：
   *   被拖点新位置 = 起始拖点位置 + 屏幕增量→世界增量
   *   角把手（0-3）：宽高双轴缩放；边把手（4-7）：单轴缩放，另一维保持起始尺寸
   */
  private resizeBoundsByCorner(handleIndex: number, startX: number, startY: number, curX: number, curY: number) {
    // 放宽为任意 UI 组件（含 markerOnly 文本控件——troika 矢量文本无真实画布面板）
    const ui = this.boundsTarget!.getComponent(CanvasUIComponent)
    if (!ui) return
    const uiTf = this.boundsTarget!.getComponent(UITransformComponent)
    if (!uiTf) return
    // 屏幕增量 → 世界增量（当前 zoom 下 1px 对应的世界距离；屏幕 y 向下为正，世界 y 向上为正 → 取反）
    const worldPerPx = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
    const worldDx = (curX - startX) * worldPerPx
    const worldDy = -(curY - startY) * worldPerPx
    // 被拖点新位置（跟随鼠标），固定点保持不动 —— 以下 dx/dy 与 fx/fy 都是「世界坐标」
    const dx = this.cornerDragWorld.x + worldDx
    const dy = this.cornerDragWorld.y + worldDy
    const fx = this.cornerFixedWorld.x
    const fy = this.cornerFixedWorld.y
    // 角把手（0-3）双轴；边把手：R/L(5,7) 只改宽，T/B(4,6) 只改高
    const isCorner = handleIndex < 4
    const isH = handleIndex === 5 || handleIndex === 7
    const isV = handleIndex === 4 || handleIndex === 6
    const newW = isCorner || isH ? Math.max(0.1, Math.abs(dx - fx)) : this.cornerStartSize[0]
    const newH = isCorner || isV ? Math.max(0.1, Math.abs(dy - fy)) : this.cornerStartSize[1]
    // 新中心（世界坐标）：被拖轴取中点，未拖轴保持当前位置（边拖动只动一侧）。
    // 用 null 表示"此轴不修改"，避免与合法的 0 混淆。
    const worldCx = isCorner || isH ? (dx + fx) / 2 : null
    const worldCy = isCorner || isV ? (dy + fy) / 2 : null

    // 尺寸权威在 uitransform：设置尺寸（不能 applyAnchor——锚点定位会把中心拉回到贴合位置）
    uiTf.setWorldSize(newW, newH)

    // ⚠️ 关键修复：setPosition 写的是 root.position（THREE 局部坐标），
    //    而 worldCx/worldCy 来自世界坐标基准（getBoundsBox）。
    //    子节点的父在世界非原点时，直接把世界坐标当局部写 → 真实世界 = 局部 + 父世界，
    //    产生"双倍偏移"瞬移。
    //    正确做法：世界目标中心 − 父世界位置 = 要写入的局部坐标。
    let localX = this.boundsTarget!.position.x
    let localY = this.boundsTarget!.position.y
    if (worldCx !== null || worldCy !== null) {
      const parentActor = this.boundsTarget!.parent
      let parentWorldX = 0
      let parentWorldY = 0
      if (parentActor) {
        parentActor.root.updateWorldMatrix(true, false)
        const pw = parentActor.root.getWorldPosition(new THREE.Vector3())
        parentWorldX = pw.x
        parentWorldY = pw.y
      }
      if (worldCx !== null) localX = worldCx - parentWorldX
      if (worldCy !== null) localY = worldCy - parentWorldY
    }
    // ⚠️ 瞬移修复：锚点模式（非 stretch）下手动改 position 必须同步 anchorOffset，
    //    否则下次 applyAnchor（节点拖动/布局刷新）用旧 offset 重算 position → 控件瞬移。
    //    stretch/无锚点：直接 setPosition（预览自由摆放）
    if (!uiTf.syncAnchorOffset(localX, localY)) {
      this.boundsTarget!.setPosition(localX, localY, this.boundsTarget!.position.z)
    }
  }

  // ═══════════════════════════════════
  //  widget 加载
  // ═══════════════════════════════════

  /** 加载 widget 蓝图到预览场景（与 BlueprintPreviewManager.loadBlueprint 同接口）
   *  @param path     蓝图注册 key（asset/...）
   *  @param diskPath 磁盘路径（src/projects/...，可选；提交/保存经服务层时必需） */
  loadBlueprint(path: string, diskPath?: string): boolean {
    // 本次 spawn 全程使用本管理器的预览工厂（多页签并发时覆盖 current）
    PreviewObjectFactoryComponent.setCurrent(this.previewFactory)
    this.clearPreview()

    // 持有蓝图 JSON 的可变深拷贝
    const asset = BlueprintRegistry.get(path)
    this._jsonTree = asset ? (JSON.parse(JSON.stringify(asset)) as Record<string, unknown>) : null

    const actor = this.world.getComponent(EditorActorComponent)!.Instantiate(path, undefined)
    if (!actor) {
      logger.warn(`[UIPreview] SpawnActorFromBlueprint("${path}") 失败`)
      return false
    }
    this._rootActor = actor

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

    this._currentWidgetKey = path
    this._currentWidgetDiskPath = diskPath ?? null

    // 根画布尺寸由视口比例驱动：若已选过比例（非 Free），加载后立即覆盖根节点尺寸
    // （资产 JSON 里根 worldWidth/worldHeight 只是设计基准，预览时始终跟随视口）
    if (this._viewportAspect !== null) {
      this.applyViewportAspect()
    }

    this.fitToWidget(actor.root)
    // Game 渲染视口范围框：以根画布世界尺寸为范围（切换视口比例后再次更新）
    this.updateViewportBounds()
    this.notifyChange()

    logger.info(`[UIPreview] 加载 UI 资产预览: ${path}${this._currentWidgetDiskPath ? `（磁盘 ${this._currentWidgetDiskPath}）` : ''}`)
    return true
  }

  /**
   * Game 渲染视口范围框：常显白色线框（透明度 0.8），表示该 widget 放入 Game 后
   * 实际会被渲染的世界范围（= 根画布 worldWidth×worldHeight）。
   * 切换视口比例（setViewportAspect）时根画布尺寸变化，范围框自动跟随。
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
    lines.visible = false
    this.overlayScene.add(lines)
    this.viewportBounds = lines
  }

  /** 更新 Game 渲染视口范围框：尺寸 = 根画布世界尺寸（无根画布时隐藏） */
  private updateViewportBounds(): void {
    this.ensureViewportBounds()
    const lines = this.viewportBounds
    if (!lines) return
    const root = this._rootActor
    const uiTf = root?.getComponent(UITransformComponent)
    if (!root || !uiTf) {
      lines.visible = false
      return
    }
    const [ww, wh] = uiTf.getWorldSize()
    lines.scale.set(ww, wh, 1)
    // 位置跟随根 Actor：锚点定位的根（如 bottom-center 的操作栏）被偏移后参考线仍贴合
    lines.position.copy(root.root.position)
    lines.visible = true
  }

  clearPreview() {
    select(null)
    this.gizmo.detach()
    this.anchorGizmo.detach()
    this.world.DestroyAllActors()
    this._rootActor = null
    this._currentWidgetKey = null
    this._currentWidgetDiskPath = null
    this._jsonTree = null
    this._actorJsonMap = null
    this._actorTreeCache = null
    if (this.viewportBounds) this.viewportBounds.visible = false
    this.notifyChange()
  }

  /** 使 Actor 树缓存失效（World Actor 列表变化时由 watchWorldActorChanges 调用，大纲即时反映新增/销毁） */
  invalidateActorTree(): void {
    this._actorTreeCache = null
  }

  /**
   * 按视口比例调整根画布尺寸（保持高度不变，宽度 = 高度 × ratio）。
   *  - ratio：宽/高（如 16/9 ≈ 1.7778、4/3 ≈ 1.3333、21/9 ≈ 2.3333）
   *  - null = Free：不调整，沿用 widget 自带画布比例
   * 调整后递归重算所有子控件锚点（容器尺寸变化 → 锚点位置变化），并重新适配相机。
   * 根画布尺寸由视口比例驱动：资产里写死的根 worldWidth/worldHeight 仅作设计基准，
   * 预览时始终跟随比例（用户不可手改，Inspector 中根节点尺寸已禁用）。
   */
  setViewportAspect(ratio: number | null): void {
    // 记录当前比例：加载/重建 widget 时按此覆盖根画布尺寸
    this._viewportAspect = ratio
    if (ratio != null && ratio > 0) this.applyViewportAspect()
  }

  /** 应用当前记录的视口比例到根画布（无比例/无根时跳过） */
  private applyViewportAspect(): void {
    const ratio = this._viewportAspect
    const root = this._rootActor
    if (!root || ratio == null || ratio <= 0) return
    const uiTf = root.getComponent(UITransformComponent)
    if (!uiTf) return
    // 仅"全屏画布" widget 跟随视口比例（保持高度、宽度按比例）：
    //  - 真实画布 1920×1080（标准全屏设计分辨率）
    //  - markerOnly 容器根且高度 ≥ 半屏（HUD 挂点/底部工具栏根等全屏布局容器）
    // 浮层 widget（toast/tooltip 等小画布）保持设计尺寸，不参与比例缩放
    const canvas = root.getComponent(CanvasUIComponent)
    const isFullscreen = canvas
      ? (!canvas.isMarkerOnly && canvas.getSize()[0] === 1920 && canvas.getSize()[1] === 1080) ||
        (canvas.isMarkerOnly && uiTf.getWorldSize()[1] >= 2.7)
      : uiTf.getWorldSize()[1] >= 2.7
    if (!isFullscreen) return
    const [ww, wh] = uiTf.getWorldSize()
    if (wh <= 0 || Math.abs(ww - wh * ratio) < 1e-6) return
    uiTf.setWorldSize(wh * ratio, wh)
    // 容器尺寸变化：递归重算所有子控件锚点
    const applyAnchors = (a: Actor) => {
      for (const child of a.getChildren()) {
        child.getComponent(UITransformComponent)?.applyAnchor()
        applyAnchors(child)
      }
    }
    applyAnchors(root)
    this.fitToWidget(root.root)
    // 根画布尺寸已变化 → 更新 Game 渲染视口范围框
    this.updateViewportBounds()
    this.notifyChange()
    logger.info(`[UIPreview] 视口比例 ${(ratio * 100).toFixed(0)}:100 → 根画布 ${(wh * ratio).toFixed(2)}x${wh.toFixed(2)}`)
  }

  get currentWidgetId(): string | null {
    return this._currentWidgetKey
  }

  /** 兼容 Outline 的 currentBlueprintId 访问 */
  get currentBlueprintId(): string | null {
    return this._currentWidgetKey
  }

  /** 该 Actor 是否对应资产 JSON 中的节点（false = 代码生成的子节点，无法做资产级结构编辑） */
  hasJsonNode(actor: Actor): boolean {
    return this._actorJsonMap?.has(actor) ?? false
  }

  /** 返回该 Actor 对应的资产 JSON 节点（根节点/代码生成节点返回 null）。
   *  widget 子节点必有全资产唯一 id，Outline 按引用定位父节点时读取它。 */
  getJsonNodeForActor(actor: Actor): Record<string, unknown> | null {
    return this._actorJsonMap?.get(actor) ?? null
  }

  getActorTree(): SceneTreeNode[] {
    if (this._actorTreeCache) return this._actorTreeCache

    const result: SceneTreeNode[] = []

    function walk(obj: THREE.Object3D, depth: number) {
      // 可见性过滤：无 actor 的纯渲染对象不可见时跳过；有 actor 的节点始终保留显示
      // （含被 canvas active 隐藏 / 大纲眼睛 previewHidden 隐藏的节点，便于恢复选择）
      const refActor = (obj as any).userData?.actorRef as Actor | undefined
      if (!obj.visible && !refActor && obj.type !== 'Scene') return
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

      // 全屏 widget 根节点尺寸由视口比例驱动（资产里的值是设计基准）→ 不把预览推导
      // 尺寸写回资产，保持 JSON 原值，避免保存后根画布被"固化"成当前视口比例
      const uiTf = actor.getComponent(UITransformComponent)
      const rootCanvas = actor.parent === null ? actor.getComponent(CanvasUIComponent) : null
      const isFullscreenRoot = rootCanvas !== null && uiTf !== null && (
        (!rootCanvas.isMarkerOnly && rootCanvas.getSize()[0] === 1920 && rootCanvas.getSize()[1] === 1080)
        || (rootCanvas.isMarkerOnly && uiTf.getWorldSize()[1] >= 2.7)
      )

      // ─── 通用组件属性持久化：扫描每个组件可编辑属性写回 JSON ───
      const jsonCompsAll = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
      for (const comp of actor.getAllComponents() as ActorComponent[]) {
        if (!comp.persistType) continue
        // 跳过运行时自动生成的内部组件（如 UIButton 透明点击层 UIImageComponent，isClickOnly=true）：
        // 不写进资产，避免保存后出现重复 image 组件
        if ((comp as unknown as { isClickOnly?: boolean }).isClickOnly) continue
        const target = jsonCompsAll.find((c) => c.baseClass === comp.persistType)
        if (!target) continue
        const props = (target.properties ?? {}) as Record<string, unknown>
        const persist = comp.getPersistentProps()
        // 全屏根：尺寸由视口驱动，worldWidth/worldHeight 不写回（保留 JSON 设计基准值）
        if (isFullscreenRoot && comp === uiTf) {
          delete persist.worldWidth
          delete persist.worldHeight
        }
        // 合入（不删除现有键，避免丢失 JSON 中只读/代码配置的属性）
        for (const [k, v] of Object.entries(persist)) {
          props[k] = v
        }
      }

      // 组件优先：含 transform/uitransform 组件的节点，位置/旋转/缩放只写在组件 properties，
      // 顶层 position/rotation/scale 冗余字段直接删除（引擎加载时组件为权威，无需兜底）
      if (!uiTf) {
        jsonNode.position = [actor.position.x, actor.position.y, actor.position.z]
        jsonNode.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
        jsonNode.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
        continue
      }

      // 范围大小：从 uitransform 读取实时世界尺寸，回写到 JSON 的 uitransform 节点（角把手拖拽的结果可保存）
      delete jsonNode.position
      delete jsonNode.rotation
      delete jsonNode.scale
      const jsonComps = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
      const target = jsonComps.find((c) => c.baseClass === 'UITransformComponent')
      if (target) {
        const [ww, wh] = uiTf.getWorldSize()
        const props = (target.properties ?? {}) as Record<string, unknown>
        // 非全屏根：尺寸是内容设计值，可写回（角把手拖拽的结果可保存）；
        // 全屏根由视口比例驱动，已在上面通用循环跳过 worldWidth/worldHeight 写回
        if (!isFullscreenRoot) {
          props.worldWidth = ww
          props.worldHeight = wh
        }
        // tsf.properties 里的 position/rotation/scale 是最终权威：重载时 TransformComponent 构造会读取
        props.position = [actor.position.x, actor.position.y, actor.position.z]
        props.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
        props.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
      }
    }

    return JSON.parse(JSON.stringify(this._jsonTree)) as Record<string, unknown>
  }

  /**
   * 拖动/拖拽松手后调用：把本次拖拽结果作为"当前已提交状态"。
   *  - 对比基准（_lastCommitted）：内容有变化 → 基准作为动作前快照 push 进撤销栈，
   *    再更新基准为当前状态；无变化（未拖动/拖回原位）→ 不产生撤销点
   *  - 同步工作副本（updateFromPreview：不写盘、不产生撤销点、不 bump——预览已是最新，无需重建）
   *  - emit BLUEPRINT_TRANSFORM_DIRTY 刷新撤销按钮可用状态
   * target 传空时回退用 mousedown 记录的 pendingDragActor（UI 内部松手走此路径）。
   */
  async commitPreviewEdit(target?: Actor | null): Promise<void> {
    const key = this._undoKey
    if (!key) {
      logger.warn(`[UIPreview] 拖拽提交跳过（无撤销 key，activate 未调用）`)
      return
    }
    const dragged = target ?? this.pendingDragActor
    this.pendingDragActor = null
    const data = this.collectSaveData()
    if (!data) return
    if (!dragged) return
    if (this._lastCommitted === null) {
      // 无基准（理论上 activate 已建立）：以当前为基准（独立拷贝），不产生撤销点
      this._lastCommitted = JSON.parse(JSON.stringify(data))
      logger.info(`[UIPreview] 拖拽提交（首帧基准）: ${key}`)
      return
    }
    // 内容无变化（拖动后松手位置与基准一致）→ 跳过，避免空撤销点
    if (JSON.stringify(data) === JSON.stringify(this._lastCommitted)) {
      logger.info(`[UIPreview] 拖拽提交跳过（内容无变化）: ${key}`)
      return
    }
    UndoManager.push(key, this._lastCommitted)
    // 注意：基准必须独立深拷贝（防与 _jsonTree 同引用被 collectSaveData 写回污染）
    this._lastCommitted = JSON.parse(JSON.stringify(data))
    // 同步工作副本（不 bump：预览已是内存最新，重建只会浪费并丢引用）
    const diskPath = this._currentWidgetDiskPath
    if (diskPath) {
      await BlueprintEditorService.updateFromPreview(diskPath, data as unknown as BlueprintAsset)
    }
    editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, diskPath ?? '')
    logger.info(`[UIPreview] 松手提交（= 一个撤销点）: "${dragged.name}" → ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
  }

  // ════════════════════════════════════════
  //  撤回系统（拖拽提交 / undo / redo，与 ScenePreviewManager 同构：内存栈 + 原地回滚）
  // ════════════════════════════════════════

  /** 撤销/重做按钮可用状态 */
  canUndo(): boolean {
    return this._undoKey !== null && UndoManager.canUndo(this._undoKey)
  }

  canRedo(): boolean {
    return this._undoKey !== null && UndoManager.canRedo(this._undoKey)
  }

  /** 撤销：从内存栈取动作前快照 → 原地回滚（不重建预览，actor 引用/选中/相机保持）；无可撤历史返回 false */
  undo(): boolean {
    const key = this._undoKey
    if (!key || !this.canUndo()) {
      logger.warn(`[UIPreview] undo 无历史可撤: ${key ?? '无 key'}`)
      return false
    }
    const cur = this.collectSaveData() ?? this._lastCommitted
    const snap = UndoManager.undo(key, cur)
    if (snap == null) return false
    // snap 作为新基准；传入 _applySnapshotInPlace 的必须是深拷贝——原地回滚内部
    // 会把 _jsonTree 指向深拷贝快照，若与基准同引用，下次 collectSaveData
    // 原地写回又会污染基准（undo → 新编辑 → 被判"无变化"不进栈的残余路径）。
    this._lastCommitted = snap as Record<string, unknown>
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(snap)) as Record<string, unknown>)
    if (!applied) {
      // 结构变更（增删节点/重命名）：注册表回滚 + 全量重建预览
      logger.info(`[UIPreview] undo 结构变更 → 重建预览: ${key}`)
      BlueprintRegistry.loadFromJson(key, snap as unknown as import('../../engine').BlueprintAsset)
      this.loadBlueprint(key, this._currentWidgetDiskPath ?? undefined)
    }
    // 同步工作副本（不 bump）：保证服务层与预览一致（Inspector 后续 apply 不会基于旧值覆盖回滚结果）
    void this.syncWorkingCopy()
    logger.info(`[UIPreview] undo: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    return true
  }

  /** 重做：从内存栈取 redo 快照 → 原地回滚（不重建预览）；无重做历史返回 false */
  redo(): boolean {
    const key = this._undoKey
    if (!key || !this.canRedo()) {
      logger.warn(`[UIPreview] redo 无历史可重做: ${key ?? '无 key'}`)
      return false
    }
    const cur = this.collectSaveData() ?? this._lastCommitted
    const snap = UndoManager.redo(key, cur)
    if (snap == null) return false
    // 同 undo：基准与原地回滚输入必须分离（防同引用污染）
    this._lastCommitted = snap as Record<string, unknown>
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(snap)) as Record<string, unknown>)
    if (!applied) {
      logger.info(`[UIPreview] redo 结构变更 → 重建预览: ${key}`)
      BlueprintRegistry.loadFromJson(key, snap as unknown as import('../../engine').BlueprintAsset)
      this.loadBlueprint(key, this._currentWidgetDiskPath ?? undefined)
    }
    void this.syncWorkingCopy()
    logger.info(`[UIPreview] redo: ${key}（redo 栈 ${UndoManager.depth(key).redo}）`)
    return true
  }

  /** 把预览当前内存态同步进服务层工作副本（不写盘、不产生撤销点、不 bump） */
  private async syncWorkingCopy(): Promise<void> {
    const diskPath = this._currentWidgetDiskPath
    if (!diskPath) return
    const data = this.collectSaveData()
    if (!data) return
    await BlueprintEditorService.updateFromPreview(diskPath, data as unknown as BlueprintAsset)
  }

  // ════════════════════════════════════════
  //  属性编辑快速通道（服务层 applyBatch 成功后广播 → 本管理器就地应用，免销毁重建）
  // ════════════════════════════════════════

  /**
   * 就地应用一批蓝图编辑 ops（属性编辑快速通道，BlueprintEditor bump 重建的替代路径）。
   * 返回 true 表示已完整应用，BlueprintEditor 应跳过本次销毁重建；
   * 返回 false 表示无法安全就地应用（结构类 op / 未加载 / 路径不匹配），调用方走常规重建。
   *
   * 实现策略与 undo/redo 的 _applySnapshotInPlace 完全同源：
   *  - 结构类 op（增删节点/组件/重命名/replace）→ 直接回退重建（树身份变化，就地应用风险大于收益）
   *  - 属性类 op → 把 ops 逐个应用到 _jsonTree（复用服务层 runOp 同一套 ops 实现），
   *    再把 _jsonTree 整体交给 _applySnapshotInPlace 回写到活动 Actor。
   */
  applyEditOps(
    assetPath: string,
    ops: ReadonlyArray<{ op: string; params: Record<string, unknown> }>,
  ): boolean {
    const key = diskPathToAssetKey(assetPath)
    if (this._currentWidgetKey !== key || !this._jsonTree || !this._actorJsonMap) return false
    // 结构类 op：树身份会变，回退常规重建路径
    const STRUCTURAL = new Set([
      'addComponent', 'removeComponent', 'addChild', 'addChildToParent', 'addChildToParentById',
      'updateChild', 'removeChild', 'removeChildDeep', 'removeChildById',
      'renameChildDeep', 'renameChildById', 'setBaseClass', 'replace',
    ])
    if (ops.some((o) => STRUCTURAL.has(o.op))) return false
    // 属性类 op 白名单：其余 op 一律回退（含未识别 op，安全兜底）
    const PROPAGATE = new Set(['setComponentProps', 'setChildComponentProps', 'setPosition', 'setRotation', 'setScale'])
    if (!ops.every((o) => PROPAGATE.has(o.op))) return false

    const before = JSON.stringify(this._jsonTree)
    // 把 ops 逐个应用到 _jsonTree 深拷贝（与 undo/redo 的快照输入约定一致，防同引用污染）
    let tree = JSON.parse(JSON.stringify(this._jsonTree)) as Record<string, unknown>
    for (const { op, params } of ops) {
      const res = ops_runOp(tree as unknown as BlueprintAsset, op, params ?? {})
      if (!res.ok || !res.asset) {
        logger.warn(`[UIPreview] 快速通道 op 被拒（回退重建）: ${op} → ${key}: ${res.error}`)
        return false
      }
      tree = res.asset as unknown as Record<string, unknown>
    }
    if (JSON.stringify(tree) === before) {
      logger.info(`[UIPreview] 快速通道内容无变化，跳过: ${key}`)
      return true
    }
    // 原地回写到活动 Actor（复用 undo/redo 同一机制：按节点名匹配 + 组件 editableProperty set）
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(tree)))
    if (!applied) {
      logger.info(`[UIPreview] 快速通道原地应用失败（回退重建）: ${key}`)
      return false
    }
    // 撤回基准推进到应用后状态（避免 undo 栈出现"回到同一状态"的空档）
    this._lastCommitted = JSON.parse(JSON.stringify(tree))
    // 同步服务层工作副本（不写盘、不 bump）
    void this.syncWorkingCopy()
    logger.info(`[UIPreview] 快速通道就地应用 ${ops.length} ops: ${key}`)
    return true
  }


  // ════════════════════════════════════════
  //  大纲右键结构编辑（按 Actor 引用定位父节点，复用快照撤销 + bump 重建预览）
  //  与 BlueprintPreviewManager 同构：直接按 _actorJsonMap 引用改 _jsonTree，
  //  不走 name/id 二次定位，同名节点不拦截
  // ════════════════════════════════════════

  /**
   * 在目标控件下添加子控件（追加到其 children 末尾）。
   * parentActor 为根/代码生成节点 → 追加到根 children 末尾。
   * 返回新控件名；失败返回 null。一个撤销点 + bump 重建 + 自动选中新控件。
   */
  async addChildNode(
    parentActor: Actor | null,
    def: { baseName: string; baseClass: string; components: BlueprintComponentDef[]; children?: BlueprintChildDef[] },
  ): Promise<string | null> {
    if (!this._jsonTree) {
      logger.warn(`[UIPreview] addChildNode 跳过（_jsonTree 为空）`)
      return null
    }
    const parentNode = parentActor ? this._actorJsonMap?.get(parentActor) ?? null : null
    const siblings: string[] = []
    if (parentNode) {
      for (const c of (parentNode.children as Array<Record<string, unknown>> | undefined) ?? []) {
        const n = (c as { name?: string }).name
        if (n) siblings.push(n)
      }
    } else {
      for (const c of ((this._jsonTree.children as Array<Record<string, unknown>> | undefined) ?? [])) {
        const n = (c as { name?: string }).name
        if (n) siblings.push(n)
      }
    }
    const name = uniqueNodeName(def.baseName, siblings)
    // 全资产唯一 id：新控件自身 + 模板子节点（如按钮的 Frame）递归分配
    let idGen = nextChildId(this._jsonTree.children as BlueprintChildDef[] | undefined)
    const assignIds = (defs: BlueprintChildDef[] | undefined): void => {
      if (!defs) return
      for (const d of defs) {
        d.id = idGen++
        assignIds(d.children)
      }
    }
    const child: BlueprintChildDef = {
      name,
      baseClass: def.baseClass,
      id: idGen++,
      components: JSON.parse(JSON.stringify(def.components)) as BlueprintComponentDef[],
    }
    if (def.children?.length) {
      child.children = JSON.parse(JSON.stringify(def.children)) as BlueprintChildDef[]
      assignIds(child.children)
    }
    if (parentNode) {
      const children = (Array.isArray(parentNode.children) ? parentNode.children.slice() : []) as Array<Record<string, unknown>>
      children.push(child as unknown as Record<string, unknown>)
      parentNode.children = children
    } else {
      const children = (Array.isArray(this._jsonTree.children) ? this._jsonTree.children.slice() : []) as Array<Record<string, unknown>>
      children.push(child as unknown as Record<string, unknown>)
      this._jsonTree.children = children
    }
    await this.commitStructureEdit(name)
    logger.info(`[UIPreview] 添加子控件: ${parentNode ? (parentNode as { name?: string }).name ?? '?' : '(根)'} → ${name}（子节点 ${child.children?.length ?? 0} 个）`)
    return name
  }

  /** 删除控件（按 Actor 引用定位，无确认，删除后清空选中）。一个撤销点。 */
  async removeChildNode(actor: Actor): Promise<boolean> {
    const node = this._actorJsonMap?.get(actor)
    if (!node) {
      logger.warn(`[UIPreview] removeChildNode 跳过（节点无 JSON 映射）: ${actor.name}`)
      return false
    }
    if (!this._removeJsonChild(node)) {
      logger.warn(`[UIPreview] removeChildNode 跳过（找不到父数组）: ${actor.name}`)
      return false
    }
    await this.commitStructureEdit(null)
    logger.info(`[UIPreview] 删除子控件: ${(node as { name?: string }).name ?? '?'}`)
    return true
  }

  /** 深拷贝控件到其父 children 末尾（根 → 根 children 末尾），名称自动加序号。返回新控件名。 */
  async duplicateChildNode(actor: Actor): Promise<string | null> {
    const node = this._actorJsonMap?.get(actor)
    if (!node) {
      logger.warn(`[UIPreview] duplicateChildNode 跳过（节点无 JSON 映射）: ${actor.name}`)
      return null
    }
    const parentArr = this._parentChildrenArray(node)
    if (!parentArr) return null
    const clone = JSON.parse(JSON.stringify(node)) as Record<string, unknown>
    const siblings = parentArr.map((o) => (o as { name?: string }).name).filter((n): n is string => !!n)
    const newName = uniqueNodeName(((node as { name?: string }).name) || 'Copy', siblings)
    clone.name = newName
    let idGen = nextChildId(this._jsonTree?.children as BlueprintChildDef[] | undefined)
    reassignChildIds(clone as unknown as BlueprintChildDef, () => idGen++)
    parentArr.push(clone)
    await this.commitStructureEdit(newName)
    logger.info(`[UIPreview] 复制子控件: ${(node as { name?: string }).name ?? '?'} → ${newName}`)
    return newName
  }

  /** 重命名控件（按 Actor 引用定位，同父重名自动追加序号）。返回是否成功。 */
  async renameChildNode(actor: Actor, newName: string): Promise<boolean> {
    const node = this._actorJsonMap?.get(actor)
    if (!node) {
      logger.warn(`[UIPreview] renameChildNode 跳过（节点无 JSON 映射）: ${actor.name}`)
      return false
    }
    const parentArr = this._parentChildrenArray(node)
    if (!parentArr) return false
    const siblings = parentArr
      .filter((o) => o !== node)
      .map((o) => (o as { name?: string }).name)
      .filter((n): n is string => !!n)
    const finalName = uniqueNodeName(newName, siblings)
    node.name = finalName
    await this.commitStructureEdit(finalName)
    logger.info(`[UIPreview] 重命名子控件: ${(node as { name?: string }).name ?? '?'} → ${finalName}`)
    return true
  }

  /** 返回节点所在的 children 数组（根 → 根 children；找不到返回 null） */
  private _parentChildrenArray(node: Record<string, unknown>): Array<Record<string, unknown>> | null {
    if (!this._jsonTree) return null
    const rootChildren = (this._jsonTree.children as Array<Record<string, unknown>> | undefined) ?? []
    if (rootChildren.includes(node)) return rootChildren
    const find = (arr: Array<Record<string, unknown>>): Array<Record<string, unknown>> | null => {
      for (const c of arr) {
        const children = (c.children as Array<Record<string, unknown>> | undefined) ?? []
        if (children.includes(node)) return children
        const hit = find(children)
        if (hit) return hit
      }
      return null
    }
    return find(rootChildren)
  }

  /** 从所在 children 数组移除节点（返回是否找到并移除） */
  private _removeJsonChild(node: Record<string, unknown>): boolean {
    const arr = this._parentChildrenArray(node)
    if (!arr) return false
    const idx = arr.indexOf(node)
    if (idx < 0) return false
    arr.splice(idx, 1)
    return true
  }

  /**
   * 结构编辑提交：收集当前状态 → 对比基准 push 撤销点 → 同步服务层工作副本
   * （不写盘、不 bump 前撤销按钮刷新由 bump 触发）→ bump 重建预览。
   * @param selectName 重建后要选中的节点名（null = 不选中；bump 后 BlueprintEditor 消费）
   */
  private async commitStructureEdit(selectName: string | null): Promise<void> {
    const key = this._undoKey
    if (!key) {
      logger.warn(`[UIPreview] 结构编辑提交跳过（无撤销 key，activate 未调用）`)
      return
    }
    const data = this.collectSaveData()
    if (!data) return
    if (this._lastCommitted === null) {
      this._lastCommitted = JSON.parse(JSON.stringify(data))
      logger.info(`[UIPreview] 结构编辑（首帧基准）: ${key}`)
    } else if (JSON.stringify(data) === JSON.stringify(this._lastCommitted)) {
      logger.info(`[UIPreview] 结构编辑提交跳过（内容无变化）: ${key}`)
      return
    } else {
      UndoManager.push(key, this._lastCommitted)
      this._lastCommitted = JSON.parse(JSON.stringify(data))
      logger.info(`[UIPreview] 结构编辑提交（= 一个撤销点）: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    }
    const diskPath = this._currentWidgetDiskPath
    if (diskPath) {
      await BlueprintEditorService.updateFromPreview(diskPath, data as unknown as BlueprintAsset)
      if (selectName) AssetPreviewManager.setPendingSelection(diskPath, selectName)
      useEditorStore.getState().bumpBlueprintEdit(diskPath)
    }
    editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, diskPath ?? '')
  }

  /**
   * 原地回滚（纯内存，唯一应用路径）：把快照 diff 逐个应用到现有 actor
   * （不销毁、不重建，actor 引用保持 → 选中/包围盒/相机零丢失）。
   *  - 遍历 _actorJsonMap（actor → JSON 节点），按节点名在快照树里找对应节点
   *  - 组件可编辑属性：按 persistType 找快照组件，遍历 getEditableProperties() set 回写
   *  - transform：写回 position/rotation/scale（组件 TransformComponent/UITransformComponent properties 优先）
   *  - 结构不一致（节点数/节点名对不上，当前场景仅 transform/属性编辑不会触发）→ 警告，不重建
   */
  private _applySnapshotInPlace(snap: Record<string, unknown>): boolean {
    const entries = Array.from(this._actorJsonMap?.entries() ?? [])
    // 结构一致性检查：节点数一致且每个 map 节点名都能在快照树中找到唯一对应
    const snapByName = new Map<string, Record<string, unknown>>()
    const walkSnap = (node: Record<string, unknown>, depth: number): boolean => {
      const name = node.name as string | undefined
      if (name) {
        if (snapByName.has(name)) return false
        snapByName.set(name, node)
      }
      const children = (node.children as Array<Record<string, unknown>> | undefined) ?? []
      for (const c of children) {
        if (!walkSnap(c, depth + 1)) return false
      }
      return true
    }
    if (!walkSnap(snap, 0)) {
      logger.warn(`[UIPreview] 原地回滚跳过（快照节点名缺失/重复）`)
      return false
    }
    // 每个 map 节点名必须能在快照中找到唯一对应（结构与 map 一致时才回滚）
    for (const [, node] of entries) {
      const name = (node as { name?: string }).name
      if (!name || !snapByName.has(name)) {
        logger.warn(`[UIPreview] 原地回滚跳过（节点 "${name}" 在快照中缺失）`)
        return false
      }
    }
    // 逐个应用
    for (const [actor, node] of entries) {
      const jsonNode = snapByName.get((node as { name?: string }).name as string)!

      // ─── 组件可编辑属性回写：按 persistType 找快照组件，set 回写（Inspector 直改的镜像） ───
      const jsonComps = (jsonNode.components as Array<Record<string, unknown>> | undefined) ?? []
      for (const comp of actor.getAllComponents() as ActorComponent[]) {
        if (!comp.persistType) continue
        // 运行时自动生成的内部组件（透明点击层）不参与回滚
        if ((comp as unknown as { isClickOnly?: boolean }).isClickOnly) continue
        const target = jsonComps.find((c) => (c.baseClass as string | undefined) === comp.persistType)
        if (!target) continue
        const props = (target.properties ?? {}) as Record<string, unknown>
        for (const p of comp.getEditableProperties()) {
          if (p.key in props && !p.readonly) {
            try {
              p.set(props[p.key] as never)
            } catch (e) {
              logger.warn(`[UIPreview] 原地回滚属性失败 ${comp.persistType}.${p.key}: ${e}`)
            }
          }
        }
      }

      // ─── transform 回写：组件 TransformComponent/UITransformComponent properties 优先，否则顶层 position/rotation/scale ───
      const tf = jsonComps.find(
        (c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent',
      )
      const tfProps = (tf?.properties ?? {}) as Record<string, unknown>
      if (tfProps.position) {
        const pos = tfProps.position as number[]
        actor.setPosition(pos[0], pos[1], pos[2])
        const rot = tfProps.rotation as number[] | undefined
        if (rot) actor.setRotation(rot[0], rot[1], rot[2])
        const scale = tfProps.scale as number[] | undefined
        if (scale) actor.setScale(scale[0], scale[1], scale[2])
      } else if (Array.isArray(jsonNode.position)) {
        const pos = jsonNode.position as number[]
        actor.setPosition(pos[0], pos[1], pos[2])
        if (Array.isArray(jsonNode.rotation)) actor.setRotation((jsonNode.rotation as number[])[0], (jsonNode.rotation as number[])[1], (jsonNode.rotation as number[])[2])
        if (Array.isArray(jsonNode.scale)) actor.setScale((jsonNode.scale as number[])[0], (jsonNode.scale as number[])[1], (jsonNode.scale as number[])[2])
      } else if (Array.isArray(jsonNode.pos)) {
        // 旧格式：只回写 pos
        const pos = jsonNode.pos as number[]
        actor.setPosition(pos[0], pos[1], pos[2])
      }
    }
    // 同步工作副本：_jsonTree 与快照分离深拷贝（防后续 collectSaveData 原地写回污染基准）
    this._jsonTree = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>
    this._rebindJsonMap()
    // 强制刷新（hidden 页 rAF 停摆时 matrixWorld 陈旧）：重算矩阵 + 重绘一帧
    this.scene.updateMatrixWorld(true)
    if (this.world.ui.scene) this.world.ui.scene.updateMatrixWorld(true)
    if (this.boundsTarget) {
      try { this.updateBounds() } catch { }
    }
    this.renderer.render(this.scene, this.camera)
    logger.info(`[UIPreview] 原地回滚完成: ${this._undoKey}（${entries.length} 个节点）`)
    return true
  }

  /**
   * _jsonTree 被深拷贝替换后，把 _actorJsonMap 节点重新指向新树中的同名单节点。
   * 否则后续 collectSaveData 的写回仍落在旧对象上，导致拖拽/属性改动被判定为
   * "内容无变化"而不进撤销栈（第一次提交后所有编辑都会失效）。
   */
  private _rebindJsonMap(): void {
    if (!this._jsonTree || !this._actorJsonMap) {
      logger.warn(`[UIPreview] _rebindJsonMap 跳过（_jsonTree/_actorJsonMap 为空）`)
      return
    }
    let rebound = 0
    let missing = 0
    for (const [actor, node] of this._actorJsonMap) {
      const name = (node as { name?: string }).name
      if (!name) continue
      const fresh = this._findNodeByName(this._jsonTree, name)
      if (fresh) {
        this._actorJsonMap.set(actor, fresh)
        rebound++
      } else {
        missing++
      }
    }
    logger.info(`[UIPreview] _rebindJsonMap: 重绑 ${rebound} 个节点, 未找到 ${missing} 个`)
  }

  /** 在 JSON 树中按节点名查找（递归 children；name 唯一，找到即返回） */
  private _findNodeByName(node: Record<string, unknown>, name: string): Record<string, unknown> | null {
    if ((node as { name?: string }).name === name) return node
    const children = (node.children as Array<Record<string, unknown>> | undefined) ?? []
    for (const c of children) {
      const hit = this._findNodeByName(c, name)
      if (hit) return hit
    }
    return null
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
    // 同时约束纵向与横向：宽 widget（如底部操作栏 9.6×1.1）在窄容器下若只按 maxDim
    // 计算纵向视野，横向会放不下被裁剪（视口参考线左右截断）——取两者较大值。
    // 0 尺寸防御：隐藏页签（display:none）重建时容器尺寸为 0 → aspect NaN 污染
    // 正交相机 left/right/top/bottom，切回后 resize() 用 top-bottom 仍是 NaN 无法自愈。
    const cw = this.container.clientWidth || 1
    const ch = this.container.clientHeight || 1
    const aspect = cw / ch
    const targetViewH = Math.max(size.y, size.x / aspect) * 1.2
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
    // 自愈：旧实例/0 尺寸重建可能污染 top/bottom 为 NaN（fitToWidget 0 尺寸时
    // aspect 曾为 NaN）→ 重算适配，否则 left/right 永远 NaN 不渲染
    if (!Number.isFinite(viewH) || viewH <= 0) {
      this.fitToWidget(this._rootActor?.root ?? this.scene)
      return
    }
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
      // 上下文丢失期间跳过渲染，避免对失效 GL 上下文上传纹理报错
      if (this.contextLost) {
        this.animationId = requestAnimationFrame(animate)
        return
      }
      const dt = (time - this.lastTime) / 1000
      this.lastTime = time

      this.updateWASD(dt)
      if (this.gizmo.visible) this.gizmo.syncTransform()
      if (this.boundsTarget) {
        try {
          this.updateBounds()
        } catch (e) {
          // 包围盒/gizmo 更新失败不应杀死渲染循环
          logger.error(`[UIPreview] updateBounds 异常: ${String(e)}`)
        }
      }
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

  /** WASD 平面平移（无飞行，保持正面观察）。速度按 zoom 换算：以 zoom=1 为基准，放大后减速保持与鼠标操作一致 */
  private updateWASD(dt: number) {
    if (this.wasdKeys.size === 0) return

    const speed = (this.wasdSpeed / this.camera.zoom) * dt
    if (this.wasdKeys.has('w')) this.camera.position.y += speed
    if (this.wasdKeys.has('s')) this.camera.position.y -= speed
    if (this.wasdKeys.has('a')) this.camera.position.x -= speed
    if (this.wasdKeys.has('d')) this.camera.position.x += speed
  }

  dispose() {
    this.stop()
    // 移除 WebGL 上下文事件监听，避免内存泄漏
    if (this._onContextLost) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost, false)
      this._onContextLost = null
    }
    if (this._onContextRestored) {
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._onContextRestored, false)
      this._onContextRestored = null
    }
    select(null)
    this.gizmo.dispose()
    this.anchorGizmo.dispose()
    this.detachBounds()
    // 清理 Game 渲染视口范围框
    if (this.viewportBounds) {
      this.overlayScene.remove(this.viewportBounds)
      this.viewportBounds.geometry.dispose()
      ;(this.viewportBounds.material as THREE.LineBasicMaterial).dispose()
      this.viewportBounds = null
    }
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
    // 彻底销毁预览 World（含 UIManager/ActorManagerComponent 三件套自身的 reclaimForWorld），
    // 避免 tab 切换/工程切换累积泄漏 World 三件套（编辑器 lifetime 内只有一份 World）。
    // clearPreview 走 DestroyAllActors 是容器复用语义（保留 World 实例）；这是 manager 终局销毁。
    // 预览对象工厂：释放全部追踪对象 + 自清 current（幂等）
    this.previewFactory.disposeAll()
    this.world.Destroy()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this._actorJsonMap = null
    this._jsonTree = null
    this._actorTreeCache = null
    this._currentWidgetKey = null
    this._currentWidgetDiskPath = null
  }

  // ═══════════════════════════════════
  //  选中 & 聚焦
  // ═══════════════════════════════════

  selectActor(actor: Actor | null) {
    if (actor) {
      select(actor)
      // UI 预览不显示坐标轴 gizmo，只显示范围包围盒（4 角可拖把手调整大小）+ 锚点 gizmo
      this.gizmo.detach()
      this.attachBounds(actor)
      this.anchorGizmo.attach(actor)
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
      mat.opacity = 0.8
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

  /** 创建/复用 8 个拖拽把手（4 角 TL/TR/BL/BR + 4 边中点 T/R/B/L，青色）。挂在 overlayScene，始终在 UI 面板之上 */
  private ensureCornerHandles() {
    if (this.cornerHandleGroup) return
    const group = new THREE.Group()
    group.name = '__ui_bounds_handles__'
    for (let i = 0; i < 8; i++) {
      // 几何统一为半径 1 的圆，实际尺寸在 updateBounds 按 zoom 换算的世界比例设置 scale（屏幕恒定大小）
      const geo = new THREE.CircleGeometry(1, 24)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.8,
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
    this.anchorGizmo.detach()
  }

  /** 每帧更新包围盒几何与尺寸标签（跟随节点变换） */
  private updateBounds() {
    if (!this.boundsTarget || !this.boundsHelper) return
    // 统一用 uitransform 尺寸矩形基准（图片/文本一致，对角固定）
    const box = this.getBoundsBox()
    this.setBoundsHelperBox(box)
    this.boundsHelper.visible = true

    // 尺寸标签：计算世界包围盒，绘制 "W × H" 文本
    if (!this.boundsLabel) return
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

    // 8 个把手跟随包围盒（4 角 + 4 边中点），尺寸按 zoom 换算保持屏幕恒定（放大变小/缩小变大）
    const z = 0.02
    const cx = (box.min.x + box.max.x) / 2
    const cy = (box.min.y + box.max.y) / 2
    const pts: [number, number][] = [
      [box.min.x, box.max.y], // TL
      [box.max.x, box.max.y], // TR
      [box.min.x, box.min.y], // BL
      [box.max.x, box.min.y], // BR
      [cx, box.max.y],        // T
      [box.max.x, cy],        // R
      [cx, box.min.y],        // B
      [box.min.x, cy],        // L
    ]
    // 目标屏幕直径（px）：角 2.5，边 1.75（圆形把手；几何半径 1 → scale = 直径 × wpp）
    const wpp = (this.camera.top - this.camera.bottom) / this.renderer.domElement.clientHeight / this.camera.zoom
    const sizes: [number, number][] = [
      [2.5, 2.5], [2.5, 2.5], [2.5, 2.5], [2.5, 2.5],
      [1.75, 1.75], [1.75, 1.75], [1.75, 1.75], [1.75, 1.75],
    ]
    for (let i = 0; i < this.cornerHandles.length; i++) {
      const h = this.cornerHandles[i]
      h.position.set(pts[i][0], pts[i][1], z)
      h.scale.set(sizes[i][0] * wpp, sizes[i][1] * wpp, 1)
      h.visible = true
    }

    // ─── 锚点 gizmo：父容器范围（白色半透明）+ 锚点图标，屏幕恒定尺寸 ───
    this.anchorGizmo.update(wpp)
  }

  /** 将本实例登记为全局活动实例（供 Outline/Inspector 读取），并通知 UI 刷新 */
  activate(assetPath?: string): void {
    if (assetPath) {
      this._undoKey = diskPathToAssetKey(assetPath)
      // 首次激活：建立撤回基准（加载后的未编辑状态）。基准必须是独立深拷贝，
      // 不能直接引用 _jsonTree（collectSaveData 会原地写回污染它）。
      const base = this.collectSaveData()
      if (this._lastCommitted === null && base) {
        this._lastCommitted = JSON.parse(JSON.stringify(base))
        logger.info(`[UIPreview] 撤回基准建立: ${this._undoKey}`)
      }
      AssetPreviewManager.setActive(assetPath)
    }
    this.notifyChange()
    notifySelectionChange()
  }

  focusActor(actor: Actor) {
    this.selectActor(actor)
    this.fitToWidget(actor.root)
  }

  /** 按名称查找并聚焦 */
  focusOnActor(actorName: string): boolean {
    const allActors = getAllActors()
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
