/**
 * UIScrollListComponent — 滚动列表组件（item 对象池 + 滚动偏移）
 *
 * 挂在列表容器 Actor 上，按 direction 排布 item：
 *  - itemWidget：item 蓝图路径（每项实例化；可在 onItemSpawned 回调中填充内容）
 *  - itemSize：[w, h] 世界尺寸（默认 1×0.4）
 *  - spacing：项间距（默认 0.1）
 *  - visibleCount：可视数量（默认自动推导）——决定对象池大小
 *  - scrollOffset：滚动偏移（项单位，可为小数）
 *  - draggable：鼠标拖拽滚动开关（默认 true；按住 item 拖动，位移超阈值视为拖拽不触发按钮点击）
 *  - scrollbar：右侧滚动条 thumb（默认 true；内容超框时显示，可拖动）
 *  - onItemSpawned(itemActor, index)：item 生成回调（设置文本/图标/点击）
 *
 * 实现：对象池化（visibleCount + 1 个 item 复用），setScrollOffset/scrollBy 时按
 * offset 重排所有 item 位置并更新索引；超范围 item 隐藏（bActive=false）。
 * 注：列表不裁剪溢出可视区（引擎无 mask）；如需裁切，容器外 item 由 active 隐藏。
 *
 * 资产配置示例：
 *   { "baseClass": "UIScrollListComponent", "properties": {
 *       "itemWidget": "asset/blueprints/ui/troop_card.widget.json",
 *       "itemSize": [1.2, 0.5], "spacing": 0.15, "visibleCount": 5, "draggable": true } }
 *
 * 用法（脚本）：
 *   const list = actor.getComponent(UIScrollListComponent)
 *   list.totalCount = 20
 *   list.onItemSpawned = (item, idx) => { item.getComponent(UITextComponent)!.text = `第 ${idx} 项` }
 *   list.scrollBy(1)   // 向下滚动 1 项
 */
import { ActorComponent, type EditableProperty } from '../entity/ActorComponent'
import { GenericActor } from '../entity/GenericActor'
import { UITransformComponent } from './UITransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { UIImageComponent } from './UIImageComponent'
import { ClickableComponent } from '../physics/ClickableComponent'
import { PhySys } from '../physics/PhySys'
import { TweenSystem, type TweenHandle } from './TweenSystem'
import { UI_CANVAS_H } from '../rendering/UICamera'
import { FLOAT_LAYER_BIAS } from './UIManager'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'
import type { UIManager } from './UIManager'

export type UIScrollDirection = 'vertical' | 'horizontal'

export interface UIScrollListComponentOptions {
  /** item 蓝图路径（UIManager.spawnUIActor 生成） */
  itemWidget?: string
  /** item 世界尺寸 [w, h]（默认 [1, 0.4]） */
  itemSize?: [number, number]
  /** 项间距（世界单位，默认 0.1） */
  spacing?: number
  /**
   * 可视数量（对象池大小，默认自动）。
   * 不设或 ≤0 时按容器尺寸自动推导（floor(容器尺寸 / 步长)），保证"只有 item 超框才能滚动"：
   * 内容未溢出时 maxScroll = 0，scrollBy 被钳制无效。
   */
  visibleCount?: number
  /** 滚动方向（默认 vertical：自上而下） */
  direction?: UIScrollDirection
  /**
   * item 生成后整树 zOrder 抬升值（默认 0）。
   * 用于池化 item 与宿主面板层对齐：spawnUIActor 运行中已 +FLOAT_LAYER_BIAS(100)，
   * 若宿主资产树额外抬升（如 GM 面板 +1000），item 需补相同差值，否则被面板盖住。
   */
  zOrderLift?: number
  /** 鼠标拖拽滚动开关（默认 true：按住 item 拖动；位移超阈值不触发按钮点击） */
  draggable?: boolean
  /** 右侧滚动条 thumb（默认 true：内容超框时显示，可拖动定位） */
  scrollbar?: boolean
}

export class UIScrollListComponent extends ActorComponent<Actor> {
  private _itemWidget: string | null
  private _itemSize: [number, number]
  private _spacing: number
  /** 显式可视数量（≤0 = 自动推导） */
  private _visibleCount: number
  private _direction: UIScrollDirection

  private _totalCount = 0
  /** 当前滚动偏移（项单位；拖拽期间允许越界，_layout 用软钳制值排布实现橡皮筋） */
  private _scrollOffset = 0
  /** item 生成后整树 zOrder 抬升值（宿主面板层对齐，默认 0） */
  private _zOrderLift = 0
  /** 鼠标拖拽滚动开关 */
  private _draggable = true
  /** 右侧滚动条开关 */
  private _scrollbar = true
  /** 滚动条轨道背景 Actor（程序化创建，attachTo 挂容器下；null = 未创建/已关闭） */
  private _scrollbarTrack: Actor | null = null
  /** 滚动条 thumb Actor（程序化创建，挂轨道下；null = 未创建/已关闭） */
  private _scrollbarThumb: Actor | null = null
  /** 滚动条 thumb 拖动会话（记录按下起点 y 与基准 offset） */
  private _thumbDrag: { sy: number; baseOffset: number } | null = null
  /** 拖拽会话：按下起点（屏幕坐标）+ 起点滚动偏移；null = 未拖拽 */
  private _dragSession: { sx: number; sy: number; baseOffset: number } | null = null
  /** 本次拖拽是否真正越界过（<0 或 >maxScroll；松手仅当 true 才回弹，避免浮点噪声误触发） */
  private _dragOverscrolled = false
  /** 进行中的回弹补间（拖拽开始时 kill，避免新旧动画冲突） */
  private _bounceTween: TweenHandle | null = null
  /** 对象池：item Actor 列表（长度 resolveVisibleCount + 1） */
  private _pool: Actor[] = []
  /** 每个 item 的初始 anchorOffset（布局基准：_layout 从基准 + 滚动位移，避免累积漂移） */
  private _baseOffsets: Map<Actor, [number, number]> = new Map()
  /**
   * 每个 item 的锚点基准世界位置（_layout 热路径直接 setPosition 用；
   * 一次性由 applyAnchor 计算，之后每帧只做加法，跳过 anchorOffset setter 的
   * applyAnchor 父链遍历 + setWorldSize 重建——拖拽卡顿的主要优化）。
   */
  private _basePositions: Map<Actor, [number, number]> = new Map()
  /**
   * 每个 item 当前绑定的数据索引（react-window memo 模式：仅在索引变化时调 onItemSpawned 刷新内容，
   * 避免滚动/回弹期间每帧重建文本纹理导致卡顿）。
   */
  private _itemIndices: Map<Actor, number> = new Map()
  /** item 生成回调（itemActor, index；仅在 item 索引变化时触发） */
  onItemSpawned: ((item: Actor, index: number) => void) | null = null
  private _initialized = false

  constructor(owner: Actor, options: UIScrollListComponentOptions = {}) {
    super(owner)
    this.name = 'UIScrollListComponent'
    this._itemWidget = options.itemWidget ?? null
    this._itemSize = options.itemSize ?? [1, 0.4]
    this._spacing = options.spacing ?? 0.1
    this._visibleCount = options.visibleCount ?? -1
    this._direction = options.direction ?? 'vertical'
    this._zOrderLift = options.zOrderLift ?? 0
    this._draggable = options.draggable ?? true
    this._scrollbar = options.scrollbar ?? true
    logger.info(`[UIScrollListComponent] 构造: owner="${owner.name}" itemWidget=${this._itemWidget ?? '未设置'} visibleCount=${this._visibleCount} zOrderLift=${this._zOrderLift} draggable=${this._draggable} scrollbar=${this._scrollbar}`)
  }

  /** 列表总项数 */
  get totalCount(): number { return this._totalCount }
  set totalCount(v: number) {
    this._totalCount = Math.max(0, v)
    this._clampScroll()
    this._layout()
  }

  /** 滚动偏移（项单位；0 = 顶部/起始）——API/滚轮路径：立即钳制到合法区间 */
  get scrollOffset(): number { return this._scrollOffset }
  set scrollOffset(v: number) {
    this._scrollOffset = Math.max(0, v)
    this._clampScroll()
    this._layout()
  }

  get itemWidget(): string | null { return this._itemWidget }
  set itemWidget(v: string | null) { this._itemWidget = v; this._initialize() }
  get direction(): UIScrollDirection { return this._direction }
  set direction(v: UIScrollDirection) { this._direction = v; this._layout() }
  get itemSize(): [number, number] { return this._itemSize }
  set itemSize(v: [number, number]) {
    this._itemSize = [Math.max(0.05, v[0]), Math.max(0.05, v[1])]
    this._layout()
  }
  get spacing(): number { return this._spacing }
  set spacing(v: number) { this._spacing = Math.max(0, v); this._layout() }
  get visibleCount(): number { return this._resolveVisibleCount() }
  set visibleCount(v: number) {
    this._visibleCount = v <= 0 ? -1 : Math.floor(v)
    this._initialize()
  }
  /** item zOrder 抬升值（设置后重建池生效） */
  get zOrderLift(): number { return this._zOrderLift }
  set zOrderLift(v: number) {
    this._zOrderLift = Math.max(0, v)
    this._initialize()
  }
  /** 鼠标拖拽滚动开关（item 按下后拖动；位移超阈值不触发按钮点击） */
  get draggable(): boolean { return this._draggable }
  set draggable(v: boolean) {
    this._draggable = !!v
    this._bindAllItemDrag()
  }
  /** 右侧滚动条开关（设置后重建 thumb 生效） */
  get scrollbar(): boolean { return this._scrollbar }
  set scrollbar(v: boolean) {
    this._scrollbar = !!v
    this._initialize()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Items: `${this._totalCount}`,
      Offset: this._scrollOffset.toFixed(2),
      Widget: this._itemWidget ?? '未设置',
      Pool: this._pool.length,
      Direction: this._direction,
      ZLift: this._zOrderLift,
      Draggable: this._draggable,
      Scrollbar: this._scrollbar,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'itemWidget', type: 'string',
        get: () => this._itemWidget ?? '',
        set: (v) => { this.itemWidget = (v as string) || null },
      },
      {
        key: 'itemSize', type: 'vec2',
        get: () => this._itemSize,
        set: (v) => { this._itemSize = v as [number, number]; this._layout() },
      },
      {
        key: 'spacing', type: 'number', step: 0.05, min: 0,
        get: () => this._spacing,
        set: (v) => { this._spacing = v as number; this._layout() },
      },
      {
        key: 'visibleCount', type: 'number', step: 1, min: 1,
        get: () => this._visibleCount,
        set: (v) => { this.visibleCount = (v as number) <= 0 ? -1 : Math.floor(v as number); this._initialize() },
      },
      {
        key: 'direction', type: 'enum', options: ['vertical', 'horizontal'],
        get: () => this._direction,
        set: (v) => { this.direction = v as UIScrollDirection },
      },
      {
        key: 'zOrderLift', type: 'number', step: 100, min: 0,
        get: () => this._zOrderLift,
        set: (v) => { this.zOrderLift = v as number },
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

  /**
   * 持久化属性：visibleCount ≤ 0（自动推导）时不写回资产——省略字段即自动推导，
   * 资产中不应残留 -1 哨兵值（assetLint schema min:1 会报错）。
   */
  override getPersistentProps(): Record<string, unknown> {
    const out = super.getPersistentProps()
    if (this._visibleCount <= 0) delete out.visibleCount
    return out
  }

  override BeginPlay(): void {
    super.BeginPlay()
    logger.info(`[UIScrollListComponent] BeginPlay: owner="${this.owner.name}" world=${this.owner.world ? `#${this.owner.world.id}` : 'null'} ui=${this.owner.world?.ui ? '有' : '无'}`)
    // 仅在未初始化时建池：资产加载期 setter（zOrderLift/visibleCount）可能已提前
    // 初始化成功（spawnUIActor 已整树传播 world）——若此处再重建，旧 item 尚在
    // World.pendingSpawn 队列中销毁失效，会泄漏一整套 item。
    if (!this._initialized) this._initialize()
  }

  /** 滚动指定项数（正 = 向末尾滚动） */
  scrollBy(deltaItems: number): void {
    this.scrollOffset = this._scrollOffset + deltaItems
  }

  /** 滚动到指定项 */
  scrollTo(index: number): void {
    this.scrollOffset = index
  }

  /**
   * 手动刷新（totalCount/onItemSpawned 变化后调用）。
   * 清空索引 memo 后重排：强制所有可见 item 重新触发 onItemSpawned——
   * 常见时序是 totalCount setter 先触发一次 _layout（memo 已记录索引，此时
   * onItemSpawned 尚未赋值），随后赋值回调再 refresh；若不清 memo，
   * _layout 会因索引未变跳过回调，首次文本/点击绑定丢失。
   */
  refresh(): void {
    this._itemIndices.clear()
    this._layout()
  }

  // ─── 内部 ─────────────────────────────────

  /**
   * 解析实际可视数量：显式 visibleCount > 0 用之；否则按容器尺寸自动推导
   * （floor(容器可视尺寸 / 步长)，至少 1）——只有 item 超框（totalCount > 可视数）才能滚动。
   */
  private _resolveVisibleCount(): number {
    if (this._visibleCount > 0) return this._visibleCount
    const [iw, ih] = this._itemSize
    const step = this._direction === 'vertical' ? ih + this._spacing : iw + this._spacing
    const tf = this.owner.getComponent(UITransformComponent)
    const size = tf?.getWorldSize()
    if (!size) return 5
    const capacity = this._direction === 'vertical' ? size[1] : size[0]
    return Math.max(1, Math.floor(capacity / step))
  }

  /** 初始化对象池（首次或 widget/visibleCount 变化时重建） */
  private _initialize(): void {
    const ui = this.owner.world?.ui
    if (!this._itemWidget) {
      logger.warn('[UIScrollListComponent] 未配置 itemWidget，跳过初始化')
      return
    }
    if (!ui) {
      // 时序未到：组件可能在资产解析期（owner 未挂 World）被 setter 触发，
      // 延迟到 BeginPlay 再初始化（spawnUIActor 已整树传播 world）
      logger.debug('[UIScrollListComponent] owner 未挂 World，延迟到 BeginPlay 初始化')
      return
    }
    logger.info(`[UIScrollListComponent] 初始化池: owner="${this.owner.name}" itemWidget=${this._itemWidget} visibleCount=${this._resolveVisibleCount()} 重建=${this._initialized}`)
    this._initialized = true
    // 池重建：取消进行中的回弹补间（旧池 item 已销毁，补间不应再驱动 layout）
    if (this._bounceTween) {
      this._bounceTween.kill()
      this._bounceTween = null
    }
    this._clearPool()
    // 池大小 = 可视 + 1（滚动时上下各多一个缓冲）
    for (let i = 0; i < this._resolveVisibleCount() + 1; i++) {
      const item = ui.spawnUIActor(this._itemWidget, this.owner)
      if (!item) {
        logger.error(`[UIScrollListComponent] item 生成失败: ${this._itemWidget}（第 ${i} 个）`)
        break
      }
      // zOrder 抬升：与宿主面板层对齐（spawnUIActor 运行中已 +FLOAT_LAYER_BIAS，补差值）
      if (this._zOrderLift > 0) this._liftZOrder(item)
      // 布局基准：贴顶/贴左（与 _layout 既有语义一致，非蓝图 anchorOffset）——
      // 布局期算一次缓存，之后每帧只做加法，跳过 applyAnchor 父链遍历与 setWorldSize 重建
      const baseTsf = item.getComponent(UITransformComponent)
      if (baseTsf) {
        const [cw, ch] = this._containerSize()
        const [iw2, ih2] = this._itemSize
        const y0 = ch / 2 - ih2 / 2
        const x0 = -cw / 2 + iw2 / 2
        this._baseOffsets.set(item, [baseTsf.anchorOffset[0], baseTsf.anchorOffset[1]])
        this._basePositions.set(item, this._direction === 'vertical' ? [x0, y0] : [x0, y0])
        // 解除 item 根锚点：池化 item 位置由列表全权接管（_layout setPosition），
        // 若保留蓝图 anchor，item 延迟到来的 BeginPlay → applyAnchor 会用蓝图
        // anchorOffset 覆盖排布位置——首次渲染全部叠到锚点处，拖动一下才恢复。
        // 置 null 后 applyAnchor 直接跳过（item 子节点锚点不受影响）
        baseTsf.anchor = null
        baseTsf.anchorOffset = [0, 0]
      }
      // 鼠标拖拽滚动（item 上的 ClickableComponent 独立字段，不干扰 UIButtonComponent 回调）
      if (this._draggable) this._bindItemDrag(item)
      item.bActive = false
      this._pool.push(item)
    }
    logger.info(`[UIScrollListComponent] 池初始化完成: ${this._pool.length} 个 item（目标 ${this._resolveVisibleCount() + 1}）`)
    // 滚动条 thumb（程序化创建，attachTo 挂容器右侧）
    this._createScrollbar()
    this._layout()
  }

  /**
   * 创建右侧滚动条（轨道背景 + 滑块，程序化：GenericActor + UITransform + UIImage + Clickable）。
   * 轨道 attachTo 挂容器下由父链传播 BeginPlay；滑块挂轨道下（轨道移动滑块跟随）。
   * zOrder 高于 item（bias + lift + 4/5）保证不被盖住。
   */
  private _createScrollbar(): void {
    this._destroyScrollbar()
    if (!this._scrollbar) return

    // ─── 轨道背景（不可交互，纯视觉：右侧整条半透明深色底） ───
    const track = new GenericActor('ScrollbarTrack')
    track.world = this.owner.world
    const trackTsf = new UITransformComponent(track, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      anchor: 'center',
      anchorOffset: [0, 0],
      worldWidth: 0.1,
      worldHeight: 0.4,
    })
    track.addComponent(trackTsf)
    const trackImg = new UIImageComponent(track, {
      color: 'rgba(26,16,40,0.55)',
      radius: 3,
      width: 20,
      height: 512,
      opacity: 0.55,
    })
    // zOrder：低于滑块（+5）高于 item（+2/3）
    trackImg.zOrder = FLOAT_LAYER_BIAS + this._zOrderLift + 4
    track.addComponent(trackImg)
    track.attachTo(this.owner)
    if (!track.bHasBegunPlay) track.BeginPlay()
    this._scrollbarTrack = track

    // ─── 滑块 thumb（可拖动 → 定位滚动；挂轨道下） ───
    const thumb = new GenericActor('ScrollbarThumb')
    thumb.world = this.owner.world
    const tsf = new UITransformComponent(thumb, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      anchor: 'center',
      anchorOffset: [0, 0],
      worldWidth: 0.08,
      worldHeight: 0.4,
    })
    thumb.addComponent(tsf)
    const img = new UIImageComponent(thumb, {
      color: 'rgba(232,216,168,0.45)',
      radius: 2,
      width: 16,
      height: 256,
      opacity: 0.45,
    })
    // zOrder：高于轨道（+4）与 item（+2/3）
    img.zOrder = FLOAT_LAYER_BIAS + this._zOrderLift + 5
    thumb.addComponent(img)
    // thumb 可拖动（拖动 → 定位滚动）
    const clickable = new ClickableComponent(thumb)
    clickable.layer = 'ui'
    clickable.onDragStart = (_sx, sy) => {
      this._thumbDrag = { sy, baseOffset: this._scrollOffset }
    }
    clickable.onDragMove = (_sx, sy) => {
      const session = this._thumbDrag
      if (!session) return
      const rect = PhySys.viewportElement?.getBoundingClientRect()
      const worldPerPx = rect && rect.height > 0 ? UI_CANVAS_H / rect.height : 0.02
      const [cw, ch] = this._containerSize()
      const maxScroll = Math.max(0, this._totalCount - this._resolveVisibleCount())
      if (maxScroll <= 0) return
      const thumbH = this._thumbHeight(ch)
      const travel = ch - thumbH
      if (travel <= 0) return
      // thumb 下移 → offset 增加（滚动条语义：看后面更多内容）
      const deltaY = (sy - session.sy) * worldPerPx
      this.scrollOffset = session.baseOffset + (deltaY / travel) * maxScroll
    }
    thumb.addComponent(clickable)
    thumb.attachTo(track)
    // 幂等保险：owner 已 BeginPlay（重建场景）时手动触发，父链传播不会重复
    if (!thumb.bHasBegunPlay) thumb.BeginPlay()
    this._scrollbarThumb = thumb
    // 滚动条为程序化创建（不经过 spawnUIActor），挂载后重排树序：
    // 滚动条位于容器树末尾 → 树序靠后 → 盖过列表 item（大纲顺序即渲染层级）
    this.owner.world?.ui?.reassignTreeOrder()
    logger.info(`[UIScrollListComponent] 滚动条已创建: owner="${this.owner.name}" track zOrder=${trackImg.zOrder} thumb zOrder=${img.zOrder}`)
  }

  /** 销毁滚动条（轨道 + 滑块） */
  private _destroyScrollbar(): void {
    const track = this._scrollbarTrack
    this._scrollbarTrack = null
    this._scrollbarThumb = null
    this._thumbDrag = null
    // thumb 挂 track 下，销毁 track 会递归销毁 thumb
    if (track && !track.bPendingDestroy) track.destroy()
  }

  /** 容器世界尺寸（fallback：按 item 尺寸 × 可视数估算） */
  private _containerSize(): [number, number] {
    const tf = this.owner.getComponent(UITransformComponent)
    const [iw, ih] = this._itemSize
    return tf?.getWorldSize() ?? [iw * 2, ih * this._resolveVisibleCount()]
  }

  /** 滚动条 thumb 高度：可视占比 × 容器高（保底 0.15） */
  private _thumbHeight(ch: number): number {
    const total = Math.max(1, this._totalCount)
    return Math.max(0.15, ch * (this._resolveVisibleCount() / total))
  }

  /**
   * 更新滚动条（轨道尺寸 + thumb 尺寸/位置）（_layout 末尾调用）。
   * 轨道：右侧整条（高 = 容器高）；thumb：按 offset 比例在轨道内滑动。
   */
  private _updateScrollbar(): void {
    const track = this._scrollbarTrack
    const thumb = this._scrollbarThumb
    if (!track || !thumb) return
    const trackTsf = track.getComponent(UITransformComponent)
    const tsf = thumb.getComponent(UITransformComponent)
    if (!trackTsf || !tsf) return
    const [cw, ch] = this._containerSize()
    const maxScroll = Math.max(0, this._totalCount - this._resolveVisibleCount())
    // 内容未超框 → 隐藏整个滚动条
    if (maxScroll <= 0) {
      track.bActive = false
      return
    }
    track.bActive = true
    // 轨道：右侧贴边，高 = 容器高
    const trackW = 0.1
    trackTsf.setWorldSize(trackW, ch)
    trackTsf.anchorOffset = [cw / 2 - trackW / 2, 0]
    // thumb：居中于轨道，高按可视占比，y 按 offset 比例滑动
    const thumbW = 0.08
    const thumbH = this._thumbHeight(ch)
    tsf.setWorldSize(thumbW, thumbH)
    const travel = ch - thumbH
    const ratio = Math.max(0, Math.min(1, this._softOffset() / maxScroll))
    const y = ch / 2 - thumbH / 2 - travel * ratio
    tsf.anchorOffset = [0, y]
  }

  /** 全部池 item 重新绑定拖拽（draggable 开关变化时调用） */
  private _bindAllItemDrag(): void {
    for (const item of this._pool) {
      if (this._draggable) this._bindItemDrag(item)
      else this._unbindItemDrag(item)
    }
  }

  /**
   * 绑定 item 鼠标拖拽：按下后拖动 → 滚动列表（滚动条式：往下/右拖 → 内容往上/左移，看后面的内容）。
   * 复用 item 上已有 ClickableComponent（UIButtonComponent 自动挂载）；onDragStart/onDragMove
   * 是独立字段（UIButtonComponent 不占用），且绑定 onDragMove 后 ClickableComponent 自动启用
   * "拖拽取消点击"（位移超阈值松开不触发按钮 onClick）。
   */
  private _bindItemDrag(item: Actor): void {
    const clickable = item.getComponent(ClickableComponent)
    if (!clickable) return
    clickable.onDragStart = (sx, sy) => {
      // 拖拽开始：取消进行中的回弹补间（避免新旧动画冲突）
      if (this._bounceTween) {
        this._bounceTween.kill()
        this._bounceTween = null
      }
      this._dragSession = { sx, sy, baseOffset: this._scrollOffset }
      this._dragOverscrolled = false
      logger.debug(`[UIScrollListComponent] 拖拽开始: owner="${this.owner.name}" 基准 offset=${this._scrollOffset.toFixed(2)}`)
    }
    clickable.onDragMove = (sx, sy) => {
      const session = this._dragSession
      if (!session) return
      // 屏幕像素 → UI 世界单位（UI 画布高恒定 5.4，垂直方向始终铺满视口）
      const rect = PhySys.viewportElement?.getBoundingClientRect()
      const worldPerPx = rect && rect.height > 0 ? UI_CANVAS_H / rect.height : 0.02
      const [iw, ih] = this._itemSize
      const step = this._direction === 'vertical' ? ih + this._spacing : iw + this._spacing
      // 内容跟随手指（自然拖拽约定）：手指下移/右移（sy/sx 增大）→ 内容下移/右移
      // （offset 减少，看前面的内容）；滚轮保持"往下滚=看后面"，两者互补。
      // _setDragOffset 允许越界（松手回弹）
      const deltaPx = this._direction === 'vertical' ? sy - session.sy : sx - session.sx
      this._setDragOffset(session.baseOffset - (deltaPx * worldPerPx) / step)
      // 记录本次拖拽是否真正越界（松手仅越界过才回弹，正常滑动不弹）
      const maxScroll = Math.max(0, this._totalCount - this._resolveVisibleCount())
      if (this._scrollOffset < -0.001 || this._scrollOffset > maxScroll + 0.001) {
        this._dragOverscrolled = true
      }
    }
    clickable.onDragEnd = () => this._bounceBack()
  }

  /** 解绑 item 拖拽（draggable=false 时） */
  private _unbindItemDrag(item: Actor): void {
    const clickable = item.getComponent(ClickableComponent)
    if (!clickable) return
    clickable.onDragStart = null
    clickable.onDragMove = null
    clickable.onDragEnd = null
    this._dragSession = null
  }

  /**
   * 拖拽专用滚动：直接写原始偏移（允许越界 overscroll，_layout 软钳制呈现橡皮筋）。
   * 松手由 _bounceBack 回弹到边界。滚轮/API 仍走 scrollOffset setter（硬钳制）。
   */
  private _setDragOffset(v: number): void {
    this._scrollOffset = v
    this._layout()
  }

  /**
   * 松手回弹：仅当本次拖拽**真正越界过**（_dragOverscrolled）才平滑补间回合法边界（橡皮筋效果）。
   * 正常滑动（界内）松手不弹——不创建补间、不加偏移。补间写原始偏移 + 手动 layout（不走 setter，避免被立即钳制）。
   */
  private _bounceBack(): void {
    if (!this._dragOverscrolled) return
    this._dragOverscrolled = false
    const maxScroll = Math.max(0, this._totalCount - this._resolveVisibleCount())
    const target = Math.max(0, Math.min(maxScroll, this._scrollOffset))
    if (Math.abs(target - this._scrollOffset) < 0.001) return
    const start = this._scrollOffset
    this._bounceTween = TweenSystem.instance.to({ v: start }, { v: target }, {
      duration: 0.25,
      easing: 'quadOut',
      onUpdate: (values) => {
        this._scrollOffset = (values.v as number)
        this._layout()
      },
      onComplete: () => {
        this._bounceTween = null
      },
    })
    logger.debug(`[UIScrollListComponent] 松手回弹: owner="${this.owner.name}" ${start.toFixed(2)} → ${target.toFixed(2)}`)
  }

  /** 递归整树抬升 zOrder（所有 CanvasUIComponent，含 UIText/UIImage 等派生 setter 同步 renderOrder） */
  private _liftZOrder(actor: Actor): void {
    for (const comp of actor.getComponents(CanvasUIComponent)) {
      comp.zOrder += this._zOrderLift
    }
    for (const child of actor.getChildren()) this._liftZOrder(child)
  }

  /** 清空对象池（销毁全部 item） */
  private _clearPool(): void {
    const ui = this.owner.world?.ui
    for (const item of this._pool) {
      if (ui && !item.bPendingDestroy) ui.destroyUIActor(item)
    }
    this._pool = []
    this._baseOffsets.clear()
    this._basePositions.clear()
    this._itemIndices.clear()
    this._dragSession = null
    this._destroyScrollbar()
  }

  /** 滚动偏移钳制：不越过末尾（最后一项仍可完整显示） */
  private _clampScroll(): void {
    const maxScroll = Math.max(0, this._totalCount - this._resolveVisibleCount())
    if (this._scrollOffset > maxScroll) this._scrollOffset = maxScroll
  }

  /**
   * 布局用软钳制偏移（橡皮筋）：越界部分衰减 1/3 呈现"被拉住"的效果。
   * 拖拽 overscroll 时 item 会越出边界但不至于飞走；松手回弹到边界。
   */
  private _softOffset(): number {
    const maxScroll = Math.max(0, this._totalCount - this._resolveVisibleCount())
    let o = this._scrollOffset
    if (o < 0) o /= 3
    else if (o > maxScroll) o = maxScroll + (o - maxScroll) / 3
    return o
  }

  /** 按当前偏移排布所有池内 item */
  private _layout(): void {
    if (!this._initialized) return
    const [iw, ih] = this._itemSize
    const step = this._direction === 'vertical' ? ih + this._spacing : iw + this._spacing
    // 用软钳制值排布（拖拽越界时呈现橡皮筋，正常滚动时等于原始值）
    const soft = this._softOffset()
    const start = Math.floor(soft)
    // 滚动小数部分（平滑滚动：offset=1.5 → item 位于 1 与 2 之间）
    const frac = soft - start
    let activeCount = 0
    for (let i = 0; i < this._pool.length; i++) {
      const item = this._pool[i]
      if (!item) continue
      const index = start + i
      // 出界隐藏（负索引也要隐藏：顶部橡皮筋拖拽时 soft < 0 会让 start = -1，
      // 若不隐藏 index < 0 的槽位，会触发 onItemSpawned(item, -1) 刷新出错误内容，
      // 且所有可见 item 同时重映射索引重建纹理——表现为拖拽/回弹边界的"跳跃/闪烁"）
      if (index < 0 || index >= this._totalCount) {
        // 出界隐藏：清除 memo（重新入界时必然刷新内容）
        item.bActive = false
        this._itemIndices.delete(item)
        continue
      }
      // 滚动位移 = (i - frac) * step（注意：不是 (index - frac)——index = start + i，
      // 用 index - frac 会多出 start×step 偏移：①滚动后内容顶部空出空白；
      // ②拖拽跨整数边界（start 递增）时位置跳跃 ~1×step。正确公式 index - soft = i - frac，
      // 保证 offset 连续变化时位置连续。垂直向下排列（-y），水平向右排列（+x））
      const pos = (i - frac) * step
      const tsf = item.getComponent(UITransformComponent)
      if (tsf) {
        // 热路径：直接 setPosition（基准世界坐标 + 位移），跳过 anchorOffset setter 的
        // applyAnchor 父链遍历与 setWorldSize 尺寸重建——尺寸布局期已设好不变
        const [bx, by] = this._basePositions.get(item) ?? [0, 0]
        const rp = item.root.position
        if (this._direction === 'vertical') {
          item.setPosition(bx, by - pos, rp.z)
        } else {
          item.setPosition(bx + pos, by, rp.z)
        }
      }
      item.bActive = true
      activeCount++
      // memo：索引变化才刷新 item 内容（滚动只改位置，内容不变不重建纹理）
      if (this._itemIndices.get(item) !== index) {
        this._itemIndices.set(item, index)
        this.onItemSpawned?.(item, index)
      }
    }
    // 滚动条 thumb 跟随
    this._updateScrollbar()
    logger.debug(`[UIScrollListComponent] layout: owner="${this.owner.name}" offset=${this._scrollOffset.toFixed(2)} soft=${soft.toFixed(2)} total=${this._totalCount} pool=${this._pool.length} active=${activeCount}`)
  }
}
