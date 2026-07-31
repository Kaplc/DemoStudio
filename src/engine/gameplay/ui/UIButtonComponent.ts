/**
 * UIButtonComponent — 按钮组件
 *
 * 模仿 Unity Button。由背景（颜色变化）+ 标签文字堆叠而成。
 * 状态切换：normal / hover / pressed / disabled；点击事件回调。
 */
import { UIImageComponent, type UIImageComponentOptions } from './UIImageComponent'
import { UITextComponent, type UITextComponentOptions } from './UITextComponent'
import { logger } from '../../Logger'
import type { Actor } from '../entity/Actor'

export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled'

export interface UIButtonComponentOptions extends UIImageComponentOptions {
  label?: string
  /** 各状态背景色 */
  colors?: Partial<Record<ButtonState, string>>
  /** 文字样式 */
  textOptions?: Partial<UITextComponentOptions>
  onClick?: () => void
}

export class UIButtonComponent extends UIImageComponent {
  private _label: UITextComponent | null = null
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

    // 子组件作为标签（挂到同一 Actor，自动跟随 transform）
    if (options.label !== undefined) {
      const [uiW, uiH] = this.getSize()
      const [btnW, btnH] = this.getWorldSize()
      this._label = new UITextComponent(owner, {
        text: options.label,
        fontSize: Math.min(btnH * 32, 28),
        color: '#ffffff',
        bold: true,
        align: 'center',
        width: uiW,
        height: uiH,
        // 标签世界尺寸精确匹配按钮，文字正好落在按钮内
        worldWidth: btnW,
        worldHeight: btnH,
        ...options.textOptions,
      })
      // 标签无背景，z 偏移保证在背景之上
      this._label.panel.position.z = 0.001
      owner.addComponent(this._label)
    }

    this.redraw()
    logger.info(`[UIButtonComponent] 创建: label="${options.label ?? '无'}", world=${this.getWorldSize()[0]}x${this.getWorldSize()[1]}`)
  }

  get state(): ButtonState { return this._state }
  set state(v: ButtonState) {
    if (this._state === v) return
    this._state = v
    this._color = this._colors[v]
    this.redraw()
  }

  get label(): string { return this._label?.text ?? '' }
  set label(v: string) { if (this._label) this._label.text = v }

  /** 触发点击（外部输入系统调用） */
  triggerClick(): void {
    if (this._state === 'disabled') return
    this.state = 'pressed'
    this._onClick?.()
    // 复位状态下一帧执行（简化版）
    setTimeout(() => { if (this._state === 'pressed') this.state = 'normal' }, 100)
  }
}
