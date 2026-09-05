/**
 * UIImageComponent — 图像控件 Component
 *
 * 模仿 Unity Image。支持纯色填充、可选圆角、可选贴图（同步加载）。
 */
import * as THREE from 'three'
import { CanvasUIComponent, type UIHitTestMode } from '../rendering/CanvasUIComponent'
import { type EditableProperty } from '../entity/Component'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'

export interface UIImageComponentOptions {
  color?: string
  radius?: number
  opacity?: number
  /** 图片路径；异步加载，加载完成后自动重绘 */
  src?: string
  /** 已加载完成的图片，直接使用 */
  image?: HTMLImageElement
  /**
   * 线性渐变填充（HTML 源 linear-gradient 映射；src 缺省时渲染）。
   * angle 为 CSS 语义角度（0=向上，90=向右，度）；stops 为归一化色标。
   */
  gradient?: {
    angle: number
    stops: Array<{ color: string; offset: number }>
  }
  /** canvas 像素分辨率（默认自动按 worldWidth 推算） */
  width?: number
  height?: number
  /** 3D 世界尺寸（默认 1×1 米） */
  worldWidth?: number
  worldHeight?: number
  /** 命中测试模式（仿 UE：block=拦截点击；CSS hit-test 编译落点，block 时本 mesh 注册拦截） */
  hitTest?: UIHitTestMode
}

export class UIImageComponent extends CanvasUIComponent {
  protected _color: string
  protected _radius: number
  protected _image: HTMLImageElement | null
  private _gradient: UIImageComponentOptions['gradient']

  constructor(owner: Actor, options: UIImageComponentOptions = {}) {
    const width = options.width ?? 256
    const height = options.height ?? 256
    super(owner, {
      width,
      height,
      // 只传显式世界尺寸；未设置时由 CanvasUIComponent 从 owner 的 uitransform 读取
      ...(options.worldWidth !== undefined ? { worldWidth: options.worldWidth } : {}),
      ...(options.worldHeight !== undefined ? { worldHeight: options.worldHeight } : {}),
      ...(options.hitTest !== undefined ? { hitTest: options.hitTest } : {}),
    })
    this.name = 'UIImageComponent'
    this._color = options.color ?? '#ffffff'
    this._radius = options.radius ?? 0
    this._image = options.image ?? null
    this._gradient = options.gradient

    if (options.opacity !== undefined) this.setOpacity(options.opacity)
    this.redraw()
    // logger.info(`[UIImageComponent] 创建: color=${this._color}, radius=${this._radius}, src=${options.src ?? '无'}`)

    if (!this._image && options.src) this.loadImage(options.src)
  }

  get color(): string { return this._color }
  set color(v: string) { this._color = v; this.redraw() }
  get radius(): number { return this._radius }
  set radius(v: number) { this._radius = v; this.redraw() }
  get gradient(): UIImageComponentOptions['gradient'] { return this._gradient }
  set gradient(v: UIImageComponentOptions['gradient']) { this._gradient = v; this.redraw() }

  /**
   * Inspector 属性展示：只放 image 自身属性。
   * 基类的 canvas 尺寸/active/markerOnly/hitTest 是节点/marker 视角的信息
   * （节点显隐开关与命中权威都在同/父节点的 marker 上），不在视觉块上露脸；
   * zOrder 保留——代码构建 UI（无 marker 的独立 image，如按钮透明点击层）的分层编辑入口。
   * 注意本方法是 Inspector 的行清单：键不在列表里的可编辑属性不渲染行
   * （如 opacity 一直可编辑但按既有行为不显示）。
   */
  override getProperties(): Record<string, unknown> {
    return {
      zOrder: this.zOrder,
      color: this._color,
      radius: this._radius,
    }
  }

  /**
   * 激活状态只同步自身 panel；节点级显隐由同/父节点的 CanvasUIComponent
   * 统一控制（canvas active → owner.bActive → 递归子树）。
   * 覆写基类避免本组件把自身 bActive 下推到 owner（UIImage 不是节点开关）。
   */
  protected override applyActive(): void {
    if (this.panel) this.panel.visible = this.bActive
  }

  /**
   * Inspector 可编辑属性：颜色（color 选择器）、圆角（number）、不透明度。
   * 基类编辑属性只保留 zOrder：active/hitTest 已归位同/父节点的 marker（节点显隐开关与
   * V2 命中权威），对视觉块是误导编辑面。zOrder 不能裁——它是代码构建 UI（无 marker 的
   * 独立 image）唯一的分层编辑入口，且持久化默认遍历可编辑属性取值，裁掉即停存。
   */
  override getEditableProperties(): EditableProperty[] {
    const base = super.getEditableProperties().filter((p) => p.key === 'zOrder')
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
      {
        key: 'opacity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => this.opacity,
        set: (v) => { this.opacity = v as number },
      },
    ]
  }

  /** 持久化：在可编辑属性基础上补 gradient（HTML 源 linear-gradient 映射字段） */
  override getPersistentProps(): Record<string, unknown> {
    const out = super.getPersistentProps()
    if (this._gradient) {
      out.gradient = {
        angle: this._gradient.angle,
        stops: this._gradient.stops.map((s) => ({ color: s.color, offset: s.offset })),
      }
    }
    return out
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
    } else if (this._gradient && this._gradient.stops.length >= 2) {
      // CSS linear-gradient 语义：angle 0=向上、90=向右（度）。
      // 渐变线过中心，方向向量 (sin a, cos a)（canvas y 向下），线长 = |w·sin| + |h·cos|
      const a = (this._gradient.angle * Math.PI) / 180
      const dx = Math.sin(a)
      const dy = Math.cos(a)
      const len = Math.abs(w * dx) + Math.abs(h * dy)
      const cx = w / 2
      const cy = h / 2
      const grad = ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2)
      for (const stop of this._gradient.stops) {
        grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color)
      }
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
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
