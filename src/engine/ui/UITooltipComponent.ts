/**
 * UITooltipComponent — 悬停提示（Tooltip）组件
 *
 * 挂在任意 UI 控件 Actor 上：悬停进入 delay 秒后，在宿主上方/下方动态生成
 * tooltip 面板（经 UIManager.spawnUIActor，自动获得浮动层 zOrder 偏移），
 * 悬停离开立即销毁。
 *
 * 数据配置：
 *   { baseClass: 'UITooltipComponent', properties: {
 *       text: '提示文本',          // 必填（正文，TooltipText 节点）
 *       title: '标题',             // 可选（TooltipTitle 节点；资产内无该节点则忽略）
 *       delay: 0.3,               // 悬停延迟（秒，默认 0.3）
 *       direction: 'top',         // 'top' | 'bottom'（默认 top）
 *       widgetPath: 'asset/blueprints/ui/tooltip.widget.json'  // 可选覆盖
 *   } }
 *
 * tooltip widget 资产约定：
 *  - 根：UITransformComponent（anchor: null，position 由组件运行时写入）+ CanvasUIComponent
 *  - 子节点：name="TooltipText" 的 UITextComponent（提示文本显示于此）；
 *    可选 name="TooltipTitle" 的 UITextComponent（标题行，配置了 title 才写）
 *  - 根建议显式 z-order（如 z-order: 30）：tooltip 挂在宿主子树内，
 *    DOM 序契约下会被宿主之后的兄弟面板盖住，抬高 zOrder 保证浮在最上
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
/** tooltip 标题节点名称约定（可选，资产内存在才写） */
export const TOOLTIP_TITLE_NODE = 'TooltipTitle'

/** 默认 tooltip widget 资产路径（项目可经 properties.widgetPath 覆盖） */
export const DEFAULT_TOOLTIP_WIDGET = 'asset/blueprints/ui/tooltip.widget.json'

/** 弹出面板与宿主边缘的间距（px；1 单位 = 1px） */
const TOOLTIP_GAP_PX = 8

export interface UITooltipComponentOptions {
  /** 提示文本（正文） */
  text?: string
  /** 标题（可选，写入资产内 TooltipTitle 节点） */
  title?: string
  /** 悬停延迟（秒），默认 0.3 */
  delay?: number
  /** 显示方向：宿主上方/下方，默认 top */
  direction?: 'top' | 'bottom'
  /** tooltip widget 资产路径（默认 DEFAULT_TOOLTIP_WIDGET） */
  widgetPath?: string
}

export class UITooltipComponent extends Component<Actor> {
  private _text: string
  private _title: string
  private _delay: number
  private _direction: 'top' | 'bottom'
  private _widgetPath: string

  private _clickable: ClickableComponent | null = null
  private _tooltipActor: Actor | null = null
  /** 悬停进入的时间戳（秒，相对首次 hover） */
  private _hoverStart = -1
  private _hovering = false
  /** BeginPlay 前宿主已有的 onHover（如 UIButtonComponent 的 hover 状态机），链式回call */
  private _prevOnHover: ClickableComponent['onHover'] = null
  /** 自己挂上去的链头（EndPlay 时身份比对，只有仍是链头才回退） */
  private _chainedOnHover: ClickableComponent['onHover'] = null

  constructor(owner: Actor, options: UITooltipComponentOptions = {}) {
    super(owner)
    this.name = 'UITooltipComponent'
    this._text = options.text ?? ''
    this._title = options.title ?? ''
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

  /** 标题（可选；tooltip 资产内需有 TooltipTitle 节点） */
  get title(): string { return this._title }
  set title(v: string) {
    this._title = v
    if (this._tooltipActor) {
      const t = this._findNode(this._tooltipActor, TOOLTIP_TITLE_NODE)
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
      Title: this._title,
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
    // 链式复接而非抢占：保留宿主已有 onHover（按钮的 hover 状态机等），
    // 同一 ClickableComponent 的 onHover 是单槽，直接赋值会互相顶掉
    this._prevOnHover = clickable.onHover
    const chained: NonNullable<ClickableComponent['onHover']> = (hit) => {
      this._prevOnHover?.(hit)
      if (hit) {
        this._hovering = true
        if (this._hoverStart < 0) this._hoverStart = 0
      } else {
        this._hovering = false
        this._hoverStart = -1
        this._hide()
      }
    }
    this._chainedOnHover = chained
    clickable.onHover = chained
    this._clickable = clickable
    logger.info(`[UITooltipComponent] BeginPlay: "${this._text}" delay=${this._delay}s dir=${this._direction}`)
  }

  override EndPlay(): void {
    this._hide()
    if (this._clickable) {
      // 仅当链头仍是自己才回退到前任，避免误伤之后接入的第三方绑定
      if (this._chainedOnHover && this._clickable.onHover === this._chainedOnHover) {
        this._clickable.onHover = this._prevOnHover
      }
      this._chainedOnHover = null
      this._prevOnHover = null
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
    // 位置：弹出面板整体让开宿主（边缘间隙 TOOLTIP_GAP_PX），不留中心重叠
    const tsf = actor.getComponent(UITransformComponent)
    if (tsf) {
      const hostSize = this.owner.getComponent(UITransformComponent)?.getWorldSize() ?? [0, 0]
      const mySize = tsf.getWorldSize() ?? [0, 0]
      const dist = hostSize[1] / 2 + TOOLTIP_GAP_PX + mySize[1] / 2
      const offsetY = this._direction === 'top' ? dist : -dist
      // 有锚点（anchor != null）时偏移写 anchorOffset；无锚点写 position
      if (tsf.anchor) {
        tsf.anchorOffset = [0, offsetY]
      } else {
        tsf.setPosition(0, offsetY, 0)
      }
    }
    // 设置文本（约定节点名 TooltipText / 可选 TooltipTitle）
    const textComp = this._findText(actor)
    if (textComp) textComp.text = this._text
    else logger.warn(`[UITooltipComponent] tooltip widget 缺少 "${TOOLTIP_TEXT_NODE}" 节点，文本未设置`)
    if (this._title) {
      const titleComp = this._findNode(actor, TOOLTIP_TITLE_NODE)
      if (titleComp) titleComp.text = this._title
    }
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
    return this._findNode(actor, TOOLTIP_TEXT_NODE)
  }

  /** 在 tooltip Actor 子树按节点名查找文本组件 */
  private _findNode(actor: Actor, nodeName: string): UITextComponent | null {
    const walk = (a: Actor): UITextComponent | null => {
      const comp = a.getComponent(UITextComponent)
      if (comp && a.root.name === nodeName) return comp
      for (const child of a.getChildren()) {
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(actor)
  }
}
