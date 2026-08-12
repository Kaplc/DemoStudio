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
}

export class UILayoutComponent extends ActorComponent<Actor> {
  private _mode: UILayoutMode
  private _columns: number
  private _spacingX: number
  private _spacingY: number
  private _autoLayout: boolean
  /** 上次布局的子项签名（数量 + 名字序列），用于 Tick 变化检测 */
  private _lastSignature = ''

  constructor(owner: Actor, options: UILayoutComponentOptions = {}) {
    super(owner)
    this.name = 'UILayoutComponent'
    this._mode = options.mode ?? 'grid'
    this._columns = options.columns ?? 5
    this._spacingX = options.spacingX ?? 0.2
    this._spacingY = options.spacingY ?? 0.2
    this._autoLayout = options.autoLayout ?? true
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
   */
  layout(): void {
    const children = this.owner
      .getChildren()
      .filter((c) => c.getComponent(UITransformComponent))
    if (children.length === 0) return

    // 以第一个子项的尺寸作为统一格子步长基准（布局容器通常子项等大）
    const first = children[0].getComponent(UITransformComponent)!
    const [itemW, itemH] = first.getWorldSize()
    const n = children.length
    const cols = Math.max(1, this._columns)

    // 计算每个子项相对父中心的偏移 [x, y]
    const offsets: Array<[number, number]> = []
    for (let i = 0; i < n; i++) {
      if (this._mode === 'horizontal') {
        offsets.push([
          (i - (n - 1) / 2) * (itemW + this._spacingX),
          0,
        ])
      } else if (this._mode === 'vertical') {
        offsets.push([
          0,
          ((n - 1) / 2 - i) * (itemH + this._spacingY),
        ])
      } else {
        // grid：首行在上，逐行向下
        const row = Math.floor(i / cols)
        const col = i % cols
        const rows = Math.ceil(n / cols)
        offsets.push([
          (col - (cols - 1) / 2) * (itemW + this._spacingX),
          ((rows - 1) / 2 - row) * (itemH + this._spacingY),
        ])
      }
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
    logger.debug(`[UILayoutComponent] "${this.owner.root.name}" ${this._mode} 布局完成: ${n} 个子项（步长 ${itemW.toFixed(2)}x${itemH.toFixed(2)}）`)
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      mode: this._mode,
      columns: this._columns,
      spacingX: this._spacingX,
      spacingY: this._spacingY,
      autoLayout: this._autoLayout,
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
    ]
  }
}
