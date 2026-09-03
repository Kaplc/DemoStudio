/**
 * troika-three-text — 运行时动态加载的三方库类型声明
 *
 * 该库未提供官方 TypeScript 类型，且项目通过动态 import() 在运行时加载
 * （TroikaTextComponent 中未安装时静默降级），因此这里提供最小声明，
 * 仅保留实际使用到的成员。
 */
declare module 'troika-three-text' {
  import type * as THREE from 'three'

  export interface TroikaTextOptions {
    text?: string
    fontSize?: number
    color?: string
    maxWidth?: number
    textAlign?: string
    anchorX?: number | string
    anchorY?: number | string
    outlineWidth?: number
    outlineColor?: string
    letterSpacing?: number
    lineHeight?: number
    font?: string
  }

  export class Text extends THREE.Object3D {
    constructor()
    text: string
    fontSize: number
    color: string
    maxWidth?: number
    textAlign?: string
    anchorX?: number | string
    anchorY?: number | string
    outlineWidth?: number
    outlineColor?: string
    letterSpacing?: number
    lineHeight?: number
    font?: string
    /** 当前渲染信息（sync 后可用，含 caretPositions/blockBounds/visibleBounds/fontData） */
    readonly textRenderInfo: {
      caretPositions: Float32Array
      blockBounds: [number, number, number, number]
      visibleBounds: [number, number, number, number]
      fontData: Array<{
        ascender: number
        descender: number
        unitsPerEm: number
        lineHeight: number
        capHeight: number
        xHeight: number
      }>
      fontSize: number
      topBaseline: number
    } | null
    sync(callback?: () => void): void
    dispose(): void
  }

  /** 按字符索引范围返回选区矩形列表（troika mesh 本地坐标） */
  export function getSelectionRects(
    textRenderInfo: Text['textRenderInfo'],
    start: number,
    end: number,
  ): Array<{ left: number; top: number; right: number; bottom: number }> | null

  /** 按本地坐标点返回最近光标位置 */
  export function getCaretAtPoint(
    textRenderInfo: Text['textRenderInfo'],
    x: number,
    y: number,
  ): { x: number; y: number; height: number; charIndex: number } | null

  /** 预热字体：走与 Text.sync() 同一条渲染信息链路，结果缓存供后续 sync 命中 */
  export function preloadFont(
    options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number },
    callback: () => void,
  ): void

  /** 全局配置（unicodeFontsURL/defaultFontURL 等）：必须在首个字体请求前调用 */
  export function configureTextBuilder(config: {
    defaultFontURL?: string
    unicodeFontsURL?: string
    sdfGlyphSize?: number
    sdfExponent?: number
    sdfMargin?: number
    textureWidth?: number
    useWorker?: boolean
  }): void
}
