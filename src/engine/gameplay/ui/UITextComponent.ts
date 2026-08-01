/**
 * UITextComponent — 文本控件 Component（基于 CanvasUIComponent）
 *
 * 模仿 Unity Text。挂到 Actor 上即可参与 Actor 生命周期，
 * 通过 blueprint { baseClass: 'uitext', properties: {...} } 配置。
 *
 * 在 CanvasUIComponent 基础上：把 draw(filler) 分离为 render(ctx) 钩子，
 * setter 自动触发 markDirty + 重绘。
 */
import { CanvasUIComponent, type AnchorPreset } from '../rendering/CanvasUIComponent'
import { logger } from '../../Logger'
import type { Actor } from '../entity/Actor'

export interface UITextComponentOptions {
  text?: string
  fontSize?: number
  fontFamily?: string
  color?: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  /** 字体阴影（CSS 颜色） */
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
  letterSpacing?: number
  /** canvas 像素宽（默认 512） */
  width?: number
  /** canvas 像素高（默认 128） */
  height?: number
  /** 3D 世界宽（默认按 canvas 比例自动推算，高度 2.5） */
  worldWidth?: number
  /** 3D 世界高（默认 2.5） */
  worldHeight?: number
  /** 九宫格锚点（相对父容器画布） */
  anchor?: AnchorPreset
  /** 相对锚点的世界偏移 */
  anchorOffset?: [number, number]
}

export class UITextComponent extends CanvasUIComponent {
  protected _text = ''
  protected _fontSize: number
  protected _fontFamily: string
  protected _color: string
  protected _bold: boolean
  protected _italic: boolean
  protected _align: 'left' | 'center' | 'right'
  protected _lineHeight: number
  protected _shadowColor?: string
  protected _shadowBlur: number
  protected _shadowOffsetX: number
  protected _shadowOffsetY: number
  protected _letterSpacing: number

  constructor(owner: Actor, options: UITextComponentOptions = {}) {
    const width = options.width ?? 512
    const height = options.height ?? 128
    // 世界尺寸：未显式指定时按 canvas 宽高比自动推算（避免文字被拉伸变形）
    let worldWidth = options.worldWidth
    let worldHeight = options.worldHeight
    if (worldWidth == null && worldHeight == null) {
      // 默认世界高度 2.5（与 CanvasUIComponent 一致），宽度按 canvas 比例
      worldHeight = 2.5
      worldWidth = worldHeight * (width / height)
    } else if (worldWidth == null) {
      worldWidth = worldHeight! * (width / height)
    } else if (worldHeight == null) {
      worldHeight = worldWidth / (width / height)
    }
    super(owner, { width, height, worldWidth, worldHeight, anchor: options.anchor, anchorOffset: options.anchorOffset })
    this.name = 'UITextComponent'
    this._text = options.text ?? ''
    this._fontSize = options.fontSize ?? 28
    this._fontFamily = options.fontFamily ?? 'sans-serif'
    this._color = options.color ?? '#ffffff'
    this._bold = options.bold ?? false
    this._italic = options.italic ?? false
    this._align = options.align ?? 'left'
    this._lineHeight = options.lineHeight ?? (this._fontSize * 1.4)
    this._shadowColor = options.shadowColor
    this._shadowBlur = options.shadowBlur ?? 4
    this._shadowOffsetX = options.shadowOffsetX ?? 1
    this._shadowOffsetY = options.shadowOffsetY ?? 2
    this._letterSpacing = options.letterSpacing ?? 0
    this.redraw()
    logger.info(`[UITextComponent] 创建: text="${this._text.slice(0, 40)}", fontSize=${this._fontSize}, color=${this._color}`)
  }

  get text(): string { return this._text }
  set text(v: string) { this._text = v; this.redraw() }
  get fontSize(): number { return this._fontSize }
  set fontSize(v: number) { this._fontSize = v; this.redraw() }
  get color(): string { return this._color }
  set color(v: string) { this._color = v; this.redraw() }
  get align(): 'left' | 'center' | 'right' { return this._align }
  set align(v: 'left' | 'center' | 'right') { this._align = v; this.redraw() }

  /** 重绘 */
  protected redraw(): void {
    this.draw((ctx, w, h) => this.render(ctx, w, h))
  }

  /** 实际 Canvas 2D 绘制（子类可重写） */
  protected render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.font = `${this._italic ? 'italic ' : ''}${this._bold ? 'bold ' : ''}${this._fontSize}px ${this._fontFamily}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'

    if (this._shadowColor) {
      ctx.shadowColor = this._shadowColor
      ctx.shadowBlur = this._shadowBlur
      ctx.shadowOffsetX = this._shadowOffsetX
      ctx.shadowOffsetY = this._shadowOffsetY
    }

    const lines = this._text.split('\n')
    const totalH = lines.length * this._lineHeight
    const startY = Math.max(0, (h - totalH) / 2)

    lines.forEach((line, i) => {
      const y = startY + i * this._lineHeight
      let x: number
      const lineWidth = ctx.measureText(line).width
      if (this._align === 'center') x = (w - lineWidth) / 2
      else if (this._align === 'right') x = w - lineWidth
      else x = 0

      if (this._letterSpacing > 0) {
        // 字间距：逐字绘制
        let cx = x
        for (const ch of Array.from(line)) {
          ctx.fillStyle = this._color
          ctx.fillText(ch, cx, y)
          cx += ctx.measureText(ch).width + this._letterSpacing
        }
      } else {
        ctx.fillStyle = this._color
        ctx.fillText(line, x, y)
      }
    })

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }
}
