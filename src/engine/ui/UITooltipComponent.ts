/**
 * UITooltipComponent — 悬停提示（Tooltip）组件
 *
 * 挂在任意 UI 控件 Actor 上：悬停进入 delay 秒后，在宿主上方/下方动态生成
 * tooltip 面板（经 UIManager.spawnUIActor，自动获得浮动层 zOrder 偏移），
 * 悬停离开立即销毁。
 *
 * 数据配置：
 *   { baseClass: 'UITooltipComponent', properties: {
 *       text: '提示文本',          // 必填
 *       delay: 0.3,               // 悬停延迟（秒，默认 0.3）
 *       direction: 'top',         // 'top' | 'bottom'（默认 top）
 *       widgetPath: 'asset/blueprints/ui/tooltip.widget.json'  // 可选覆盖
 *   } }
 *
 * tooltip widget 资产约定：
 *  - 根：UITransformComponent（anchor: null，position 由组件运行时写入）+ CanvasUIComponent
 *  - 子节点：name="TooltipText" 的 UITextComponent（提示文本显示于此）
 *
 * 生命周期：BeginPlay 时挂载/复用 ClickableComponent 并绑定 onHover；
 * EndPlay 时销毁 tooltip 面板并解除绑定。
 */
import { Component } from '../entity/Component'
import { ClickableComponent } from '../physics/ClickableComponent'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'
import type { UIManager } from './UIManager'
import { UITransformComponent } from './UITransformComponent'
import { UITextComponent } from './UITextComponent'

/** tooltip 文本节点名称约定（tooltip widget 资产内） */
export const TOOLTIP_TEXT_NODE = 'TooltipText'

/** 默认 tooltip widget 资产路径（项目可经 properties.widgetPath 覆盖） */
export const DEFAULT_TOOLTIP_WIDGET = 'asset/blueprints/ui/tooltip.widget.json'

export interface UITooltipComponentOptions {
  /** 提示文本 */
  text?: string
  /** 悬停延迟（秒），默认 0.3 */
  delay?: number
  /** 显示方向：宿主上方/下方，默认 top */
  direction?: 'top' | 'bottom'
  /** tooltip widget 资产路径（默认 DEFAULT_TOOLTIP_WIDGET） */
  widgetPath?: string
}

export class UITooltipComponent extends Component<Actor> {
  private _text: string
  private _delay: number
  private _direction: 'top' | 'bottom'
  private _widgetPath: string

  private _clickable: ClickableComponent | null = null
  private _tooltipActor: Actor | null = null
  /** 悬停进入的时间戳（秒，相对首次 hover） */
  private _hoverStart = -1
  private _hovering = false

  constructor(owner: Actor, options: UITooltipComponentOptions = {}) {
    super(owner)
    this.name = 'UITooltipComponent'
    this._text = options.text ?? ''
    this._delay = options.delay ?? 0.3
    this._direction = options.direction ?? 'top'
    this._widgetPath = options.widgetPath ?? DEFAULT_TOOLTIP_WIDGET
  }

  get text(): string { return this._text }
  set text(v: string) {
    this._text = v
    // 已显示的 tooltip 同步文本
    if (this._tooltipActor) {
      const t = this._findText(this._tooltipActor)
      if (t) t.text = v
    }
  }

  /** 悬停延迟（秒） */
  get delay(): number { return this._delay }
  set delay(v: number) { this._delay = Math.max(0, v) }

  /** 显示方向：宿主上方/下方 */
  get direction(): 'top' | 'bottom' { return this._direction }
  set direction(v: 'top' | 'bottom') { this._direction = v }

  /** tooltip widget 资产路径 */
  get widgetPath(): string { return this._widgetPath }
  set widgetPath(v: string) { this._widgetPath = v }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Text: this._text,
      Delay: `${this._delay}s`,
      Direction: this._direction,
      Widget: this._widgetPath,
      Hovering: this._hovering,
    }
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 挂载/复用可点击组件（UI 按钮已自带；纯文本/图片控件需补挂）
    let clickable = this.owner.getComponent(ClickableComponent)
    if (!clickable) {
      clickable = new ClickableComponent(this.owner)
      this.owner.addComponent(clickable)
    }
    // UI 层：独立 UI 相机平行射线检测
    clickable.layer = 'ui'
    clickable.onHover = (hit) => {
      if (hit) {
        this._hovering = true
        if (this._hoverStart < 0) this._hoverStart = 0
      } else {
        this._hovering = false
        this._hoverStart = -1
        this._hide()
      }
    }
    this._clickable = clickable
    logger.info(`[UITooltipComponent] BeginPlay: "${this._text}" delay=${this._delay}s dir=${this._direction}`)
  }

  override EndPlay(): void {
    this._hide()
    if (this._clickable) {
      this._clickable.onHover = null
      this._clickable = null
    }
    this._hovering = false
    this._hoverStart = -1
    super.EndPlay()
  }

  override Tick(dt: number): void {
    super.Tick(dt)
    // 悬停延迟累计：进入 delay 秒后显示
    if (this._hovering && !this._tooltipActor && this._hoverStart >= 0) {
      this._hoverStart += dt
      if (this._hoverStart >= this._delay) {
        this._hoverStart = -1
        this._show()
      }
    }
  }

  // ─── 内部 ─────────────────────────────────

  private _ui(): UIManager | null {
    return this.owner.world?.ui ?? null
  }

  /** 生成 tooltip 面板（挂在宿主下：位置自动跟随宿主） */
  private _show(): void {
    const ui = this._ui()
    if (!ui) {
      logger.warn('[UITooltipComponent] 无 UIManager（owner.world 未挂 World），跳过显示')
      return
    }
    if (this._tooltipActor) return
    const actor = ui.spawnUIActor(this._widgetPath, this.owner)
    if (!actor) {
      logger.error(`[UITooltipComponent] tooltip widget 生成失败: ${this._widgetPath}`)
      return
    }
    // 位置：相对宿主中心的偏移（宿主是父容器，position 直接相对）
    const tsf = actor.getComponent(UITransformComponent)
    if (tsf) {
      const gap = 0.15 // 与宿主的间距（世界单位）
      const hostSize = this.owner.getComponent(UITransformComponent)?.getWorldSize() ?? [0, 0]
      const offsetY = this._direction === 'top' ? hostSize[1] / 2 + gap : -(hostSize[1] / 2 + gap)
      // 有锚点（anchor != null）时偏移写 anchorOffset；无锚点写 position
      if (tsf.anchor) {
        tsf.anchorOffset = [0, offsetY]
      } else {
        tsf.setPosition(0, offsetY, 0)
      }
    }
    // 设置文本（约定节点名 TooltipText）
    const textComp = this._findText(actor)
    if (textComp) textComp.text = this._text
    else logger.warn(`[UITooltipComponent] tooltip widget 缺少 "${TOOLTIP_TEXT_NODE}" 节点，文本未设置`)
    this._tooltipActor = actor
  }

  /** 销毁 tooltip 面板 */
  private _hide(): void {
    const ui = this._ui()
    const actor = this._tooltipActor
    this._tooltipActor = null
    if (ui && actor && !actor.bPendingDestroy) {
      ui.destroyUIActor(actor)
    }
  }

  /** 在 tooltip Actor 子树查找文本组件（按 root.name 匹配） */
  private _findText(actor: Actor): UITextComponent | null {
    const walk = (a: Actor): UITextComponent | null => {
      const comp = a.getComponent(UITextComponent)
      if (comp && a.root.name === TOOLTIP_TEXT_NODE) return comp
      for (const child of a.getChildren()) {
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(actor)
  }
}
