/**
 * UIButtonComponent — 按钮交互组件
 *
 * 模仿 Unity Button 的交互部分：状态切换（normal / hover / pressed / disabled）
 * 与点击事件回调，背景色随状态变化。
 *
 * 注意：按钮文字不在此组件内创建，
 * 应由独立子 Actor 挂 UITextComponent 提供（如 blueprints/ui/main_menu.widget.json）。
 */
import { UIImageComponent, type UIImageComponentOptions } from './UIImageComponent'
import { logger } from '../../Logger'
import type { Actor } from '../entity/Actor'

export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled'

export interface UIButtonComponentOptions extends UIImageComponentOptions {
  /** 各状态背景色 */
  colors?: Partial<Record<ButtonState, string>>
  onClick?: () => void
}

export class UIButtonComponent extends UIImageComponent {
  private _state: ButtonState = 'normal'
  private _colors: Required<Record<ButtonState, string>>
  private _onClick: (() => void) | null

  constructor(owner: Actor, options: UIButtonComponentOptions = {}) {
    super(owner, options)
    this.name = 'UIButtonComponent'

    const defaultColors: Record<ButtonState, string> = {
      normal: '#3a4a5e',
      hover: '#4a6080',
      pressed: '#2a3850',
      disabled: '#666666',
    }
    this._colors = { ...defaultColors, ...(options.colors ?? {}) } as Required<Record<ButtonState, string>>
    this._onClick = options.onClick ?? null
    this._color = this._colors.normal

    this.redraw()
    logger.info(`[UIButtonComponent] 创建: world=${this.getWorldSize()[0]}x${this.getWorldSize()[1]}`)
  }

  get state(): ButtonState { return this._state }
  set state(v: ButtonState) {
    if (this._state === v) return
    this._state = v
    this._color = this._colors[v]
    this.redraw()
    logger.info(`[UIButtonComponent] "${this.name}" 状态 -> ${v}`)
  }

  /** 触发点击（外部输入系统调用） */
  triggerClick(): void {
    if (this._state === 'disabled') return
    logger.info(`[UIButtonComponent] "${this.name}" 被点击`)
    this.state = 'pressed'
    this._onClick?.()
    // 复位状态下一帧执行（简化版）
    setTimeout(() => { if (this._state === 'pressed') this.state = 'normal' }, 100)
  }
}
