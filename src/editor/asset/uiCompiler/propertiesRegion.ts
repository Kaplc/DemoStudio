/**
 * propertiesRegion — widget HTML `<properties>` 参数区共享约定
 * （方案 doc-dev/ui-html-source-format/properties-region.md，编译/补丁/反编译三方共用）
 *
 * 参数区定位：原生 HTML 保持纯设计（结构 + CSS + 内联文本），无 CSS 表达位的
 * 组件参数收敛到文件内一个机器管理的 `<properties>` 原始 JSON 区。键结构：
 *   节点名（编译产物 name）→ 组件 baseClass → properties 对象
 *
 * 规范形（补丁重写 / 反编译输出统一）：JSON.stringify(region, null, 2)，
 * 每行整体再缩进 2 空格。region 是机器管理数据区，规范化即特性，
 * 不承诺保留手写排版。
 */

/** 参数区标签名（miniParser RAW_TEXT_TAG：内容原文读取，不解析实体/子节点） */
export const PROPS_REGION_TAG = 'properties'

/** 禁止在 region 声明的视觉组件（有原生标签/CSS 表达位，防同一视觉值双真相源） */
export const REGION_BLOCKED_COMPS = new Set([
  'UITransformComponent', 'CanvasUIComponent', 'UITextComponent',
  'UIImageComponent', 'UIButtonComponent',
])

/** 由 region 承载的组件族：保存补丁走 region 键重写、反编译前置摘出（其余组件沿用既有通道） */
export const REGION_FAMILY_COMPS = new Set(['UIWorldAnchorComponent'])

/** 组件键归一：短名（UIWorldAnchor）补 Component 后缀（与 emitDataComp 语义一致） */
export function regionCompBaseClass(key: string): string {
  return key.endsWith('Component') ? key : `${key}Component`
}

/** region 内容规范形（不含 <properties> 标签本身；标签内整体缩进 2 空格） */
export function formatRegionContent(region: Record<string, unknown>): string {
  return JSON.stringify(region, null, 2)
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n')
}
