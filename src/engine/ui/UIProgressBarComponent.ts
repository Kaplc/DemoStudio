/**
 * UIProgressBarComponent — 进度条/血条组件
 *
 * 挂在容器 Actor 上，驱动一个 fill 子 Actor（UIImage）的尺寸按比例填充：
 *  - value/min/max：数值模型（默认 0-100），setValue 时自动刷新
 *  - fillActorName：fill 子 Actor 名（默认 "Fill"），其上挂 UIImageComponent + UITransformComponent
 *  - direction：填充方向（left-to-right 默认 / right-to-left / bottom-to-top / top-to-bottom）
 *
 * 填充实现：水平方向改 fill 的 UITransform.worldWidth（锚点 middle-left/middle-right 贴合容器内边），
 * 垂直方向改 worldHeight（锚点 bottom-center/top-center）。fill 尺寸必须从锚点贴边生长，
 * 因此 fill 子节点应配置对应方向的锚点（middle-left / middle-right / bottom-center / top-center）。
 *
 * 资产配置示例（血条容器）：
 *   { "baseClass": "UIProgressBarComponent", "properties": {
 *       "value": 50, "min": 0, "max": 100,
 *       "fillActorName": "HealthFill", "direction": "left-to-right" } }
 *
 * 用法（脚本）：
 *   const bar = actor.getComponent(UIProgressBarComponent)
 *   bar.max = 100; bar.value = 37   // 自动刷新 fill 宽度
 */
import { ActorComponent, type EditableProperty } from '../entity/ActorComponent'
import { UITransformComponent } from './UITransformComponent'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'

export type UIProgressDirection = 'left-to-right' | 'right-to-left' | 'bottom-to-top' | 'top-to-bottom'

export interface UIProgressBarComponentOptions {
  /** 当前值（默认 50） */
  value?: number
  /** 最小值（默认 0） */
  min?: number
  /** 最大值（默认 100） */
  max?: number
  /** fill 子 Actor 名（默认 "Fill"） */
  fillActorName?: string
  /** 填充方向（默认 left-to-right） */
  direction?: UIProgressDirection
}

export class UIProgressBarComponent extends ActorComponent<Actor> {
  private _value: number
  private _min: number
  private _max: number
  private _fillActorName: string
  private _direction: UIProgressDirection
  /** fill Actor 缓存（首次使用时按名查找） */
  private _fill: Actor | null = null

  constructor(owner: Actor, options: UIProgressBarComponentOptions = {}) {
    super(owner)
    this.name = 'UIProgressBarComponent'
    this._min = options.min ?? 0
    this._max = options.max ?? 100
    this._value = Math.min(this._max, Math.max(this._min, options.value ?? 50))
    this._fillActorName = options.fillActorName ?? 'Fill'
    this._direction = options.direction ?? 'left-to-right'
  }

  get value(): number { return this._value }
  set value(v: number) {
    this._value = Math.min(this._max, Math.max(this._min, v))
    this._refresh()
  }
  get min(): number { return this._min }
  set min(v: number) { this._min = v; this.value = this._value }
  get max(): number { return this._max }
  set max(v: number) { this._max = v; this.value = this._value }
  get fillActorName(): string { return this._fillActorName }
  set fillActorName(v: string) { this._fillActorName = v; this._fill = null; this._refresh() }
  get direction(): UIProgressDirection { return this._direction }
  set direction(v: UIProgressDirection) { this._direction = v; this._refresh() }

  /** 归一化进度 [0,1] */
  get ratio(): number {
    return this._max <= this._min ? 0 : (this._value - this._min) / (this._max - this._min)
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Value: `${this._value} / ${this._max}`,
      Ratio: `${(this.ratio * 100).toFixed(0)}%`,
      FillActor: this._fillActorName,
      Direction: this._direction,
    }
  }

  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'value', type: 'number', step: 1,
        get: () => this._value,
        set: (v) => { this.value = v as number },
      },
      {
        key: 'min', type: 'number', step: 1,
        get: () => this._min,
        set: (v) => { this.min = v as number },
      },
      {
        key: 'max', type: 'number', step: 1,
        get: () => this._max,
        set: (v) => { this.max = v as number },
      },
      {
        key: 'fillActorName', type: 'string',
        get: () => this._fillActorName,
        set: (v) => { this.fillActorName = v as string },
      },
      {
        key: 'direction', type: 'enum',
        options: ['left-to-right', 'right-to-left', 'bottom-to-top', 'top-to-bottom'],
        get: () => this._direction,
        set: (v) => { this.direction = v as UIProgressDirection },
      },
    ]
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 树构建完成后解析 fill + 首刷
    this._refresh()
  }

  /** 手动刷新 fill（脚本动态改名/加子节点后调用） */
  refresh(): void {
    this._fill = null
    this._refresh()
  }

  // ─── 内部 ─────────────────────────────────

  /** 按比例更新 fill 尺寸（水平改宽度，垂直改高度；锚点决定生长方向） */
  private _refresh(): void {
    if (!this._fill) {
      this._fill = this._findChildByName(this.owner, this._fillActorName)
      if (!this._fill) {
        logger.warn(`[UIProgressBarComponent] 未找到 fill 子 Actor "${this._fillActorName}"（宿主 ${this.owner.root.name}）`)
        return
      }
    }
    const tsf = this._fill.getComponent(UITransformComponent)
    if (!tsf) {
      logger.warn(`[UIProgressBarComponent] fill "${this._fillActorName}" 缺少 UITransformComponent`)
      return
    }
    const hostTsf = this.owner.getComponent(UITransformComponent)
    const [hostW, hostH] = hostTsf?.getWorldSize() ?? [0, 0]
    if (hostW <= 0 || hostH <= 0) return
    const ratio = this.ratio
    // 水平方向：改宽度（高度保持容器高）；垂直方向：改高度（宽度保持容器宽）
    if (this._direction === 'left-to-right' || this._direction === 'right-to-left') {
      tsf.setWorldSize(hostW * ratio, hostH)
    } else {
      tsf.setWorldSize(hostW, hostH * ratio)
    }
    // 锚点已配置（middle-left 等）→ applyAnchor 让 fill 贴边生长；
    // 未配置锚点 → fill 中心默认在容器中心，宽度缩小时两侧同时收缩（效果同 center 填充）
    tsf.applyAnchor()
  }

  /** 按 root.name 深度查找子 Actor */
  private _findChildByName(actor: Actor, name: string): Actor | null {
    for (const child of actor.getChildren()) {
      if (child.root.name === name) return child
      const found = this._findChildByName(child, name)
      if (found) return found
    }
    return null
  }
}
