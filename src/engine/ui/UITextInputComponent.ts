/**
 * UITextInputComponent — 文本输入控件 Component（引擎级，GM 控制台等复用）
 *
 * 引擎此前无文本输入框组件（UIText 家族只有 UITextComponent 静态文本），
 * 本组件补上可编辑单行文本输入能力：
 *   - 键盘字符输入 / Backspace 退格 / Enter 提交 / Escape 失焦
 *   - 光标（'|' 后缀渲染）+ 失焦闪烁省略
 *   - 焦点管理：focus()/blur()；聚焦时宿主（GM 控制台）应暂停游戏输入转发
 *
 * 渲染：内部持有 UITextComponent 显示「文本 + 光标」，背景由宿主面板的
 * UIImageComponent 提供（与 UIText 同风格：尺寸权威在 uitransform）。
 *
 * 键盘路由：组件不直接监听全局键盘（引擎键盘事件走 InputSys → Controller 管线），
 * 由使用方（GMConsoleHUD/GMModule）在控制台打开时把按键转交 handleKey(key)。
 *
 * 用法：
 *   const input = new UITextInputComponent(actor, { placeholder: '输入命令...' })
 *   actor.addComponent(input)
 *   input.focus()
 *   input.handleKey('a') / input.handleKey('Backspace') / input.handleKey('Enter')
 */
import { UITextComponent } from './UITextComponent'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'

export interface UITextInputComponentOptions {
  /** 占位提示（value 为空且未聚焦时显示，灰色） */
  placeholder?: string
  /** 初始文本 */
  value?: string
  /** 字体大小（px，默认 22） */
  fontSize?: number
  /** 文本颜色（默认羊皮纸色 #f5e6c8） */
  color?: string
  /** 占位符颜色（默认灰色） */
  placeholderColor?: string
  /** canvas 像素宽（默认 1024，作为 fontSize 映射基准） */
  width?: number
  /** canvas 像素高（默认 96） */
  height?: number
  /** UI 层级（越大越靠前，默认 0；透传 UITextComponent） */
  zOrder?: number
  /** 提交回调（Enter 触发，参数为当前文本） */
  onSubmit?: (value: string) => void
}

export class UITextInputComponent extends UITextComponent {
  /** 当前输入文本 */
  private _value = ''
  /** 占位提示 */
  private _placeholder: string
  /** 占位符颜色 */
  private readonly _placeholderColor: string
  /** 正常文本颜色 */
  private readonly _textColor: string
  /** 是否聚焦（聚焦显示光标） */
  private _focused = false
  /** 提交回调 */
  private _onSubmit: ((value: string) => void) | null

  constructor(owner: Actor, options: UITextInputComponentOptions = {}) {
    const fontSize = options.fontSize ?? 22
    const color = options.color ?? '#f5e6c8'
    super(owner, {
      text: '',
      fontSize,
      color,
      align: 'left',
      // 输入框单行文本必须左对齐：textAlign 对单行无效，单行整体按 anchorX 放置
      // （anchorX=center 时短文本从元素中心开始输入）
      anchorX: 'left',
      width: options.width ?? 1024,
      height: options.height ?? 96,
      bold: true,
      ...(options.zOrder !== undefined ? { zOrder: options.zOrder } : {}),
    })
    this.name = 'UITextInputComponent'
    this._value = options.value ?? ''
    this._placeholder = options.placeholder ?? ''
    this._placeholderColor = options.placeholderColor ?? '#8a7a5a'
    this._textColor = color
    this._onSubmit = options.onSubmit ?? null
    this.refreshText()
    logger.info('[UITextInputComponent] 创建文本输入控件')
  }

  /** 当前输入值 */
  get value(): string {
    return this._value
  }

  set value(v: string) {
    this._value = v
    this.refreshText()
  }

  /** 占位提示（value 为空且未聚焦时显示） */
  get placeholder(): string {
    return this._placeholder
  }

  set placeholder(v: string) {
    this._placeholder = v
    this.refreshText()
  }

  /** 是否聚焦 */
  get focused(): boolean {
    return this._focused
  }

  /** 提交回调（Enter 触发） */
  get onSubmit(): ((value: string) => void) | null {
    return this._onSubmit
  }

  set onSubmit(fn: ((value: string) => void) | null) {
    this._onSubmit = fn
  }

  /** 聚焦：显示光标，进入输入态 */
  focus(): void {
    if (this._focused) return
    this._focused = true
    this.refreshText()
    logger.info('[UITextInputComponent] 聚焦输入框')
  }

  /** 失焦：隐藏光标（value 为空时显示占位符） */
  blur(): void {
    if (!this._focused) return
    this._focused = false
    this.refreshText()
    logger.info('[UITextInputComponent] 输入框失焦')
  }

  /** 清空输入 */
  clear(): void {
    this._value = ''
    this.refreshText()
  }

  /**
   * 键盘输入处理（由使用方从 InputSys 转交）。
   * @param key InputSys 传来的键名（如 'a'、'Backspace'、'Enter'、'Escape'）
   * @returns true = 按键被消费（宿主不应再转发给游戏）
   */
  handleKey(key: string): boolean {
    // 提交：Enter → onSubmit（不清空，由宿主决定）
    if (key === 'Enter') {
      logger.info(`[UITextInputComponent] 提交输入: "${this._value}"`)
      this._onSubmit?.(this._value)
      return true
    }
    // 失焦：Escape 由宿主处理关闭面板，这里仅标记不消费
    if (key === 'Escape') {
      return false
    }
    // 退格：删除最后一个字符（按 UTF-16 码元；中文等 BMP 字符占 1 码元）
    if (key === 'Backspace') {
      if (this._value.length > 0) {
        this._value = this._value.slice(0, -1)
        this.refreshText()
      }
      return true
    }
    // 可打印字符：单个字符（字母/数字/符号/空格；中文经 IME 单字输入）
    if (key.length === 1) {
      this._value += key
      this.refreshText()
      return true
    }
    // 其他功能键（Shift/Control/方向键等）不消费（宿主可忽略）
    return false
  }

  /** 刷新显示文本（值 + 光标 / 占位符） */
  private refreshText(): void {
    if (this._focused) {
      this.text = `${this._value}|`
      this.color = this._textColor
    } else if (this._value) {
      this.text = this._value
      this.color = this._textColor
    } else {
      this.text = this._placeholder
      this.color = this._placeholderColor
    }
  }

  override getProperties(): Record<string, unknown> {
    return {
      ...super.getProperties(),
      Value: this._value,
      Focused: this._focused,
    }
  }
}
