/**
 * UITextComponent — 文本控件 Component（troika 矢量渲染）
 *
 * 基于 troika-three-text 的 GPU 字形 mesh：字形轮廓三角化渲染，任意缩放不模糊（矢量）。
 * 通过 blueprint { baseClass: 'UITextComponent', properties: {...} } 配置。
 *
 * 实现要点：
 *  - 继承 CanvasUIComponent（markerOnly）保持"UI 组件"身份（isUIActor 判定 / 锚点 /
 *    尺寸权威在 uitransform），但不创建位图画布 mesh——文本由 troika mesh 渲染
 *  - fontSize 语义保持 canvas 像素（如 32px）：世界字号 = fontSize × 构造时固化的
 *    换算系数（系数 = 构造时世界高 / 基准 canvas 高）。文本大小只受 fontSize 属性
 *    影响，改变控件世界尺寸 / canvas 像素尺寸不会缩放字形
 *  - 控件世界宽 = 换行宽度（maxWidth）：超宽自动换行（whiteSpace normal +
 *    overflowWrap break-word，长中文/长单词按字符断行）
 *  - 尺寸权威在 uitransform：tsf 显式 → 读 tsf；未显式 → 按 canvas 比例推导
 *  - 字体：默认 'Microsoft YaHei'（系统字体，支持中文）；fontFamily 可覆盖
 *  - 局限：troika 为单色轮廓字形，彩色 emoji 会退化为单色/空白；shadow* 属性
 *    仅保留展示（troika 不支持 canvas 阴影，可用 outline 替代）
 */
import * as THREE from 'three'
import { Text as TroikaText } from 'troika-three-text'
// 思源黑体（简体中文子集，支持中文/emoji 单色字形）——troika 只接受字体文件 URL，且不支持 woff2（用 woff）
import notoSansSC400Url from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff?url'
import notoSansSC700Url from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff?url'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { type EditableProperty } from '../entity/Component'
import { UITransformComponent } from './UITransformComponent'
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
  /** 字体阴影（CSS 颜色）——troika 不支持，仅保留展示 */
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
  letterSpacing?: number
  /** canvas 像素宽（默认 512；作为 fontSize 映射基准） */
  width?: number
  /** canvas 像素高（默认 128；作为 fontSize 映射基准） */
  height?: number
  /** 3D 世界宽（默认按 canvas 比例自动推算，高度 2.5） */
  worldWidth?: number
  /** 3D 世界高（默认 2.5） */
  worldHeight?: number
  /** UI 层级（越大越靠前） */
  zOrder?: number
  /** 是否激活（默认 true；false = troika mesh 不渲染） */
  active?: boolean
}

/**
 * 解析 troika 字体 URL：
 *  - fontFamily 为 URL（http/https/data:/blob:/绝对路径）→ 直接用
 *  - 否则（CSS 字体名 / 未设置）→ 用内置思源黑体（支持中文；bold 用 700 变体）
 * troika 的 font 属性只接受字体文件 URL（XHR 加载），不支持 CSS font-family 名。
 */
function resolveFontURL(family: string | undefined, bold: boolean): string {
  if (family && /^(https?:|data:|blob:|\/)/.test(family)) return family
  return bold ? notoSansSC700Url : notoSansSC400Url
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

  /**
   * 像素 → 世界单位换算系数（构造时固化一次）。
   * 世界字号 = fontSize × 系数：文本大小只受 fontSize 属性影响，
   * 后续改变控件世界尺寸 / canvas 像素尺寸都不会再缩放字形。
   */
  private readonly _pxToWorld: number

  /** troika 文本 mesh（构造即创建；字形几何异步生成，属性同步设置） */
  private mesh: TroikaText | null = null

  constructor(owner: Actor, options: UITextComponentOptions = {}) {
    const width = options.width ?? 512
    const height = options.height ?? 128
    // 世界尺寸：尺寸权威在 uitransform（Unity RectTransform 风格）。
    //  - tsf 已显式设置尺寸 → 不传，由 CanvasUIComponent 读取 tsf 值
    //  - 未显式 → 按 canvas 宽高比自动推算（避免文字被拉伸变形），传入并同步回 tsf
    const uiTf = owner.getComponent(UITransformComponent)
    const tsfHasSize = uiTf?.worldSizeExplicit ?? false
    let worldWidth = tsfHasSize ? undefined : options.worldWidth
    let worldHeight = tsfHasSize ? undefined : options.worldHeight
    if (!tsfHasSize) {
      if (worldWidth == null && worldHeight == null) {
        // 默认世界高度 2.5（与 CanvasUIComponent 一致），宽度按 canvas 比例
        worldHeight = 2.5
        worldWidth = worldHeight * (width / height)
      } else if (worldWidth == null) {
        worldWidth = worldHeight! * (width / height)
      } else if (worldHeight == null) {
        worldHeight = worldWidth / (width / height)
      }
    }
    // markerOnly：保持 UI 组件身份，但不创建位图画布 mesh（矢量文本不需要）
    super(owner, {
      width,
      height,
      ...(worldWidth !== undefined ? { worldWidth } : {}),
      ...(worldHeight !== undefined ? { worldHeight } : {}),
      markerOnly: true,
      ...(options.zOrder !== undefined ? { zOrder: options.zOrder } : {}),
    })
    this.name = 'UITextComponent'
    this._text = options.text ?? ''
    this._fontSize = options.fontSize ?? 28
    this._fontFamily = options.fontFamily ?? ''
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

    // 构造时固化换算系数（super 之后世界尺寸已最终确定：tsf 权威或已同步回 tsf）
    this._pxToWorld = this.getWorldSize()[1] / height

    this.initTroika()
  }

  /** 像素 → 世界单位换算（基于构造时固化的系数，不随控件尺寸变化） */
  private toWorldUnits(px: number): number {
    return px * this._pxToWorld
  }

  /** 创建 troika 文本 mesh（sync 内部异步加载字体/生成字形） */
  private initTroika(): void {
    const mesh = new TroikaText()
    mesh.name = 'UITextMesh'
    this.mesh = mesh
    // zOrder 分层：与面板一致（zOrder 每 +1 前移 0.001），文本额外 +0.0002 避免与面板 z-fighting
    mesh.renderOrder = this.zOrder
    mesh.position.z = this.zOrder * 0.001 + 0.0002
    // 渲染对象的显隐统一归 canvas 组件管：注册后由 CanvasUIComponent.applyActive 同步 visible
    this.owner.root.add(mesh)
    this.registerRenderObject(mesh)
    this.applyAll()
  }

  /**
   * 激活状态只同步自身 troika mesh；节点级显隐由同/父节点的 CanvasUIComponent
   * 统一控制（canvas active → owner.bActive → 递归子树）。
   * 覆写基类避免本组件把自身 bActive 下推到 owner（UIText 不是节点开关）。
   */
  protected override applyActive(): void {
    if (this.mesh) this.mesh.visible = this.bActive
  }

  /** 同步所有属性到 troika mesh（属性即时存储，sync 生成字形几何） */
  protected applyAll(): void {
    const mesh = this.mesh
    if (!mesh) return
    const [ww] = this.getWorldSize()
    mesh.text = this._text
    // 世界字号只由 fontSize 属性决定（× 构造时固化的换算系数），不随控件尺寸缩放
    mesh.fontSize = this._fontSize * this._pxToWorld
    mesh.maxWidth = ww
    // textAlign 控制文本在 maxWidth 尺寸框内的对齐；anchorX 固定 center——
    // mesh 原点 = 元素中心（UITransform 锚点定位基准），若把 anchorX 也设成 align，
    // 左对齐时文本左边缘会被钉在元素中心，开头就不在左边缘了
    mesh.textAlign = this._align
    mesh.anchorX = 'center'
    mesh.anchorY = 'middle'
    mesh.color = this._color
    // 换行：whiteSpace normal + overflowWrap break-word——超宽时在任意字符间断行
    // （默认 overflowWrap='normal' 只在空格处断行，长中文/长单词会溢出控件不换行）
    ;(mesh as unknown as { whiteSpace: string }).whiteSpace = 'normal'
    ;(mesh as unknown as { overflowWrap: string }).overflowWrap = 'break-word'
    // troika 只接受字体文件 URL：CSS 名回退到内置思源黑体（bold 用 700 变体）
    mesh.font = resolveFontURL(this._fontFamily, this._bold)
    // troika 类型声明缺失 fontWeight/fontStyle（运行时支持）
    ;(mesh as unknown as { fontWeight: number | string }).fontWeight = this._bold ? 700 : 400
    ;(mesh as unknown as { fontStyle: string }).fontStyle = this._italic ? 'italic' : 'normal'
    mesh.letterSpacing = this.toWorldUnits(this._letterSpacing)
    mesh.lineHeight = this.toWorldUnits(this._lineHeight)
    // unicode fallback（emoji/生僻字）：走本地缓存代理（首次下载后永久本地，不再联网）。
    // 必须绝对 URL——troika 的 fetch 在 worker 里执行，相对路径无法解析
    ;(mesh as unknown as { unicodeFontsURL: string }).unicodeFontsURL = `${location.origin}/__unicode_fonts`
    mesh.sync()
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 确保属性最终一致（尺寸可能已在 BeginPlay 前由 tsf 应用）
    this.applyAll()
  }

  /**
   * 世界尺寸变化（gizmo 拖拽 / Inspector 修改）：只重算换行宽度（maxWidth）。
   * 字号由 fontSize 属性决定，不随控件尺寸缩放。
   */
  override onWorldSizeChange(): void {
    if (this.mesh) {
      const [ww] = this.getWorldSize()
      this.mesh.maxWidth = ww
      this.mesh.sync()
    }
  }

  get text(): string { return this._text }
  set text(v: string) { this._text = v; this.applyAll() }
  get fontSize(): number { return this._fontSize }
  set fontSize(v: number) { this._fontSize = v; this.applyAll() }
  get color(): string { return this._color }
  set color(v: string) { this._color = v; this.applyAll() }
  get align(): 'left' | 'center' | 'right' { return this._align }
  set align(v: 'left' | 'center' | 'right') { this._align = v; this.applyAll() }
  get bold(): boolean { return this._bold }
  set bold(v: boolean) { this._bold = v; this.applyAll() }
  get italic(): boolean { return this._italic }
  set italic(v: boolean) { this._italic = v; this.applyAll() }

  /** UI 层级（越大越靠前）：面板（继承）+ troika mesh 同步分层 */
  override get zOrder(): number { return super.zOrder }
  override set zOrder(v: number) {
    super.zOrder = v
    if (this.mesh) {
      this.mesh.renderOrder = v
      this.mesh.position.z = v * 0.001 + 0.0002
    }
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const base = super.getProperties()
    return {
      ...base,
      text: this._text.length > 60 ? `${this._text.slice(0, 60)}…` : this._text,
      fontSize: this._fontSize,
      fontFamily: this._fontFamily,
      color: this._color,
      bold: this._bold,
      italic: this._italic,
      align: this._align,
      lineHeight: Math.round(this._lineHeight * 100) / 100,
      letterSpacing: this._letterSpacing,
      render: '矢量（troika）',
    }
  }

  /** Inspector 可编辑属性：文本/字号/颜色/对齐/加粗/斜体（camelCase 与 JSON 属性名一致） */
  override getEditableProperties(): EditableProperty[] {
    // UIText 不是节点显隐开关：active 由同/父节点的 CanvasUIComponent 统一控制，这里过滤掉
    const base = super.getEditableProperties().filter((p) => p.key !== 'active')
    return [
      ...base,
      {
        key: 'text', type: 'string',
        get: () => this._text,
        set: (v) => { this.text = v as string },
      },
      {
        key: 'fontSize', type: 'number', step: 1, min: 4, max: 400,
        get: () => this._fontSize,
        set: (v) => { this.fontSize = v as number },
      },
      {
        key: 'color', type: 'color',
        get: () => this._color,
        set: (v) => { this.color = v as string },
      },
      {
        key: 'align', type: 'enum', options: ['left', 'center', 'right'],
        get: () => this._align,
        set: (v) => { this.align = v as 'left' | 'center' | 'right' },
      },
      {
        key: 'bold', type: 'boolean',
        get: () => this._bold,
        set: (v) => { this.bold = v as boolean },
      },
      {
        key: 'italic', type: 'boolean',
        get: () => this._italic,
        set: (v) => { this.italic = v as boolean },
      },
    ]
  }

  override EndPlay(): void {
    if (this.mesh) {
      this.unregisterRenderObject(this.mesh)
      this.owner.root.remove(this.mesh)
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose())
          } else {
            child.material?.dispose()
          }
        }
      })
      this.mesh.dispose?.()
      this.mesh = null
    }
    super.EndPlay()
  }
}

