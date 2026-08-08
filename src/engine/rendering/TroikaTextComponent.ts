/**
 * TroikaTextComponent — 基于 troika-three-text 的 GPU SDF 文字
 *
 * 作为 THREE.Mesh 渲染在 3D 世界空间，任意缩放不模糊。
 * 与 SpriteComponent / CanvasUIComponent 同级，遵循 Component 生命周期。
 *
 * 特点：
 *  - SDF（有符号距离场）渲染：任意缩放不模糊，无需提高分辨率
 *  - 纯 GPU mesh，可被其他 3D 物体遮挡
 *  - 支持自动换行、对齐、描边、字间距
 *  - 文本更新走 sync()，内部增量处理脏区域
 *
 * 安装：
 *   npm install troika-three-text
 *
 * 用法：
 *   const label = new TroikaTextComponent(actor, '玩家名称', {
 *     fontSize: 0.4, color: '#ffaa00', outlineWidth: 0.05
 *   })
 *   actor.addComponent(label)
 *   // 运行时修改
 *   label.setText('新名称')
 *   label.setColor('#00ff88')
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'

export interface TroikaTextOptions {
  fontSize?: number         // 世界单位字高，默认 0.3
  color?: string            // CSS 颜色，默认 '#ffffff'
  maxWidth?: number         // 最大宽度（超出自动换行），默认 Infinity
  textAlign?: 'left' | 'center' | 'right'
  anchorX?: number | 'left' | 'center' | 'right'
  anchorY?: number | 'top' | 'middle' | 'bottom'
  outlineWidth?: number     // 描边宽度，0 则不描边
  outlineColor?: string
  font?: string             // 字体路径或 CSS font-family
  letterSpacing?: number
  lineHeight?: number
  name?: string
}

const DEFAULT_OPTIONS: TroikaTextOptions = {
  fontSize: 0.3,
  color: '#ffffff',
  textAlign: 'center',
  anchorX: 'center',
  anchorY: 'middle',
  outlineWidth: 0,
}

/**
 * 动态加载 troika-three-text，失败返回 null。
 * Vite 会将其拆为独立 chunk，运行时未安装才报错。
 */
async function loadTroika(): Promise<any> {
  try {
    const mod = await import('troika-three-text')
    return mod.Text
  } catch {
    return null
  }
}

export class TroikaTextComponent extends Component<Actor> {
  /** 实际 troika Text mesh，未加载时为空 */
  public mesh: THREE.Object3D | null = null

  private _text: string
  private _options: TroikaTextOptions
  private _ready = false
  private _pendingText: string | null = null
  private _pendingColor: string | null = null

  constructor(owner: Actor, text: string, options: TroikaTextOptions = {}) {
    super(owner)
    this.name = options.name ?? 'TroikaTextComponent'
    this._text = text
    this._options = { ...DEFAULT_OPTIONS, ...options }
    this.initText()
  }

  private async initText() {
    const TextClass = await loadTroika()
    if (!TextClass) {
      // 未安装 troika-three-text：静默降级，不崩溃
      return
    }

    const textObj = new TextClass()
    textObj.text = this._text
    textObj.fontSize = this._options.fontSize
    textObj.color = this._options.color
    if (this._options.maxWidth != null) textObj.maxWidth = this._options.maxWidth
    if (this._options.textAlign) textObj.textAlign = this._options.textAlign
    if (this._options.anchorX != null) textObj.anchorX = this._options.anchorX
    if (this._options.anchorY != null) textObj.anchorY = this._options.anchorY
    if (this._options.outlineWidth) textObj.outlineWidth = this._options.outlineWidth
    if (this._options.outlineColor) textObj.outlineColor = this._options.outlineColor
    if (this._options.font) textObj.font = this._options.font
    if (this._options.letterSpacing != null) textObj.letterSpacing = this._options.letterSpacing
    if (this._options.lineHeight != null) textObj.lineHeight = this._options.lineHeight

    textObj.sync()
    this.mesh = textObj
    this.owner.root.add(textObj)
    this._ready = true

    // 应用积压更新
    if (this._pendingText != null) {
      this.applyText(this._pendingText)
      this._pendingText = null
    }
    if (this._pendingColor != null) {
      this.applyColor(this._pendingColor)
      this._pendingColor = null
    }
  }

  /** 运行时修改文字（未 ready 时会排队） */
  setText(text: string) {
    if (!this._ready) {
      this._pendingText = text
      return
    }
    this.applyText(text)
  }

  private applyText(text: string) {
    if (!this.mesh) return
    ;(this.mesh as any).text = text
    ;(this.mesh as any).sync()
  }

  /** 修改颜色 */
  setColor(color: string) {
    if (!this._ready) {
      this._pendingColor = color
      return
    }
    this.applyColor(color)
  }

  private applyColor(color: string) {
    if (!this.mesh) return
    ;(this.mesh as any).color = color
    ;(this.mesh as any).sync()
  }

  override EndPlay() {
    super.EndPlay()
    if (this.mesh) {
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
    }
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const o = this._options
    return {
      Text: this._text.length > 60 ? `${this._text.slice(0, 60)}…` : this._text,
      FontSize: o.fontSize,
      Color: o.color,
      MaxWidth: o.maxWidth ?? '∞',
      TextAlign: o.textAlign ?? 'left',
      Anchor: `${o.anchorX ?? 'center'}/${o.anchorY ?? 'middle'}`,
      OutlineWidth: o.outlineWidth ?? 0,
      OutlineColor: o.outlineColor ?? '（无）',
      Ready: this._ready,
    }
  }
}
