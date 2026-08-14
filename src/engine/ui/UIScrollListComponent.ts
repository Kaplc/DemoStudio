/**
 * UIScrollListComponent — 滚动列表组件（item 对象池 + 滚动偏移）
 *
 * 挂在列表容器 Actor 上，按 direction 排布 item：
 *  - itemWidget：item 蓝图路径（每项实例化；可在 onItemSpawned 回调中填充内容）
 *  - itemSize：[w, h] 世界尺寸（默认 1×0.4）
 *  - spacing：项间距（默认 0.1）
 *  - visibleCount：可视数量（默认 5）——决定对象池大小
 *  - scrollOffset：滚动偏移（项单位，可为小数）
 *  - onItemSpawned(itemActor, index)：item 生成回调（设置文本/图标/点击）
 *
 * 实现：对象池化（visibleCount + 1 个 item 复用），setScrollOffset/scrollBy 时按
 * offset 重排所有 item 位置并更新索引；超范围 item 隐藏（bActive=false）。
 * 注：列表不裁剪溢出可视区（引擎无 mask）；如需裁切，容器外 item 由 active 隐藏。
 *
 * 资产配置示例：
 *   { "baseClass": "UIScrollListComponent", "properties": {
 *       "itemWidget": "asset/blueprints/ui/troop_card.blueprint.json",
 *       "itemSize": [1.2, 0.5], "spacing": 0.15, "visibleCount": 5 } }
 *
 * 用法（脚本）：
 *   const list = actor.getComponent(UIScrollListComponent)
 *   list.totalCount = 20
 *   list.onItemSpawned = (item, idx) => { item.getComponent(UITextComponent)!.text = `第 ${idx} 项` }
 *   list.scrollBy(1)   // 向下滚动 1 项
 */
import { ActorComponent, type EditableProperty } from '../entity/ActorComponent'
import { UITransformComponent } from './UITransformComponent'
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
  /** 可视数量（对象池大小，默认 5） */
  visibleCount?: number
  /** 滚动方向（默认 vertical：自上而下） */
  direction?: UIScrollDirection
}

export class UIScrollListComponent extends ActorComponent<Actor> {
  private _itemWidget: string | null
  private _itemSize: [number, number]
  private _spacing: number
  private _visibleCount: number
  private _direction: UIScrollDirection

  private _totalCount = 0
  private _scrollOffset = 0
  /** 对象池：item Actor 列表（长度 visibleCount + 1） */
  private _pool: Actor[] = []
  /** item 生成回调（itemActor, index） */
  onItemSpawned: ((item: Actor, index: number) => void) | null = null
  private _initialized = false

  constructor(owner: Actor, options: UIScrollListComponentOptions = {}) {
    super(owner)
    this.name = 'UIScrollListComponent'
    this._itemWidget = options.itemWidget ?? null
    this._itemSize = options.itemSize ?? [1, 0.4]
    this._spacing = options.spacing ?? 0.1
    this._visibleCount = Math.max(1, options.visibleCount ?? 5)
    this._direction = options.direction ?? 'vertical'
  }

  /** 列表总项数 */
  get totalCount(): number { return this._totalCount }
  set totalCount(v: number) {
    this._totalCount = Math.max(0, v)
    this._clampScroll()
    this._layout()
  }

  /** 滚动偏移（项单位；0 = 顶部/起始） */
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
  get visibleCount(): number { return this._visibleCount }
  set visibleCount(v: number) {
    this._visibleCount = Math.max(1, v)
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
        set: (v) => { this._visibleCount = Math.max(1, v as number); this._initialize() },
      },
      {
        key: 'direction', type: 'enum', options: ['vertical', 'horizontal'],
        get: () => this._direction,
        set: (v) => { this.direction = v as UIScrollDirection },
      },
    ]
  }

  override BeginPlay(): void {
    super.BeginPlay()
    this._initialize()
  }

  /** 滚动指定项数（正 = 向末尾滚动） */
  scrollBy(deltaItems: number): void {
    this.scrollOffset = this._scrollOffset + deltaItems
  }

  /** 滚动到指定项 */
  scrollTo(index: number): void {
    this.scrollOffset = index
  }

  /** 手动刷新（totalCount/onItemSpawned 变化后调用） */
  refresh(): void {
    this._layout()
  }

  // ─── 内部 ─────────────────────────────────

  /** 初始化对象池（首次或 widget/visibleCount 变化时重建） */
  private _initialize(): void {
    const ui = this.owner.world?.ui
    if (!this._itemWidget || !ui) {
      logger.warn('[UIScrollListComponent] 未配置 itemWidget 或 owner 未挂 World，跳过初始化')
      return
    }
    this._initialized = true
    this._clearPool()
    // 池大小 = 可视 + 1（滚动时上下各多一个缓冲）
    for (let i = 0; i < this._visibleCount + 1; i++) {
      const item = ui.spawnUIActor(this._itemWidget, this.owner)
      if (!item) {
        logger.error(`[UIScrollListComponent] item 生成失败: ${this._itemWidget}（第 ${i} 个）`)
        break
      }
      item.bActive = false
      this._pool.push(item)
    }
    this._layout()
  }

  /** 清空对象池（销毁全部 item） */
  private _clearPool(): void {
    const ui = this.owner.world?.ui
    for (const item of this._pool) {
      if (ui && !item.bPendingDestroy) ui.destroyUIActor(item)
    }
    this._pool = []
  }

  /** 滚动偏移钳制：不越过末尾（最后一项仍可完整显示） */
  private _clampScroll(): void {
    const step = this._itemSize[1] + this._spacing
    const maxScroll = Math.max(0, this._totalCount - this._visibleCount)
    if (this._scrollOffset > maxScroll) this._scrollOffset = maxScroll
  }

  /** 按当前偏移排布所有池内 item */
  private _layout(): void {
    if (!this._initialized) return
    const step = this._direction === 'vertical'
      ? this._itemSize[1] + this._spacing
      : this._itemSize[0] + this._spacing
    const start = Math.floor(this._scrollOffset)
    // 滚动小数部分（平滑滚动：offset=1.5 → item 位于 1 与 2 之间）
    const frac = this._scrollOffset - start
    for (let i = 0; i < this._pool.length; i++) {
      const item = this._pool[i]
      if (!item) continue
      const index = start + i
      if (index >= this._totalCount) {
        item.bActive = false
        continue
      }
      // 位置：容器中心为基准，垂直列表向下排列（-y），水平列表向右排列（+x）
      const pos = (start + i - frac) * step
      const tsf = item.getComponent(UITransformComponent)
      if (tsf) {
        const [w, h] = this._itemSize
        tsf.setWorldSize(w, h)
        const [ox, oy] = tsf.anchorOffset
        tsf.anchorOffset = this._direction === 'vertical'
          ? [ox, oy - pos]
          : [ox + pos, oy]
      }
      item.bActive = true
      this.onItemSpawned?.(item, index)
    }
  }
}
