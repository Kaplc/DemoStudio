/**
 * widgetMapping — HTML/CSS 受控子集 ↔ widget.json 组件 映射规则（方案 §4/§5 定案表）
 *
 * 单一事实来源：编译器（compile.ts）与反编译器（decompile.ts）共用，
 * 保证双向映射对称、round-trip 稳定（html → json → html' 语义一致）。
 *
 * UI 单位一元化（doc-dev/ui-unit-unification，2026-09-03 定案）：
 * json 几何字段（worldWidth/worldHeight/position/anchorOffset 等）直接存设计 px，
 * 1 世界单位 = 1px，数据链路上不存在任何缩放系数——唯一的"缩放"是 UICamera
 * contain 视锥把画布尺寸的 UI 世界整体投影到渲染视口（投影级，不触碰属性值）。
 * 根节点 worldWidth/worldHeight = 画布尺寸（canvas 即世界）；
 * <widget world> 属性已废弃（解析端忽略 + deprecation 告警）。
 */

/** 编译上下文：画布基准（px 世界的坐标系，y 向上、原点画布中心） */
export interface CompileContext {
  /** 根画布像素宽（<widget canvas="WxH">） */
  canvasWidth: number
  /** 根画布像素高 */
  canvasHeight: number
}

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

/** 保留 2 位小数（sourceLayout 侧车 padding/border 惯例精度；||0 归一 -0/NaN） */
export function round2(v: number): number {
  return Math.round(v * 100) / 100 || 0
}

/** 保留 4 位小数（几何落盘的浮点噪声归一，0.0001px 网格；||0 归一 -0/NaN） */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000 || 0
}
