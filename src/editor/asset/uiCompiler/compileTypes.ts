/** compileTypes — 编译器公共类型（拆分以避免 compile.ts 与 decompile.ts 循环依赖） */
export interface CompileContext {
  /** 根画布像素宽（<widget canvas="WxH">） */
  canvasWidth: number
  /** 根画布像素高 */
  canvasHeight: number
  /** 根画布世界宽（米） */
  worldWidth: number
  /** 根画布世界高（米） */
  worldHeight: number
}

export { type HtmlNode } from './miniParser'
