/**
 * widgetMapping — HTML/CSS 受控子集 ↔ widget.json 组件 映射规则（方案 §4/§5 定案表）
 *
 * 单一事实来源：编译器（compile.ts）与反编译器（decompile.ts）共用，
 * 保证双向映射对称、round-trip 稳定（html → json → html' 语义一致）。
 *
 * 像素 → 米换算（按根画布比例，与方案 §5 / TC-B4 公式一致）：
 *  - x 轴：px / canvasWidth × rootWorldWidth
 *  - y 轴：px / canvasHeight × rootWorldHeight
 *  根画布世界尺寸由 <widget world="WxH"> 声明（缺省全屏 4.8 × 4.8·canvasH/canvasW）。
 *  不同 widget 的画布分辨率不同（toast 960px→4.8m = 200px/m，全屏 1920px→4.8m = 400px/m），
 *  因此不存在全局 px/m 常数，一律按上下文换算。
 */

/** 编译上下文：画布基准（px ↔ 米换算的坐标系） */
export interface CompileContext {
  /** 根画布像素宽（<widget canvas="WxH">） */
  canvasWidth: number
  /** 根画布像素高 */
  canvasHeight: number
  /** 根画布世界宽（米，<widget world="WxH"> 或缺省推导） */
  worldWidth: number
  /** 根画布世界高（米） */
  worldHeight: number
}

/** 全屏画布世界宽（米）——与 UIPreviewManager / 现有资产惯例一致 */
export const FULLSCREEN_WORLD_WIDTH = 4.8
/** 全屏画布设计分辨率（缺省 canvas） */
export const FULLSCREEN_CANVAS_WIDTH = 1920
export const FULLSCREEN_CANVAS_HEIGHT = 1080

/** 已知 UI 组件白名单（data-comp 逃逸通道用）。
 *  注：UITextInput/UIProgressBar/UIScrollList/UITooltip 已有原生标签映射
 *  （input/textarea、progress、overflow:auto、title），data-comp 写法仍兼容。 */
export const KNOWN_UI_COMPONENTS = new Set([
  'UIProgressBarComponent',
  'UIScrollListComponent',
  'UITextInputComponent',
  'UITooltipComponent',
])

/** 主轴 justify：CSS 值 → 引擎枚举（CSS flex-start/flex-end 归一化） */
export const JUSTIFY_MAP: Record<string, string> = {
  'flex-start': 'start',
  'start': 'start',
  'center': 'center',
  'flex-end': 'end',
  'end': 'end',
  'space-between': 'space-between',
  'space-around': 'space-around',
  'space-evenly': 'space-evenly',
}

/** 交叉轴 align：CSS 值 → 引擎枚举 */
export const ALIGN_MAP: Record<string, string> = {
  'flex-start': 'start',
  'start': 'start',
  'center': 'center',
  'flex-end': 'end',
  'end': 'end',
  'stretch': 'stretch',
}

/** text-align → UITextComponent.align */
export const TEXT_ALIGN_MAP: Record<string, string> = {
  left: 'left', center: 'center', right: 'right',
}

/** 引擎专有 CSS 属性（非标准属性，声明在普通规则里承载引擎能力） */
export const ENGINE_PROPS = new Set(['z-order', 'hit-test'])

/** 保留 2 位小数（现有资产 worldWidth/worldHeight 惯例精度） */
export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 保留 4 位小数（offset 精度） */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

/** px → 米（x 轴：按画布宽比例） */
export function pxToWorldX(px: number, ctx: CompileContext): number {
  return round4((px / ctx.canvasWidth) * ctx.worldWidth)
}

/** px → 米（y 轴：按画布高比例） */
export function pxToWorldY(px: number, ctx: CompileContext): number {
  return round4((px / ctx.canvasHeight) * ctx.worldHeight)
}

/** 米 → px（x 轴，反编译用） */
export function worldToPxX(world: number, ctx: CompileContext): number {
  return (world / ctx.worldWidth) * ctx.canvasWidth
}

/** 米 → px（y 轴，反编译用） */
export function worldToPxY(world: number, ctx: CompileContext): number {
  return (world / ctx.worldHeight) * ctx.canvasHeight
}
