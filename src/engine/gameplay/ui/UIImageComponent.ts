/**
 * UIImageComponent — 图像控件 Component
 *
 * 模仿 Unity Image。支持纯色填充、可选圆角、可选贴图（同步加载）。
 */
import * as THREE from 'three'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { type EditableProperty } from '../entity/Component'
import { logger } from '../../Logger'
import type { Actor } from '../entity/Actor'

export interface UIImageComponentOptions {
  color?: string
  radius?: number
  opacity?: number
  /** 图片路径；异步加载，加载完成后自动重绘 */
  src?: string
  /** 已加载完成的图片，直接使用 */
  image?: HTMLImageElement
  /** canvas 像素分辨率（默认自动按 worldWidth 推算） */
  width?: number
  height?: number
  /** 3D 世界尺寸（默认 1×1 米） */
  worldWidth?: number
  worldHeight?: number
}

export class UIImageComponent extends CanvasUIComponent {
  protected _color: string
  protected _radius: number
  protected _image: HTMLImageElement | null

  constructor(owner: Actor, options: UIImageComponentOptions = {}) {
    const width = options.width ?? 256
    const height = options.height ?? 256
    super(owner, {
      width,
      height,
      // 只传显式世界尺寸；未设置时由 CanvasUIComponent 从 owner 的 uitransform 读取
      ...(options.worldWidth !== undefined ? { worldWidth: options.worldWidth } : {}),
      ...(options.worldHeight !== undefined ? { worldHeight: options.worldHeight } : {}),
    })
    this.name = 'UIImageComponent'
    this._color = options.color ?? '#ffffff'
    this._radius = options.radius ?? 0
    this._image = options.image ?? null

    if (options.opacity !== undefined) this.setOpacity(options.opacity)
    this.redraw()
    logger.info(`[UIImageComponent] 创建: color=${this._color}, radius=${this._radius}, src=${options.src ?? '无'}`)

    if (!this._image && options.src) this.loadImage(options.src)
  }

  get color(): string { return this._color }
  set color(v: string) { this._color = v; this.redraw() }
  get radius(): number { return this._radius }
  set radius(v: number) { this._radius = v; this.redraw() }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const base = super.getProperties()
    return {
      ...base,
      color: this._color,
      radius: this._radius,
    }
  }

  /** Inspector 可编辑属性：颜色（color 选择器）、圆角（number） */
  override getEditableProperties(): EditableProperty[] {
    const base = super.getEditableProperties()
    return [
      ...base,
      {
        key: 'color', type: 'color',
        get: () => this._color,
        set: (v) => { this.color = v as string },
      },
      {
        key: 'radius', type: 'number', step: 1, min: 0, max: 512,
        get: () => this._radius,
        set: (v) => { this.radius = v as number },
      },
    ]
  }

  /** 异步加载图片，完成后自动重绘 */
  loadImage(src: string): void {
    logger.info(`[UIImageComponent] 加载图片: ${src}`)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      this._image = img
      this.redraw()
      logger.info(`[UIImageComponent] 图片加载完成: ${src} (${img.width}x${img.height})`)
    }
    img.onerror = () => {
      logger.error(`[UIImageComponent] 图片加载失败: ${src}`)
    }
    img.src = src
  }

  protected redraw(): void {
    this.draw((ctx, w, h) => this.render(ctx, w, h))
  }

  protected render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this._radius > 0) {
      ctx.save()
      ctx.beginPath()
      this.roundRectPath(ctx, 0, 0, w, h, this._radius)
      ctx.clip()
    }

    if (this._image) {
      ctx.drawImage(this._image, 0, 0, w, h)
    } else {
      ctx.fillStyle = this._color
      ctx.fillRect(0, 0, w, h)
    }

    if (this._radius > 0) ctx.restore()
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
  ): void {
    const radius = Math.min(r, w / 2, h / 2)
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + w - radius, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
    ctx.lineTo(x + w, y + h - radius)
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
    ctx.lineTo(x + radius, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
  }
}

/** 让 TypeScript 不报 THREE 未使用（保留导入以便未来扩展用 Material 等） */
void THREE
