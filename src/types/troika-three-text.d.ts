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
    sync(callback?: () => void): void
    dispose(): void
  }
}
