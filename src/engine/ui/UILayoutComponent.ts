/**
 * UILayoutComponent — UI 布局组件（水平 / 垂直 / 网格）
 *
 * 挂在容器 Actor 上，自动按模式排列其所有子 UI 节点：
 *  - 'horizontal'：子项沿 X 轴等间距单行排列
 *  - 'vertical'  ：子项沿 Y 轴等间距单列排列
 *  - 'grid'      ：按 columns 列数分多行排列（首行在上，行间/列间各自间距）
 *
 * 定位语义：每个子项的 UITransformComponent 为 anchor=center + anchorOffset，
 * 布局即写入 anchorOffset（相对父容器中心的世界偏移）并 applyAnchor 生效；
 * 子项未配置锚点时退回直接 setPosition（相对父 Actor 的本地坐标）。
 * 因此子项的世界尺寸（worldWidth/worldHeight）决定格子步长：
 * 步长 = 子项尺寸 + 对应方向 spacing。
 *
 * 触发时机：
 *  - BeginPlay 初次布局（树构建完成后）
 *  - Tick 自动检测子项数量/名字变化 → 重新布局（autoLayout，默认开）
 *  - 代码主动调用 layout()（如脚本动态生成子节点后）
 *
 * 资产配置示例（挂在兵营 TroopList 容器上）：
 *   { "baseClass": "UILayoutComponent", "properties": { "mode": "grid", "columns": 5, "spacingX": 0.2, "spacingY": 0.12 } }
 */
import { ActorComponent, type EditableProperty } from '../entity/ActorComponent'
import { UITransformComponent } from './UITransformComponent'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'

export type UILayoutMode = 'horizontal' | 'vertical' | 'grid'

/**
 * 主轴分布（justify-content 语义，仅 horizontal/vertical 模式生效；grid 忽略）。
 * 缺省 center：与旧版等间距居中排列公式完全一致（旧资产不重排）。
 */
export type UILayoutJustify =
  | 'start' | 'center' | 'end'
  | 'space-between' | 'space-around' | 'space-evenly'

/**
 * 交叉轴对齐（align-items 语义，仅 horizontal/vertical 模式生效；grid 忽略）。
 * 缺省 center：旧版子项交叉轴恒居中（offset=0），缺省值保持行为不变。
 * stretch：未显式设置该轴尺寸的子项拉伸至容器内尺寸（写回 worldWidth/worldHeight）。
 */
export type UILayoutAlign = 'start' | 'center' | 'end' | 'stretch'

/** justify 六枚举（Inspector 下拉 + assetLint schema 共用） */
export const UILAYOUT_JUSTIFY_OPTIONS: UILayoutJustify[] = [
  'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly',
]
/** align 四枚举（Inspector 下拉 + assetLint schema 共用） */
export const UILAYOUT_ALIGN_OPTIONS: UILayoutAlign[] = ['start', 'center', 'end', 'stretch']

export interface UILayoutComponentOptions {
  /** 布局模式：horizontal 水平 / vertical 垂直 / grid 网格（默认 grid） */
  mode?: UILayoutMode
  /** 网格列数（仅 grid 模式生效，默认 5） */
  columns?: number
  /** X 轴方向子项间距（世界单位，默认 0.2） */
  spacingX?: number
  /** Y 轴方向子项间距（世界单位，默认 0.2） */
  spacingY?: number
  /** 是否自动布局（默认 true：Tick 检测子项变化后重排；false 时仅 BeginPlay + 手动 layout()） */
  autoLayout?: boolean
  /** 主轴分布（justify-content 语义，缺省 center，与旧版居中排列一致） */
  justify?: UILayoutJustify
  /** 交叉轴对齐（align-items 语义，缺省 center；stretch = 未显式设尺寸的子项拉伸至容器内尺寸） */
  align?: UILayoutAlign
}

export class UILayoutComponent extends ActorComponent<Actor> {
  private _mode: UILayoutMode
  private _columns: number
  private _spacingX: number
  private _spacingY: number
  private _autoLayout: boolean
  private _justify: UILayoutJustify
  private _align: UILayoutAlign
  /** 上次布局的子项签名（数量 + 名字序列），用于 Tick 变化检测 */
  private _lastSignature = ''
  /** 子项基准尺寸快照（uid → [w,h]）：首次布局时记录，stretch 写回不污染基准（重排无漂移） */
  private _baseSizes = new Map<number, [number, number]>()
  /** 容器尺寸不可得时只告警一次（避免每帧刷屏） */
  private _containerWarned = false

  constructor(owner: Actor, options: UILayoutComponentOptions = {}) {
    super(owner)
    this.name = 'UILayoutComponent'
    this._mode = options.mode ?? 'grid'
    this._columns = options.columns ?? 5
    this._spacingX = options.spacingX ?? 0.2
    this._spacingY = options.spacingY ?? 0.2
    this._autoLayout = options.autoLayout ?? true
    this._justify = options.justify ?? 'center'
    this._align = options.align ?? 'center'
  }

  get mode(): UILayoutMode { return this._mode }
  set mode(v: UILayoutMode) {
    if (this._mode === v) return
    this._mode = v
    this.layout()
  }
  get columns(): number { return this._columns }
  set columns(v: number) {
    if (this._columns === v) return
    this._columns = Math.max(1, Math.floor(v))
    this.layout()
  }
  get spacingX(): number { return this._spacingX }
  set spacingX(v: number) {
    if (this._spacingX === v) return
    this._spacingX = v
    this.layout()
  }
  get spacingY(): number { return this._spacingY }
  set spacingY(v: number) {
    if (this._spacingY === v) return
    this._spacingY = v
    this.layout()
  }
  get autoLayout(): boolean { return this._autoLayout }
  set autoLayout(v: boolean) { this._autoLayout = v }
  get justify(): UILayoutJustify { return this._justify }
  set justify(v: UILayoutJustify) {
    if (this._justify === v) return
    this._justify = v
    this.layout()
  }
  get align(): UILayoutAlign { return this._align }
  set align(v: UILayoutAlign) {
    if (this._align === v) return
    this._align = v
    this.layout()
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 树构建完成（所有 attachTo 已就绪）后初次布局
    this.layout()
  }

  override Tick(_dt: number): void {
    super.Tick(_dt)
    // 自动布局：子项集合变化（数量/名字）时重排，避免每帧无谓重算
    if (!this._autoLayout) return
    const sig = this.owner
      .getChildren()
      .map((c) => c.root.name)
      .join('|')
    if (sig !== this._lastSignature) {
      this._lastSignature = sig
      this.layout()
    }
  }

  /**
   * 重新布局所有子 UI 节点（水平/垂直/网格）。
   * 动态生成子节点后（如脚本 spawnUIActor）调用本方法即可对齐网格。
   *
   * 对齐语义（justify/align，仅 horizontal/vertical 生效，grid 忽略）：
   *  - justify 定主轴分布：start 首项贴起始边、center 整组居中（与旧公式逐位一致）、
   *    end 末项贴终止边、space-* 按 CSS 定义重新分布间隔
   *  - align 定交叉轴对齐：start/end 贴边、center 居中、
   *    stretch 把未显式设置该轴尺寸的子项拉伸至容器内尺寸
   *  - 容器尺寸取 owner 的 uitransform（markerOnly 容器也有显式尺寸）；
   *    不可得时 justify/align 全部退回 center 行为（与旧版一致）并告警一次
   */
  layout(): void {
    const children = this.owner
      .getChildren()
      .filter((c) => c.getComponent(UITransformComponent))
    if (children.length === 0) return

    // 子项基准尺寸：首次布局时快照（uid 键）。stretch 写回 worldSize 不置 explicit，
    // 后续改回 center 等对齐时恢复基准尺寸；快照保证重排不再漂移
    const baseSizes: Array<[number, number]> = []
    const liveUids = new Set<number>()
    for (const c of children) {
      liveUids.add(c.uid)
      let base = this._baseSizes.get(c.uid)
      if (!base) {
        base = c.getComponent(UITransformComponent)!.getWorldSize()
        this._baseSizes.set(c.uid, base)
      }
      baseSizes.push(base)
    }
    for (const uid of [...this._baseSizes.keys()]) {
      if (!liveUids.has(uid)) this._baseSizes.delete(uid)
    }

    // 以第一个子项的基准尺寸作为统一格子步长基准（布局容器通常子项等大）
    const [itemW, itemH] = baseSizes[0]
    const n = children.length
    const cols = Math.max(1, this._columns)

    // 计算每个子项相对父中心的偏移 [x, y]
    const offsets: Array<[number, number]> = []
    // stretch 需写回的子项尺寸（uid → [w,h]，循环末统一应用）
    const stretchTo = new Map<number, [number, number]>()

    if (this._mode === 'grid') {
      // grid：首行在上，逐行向下（justify/align 不参与，保持旧公式）
      const rows = Math.ceil(n / cols)
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols)
        const col = i % cols
        offsets.push([
          (col - (cols - 1) / 2) * (itemW + this._spacingX),
          ((rows - 1) / 2 - row) * (itemH + this._spacingY),
        ])
      }
    } else {
      // horizontal / vertical：主轴 justify + 交叉轴 align
      const horizontal = this._mode === 'horizontal'
      const gap = horizontal ? this._spacingX : this._spacingY
      // 容器尺寸（owner 自身 uitransform；不可得 → 退回 center 语义）
      const ownTf = this.owner.getComponent(UITransformComponent)
      const container = ownTf?.worldSizeExplicit ? ownTf.getWorldSize() : null
      if (!container && (this._justify !== 'center' || this._align !== 'center') && !this._containerWarned) {
        this._containerWarned = true
        logger.warn(`[UILayoutComponent] "${this.owner.root.name}" 容器无显式尺寸，justify/align 退回 center（请给容器设置 worldWidth/worldHeight）`)
      }
      const mainSize = container ? (horizontal ? container[0] : container[1]) : 0
      const crossSize = container ? (horizontal ? container[1] : container[0]) : 0
      const itemMain = horizontal ? itemW : itemH
      const content = n * itemMain + (n - 1) * gap

      // 主轴偏移（CSS 主轴方向的带符号值：horizontal 正=右，vertical 正=下）
      const mainOffsets: number[] = []
      const justify = container ? this._justify : 'center'
      const half = itemMain / 2
      for (let i = 0; i < n; i++) {
        switch (justify) {
          case 'start':
            mainOffsets.push(-(mainSize / 2 - half) + i * (itemMain + gap))
            break
          case 'end':
            mainOffsets.push(mainSize / 2 - half - (n - 1 - i) * (itemMain + gap))
            break
          case 'space-between': {
            const g = n > 1 ? (mainSize - content) / (n - 1) : gap
            mainOffsets.push(-(mainSize / 2 - half) + i * (itemMain + g))
            break
          }
          case 'space-around': {
            const a = (mainSize - content) / (2 * n)
            mainOffsets.push(-mainSize / 2 + a + half + i * (itemMain + 2 * a))
            break
          }
          case 'space-evenly': {
            const g = (mainSize - content) / (n + 1)
            mainOffsets.push(-mainSize / 2 + g + half + i * (itemMain + g))
            break
          }
          // center（缺省）：与旧版公式逐位一致
          case 'center':
          default:
            mainOffsets.push((i - (n - 1) / 2) * (itemMain + gap))
            break
        }
      }

      for (let i = 0; i < n; i++) {
        const tf = children[i].getComponent(UITransformComponent)!
        const [bw, bh] = baseSizes[i]
        let ox = 0
        let oy = 0
        if (horizontal) {
          // 主轴 x：CSS 左→右 = 世界 -x→+x
          ox = mainOffsets[i]
          // 交叉轴 y：CSS top 起始边 = 世界 +y
          const chHalf = bh / 2
          if (this._align === 'start') oy = crossSize / 2 - chHalf
          else if (this._align === 'end') oy = -(crossSize / 2 - chHalf)
          else {
            oy = 0
            if (this._align === 'stretch' && container && !tf.worldHeightExplicit) {
              stretchTo.set(children[i].uid, [bw, crossSize])
            }
          }
        } else {
          // 主轴 y：CSS top→bottom = 世界 +y→-y（取负）
          oy = -mainOffsets[i]
          // 交叉轴 x：CSS left 起始边 = 世界 -x
          const cwHalf = bw / 2
          if (this._align === 'start') ox = -(crossSize / 2 - cwHalf)
          else if (this._align === 'end') ox = crossSize / 2 - cwHalf
          else {
            ox = 0
            if (this._align === 'stretch' && container && !tf.worldWidthExplicit) {
              stretchTo.set(children[i].uid, [crossSize, bh])
            }
          }
        }
        offsets.push([ox, oy])
      }
    }

    // stretch 尺寸写回（applyExplicit=false：不置 explicit 标志，改 align 后可恢复基准）
    for (let i = 0; i < children.length; i++) {
      const stretch = stretchTo.get(children[i].uid)
      if (stretch) children[i].getComponent(UITransformComponent)!.setWorldSize(stretch[0], stretch[1], false)
    }

    for (let i = 0; i < children.length; i++) {
      const tf = children[i].getComponent(UITransformComponent)!
      const [ox, oy] = offsets[i]
      if (tf.anchor) {
        // 锚点定位：anchorOffset 即相对父中心的偏移（anchor=center 时）
        tf.anchorOffset = [ox, oy]
        tf.applyAnchor()
      } else {
        // 无锚点：直接设相对父 Actor 的本地位置（z 保持父容器层级）
        tf.setPosition(ox, oy, 0)
      }
    }
    logger.debug(`[UILayoutComponent] "${this.owner.root.name}" ${this._mode} 布局完成: ${n} 个子项（步长 ${itemW.toFixed(2)}x${itemH.toFixed(2)}，justify=${this._justify}，align=${this._align}）`)
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      mode: this._mode,
      columns: this._columns,
      spacingX: this._spacingX,
      spacingY: this._spacingY,
      autoLayout: this._autoLayout,
      justify: this._justify,
      align: this._align,
      childCount: this.owner.getChildren().length,
    }
  }

  /** Inspector 可编辑属性 + 资产持久化（camelCase 与 JSON 属性名一致） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'mode', type: 'enum', options: ['horizontal', 'vertical', 'grid'],
        get: () => this._mode,
        set: (v) => { this.mode = v as UILayoutMode },
      },
      {
        key: 'columns', type: 'number', step: 1, min: 1, max: 64,
        get: () => this._columns,
        set: (v) => { this.columns = v as number },
      },
      {
        key: 'spacingX', type: 'number', step: 0.01, min: 0, max: 10,
        get: () => this._spacingX,
        set: (v) => { this.spacingX = v as number },
      },
      {
        key: 'spacingY', type: 'number', step: 0.01, min: 0, max: 10,
        get: () => this._spacingY,
        set: (v) => { this.spacingY = v as number },
      },
      {
        key: 'autoLayout', type: 'boolean',
        get: () => this._autoLayout,
        set: (v) => { this.autoLayout = v as boolean },
      },
      {
        key: 'justify', type: 'enum', options: UILAYOUT_JUSTIFY_OPTIONS,
        get: () => this._justify,
        set: (v) => { this.justify = v as UILayoutJustify },
      },
      {
        key: 'align', type: 'enum', options: UILAYOUT_ALIGN_OPTIONS,
        get: () => this._align,
        set: (v) => { this.align = v as UILayoutAlign },
      },
    ]
  }
}
