/**
 * CanvasUIComponent — 基于 CanvasTexture 的 3D 世界空间 UI 面板
 *
 * 用 <canvas> 2D API 自绘 UI → 贴到 THREE.PlaneGeometry 上 → 挂载为 Actor 的 Component。
 * 与你现有 SpriteComponent / MeshComponent 同级的 Component 模式。
 *
 * 特点：
 *  - 纯 GPU 渲染（作为贴图 mesh），可被其他 3D 物体遮挡
 *  - 支持任意 Canvas 2D 绘制（矩形/图片/渐变/emoji/圆角）
 *  - 运行时 draw() 增量更新纹理
 *  - 像素位图，需按目标精度设置 canvas 分辨率
 *
 * 用法：
 *   const ui = new CanvasUIComponent(actor, { width: 512, height: 256 })
 *   actor.addComponent(ui)
 *   ui.draw((ctx, w, h) => {
 *     ctx.fillStyle = 'rgba(0,0,0,0.7)'
 *     ctx.fillRect(0, 0, w, h)
 *     ctx.fillStyle = '#ffcc00'
 *     ctx.font = '24px monospace'
 *     ctx.fillText('任务公告', 20, 50)
 *   })
 *   ui.setWorldSize(5, 2.5)  // 设置 3D 世界尺寸（米）
 */
import * as THREE from 'three'
import { Component, type EditableProperty } from '../entity/Component'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'
// 循环引用（UITransformComponent → CanvasUIComponent）：ESM 活绑定，构造时使用安全
import { UITransformComponent } from '../ui/UITransformComponent'
// 值导入（运行时注册/注销 blocker 到 PhySys；PhySys 对 CanvasUIComponent 仅 type 引用，无循环）
import { PhySys } from '../physics/PhySys'

/**
 * UI 画布命中测试模式（仿 UE EVisibility 的命中测试语义）：
 *  - 'visible'：渲染 + 可被点击（默认；射线可穿透非 clickable 区域到更低层级）
 *  - 'block'：渲染 + 拦截点击 —— 画布 mesh 命中射线即消费点击，
 *    挡住更低 zOrder 的 UI 与世界层（模态遮罩/GM 控制台用）
 *  - 'hitTestInvisible'：渲染 + 点击穿透 —— 不参与任何命中/拦截（射线直接穿过）
 */
export type UIHitTestMode = 'visible' | 'block' | 'hitTestInvisible'

export interface CanvasUIOptions {
  width?: number           // canvas 像素宽，默认 512
  height?: number          // canvas 像素高，默认 256
  worldWidth?: number      // 3D 世界宽（米），默认 5
  worldHeight?: number     // 3D 世界高（米），默认 2.5
  doubleSided?: boolean    // 是否双面可见，默认 true
  name?: string
  zOrder?: number          // UI 层级（越大越靠前），默认 0
  /**
   * 是否激活（默认 true）。false = 该 UI 画布节点已创建但不渲染（panel.visible=false）。
   * 仅控制本组件渲染；节点级失活（含子树）用 Actor.bActive。
   */
  active?: boolean
  /**
   * 仅标记模式（默认 false）：只把 Actor 标记为 UI 元素，不创建渲染 mesh。
   * 用于"每个 UI Actor 挂一个 canvasui 作为 UI 标识"的约定；
   * 不参与锚点容器查找（子元素锚点由 UITransformComponent 以真正的画布为基准）。
   */
  markerOnly?: boolean
  /**
   * 命中测试模式（仿 UE EVisibility，默认 'visible'）：
   * 'block' = 画布拦截点击（挡住更低层级 UI/世界），'hitTestInvisible' = 点击穿透。
   */
  hitTest?: UIHitTestMode
}

export class CanvasUIComponent extends Component<Actor> {
  /** 渲染面板；markerOnly 模式下为 null */
  public panel: THREE.Mesh | null
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  private texture: THREE.CanvasTexture
  private _width: number
  private _height: number
  private _worldW = 5
  private _worldH = 2.5
  private _zOrder = 0
  /** 是否激活（false = 已创建但不渲染 panel） */
  private _bActive: boolean
  /** 仅标记模式（不渲染） */
  private _markerOnly: boolean
  /**
   * 透明点击层（默认 false）：仅提供命中 mesh，不渲染视觉（opacity 恒 0）。
   * UIButtonComponent 无显式背景时自动生成的点击层标记此字段：
   *  - 不参与状态色驱动（透明层无需重绘纹理）
   *  - 不参与 TweenSystem.fade 透明度补间（fade 到 1 不会让点击层变可见）
   */
  private _isClickOnly = false
  /** 命中测试模式（仿 UE：visible=可命中 / block=拦截 / hitTestInvisible=穿透） */
  private _hitTest: UIHitTestMode
  /**
   * 子组件（如 UIText 的 troika mesh）注册到本 canvas 的渲染对象列表。
   * canvas 组件作为本 UI 节点的"显隐控制中心"：
   *  - active=false 时统一隐藏 panel + 所有已注册的渲染对象
   *  - active=true 时统一恢复
   * 子类不要自己持有 bActive；显隐唯一入口是 canvas 组件的 active。
   */
  private readonly _registeredObjects: THREE.Object3D[] = []

  constructor(owner: Actor, options: CanvasUIOptions = {}) {
    super(owner)
    this.name = options.name ?? 'CanvasUIComponent'
    this._width = options.width ?? 512
    this._height = options.height ?? 256
    this._markerOnly = options.markerOnly ?? false
    this._bActive = options.active ?? true
    this._hitTest = options.hitTest ?? 'visible'

    // 1. 离屏 Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.width = this._width
    this.canvas.height = this._height
    this.ctx = this.canvas.getContext('2d')!

    // 2. Canvas → Texture
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter

    // 世界尺寸：优先 uitransform（尺寸归 transform 管，Unity RectTransform 风格）。
    //  - tsf 已显式设置且组件未传 → 用 tsf 值（JSON 迁移后标准）
    //  - 组件显式传入（uitext 推导 / 旧数据兼容）→ 组件值并同步回 tsf
    let ww = options.worldWidth ?? 5
    let wh = options.worldHeight ?? 2.5
    const uiTf = owner.getComponent(UITransformComponent)
    if (uiTf) {
      if (uiTf.worldSizeExplicit && options.worldWidth === undefined && options.worldHeight === undefined) {
        ;[ww, wh] = uiTf.getWorldSize()
      } else if (options.worldWidth !== undefined || options.worldHeight !== undefined) {
        uiTf.setWorldSize(ww, wh)
      }
    }
    this._worldW = ww
    this._worldH = wh

    if (this._markerOnly) {
      // 仅标记模式：不创建 mesh、不挂到场景，仅声明"本 Actor 是 UI"
      this.panel = null
      // 注释：每个 UI 子元素都会创建 UIMarker，属高频噪音
      // logger.info(`[CanvasUIComponent] 创建 "${this.name}": 仅标记模式（不渲染，标记 Actor 为 UI）`)
    } else {
      // 3. Texture → Plane Mesh（共享单位几何体，scale 控制尺寸）
      const geo = new THREE.PlaneGeometry(1, 1)
      const mat = new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: (options.doubleSided ?? true) ? THREE.DoubleSide : THREE.FrontSide,
      })
      this.panel = new THREE.Mesh(geo, mat)
      this.panel.scale.set(ww, wh, 1)
      this.panel.visible = this._bActive // 激活属性：false = 不渲染
      owner.root.add(this.panel)
    }

    if (options.zOrder !== undefined) this.zOrder = options.zOrder
  }

  /** 仅标记模式（不渲染，仅作 UI 标识） */
  get isMarkerOnly(): boolean { return this._markerOnly }

  /** 透明点击层（仅命中不渲染，opacity 恒 0） */
  get isClickOnly(): boolean { return this._isClickOnly }
  set isClickOnly(v: boolean) { this._isClickOnly = v }

  /**
   * 是否激活（默认 true）。false = 该 UI 节点（自身 + 子对象的所有渲染组件）不渲染。
   * 运行时切换即时生效；Inspector/资产通过 editable property 'active' 读写。
   * canvas 是 UI 节点的显隐控制中心：切换时统一控制自身 panel + 注册的渲染对象 +
   * 递归控制整个子树的渲染（经 owner.bActive → applyActiveTree）。
   */
  get bActive(): boolean { return this._bActive }
  set bActive(v: boolean) {
    if (this._bActive === v) return
    this._bActive = v
    this.applyActive()
    logger.debug(`[CanvasUIComponent] "${this.name}" 激活 -> ${v}`)
  }

  /** 激活状态应用到渲染对象（panel + 注册对象 + 节点级级联） */
  protected applyActive(): void {
    if (this.panel) this.panel.visible = this._bActive
    for (const obj of this._registeredObjects) obj.visible = this._bActive
    // 节点级显隐开关：canvas active 统一控制自身 + 子对象所有渲染组件（Actor.applyActiveTree 递归）
    this.owner.bActive = this._bActive
  }

  /**
   * 子组件注册自有的渲染对象（如 UIText 的 troika mesh）到本 canvas。
   * canvas active 切换时会自动同步该对象的 visible 状态。
   * 子组件自身不再持有 bActive；显隐统一由 canvas 组件管理。
   */
  registerRenderObject(obj: THREE.Object3D): void {
    if (!this._registeredObjects.includes(obj)) {
      this._registeredObjects.push(obj)
      obj.visible = this._bActive
    }
  }

  /** 注销渲染对象（一般在子组件 EndPlay 销毁自身 mesh 时调用） */
  unregisterRenderObject(obj: THREE.Object3D): void {
    const i = this._registeredObjects.indexOf(obj)
    if (i >= 0) this._registeredObjects.splice(i, 1)
  }

  /** UI 层级（越大越靠前）：设置 renderOrder + panel z 偏移分层 */
  get zOrder(): number { return this._zOrder }
  set zOrder(v: number) {
    this._zOrder = v
    if (!this.panel) return
    this.panel.renderOrder = v
    // z 偏移分层：zOrder 每 +1 对应 0.001 世界单位前移（正交相机下无透视变形）
    this.panel.position.z = v * 0.001
  }

  /** 命中测试模式（仿 UE：visible=可命中 / block=拦截 / hitTestInvisible=穿透） */
  get hitTestMode(): UIHitTestMode { return this._hitTest }
  set hitTestMode(v: UIHitTestMode) {
    if (this._hitTest === v) return
    const wasBlock = this._hitTest === 'block'
    this._hitTest = v
    // block 模式注册到 PhySys 参与点击拦截；退出 block 注销
    if (v === 'block' && !wasBlock) PhySys.registerUIBlocker(this)
    else if (wasBlock && v !== 'block') PhySys.unregisterUIBlocker(this)
    logger.info(`[CanvasUIComponent] "${this.name}" 命中测试模式 → ${v}`)
  }

  override BeginPlay() {
    // block 命中测试模式：注册到 PhySys 参与点击拦截（构造时可能组件未全挂载，BeginPlay 兜底）
    if (this._hitTest === 'block') PhySys.registerUIBlocker(this)
    // 注释：每个 UI 组件（UIMarker/UIText/UIImage/Canvas）都会触发，属高频噪音
    // logger.debug(`[CanvasUIComponent] "${this.name}" BeginPlay 进入`)
    super.BeginPlay()
    // 子树挂载完成后应用初始 active（构造时子节点未挂载，无法级联到子树）。
    // 仅当失活时需要主动下推；激活为默认态，交由 applyActiveTree 统一计算。
    if (!this._bActive) this.owner.bActive = false
    // logger.debug(`[CanvasUIComponent] "${this.name}" BeginPlay 退出`)
  }

  /** 获取 canvas 像素尺寸 */
  getSize(): [number, number] {
    return [this._width, this._height]
  }

  /** 设置 3D 世界尺寸（单位：米）；同步到 owner 的 uitransform（尺寸权威在 transform） */
  setWorldSize(w: number, h: number) {
    this._worldW = w
    this._worldH = h
    this.panel?.scale.set(w, h, 1)
    this.owner.getComponent(UITransformComponent)?.setWorldSize(w, h)
  }

  /**
   * 世界尺寸变化钩子：由 UITransformComponent.setWorldSize 遍历调用（含 markerOnly 组件）。
   * 子类可覆写以响应尺寸变化（如 UITextComponent 重算字形字号）。
   */
  onWorldSizeChange(): void {}

  /** 获取 3D 世界尺寸；优先读 owner 的 uitransform */
  getWorldSize(): [number, number] {
    const uiTf = this.owner.getComponent(UITransformComponent)
    if (uiTf) return uiTf.getWorldSize()
    return [this._worldW, this._worldH]
  }

  /** Inspector 属性展示（世界尺寸在 uitransform 上展示） */
  override getProperties(): Record<string, unknown> {
    const [cw, ch] = this.getSize()
    return {
      canvas: `${cw}×${ch}px`,
      zOrder: this._zOrder,
      active: this._bActive,
      markerOnly: this._markerOnly,
      hitTest: this._hitTest,
    }
  }

  /**
   * Inspector 可编辑属性：激活（boolean）+ UI 层级（number）。
   * active 是节点级显隐开关（统一控制自身 + 子对象所有渲染组件），所有 canvas 组件
   * （含 markerOnly 的 UIMarker 占位）都可编辑。
   */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'active', type: 'boolean',
        get: () => this._bActive,
        set: (v) => { this.bActive = v as boolean },
      },
      {
        key: 'zOrder', type: 'number', step: 1, min: 0, max: 10000,
        get: () => this._zOrder,
        set: (v) => { this.zOrder = v as number },
      },
      {
        key: 'hitTest', type: 'enum',
        options: ['visible', 'block', 'hitTestInvisible'],
        get: () => this._hitTest,
        set: (v) => { this.hitTestMode = v as UIHitTestMode },
      },
    ]
  }

  /** 保留 2 位小数的数值 */
  protected round2(v: number): number {
    return Math.round(v * 100) / 100
  }

  /** 设置不透明度 */
  setOpacity(opacity: number) {
    if (!this.panel) return
    ;(this.panel.material as THREE.MeshBasicMaterial).opacity = opacity
    ;(this.panel.material as THREE.MeshBasicMaterial).transparent = opacity < 1
  }

  /**
   * 当前不透明度 [0,1]（读取 material.opacity；写入走 setOpacity，供补间系统/脚本使用）。
   * 资产字段：UIImageComponent 的 `opacity` 已由 Inspector/assetLint 支持（运行时属性映射）。
   */
  get opacity(): number {
    if (!this.panel) return 1
    return (this.panel.material as THREE.MeshBasicMaterial).opacity
  }
  set opacity(v: number) {
    this.setOpacity(v)
  }

  /** 自定义绘制回调。每次调用清空 canvas 并执行 fn，然后标记纹理更新 */
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.ctx.clearRect(0, 0, this._width, this._height)
    fn(this.ctx, this._width, this._height)
    // logger.debug(`[CanvasUIComponent] "${this.name}" 重绘 (${this._width}x${this._height})`)
  }

  /** 只标记纹理更新（外部已通过 this.ctx 直接绘制） */
  markDirty() {
    this.texture.needsUpdate = true
    // logger.debug(`[CanvasUIComponent] "${this.name}" 纹理标记脏`)
  }

  override EndPlay() {
    super.EndPlay()
    // block 模式注销（点击拦截注册随组件销毁清理）
    if (this._hitTest === 'block') PhySys.unregisterUIBlocker(this)
    if (!this.panel) return // 仅标记模式无渲染资源
    this.owner.root.remove(this.panel)
    this.texture.dispose()
    this.panel.geometry.dispose()
    ;(this.panel.material as THREE.MeshBasicMaterial).dispose()
  }
}
