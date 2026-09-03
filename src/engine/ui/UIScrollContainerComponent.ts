/**
 * UIScrollContainerComponent — 通用滚动容器（任意内容 + 裁剪）
 *
 * 与 UIScrollListComponent（等步长 item 对象池）的区别：内容是**任意子 Actor 树**
 * （异构混排），滚动范围由内容总尺寸决定，配合 UIMaskComponent 实现溢出裁剪——
 * 即 CSS overflow: auto/scroll 的语义。
 *
 * 内容模型：**单一内容子 Actor（content wrapper）**——容器下的一个直接子 Actor
 * 承载全部内容（编译器从 HTML overflow:auto 元素自动生成 `_ScrollContent` 层）。
 * 滚动 = 沿滚动轴平移 wrapper 的本地 position（wrapper 无锚点，不与锚点/布局冲突）。
 *
 * 测量：wrapper 的 UITransform 世界尺寸即内容总尺寸（编译期已烘好；运行时内容
 * 变化后调 refresh() 重测并钳制滚动范围）。maxScroll = max(0, 内容尺寸 − 视口尺寸)。
 *
 * 交互：容器挂透明点击层（isClickOnly CanvasUI，无视觉仅命中）实现拖拽滚动
 * （内容跟随手指 + 越界回弹）；滚动条可选（程序化创建，与 UIScrollList 同款）。
 *
 * HTML 映射：overflow: auto / scroll 元素 → 容器挂 UIMask + 本组件 + 自动内容层。
 */
import * as THREE from 'three'
import { Component, type EditableProperty } from '../entity/Component'
import { GenericActor } from '../entity/GenericActor'
import type { Actor } from '../entity/Actor'
import { UITransformComponent } from './UITransformComponent'
import { UIImageComponent } from './UIImageComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { UIMaskComponent } from './UIMaskComponent'
import { ClickableComponent } from '../physics/ClickableComponent'
import { TweenSystem } from './TweenSystem'
import { FLOAT_LAYER_BIAS } from './UIManager'
import { UI_CANVAS_H } from '../rendering/UICamera'
import { PhySys } from '../physics/PhySys'
import { logger } from '../Logger'

export type UIScrollDirection = 'vertical' | 'horizontal'

export interface UIScrollContainerComponentOptions {
  direction?: UIScrollDirection
  draggable?: boolean
  scrollbar?: boolean
  /** 初始滚动偏移（世界单位 = 设计 px，0 = 顶部/起始） */
  scrollOffset?: number
}

export class UIScrollContainerComponent extends Component<Actor> {
  private _direction: UIScrollDirection
  private _draggable: boolean
  private _scrollbar: boolean
  private _scrollOffset = 0
  /** 内容 wrapper（单一内容子 Actor；滚动平移它） */
  private _content: Actor | null = null
  /** 内容总尺寸（refresh 时测量，世界单位） */
  private _contentSize: [number, number] = [0, 0]
  /** 透明点击层（拖拽命中用；BeginPlay 创建） */
  private _hitLayer: CanvasUIComponent | null = null
  /** 拖拽会话 */
  private _dragSession: { sx: number, sy: number, base: number } | null = null
  private _dragOverscrolled = false
  private _bounceTween: { kill(): void } | null = null
  /** 内容 wrapper 基准本地位置（refresh 首次快照，滚动在其上叠加） */
  private _contentBase: [number, number] | null = null
  /** 滚动条（程序化创建） */
  private _scrollbarTrack: Actor | null = null
  private _scrollbarThumb: Actor | null = null
  private _thumbDrag: { sy: number, base: number } | null = null

  constructor(owner: Actor, options: UIScrollContainerComponentOptions = {}) {
    super(owner)
    this.name = 'UIScrollContainerComponent'
    this._direction = options.direction ?? 'vertical'
    this._draggable = options.draggable ?? true
    this._scrollbar = options.scrollbar ?? true
    this._scrollOffset = Math.max(0, options.scrollOffset ?? 0)
  }

  get direction(): UIScrollDirection { return this._direction }
  set direction(v: UIScrollDirection) {
    this._direction = v
    this._clampOffset()
    this._applyOffset()
  }

  /** 鼠标拖拽滚动开关 */
  get draggable(): boolean { return this._draggable }
  set draggable(v: boolean) { this._draggable = !!v }

  /** 滚动条开关（切换后重建） */
  get scrollbar(): boolean { return this._scrollbar }
  set scrollbar(v: boolean) {
    this._scrollbar = !!v
    this._createScrollbar()
    this._updateScrollbar()
  }

  /** 滚动偏移（世界单位 = 设计 px，0 = 顶部/起始；setter 钳制） */
  get scrollOffset(): number { return this._scrollOffset }
  set scrollOffset(v: number) {
    this._scrollOffset = Math.max(0, v)
    this._clampOffset()
    this._applyOffset()
  }

  /** 最大滚动量（内容超出视口的部分，世界单位 = 设计 px） */
  get maxScroll(): number {
    const view = this._viewSize()
    const total = this._direction === 'vertical' ? this._contentSize[1] : this._contentSize[0]
    return Math.max(0, total - (this._direction === 'vertical' ? view[1] : view[0]))
  }

  /** 内容总尺寸（世界单位，refresh 时测量） */
  get contentSize(): [number, number] {
    return [this._contentSize[0], this._contentSize[1]]
  }

  /** 内容 wrapper Actor（可显式指定；缺省取名为 *_ScrollContent 的直接子项，再退化为唯一直接子项） */
  get contentActor(): Actor | null {
    if (this._content) return this._content
    const children = this.owner.getChildren()
    const byName = children.find((c) => c.root.name.includes('_ScrollContent'))
    if (byName) return byName
    if (children.length === 1) return children[0]
    return null
  }
  set contentActor(v: Actor | null) {
    this._content = v
    this.refresh()
  }

  override BeginPlay(): void {
    super.BeginPlay()
    this._ensureClickable()
    this._ensureHitLayer()
    this.refresh()
    if (this._scrollbar) this._createScrollbar()
  }

  override EndPlay(): void {
    super.EndPlay()
    this._destroyScrollbar()
    this._hitLayer = null
  }

  /** 滚动指定世界单位（正 = 看后面内容） */
  scrollBy(deltaMeters: number): void {
    this.scrollOffset = this._scrollOffset + deltaMeters
  }

  /**
   * 重测内容尺寸 + 钳制偏移 + 刷新滚动条。运行时内容变化（动态加子项/布局重排）后调用。
   */
  refresh(): void {
    const content = this.contentActor
    if (!content) {
      this._contentSize = [0, 0]
      logger.warn(`[UIScrollContainerComponent] "${this.owner.root.name}" 无内容子 Actor（需单一内容层 _ScrollContent），跳过测量`)
      return
    }
    const tf = content.getComponent(UITransformComponent)
    if (!tf) {
      this._contentSize = [0, 0]
      return
    }
    this._contentSize = tf.getWorldSize()
    // 内容层更换（引用变化）时重拍基准位置
    if (this._content !== content) this._contentBase = null
    this._content = content
    this._clampOffset()
    this._applyOffset()
    this._updateScrollbar()
  }

  // ─── 内部 ─────────────────────────────────

  /** 视口尺寸（容器 uitransform） */
  private _viewSize(): [number, number] {
    const tf = this.owner.getComponent(UITransformComponent)
    return tf?.getWorldSize() ?? [1, 1]
  }

  private _clampOffset(): void {
    this._scrollOffset = Math.max(0, Math.min(this.maxScroll, this._scrollOffset))
  }

  /** 滚动偏移应用到内容 wrapper 位置（基准位置快照 + 轴向位移） */
  private _applyOffset(): void {
    const content = this.contentActor
    if (!content) return
    const tf = content.getComponent(UITransformComponent)
    if (!tf) return
    if (tf.anchor) {
      logger.warn(`[UIScrollContainerComponent] "${this.owner.root.name}" 内容层 "${content.root.name}" 带锚点，滚动位移会被 applyAnchor 覆盖（内容层应为无锚点 position 定位）`)
      return
    }
    // 基准快照：首次应用时记录布局期位置（编译器烘的坐标），滚动只在其上叠加轴向位移
    if (!this._contentBase) {
      this._contentBase = [content.root.position.x, content.root.position.y]
    }
    const [bx, by] = this._contentBase
    if (this._direction === 'vertical') {
      content.setPosition(bx, by + this._scrollOffset, content.root.position.z)
    } else {
      content.setPosition(bx - this._scrollOffset, by, content.root.position.z)
    }
  }

  /** 确保容器有 UI 层 ClickableComponent（拖拽滚动载体；数据未显式配置时补挂，UIButtonComponent 同款复用/新建模式） */
  private _ensureClickable(): void {
    let clickable = this.owner.getComponent(ClickableComponent)
    if (!clickable) {
      clickable = new ClickableComponent(this.owner)
      this.owner.addComponent(clickable)
    }
    clickable.layer = 'ui'
  }

  /** 透明点击层（isClickOnly canvas：仅命中不渲染；zOrder 低于内容不挡按钮） */
  private _ensureHitLayer(): void {
    if (this._hitLayer) return
    const existing = this.owner.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
    if (existing) {
      this._hitLayer = existing
      this._bindDrag()
      return
    }
    const [vw, vh] = this._viewSize()
    const canvas = new CanvasUIComponent(this.owner, {
      width: 64, height: 64,
      worldWidth: Math.max(1, vw), worldHeight: Math.max(1, vh),
      name: 'ScrollHitLayer',
    })
    canvas.isClickOnly = true
    canvas.zOrder = 0
    this.owner.addComponent(canvas)
    this._hitLayer = canvas
    this._bindDrag()
    logger.debug(`[UIScrollContainerComponent] "${this.owner.root.name}" 已创建透明点击层 (${vw.toFixed(2)}x${vh.toFixed(2)})`)
  }

  /** 绑定容器拖拽滚动（内容跟随手指 + 越界回弹；绑定后自动启用"拖拽取消点击"） */
  private _bindDrag(): void {
    const clickable = this.owner.getComponent(ClickableComponent)
    if (!clickable) return
    clickable.onDragStart = (sx, sy) => {
      if (this._bounceTween) {
        this._bounceTween.kill()
        this._bounceTween = null
      }
      this._dragSession = { sx, sy, base: this._scrollOffset }
      this._dragOverscrolled = false
    }
    clickable.onDragMove = (sx, sy) => {
      const session = this._dragSession
      if (!session) return
      const rect = PhySys.viewportElement?.getBoundingClientRect()
      const worldPerPx = rect && rect.height > 0 ? UI_CANVAS_H / rect.height : 1
      const deltaPx = this._direction === 'vertical' ? sy - session.sy : sx - session.sx
      // 内容跟随手指：手指下移（sy 增大）→ offset 减少
      this._scrollOffset = session.base - (deltaPx * worldPerPx)
      this._applyOffset()
      if (this._scrollOffset < -0.001 || this._scrollOffset > this.maxScroll + 0.001) {
        this._dragOverscrolled = true
      }
    }
    clickable.onDragEnd = () => this._bounceBack()
  }

  /** 松手回弹（仅真正越界过才补间回边界） */
  private _bounceBack(): void {
    this._dragSession = null
    if (!this._dragOverscrolled) return
    this._dragOverscrolled = false
    const max = this.maxScroll
    const target = Math.max(0, Math.min(max, this._scrollOffset))
    if (Math.abs(target - this._scrollOffset) < 0.001) return
    const start = this._scrollOffset
    this._bounceTween = TweenSystem.instance.to({ v: start }, { v: target }, {
      duration: 0.25,
      easing: 'quadOut',
      onUpdate: (values) => {
        this._scrollOffset = values.v as number
        this._applyOffset()
        this._updateScrollbar()
      },
      onComplete: () => { this._bounceTween = null },
    })
  }

  /** 滚动条（轨道 + 滑块，程序化创建，模式与 UIScrollList 一致） */
  private _createScrollbar(): void {
    this._destroyScrollbar()
    if (!this._scrollbar) return
    const world = this.owner.world
    if (!world) return

    const track = new GenericActor('ScrollTrack')
    track.world = world
    const trackTsf = new UITransformComponent(track, {
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      anchor: 'center', anchorOffset: [0, 0],
      worldWidth: 8, worldHeight: 160,
    })
    track.addComponent(trackTsf)
    const trackImg = new UIImageComponent(track, {
      color: 'rgba(26,16,40,0.55)', radius: 3, width: 20, height: 512, opacity: 0.55,
    })
    trackImg.zOrder = FLOAT_LAYER_BIAS + 4
    track.addComponent(trackImg)
    track.attachTo(this.owner)
    if (!track.bHasBegunPlay) track.BeginPlay()
    this._scrollbarTrack = track

    const thumb = new GenericActor('ScrollThumb')
    thumb.world = world
    const tsf = new UITransformComponent(thumb, {
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      anchor: 'center', anchorOffset: [0, 0],
      worldWidth: 6, worldHeight: 160,
    })
    thumb.addComponent(tsf)
    const img = new UIImageComponent(thumb, {
      color: 'rgba(232,216,168,0.45)', radius: 2, width: 16, height: 256, opacity: 0.45,
    })
    img.zOrder = FLOAT_LAYER_BIAS + 5
    thumb.addComponent(img)
    const clickable = new ClickableComponent(thumb)
    clickable.layer = 'ui'
    clickable.onDragStart = (_sx, sy) => {
      this._thumbDrag = { sy, base: this._scrollOffset }
    }
    clickable.onDragMove = (_sx, sy) => {
      const session = this._thumbDrag
      if (!session) return
      const max = this.maxScroll
      if (max <= 0) return
      const rect = PhySys.viewportElement?.getBoundingClientRect()
      const worldPerPx = rect && rect.height > 0 ? UI_CANVAS_H / rect.height : 1
      const [, vh] = this._viewSize()
      const thumbH = this._thumbHeight(vh)
      const travel = vh - thumbH
      if (travel <= 0) return
      const deltaY = (sy - session.sy) * worldPerPx
      this.scrollOffset = session.base + (deltaY / travel) * max
    }
    clickable.onDragEnd = () => { this._thumbDrag = null }
    thumb.addComponent(clickable)
    thumb.attachTo(track)
    if (!thumb.bHasBegunPlay) thumb.BeginPlay()
    this._scrollbarThumb = thumb
    this.owner.world?.ui?.reassignTreeOrder()
    this._updateScrollbar()
  }

  private _destroyScrollbar(): void {
    const track = this._scrollbarTrack
    this._scrollbarTrack = null
    this._scrollbarThumb = null
    this._thumbDrag = null
    if (track && !track.bPendingDestroy) track.destroy()
  }

  private _thumbHeight(viewH: number): number {
    const total = this._direction === 'vertical' ? this._contentSize[1] : this._contentSize[0]
    const view = this._direction === 'vertical' ? viewH : this._viewSize()[0]
    if (total <= 0) return 12
    return Math.max(12, view * (view / total))
  }

  /** 滚动条位置/尺寸刷新（内容未超框时隐藏） */
  private _updateScrollbar(): void {
    const track = this._scrollbarTrack
    const thumb = this._scrollbarThumb
    if (!track || !thumb) return
    const trackTsf = track.getComponent(UITransformComponent)
    const tsf = thumb.getComponent(UITransformComponent)
    if (!trackTsf || !tsf) return
    const max = this.maxScroll
    if (max <= 0) {
      track.bActive = false
      return
    }
    track.bActive = true
    const [vw, vh] = this._viewSize()
    if (this._direction === 'vertical') {
      const trackW = 8
      trackTsf.setWorldSize(trackW, vh)
      trackTsf.anchorOffset = [vw / 2 - trackW / 2, 0]
      const thumbH = this._thumbHeight(vh)
      const travel = vh - thumbH
      tsf.setWorldSize(6, thumbH)
      const ratio = Math.max(0, Math.min(1, this._scrollOffset / max))
      tsf.anchorOffset = [0, vh / 2 - thumbH / 2 - travel * ratio]
    } else {
      const trackH = 8
      trackTsf.setWorldSize(vw, trackH)
      trackTsf.anchorOffset = [0, -(vh / 2 - trackH / 2)]
      const thumbW = this._thumbHeight(vw)
      const travel = vw - thumbW
      tsf.setWorldSize(thumbW, 6)
      const ratio = Math.max(0, Math.min(1, this._scrollOffset / max))
      tsf.anchorOffset = [-(vw / 2 - thumbW / 2) + travel * ratio, 0]
    }
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Direction: this._direction,
      Offset: `${this._scrollOffset.toFixed(2)}/${this.maxScroll.toFixed(2)}`,
      Content: [Math.round(this._contentSize[0] * 100) / 100, Math.round(this._contentSize[1] * 100) / 100],
      Draggable: this._draggable,
      Scrollbar: this._scrollbar,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'direction', type: 'enum', options: ['vertical', 'horizontal'],
        get: () => this._direction,
        set: (v) => { this.direction = v as UIScrollDirection },
      },
      {
        key: 'scrollOffset', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._scrollOffset * 100) / 100,
        set: (v) => { this.scrollOffset = v as number },
      },
      {
        key: 'draggable', type: 'boolean',
        get: () => this._draggable,
        set: (v) => { this.draggable = v as boolean },
      },
      {
        key: 'scrollbar', type: 'boolean',
        get: () => this._scrollbar,
        set: (v) => { this.scrollbar = v as boolean },
      },
    ]
  }
}
