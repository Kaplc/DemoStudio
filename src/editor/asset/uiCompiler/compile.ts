/**
 * compile — ui-compiler：完整原生 HTML 映射 → widget.json
 *
 * 管线：HTML 解析（miniParser）→ 样式表收集（<style>/link/@import 内联 + UA 默认）
 * → @media 静态评估 → 级联/继承（css/cascade）→ 标签/属性白名单校验（越界硬报错）
 * → 静态布局求解（layout）→ 发射 Actor 树（anchor/position + 组件映射）。
 *
 * 原则：任何超出映射面的写法在编译期带行号硬报错，绝不静默降级；
 * 近似（文本测宽估算、垂直 margin 不折叠等）走 warnings 通道显式披露。
 */
import type { HtmlNode } from './miniParser'
import { tokenizeHtml, ParseError } from './miniParser'
import {
  tokenizeStylesheet, CssParseError,
  type CssRule, type Stylesheet,
} from './css/tokenize'
import {
  substituteVars, normalizeColor, parseLength, parseTransform,
  parseLinearGradient, expandAll,
} from './css/values'
import { buildStyleTree, computeStyles, classesOf, type StyleElement } from './css/cascade'
import { UA_STYLESHEET } from './css/ua'
import { solveLayout, type Box, type SolveContext } from './layout'
import {
  FULLSCREEN_WORLD_WIDTH, FULLSCREEN_CANVAS_WIDTH, FULLSCREEN_CANVAS_HEIGHT,
  JUSTIFY_MAP, ALIGN_MAP,
  round2, round4, pxToWorldX, pxToWorldY,
} from './widgetMapping'

/** 编译错误（面向源文件：行号指向 .widget.html） */
export interface CompileError {
  line: number
  message: string
}

/** 编译警告（近似/降级披露，不阻断） */
export interface CompileWarning {
  line: number
  message: string
}

/** 编译结果 */
export interface CompileResult {
  ok: boolean
  errors: CompileError[]
  warnings: CompileWarning[]
  /** 产物（成功时）；含顶层 sourceHash */
  doc?: Record<string, unknown>
}

/** 编译选项 */
export interface CompileOptions {
  /**
   * 外部样式表读取（link rel=stylesheet / @import）。
   * 提供（编辑器/CLI 传 fs 实现）则内联编译；缺省遇外部样式报错。
   */
  resolveInclude?: (href: string) => string
}

/** 内部编译异常（携带行号） */
class CompileFail extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

/** FNV-1a 32 位 hash（sourceHash：源文件内容指纹） */
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`
}

/** 确定性节点 id 生成器（同一源编译两次产物逐字节一致，TC-B8） */
let nodeIdSeq = 0
function nextNodeId(): number {
  nodeIdSeq += 1
  return 13200 + nodeIdSeq
}

/** ─── 标签白名单（完整映射面；白名单外 = 硬报错） ─── */

/** 透传容器语义（无专属视觉/交互组件） */
const CONTAINER_TAGS = new Set([
  'div', 'span', 'p', 'section', 'article', 'header', 'footer', 'main', 'nav',
  'aside', 'figure', 'figcaption', 'blockquote', 'address', 'center', 'hgroup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'menu',
  'form', 'fieldset', 'legend', 'label', 'output',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'details', 'summary', 'dialog', 'figure',
  // 内联样式语义标签（发射为容器；样式由级联提供）
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'small', 'big',
  'mark', 'code', 'kbd', 'samp', 'cite', 'q', 'dfn', 'abbr', 'time', 'data',
  'var', 'sub', 'sup', 'bdi', 'bdo', 'ruby', 'rt', 'rp', 'wbr',
])
/** 专属控件标签（发射专属组件） */
const WIDGET_TAGS = new Set(['widget', 'img', 'button', 'text', 'input', 'textarea', 'progress', 'br'])
/** 结构性处理标签（编译流程剥离/收集，不进发射） */
const STRUCTURAL_TAGS = new Set(['html', 'head', 'body', 'style', 'script', 'title', 'meta', 'link', 'base', 'noscript'])
/** 映射面外标签（引擎无对应能力 → 硬报错并给替代建议） */
export const UNSUPPORTED_TAGS: Record<string, string> = {
  select: '引擎无下拉控件（用 UIScrollList 或 data-comp 逃逸承载）',
  option: 'select/option 不受支持（用 UIScrollList 承载列表）',
  optgroup: 'select/optgroup 不受支持（用 UIScrollList 承载列表）',
  datalist: '引擎无下拉/补全控件',
  keygen: '已废弃元素，不受支持',
  meter: '引擎无仪表控件（用 progress 表达）',
  video: '引擎无视频控件（UI 层不支持视频播放）',
  audio: '引擎 UI 层不支持音频控件（用游戏脚本播放）',
  canvas: '引擎 UI 不支持位图画布（用 UIImage + 贴图）',
  svg: '引擎不支持 SVG 矢量（转贴图后用 img）',
  math: '引擎不支持数学标记',
  iframe: '引擎不支持内嵌网页',
  object: '引擎不支持嵌入式对象',
  embed: '引擎不支持嵌入式对象',
  map: '图像映射不受支持（用分层 img+按钮表达）',
  area: '图像映射不受支持（用分层 img+按钮表达）',
  slot: 'Web Components 插槽不受支持',
  template: '模板元素不受支持（一对多模板不在映射面）',
  picture: 'picture 响应式图片不受支持（直接用 img）',
  source: 'picture/audio/video 的 source 不受支持',
  track: '媒体字幕轨道不受支持',
}

/** 带专有行为的标签在编译层逐一消费；白名单 = CONTAINER ∪ WIDGET ∪ STRUCTURAL */
export const SUPPORTED_TAGS = new Set([...CONTAINER_TAGS, ...WIDGET_TAGS, ...STRUCTURAL_TAGS])

/** 白名单外的标签 → 硬报错（发射前对内容树全量校验） */
function assertTagSupported(tag: string, line: number): void {
  if (CONTAINER_TAGS.has(tag) || WIDGET_TAGS.has(tag) || STRUCTURAL_TAGS.has(tag) || UNSUPPORTED_TAGS[tag]) return
  throw new CompileFail(`标签 <${tag}> 不在映射面（完整标签清单见 devdoc/ui-html-source-format）`, line)
}

/** 内容树全量标签校验（发射前） */
function validateTags(el: StyleElement): void {
  if (el.tag !== '#text') assertTagSupported(el.tag, el.node.line)
  for (const c of el.children) {
    if (c.tag !== '#text') validateTags(c)
  }
}

/** ─── CSS 属性白名单 ─── */

export const KNOWN_CSS_PROPS = new Set([
  // 布局
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index',
  'float', 'clear', 'order', 'columns', 'column-count', 'column-width', 'gap',
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction', 'flex-wrap', 'flex-flow',
  'justify-content', 'justify-items', 'justify-self', 'align-content', 'align-items', 'align-self',
  'place-content', 'place-items', 'place-self', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow',
  'grid-auto-rows', 'grid-auto-columns', 'grid-area', 'grid-column', 'grid-row',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  // 盒模型
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-sizing', 'aspect-ratio', 'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'object-position',
  // 视觉
  'background', 'background-color', 'background-image', 'background-repeat',
  'background-position', 'background-size', 'background-attachment', 'background-clip', 'background-origin',
  'opacity', 'visibility', 'transform', 'transform-origin', 'transform-style',
  'box-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
  'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  // 文本
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-align-last',
  'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'text-transform', 'text-indent', 'text-shadow', 'text-overflow',
  'white-space', 'word-break', 'overflow-wrap', 'word-wrap', 'vertical-align',
  'direction', 'writing-mode', 'tab-size', 'quotes', 'list-style', 'list-style-type',
  'list-style-position', 'list-style-image',
  // 交互/其它
  'cursor', 'pointer-events', 'user-select', 'resize', 'touch-action',
  'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
  'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
  'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
  // 表格布局辅助（接受，静态求解器恒按 collapsed 语义渲染）
  'border-collapse', 'border-spacing', 'caption-side', 'empty-cells', 'table-layout',
  // 引擎专有（方案 §5 承载）
  'z-order', 'hit-test',
  // 引擎专有文本阴影（标准 text-shadow 的别名通道，兼容既有源）
  'text-shadow-color', 'text-shadow-blur',
])

/** 只警告不生效的装饰属性（引擎无对应渲染能力；披露后忽略） */
const DECORATION_ONLY_PROPS = new Set([
  'cursor', 'user-select', 'word-spacing', 'text-decoration', 'text-decoration-line',
  'text-decoration-color', 'text-decoration-style', 'text-overflow', 'tab-size',
  'resize', 'touch-action', 'direction', 'text-indent', 'text-align-last',
])

/** 交互态伪类允许的属性（按钮状态色透传） */
const STATE_ALLOWED_PROPS = new Set(['color', 'background-color', 'background', 'opacity'])

/** 枚举值映射查找（未知值报错） */
function mapEnum(map: Record<string, string>, value: string, prop: string, line: number): string {
  const v = map[value]
  if (v === undefined) {
    throw new CompileFail(`属性 "${prop}: ${value}" 不在支持范围 [${Object.keys(map).join(' / ')}]`, line)
  }
  return v
}

/** ─── 位置解析上下文 ─── */

interface WorldCtx {
  canvasWidth: number
  canvasHeight: number
  worldWidth: number
  worldHeight: number
}

/** ─── 样式表收集 ─── */

interface SheetBundle {
  rules: CssRule[]
  /** @media 规则（编译主流程按画布尺寸静态评估后并入） */
  medias: Array<{ condition: string; rules: CssRule[]; line: number }>
  title?: string
}

function collectStylesheets(
  headNodes: HtmlNode[],
  inlineStyles: string[],
  opts: CompileOptions,
  warnings: CompileWarning[],
): SheetBundle {
  const rules: CssRule[] = []
  let orderBase = 0
  let title: string | undefined

  const ingest = (cssText: string): void => {
    const sheet: Stylesheet = tokenizeStylesheet(cssText, { origin: 1 })
    // @keyframes / @font-face / @supports 等 → 硬报错（映射面之外）
    for (const at of sheet.unsupportedAtRules) {
      throw new CompileFail(
        `@${at.name} 不受支持（动画/字体/条件注入不在声明式映射面内；动效请用 UIScript + TweenSystem）`,
        at.line,
      )
    }
    for (const imp of sheet.imports) {
      if (!opts.resolveInclude) {
        throw new CompileFail(`@import "${imp.href}" 需要编译环境提供外部样式读取（CLI/编辑器默认支持）`, imp.line)
      }
      let imported: string
      try {
        imported = opts.resolveInclude(imp.href)
      } catch (e) {
        throw new CompileFail(`@import "${imp.href}" 读取失败: ${(e as Error).message}`, imp.line)
      }
      ingest(imported)
    }
    // @media 静态评估在 compile 主流程做（需要画布尺寸）——先暂存
    pendingMedias.push(...sheet.medias)
    for (const r of sheet.rules) {
      rules.push({ ...r, order: r.order + orderBase })
    }
    orderBase += sheet.rules.length + 1
  }

  const pendingMedias: Array<{ condition: string; rules: CssRule[]; line: number }> = []

  // link rel=stylesheet / title
  for (const node of headNodes) {
    if (node.tag === 'title') {
      title = node.children.find((c) => c.tag === '#text')?.text
      continue
    }
    if (node.tag === 'link') {
      const rel = (node.attrs['rel'] ?? '').toLowerCase()
      const href = node.attrs['href']
      if (rel.includes('stylesheet') && href) {
        if (!opts.resolveInclude) {
          throw new CompileFail(`<link rel="stylesheet" href="${href}"> 需要编译环境提供外部样式读取`, node.line)
        }
        let css: string
        try {
          css = opts.resolveInclude(href)
        } catch (e) {
          throw new CompileFail(`外部样式表 "${href}" 读取失败: ${(e as Error).message}`, node.line)
        }
        ingest(css)
      }
      continue
    }
    if (node.tag === 'style') {
      ingest(node.raw ?? '')
      continue
    }
    // meta/base/noscript 等头部元素：忽略（元信息，不影响渲染）
  }

  for (const css of inlineStyles) ingest(css)

  return { rules, medias: pendingMedias, title }
}

/** @media 条件静态评估（相对画布尺寸；不涉及设备能力的条件视为匹配并警告） */
function evaluateMedia(condition: string, canvasW: number, canvasH: number, line: number, warnings: CompileWarning[]): boolean {
  const conds = condition.split(/\band\b/i).map((c) => c.trim().replace(/^\(|\)$/g, '')).filter(Boolean)
  for (const cond of conds) {
    const m = /^(min|max)-(width|height)\s*:\s*([\d.]+)(px|em|rem)?$/.exec(cond)
    if (m) {
      const v = parseFloat(m[3]) * (m[4] === 'em' || m[4] === 'rem' ? 16 : 1)
      const actual = m[2] === 'width' ? canvasW : canvasH
      if (m[1] === 'min' && actual < v) return false
      if (m[1] === 'max' && actual > v) return false
      continue
    }
    if (/^(screen|all)$/.test(cond)) continue
    if (cond === 'print') return false
    // orientation 等其它媒体特征：视为匹配并披露
    warnings.push({ line, message: `@media 特征 "${cond}" 无法静态评估，按匹配处理` })
  }
  return true
}

/** ─── 计算样式后校验：属性白名单 + overflow/pointer-events 归一 ─── */

function validateComputedStyles(el: StyleElement, warnings: CompileWarning[]): void {
  if (el.tag !== '#text') {
    const err = UNSUPPORTED_TAGS[el.tag]
    if (err) throw new CompileFail(`标签 <${el.tag}> 不受支持：${err}`, el.node.line)
  }
  for (const [prop] of el.computed) {
    if (prop.startsWith('--')) continue
    if (!KNOWN_CSS_PROPS.has(prop)) {
      throw new CompileFail(`CSS 属性 "${prop}" 不在映射面（属性清单见 devdoc/ui-html-source-format）`, el.node.line)
    }
    if (DECORATION_ONLY_PROPS.has(prop) && el.computed.get(prop) !== 'none') {
      const v = el.computed.get(prop)!
      if (prop === 'text-decoration-line' && (v === 'underline' || v === 'line-through')) {
        warnings.push({
          line: el.node.line,
          message: `text-decoration: ${v} 引擎文本不渲染装饰线（troika 单色字形），按普通文本处理`,
        })
      } else if (prop !== 'text-decoration-line') {
        warnings.push({ line: el.node.line, message: `属性 "${prop}: ${v}" 为装饰/交互提示，不影响渲染` })
      }
    }
  }
  // overflow hidden → 硬报错（引擎无视觉裁剪）
  for (const p of ['overflow-x', 'overflow-y']) {
    const v = el.computed.get(p)
    if (v === 'hidden' || v === 'clip') {
      throw new CompileFail(
        `${p}: ${v} 不受支持（引擎无容器视觉裁剪；圆角裁剪用 border-radius，滚动用 auto/scroll）`,
        el.node.line,
      )
    }
  }
  for (const child of el.children) validateComputedStyles(child, warnings)
}

/** ─── 事件属性拦截 ─── */

function assertNoEventAttrs(node: HtmlNode): void {
  for (const attr of Object.keys(node.attrs)) {
    if (/^on[a-z]+$/i.test(attr)) {
      throw new CompileFail(
        `事件属性 ${attr} 不在声明式映射面（行为请用 data-script="脚本路径" + UIScript）`,
        node.line,
      )
    }
  }
  for (const c of node.children) assertNoEventAttrs(c)
}

/** ─── html/head/body 剥离 ─── */

interface DocStructure {
  root: HtmlNode
  headNodes: HtmlNode[]
  inlineStyles: string[]
}

function unwrapDocument(raw: HtmlNode): DocStructure {
  const inlineStyles: string[] = []
  const headNodes: HtmlNode[] = []

  const collectHead = (candidates: HtmlNode[]): void => {
    for (const c of candidates) {
      if (c.tag === 'style') {
        inlineStyles.push(c.raw ?? '')
        headNodes.push(c)
      } else if (c.tag === 'head') {
        collectHead(c.children)
      } else if (c.tag === 'title' || c.tag === 'link' || c.tag === 'meta' || c.tag === 'base' || c.tag === 'noscript') {
        headNodes.push(c)
      } else if (c.tag === 'script') {
        // 内嵌 script：声明式映射面无内联 JS——内容非空即报错
        if ((c.raw ?? '').trim()) {
          throw new CompileFail('内嵌 <script> 不受支持（行为请用 data-script="脚本路径"）', c.line)
        }
      }
    }
  }

  const walkStyles = (node: HtmlNode): void => {
    for (const c of node.children) {
      if (c.tag === 'style') {
        inlineStyles.push(c.raw ?? '')
        headNodes.push(c)
      } else if (c.tag === 'script') {
        if ((c.raw ?? '').trim()) {
          throw new CompileFail('内嵌 <script> 不受支持（行为请用 data-script="脚本路径"）', c.line)
        }
      }
    }
  }

  let root = raw
  if (root.tag === 'html') {
    collectHead(root.children)
    const body = root.children.find((c) => c.tag === 'body')
    if (!body) throw new CompileFail('<html> 缺少 <body>', root.line)
    // html/body 属性合并到 body（name/canvas/world 等允许写在任一层）
    const merged: HtmlNode = {
      ...body,
      attrs: { ...root.attrs, ...body.attrs },
    }
    root = merged
  } else {
    walkStyles(root)
  }
  if (root.tag === 'body') collectHead(root.children)
  // 内容树内嵌 style/script 摘除（样式已收集；script 报错）
  root = stripStyleScript(root, inlineStyles, headNodes)
  return { root, headNodes, inlineStyles }
}

/** 递归摘除内容树中的 style/script（返回新树，不改原节点） */
function stripStyleScript(node: HtmlNode, inlineStyles: string[], headNodes: HtmlNode[]): HtmlNode {
  const children: HtmlNode[] = []
  for (const c of node.children) {
    if (c.tag === 'style') {
      continue // 已收集
    }
    if (c.tag === 'script') {
      if ((c.raw ?? '').trim()) {
        throw new CompileFail('内嵌 <script> 不受支持（行为请用 data-script="脚本路径"）', c.line)
      }
      continue
    }
    children.push(stripStyleScript(c, inlineStyles, headNodes))
  }
  return { ...node, children }
}

/** ─── inline style 解析 ─── */

function parseInlineStyle(text: string): Map<string, { value: string; important: boolean }> {
  const sheet = tokenizeStylesheet(`x{${text}}`, { origin: 1 })
  const out = new Map<string, { value: string; important: boolean }>()
  if (sheet.unsupportedAtRules.length > 0) {
    throw new CompileFail(`inline style 含不支持的 @规则`, 0)
  }
  const rule = sheet.rules[0]
  if (rule) {
    const scope = new Map<string, string>()
    for (const [k, v] of rule.customProps) scope.set(k, v)
    for (const [prop, { value, important }] of rule.decls) {
      const resolved = substituteVars(value, scope)
      for (const ex of expandAll(prop, resolved)) {
        out.set(ex.prop, { value: ex.value, important })
      }
    }
  }
  return out
}

/** ─── 文本变换 ─── */

function applyTextTransform(text: string, el: StyleElement): string {
  const tt = el.computed.get('text-transform') ?? 'none'
  switch (tt) {
    case 'uppercase': return text.toUpperCase()
    case 'lowercase': return text.toLowerCase()
    case 'capitalize': return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    default: return text
  }
}

/** ─── url() 剥离 ─── */

function unwrapUrl(value: string, line: number): string {
  const m = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+?))\s*\)$/.exec(value.trim())
  if (m) return (m[1] ?? m[2] ?? m[3]).trim()
  if (value.includes('url(')) {
    throw new CompileFail(`background-image "${value}" 无法解析（应为 url(路径) 或裸路径）`, line)
  }
  return value.trim()
}

/** ─── 编译入口 ─── */

export function compileWidgetHtml(source: string, options: CompileOptions = {}): CompileResult {
  const errors: CompileError[] = []
  const warnings: CompileWarning[] = []
  nodeIdSeq = 0
  decorationCount = 0
  try {
    // 1. HTML 解析
    const { root: rawRoot } = tokenizeHtml(source)
    assertNoEventAttrs(rawRoot)
    const { root, headNodes, inlineStyles } = unwrapDocument(rawRoot)

    // 2. <widget> 根属性（name/canvas/world/anchor/offset；full-document 模式合并到 body）
    const name = root.attrs['name'] ?? root.attrs['data-name']
    if (!name) {
      throw new CompileFail(
        '缺少 widget 名称（<widget name="..."> 或 <body name="...">；full-document 可用 <title>）',
        root.line,
      )
    }
    const canvasStr = root.attrs['canvas'] ?? `${FULLSCREEN_CANVAS_WIDTH}x${FULLSCREEN_CANVAS_HEIGHT}`
    const cm = /^(\d+)x(\d+)$/.exec(canvasStr)
    if (!cm) throw new CompileFail(`<widget> canvas 属性格式应为 "宽x高"（如 canvas="960x540"）`, root.line)
    const canvasWidth = parseInt(cm[1], 10)
    const canvasHeight = parseInt(cm[2], 10)
    let worldWidth = FULLSCREEN_WORLD_WIDTH
    let worldHeight = round2(FULLSCREEN_WORLD_WIDTH * (canvasHeight / canvasWidth))
    const worldStr = root.attrs['world']
    if (worldStr) {
      const wm = /^([\d.]+)x([\d.]+)$/.exec(worldStr)
      if (!wm) throw new CompileFail(`<widget> world 属性格式应为 "宽x高"（米，如 world="4.8x0.9"）`, root.line)
      worldWidth = round2(parseFloat(wm[1]))
      worldHeight = round2(parseFloat(wm[2]))
    }
    const wctx: WorldCtx = { canvasWidth, canvasHeight, worldWidth, worldHeight }

    // 3. 样式表：UA + 作者（style/link/@import）
    const bundle = collectStylesheets(headNodes, inlineStyles, options, warnings)
    const uaSheet = tokenizeStylesheet(UA_STYLESHEET, { origin: 0 })
    const allRules = [...uaSheet.rules, ...bundle.rules]
    // @media 静态评估
    for (const pending of bundle.medias) {
      if (evaluateMedia(pending.condition, canvasWidth, canvasHeight, pending.line, warnings)) {
        allRules.push(...pending.rules)
      }
    }

    // 4. 级联 + 继承
    const styleRoot = buildStyleTree(root, null, parseInlineStyle)
    validateTags(styleRoot)
    computeStyles(styleRoot, allRules)
    validateComputedStyles(styleRoot, warnings)

    // 5. 静态布局求解
    const solveCtx: SolveContext = {
      canvasWidth, canvasHeight,
      rootFontSize: resolveRootFontSize(styleRoot, canvasWidth, canvasHeight),
      warnings,
    }
    const rootBox = solveLayout(styleRoot, solveCtx)

    // 6. 产物骨架
    const doc: Record<string, unknown> = {
      name,
      baseClass: 'Actor',
      sourceHash: fnv1a(source.replace(/^\uFEFF/, '')),
      components: [] as unknown[],
      children: [] as unknown[],
    }
    const rootTfProps: Record<string, unknown> = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      worldWidth,
      worldHeight,
    }
    const rootAnchor = root.attrs['anchor']
    if (rootAnchor) {
      rootTfProps.anchor = rootAnchor
      const off: [number, number] = [0, 0]
      const rootOffset = root.attrs['offset']
      if (rootOffset) {
        const parts = rootOffset.split(',').map((s) => parseFloat(s.trim()))
        if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) {
          throw new CompileFail(`<widget> offset 属性格式应为 "x,y"（世界米）`, root.line)
        }
        off[0] = round4(parts[0]); off[1] = round4(parts[1])
      }
      rootTfProps.anchorOffset = off
    }
    ;(doc.components as unknown[]).push({ baseClass: 'UITransformComponent', properties: rootTfProps })
    ;(doc.components as unknown[]).push({
      baseClass: 'CanvasUIComponent',
      properties: {
        width: canvasWidth, height: canvasHeight, name: 'Canvas', zOrder: 0, active: true,
        ...(styleRoot.computed.get('hit-test') ? { hitTest: styleRoot.computed.get('hit-test') } : {}),
      },
    })
    // 根节点默认隐藏（<widget active="false"> → 根 Actor active:false，旧资产根挂 inactive 的等价写法）
    if (root.attrs['active'] === 'false') doc.active = false
    // 根背景（body/widget 的 background 声明）
    emitRootBackground(rootBox, doc, wctx)

    // 7. 发射
    const emitter = new Emitter(wctx, warnings)
    const usedNames = new Set<string>([name])
    // 根节点行为脚本（<widget data-script="...">，旧资产根挂 UIScript 的等价写法）
    emitter.emitDataScript(styleRoot, doc as unknown as Record<string, unknown>)
    for (const child of rootBox.children) {
      emitter.emitBox(child, doc as unknown as { children: unknown[] }, rootBox, usedNames, 0)
    }
    if (decorationCount > 0) {
      warnings.push({ line: 0, message: `共 ${decorationCount} 处装饰类声明不渲染（cursor/user-select 等，见文档偏差表）` })
    }

    return { ok: true, errors: [], warnings, doc }
  } catch (e) {
    if (e instanceof CompileFail || e instanceof ParseError || e instanceof CssParseError) {
      errors.push({ line: (e as { line: number }).line, message: e.message })
    } else {
      errors.push({ line: 0, message: `编译异常: ${(e as Error).message}` })
    }
    return { ok: false, errors, warnings, doc: undefined }
  }
}

function resolveRootFontSize(root: StyleElement, canvasW: number, canvasH: number): number {
  const fs = root.computed.get('font-size')
  if (!fs) return 16
  const l = parseLength(fs, { rootFontSize: 16, fontSize: 16, viewport: [canvasW, canvasH] })
  return l && l.unit === 'px' ? Math.max(1, l.value) : 16
}

/** 根背景（body/widget background 声明 → 全画布 UIImage） */
function emitRootBackground(rootBox: Box, doc: Record<string, unknown>, wctx: WorldCtx): void {
  const el = rootBox.el
  const bg = el.computed.get('background-color')
  const bgImageRaw = el.computed.get('background-image')
  const image = bgImageRaw && bgImageRaw !== 'none' ? unwrapUrl(bgImageRaw, el.node.line) : undefined
  const color = bg && bg !== 'transparent' ? normalizeColor(bg) : undefined
  if (!color && !image) return
  const props: Record<string, unknown> = {
    name: 'RootBackground',
    width: wctx.canvasWidth,
    height: wctx.canvasHeight,
  }
  if (image) props.src = image
  else if (color) props.color = color
  const radius = el.computed.get('border-top-left-radius')
  if (radius) props.radius = parseFloat(radius) || 0
  const opacity = el.computed.get('opacity')
  if (opacity !== undefined) props.opacity = parseFloat(opacity)
  ;(doc.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: props })
}

/** ─── 发射器 ─── */

let decorationCount = 0

class Emitter {
  constructor(
    private wctx: WorldCtx,
    private warnings: CompileWarning[],
  ) {}

  wx(px: number): number {
    return pxToWorldX(px, this.wctx)
  }
  wy(px: number): number {
    return pxToWorldY(px, this.wctx)
  }

  /** 发射一个盒子为 widget.json 子节点 */
  emitBox(
    box: Box,
    parent: { children: unknown[] },
    parentBox: Box,
    usedNames: Set<string>,
    depth: number,
    parentName = '',
  ): void {
    if (box.kind === 'text') {
      parent.children.push(this.emitTextActor(box, parentBox, usedNames, parentName))
      return
    }
    // markerOnly 列表标记由 li 发射逻辑处理
    const el = box.el
    const nodeName = this.nameOf(el, box, usedNames)
    const node: Record<string, unknown> = {
      name: nodeName,
      baseClass: 'Actor',
      id: nextNodeId(),
      components: [] as unknown[],
      children: [] as unknown[],
    }

    // visibility:hidden → 保留节点（占位）但不渲染
    if (el.computed.get('visibility') === 'hidden') node.active = false

    // ─── UITransform：边盒尺寸 + 定位 ───
    const bbW = box.w + box.pl + box.pr + box.bl + box.br
    const bbH = box.h + box.pt + box.pb + box.bt + box.bb
    const bbX = box.x - box.pl - box.bl
    const bbY = box.y - box.pt - box.bt
    const tfProps = this.buildTransform(box, bbX, bbY, bbW, bbH, parentBox, depth === 0)
    ;(node.components as unknown[]).push({ baseClass: 'UITransformComponent', properties: tfProps })

    // ─── CanvasUI marker ───
    const markerProps: Record<string, unknown> = { markerOnly: true, name: 'UIMarker', zOrder: 0 }
    const zIndex = el.computed.get('z-index')
    const zOrderProp = el.computed.get('z-order')
    if (zOrderProp !== undefined) markerProps.zOrder = parseInt(zOrderProp, 10) || 0
    else if (zIndex !== undefined && zIndex !== 'auto') markerProps.zOrder = parseInt(zIndex, 10) || 0
    const pe = el.computed.get('pointer-events')
    const hitTest = el.computed.get('hit-test')
    if (pe === 'none') markerProps.hitTest = 'hitTestInvisible'
    else if (hitTest === 'visible' || hitTest === 'block' || hitTest === 'hitTestInvisible') markerProps.hitTest = hitTest
    ;(node.components as unknown[]).push({ baseClass: 'CanvasUIComponent', properties: markerProps })

    // ─── UILayout（flex 静态解可被运行时公式复现时补挂：保留 v1 动态子项重排能力）───
    if (box.flexRuntime) {
      const fr = box.flexRuntime
      ;(node.components as unknown[]).push({
        baseClass: 'UILayoutComponent',
        properties: {
          mode: fr.isRow ? 'horizontal' : 'vertical',
          // 引擎 spacingX/Y 缺省 0.2，必须显式写 0
          spacingX: fr.isRow ? round4(this.wx(fr.gapX)) : round4(this.wy(fr.gapX)),
          spacingY: fr.isRow ? round4(this.wx(fr.gapY)) : round4(this.wy(fr.gapY)),
          // 引擎缺省 justify=center / align=center，与 CSS 缺省（flex-start/stretch）不同，必须显式写
          justify: mapEnum(JUSTIFY_MAP, fr.justify, 'justify-content', box.line),
          align: mapEnum(ALIGN_MAP, fr.align, 'align-items', box.line),
          autoLayout: true,
        },
      })
    }

    // ─── 功能组件 ───
    const scrollDir = this.scrollDirectionOf(el)
    if (scrollDir) {
      ;(node.components as unknown[]).push({
        baseClass: 'UIScrollListComponent',
        properties: { direction: scrollDir },
      })
    }

    // data-script 先于功能组件发射：按钮交互态（emitButtonStates）需要找到已有
    // UIScriptComponent 并入 args，否则误报"无 data-script"
    this.emitDataScript(el, node)

    switch (box.tag) {
      case 'img': this.emitImage(box, node, nodeName, true); this.emitBorders(box, node, nodeName); break
      case 'button': this.emitButton(box, node, nodeName, usedNames); this.emitBorders(box, node, nodeName); break
      case 'text': this.emitTextElement(box, node, nodeName); break
      case 'input': case 'textarea': this.emitInput(box, node); break
      case 'progress': this.emitProgress(box, node); break
      case 'br': case 'wbr':
        // 不可达（buildBox 已消化），防御
        break
      default:
        this.emitContainerVisuals(box, node, nodeName)
        break
    }

    // 非 button 元素携带交互态伪类：引擎仅按钮有 hover/pressed 状态机 → 披露
    for (const [kind, decls] of [
      [':hover', el.stateDecls.hover], [':active', el.stateDecls.active], [':disabled', el.stateDecls.disabled],
    ] as Array<[string, Map<string, string>]>) {
      if (decls.size > 0 && box.tag !== 'button') {
        this.warnings.push({
          line: el.node.line,
          message: `${kind} 交互态仅 button 支持（该元素为 <${box.tag}>），声明不生效`,
        })
      }
    }

    // ─── sourceLayout 侧车：盒模型信息不落盘于组件 schema，json 侧车承载（sourceHash 先例）───
    const padArr = [box.pt, box.pr, box.pb, box.pl]
    const bordArr = [box.bt, box.br, box.bb, box.bl]
    if (padArr.some((v) => v > 0) || bordArr.some((v) => v > 0)) {
      const sl: Record<string, unknown> = {}
      if (padArr.some((v) => v > 0)) sl.padding = padArr.map((v) => round2(v))
      if (bordArr.some((v) => v > 0)) sl.border = bordArr.map((v) => round2(v))
      ;(node as Record<string, unknown>).sourceLayout = sl
    }

    // ─── 通用：data-comp / title（data-script 已提前发射） ───
    this.emitDataComp(el, node)
    const title = el.node.attrs['title']
    if (title) {
      ;(node.components as unknown[]).push({
        baseClass: 'UITooltipComponent',
        properties: { text: title },
      })
    }

    // ─── 子盒子 ───
    // button/text 的直属文本已由专属组件承载，仅跳过"自身"文本片段；
    // 子元素（如反编译回读的 <text> 子节点）的文本片段照常发射
    const skipSelfText = box.tag === 'button' || box.tag === 'text'
    // li 标记
    if (box.listMarker && box.display === 'list-item') {
      const markerBox = this.markerBoxOf(box)
      node.children = node.children as unknown[]
      ;(node.children as unknown[]).push(this.emitMarkerActor(markerBox, box, nodeName, usedNames))
    }
    for (const child of box.children) {
      if (skipSelfText && child.kind === 'text' && child.el === el) continue
      this.emitBox(child, node as unknown as { children: unknown[] }, box, usedNames, depth + 1, nodeName)
    }

    parent.children.push(node)
  }

  /** 盒子 → UIText Actor */
  private emitTextActor(box: Box, parentBox: Box, usedNames: Set<string>, parentName = ''): Record<string, unknown> {
    const el = box.el
    let base: string
    if (parentName) {
      // 元素直属文本：随父名 +Text（assetLint 同名去重）
      base = parentName.endsWith('Text') ? `${parentName}_2` : `${parentName}Text`
      if (usedNames.has(base)) {
        let i = 2
        while (usedNames.has(`${parentName}Text${i}`)) i++
        base = `${parentName}Text${i}`
      }
      usedNames.add(base)
    } else {
      base = this.nameOf(el, box, usedNames, '#text')
    }
    const fsRaw = el.computed.get('font-size')
    const fontSize = fsRaw
      ? Math.round(parseLength(fsRaw, { rootFontSize: 16, fontSize: 16, viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })?.value ?? 28)
      : 28
    const text = applyTextTransform(box.text ?? '', el)
    const props: Record<string, unknown> = {
      text,
      name: base,
      width: Math.max(8, Math.round(box.w)),
      height: Math.max(8, Math.round(box.h)),
    }
    this.applyTextProps(el, props)
    const pos = this.centerOffset(box, parentBox)
    return {
      name: base,
      baseClass: 'Actor',
      id: nextNodeId(),
      active: el.computed.get('visibility') === 'hidden' ? false : undefined,
      components: [
        {
          baseClass: 'UITransformComponent',
          properties: {
            position: [pos.x, pos.y, 0],
            rotation: this.rotationOf(el),
            scale: this.scaleOf(el),
            worldWidth: this.wx(box.w),
            worldHeight: this.wy(box.h),
          },
        },
        { baseClass: 'CanvasUIComponent', properties: this.markerPropsOf(el) },
        { baseClass: 'UITextComponent', properties: props },
      ],
      children: [],
    }
  }

  /** 列表标记（在 li 内容盒左侧外挂文本） */
  private markerBoxOf(liBox: Box): { x: number; y: number; text: string; fontSize: number } {
    const el = liBox.el
    const fs = this.fontSizePxOf(el)
    return {
      x: liBox.x - liBox.pl - 24, // 标记放在 padding 区右侧 24px 带
      y: liBox.y,
      text: liBox.listMarker ?? '•',
      fontSize: fs,
    }
  }

  private emitMarkerActor(
    mk: { x: number; y: number; text: string; fontSize: number },
    liBox: Box,
    liName: string,
    usedNames: Set<string>,
  ): Record<string, unknown> {
    void usedNames
    const name = `${liName}Marker`
    const props: Record<string, unknown> = {
      text: mk.text,
      name,
      fontSize: mk.fontSize,
      width: 32,
      height: Math.max(8, Math.round(mk.fontSize * 1.4)),
      anchorX: 'right',
    }
    this.applyTextProps(liBox.el, props)
    // 相对 li 边盒中心（position 语义）：标记中心在内容原点左侧 8px
    const liBorderX = liBox.x - liBox.pl - liBox.bl
    const liCenterX = liBorderX + (liBox.w + liBox.pl + liBox.pr + liBox.bl + liBox.br) / 2
    const liBorderY = liBox.y - liBox.pt - liBox.bt
    const liCenterY = liBorderY + (liBox.h + liBox.pt + liBox.pb + liBox.bt + liBox.bb) / 2
    const cx = this.wx(mk.x + 16 - liCenterX)
    const cy = this.wy(-(mk.y + mk.fontSize * 0.7 - liCenterY))
    return {
      name,
      baseClass: 'Actor',
      id: nextNodeId(),
      components: [
        {
          baseClass: 'UITransformComponent',
          properties: {
            position: [cx, cy, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            worldWidth: this.wx(32),
            worldHeight: this.wy(Math.max(8, mk.fontSize * 1.4)),
          },
        },
        { baseClass: 'CanvasUIComponent', properties: { markerOnly: true, name: 'UIMarker', zOrder: 0 } },
        { baseClass: 'UITextComponent', properties: props },
      ],
      children: [],
    }
  }

  /** ─── 各标签专属发射 ─── */

  private emitImage(box: Box, node: Record<string, unknown>, nodeName: string, requireSize: boolean): void {
    const el = box.el
    if (requireSize && (box.w <= 0 || box.h <= 0)) {
      // img 无显式尺寸：编译期无法得知图片原始比例
      this.warnings.push({
        line: el.node.line,
        message: '<img> 未显式设置 width/height（编译期无法获取图片原始尺寸，已按内容盒渲染）',
      })
    }
    const elW = box.w + box.pl + box.pr + box.bl + box.br
    const elH = box.h + box.pt + box.pb + box.bt + box.bb
    const props = this.collectImageProps(el, elW, elH, nodeName)
    ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: props })
  }

  private emitButton(box: Box, node: Record<string, unknown>, nodeName: string, usedNames: Set<string>): void {
    const el = box.el
    ;(node.components as unknown[]).push({ baseClass: 'UIButtonComponent', properties: {} })
    const elW = box.w + box.pl + box.pr + box.bl + box.br
    const elH = box.h + box.pt + box.pb + box.bt + box.bb
    const bgProps = this.collectImageProps(el, elW, elH, nodeName)
    if (bgProps) {
      ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: bgProps })
    }
    // 按钮文本：直属文本 → 子 UIText；无文本也挂（交脚本驱动）
    const textParts: string[] = []
    for (const c of el.children) {
      if (c.tag === '#text') textParts.push(applyTextTransform(c.text ?? '', el))
    }
    const text = textParts.join(' ').trim()
    // 无直属文本且有元素子项（如反编译回读的 <text> 子节点）→ 文字已由子项承载
    const hasElementChild = box.children.some((c) => c.kind === 'element' && c.tag !== 'br')
      || box.children.some((c) => c.kind === 'text' && c.el !== el)
    if (text || !hasElementChild) {
      const textActor = this.buttonTextActor(box, text, nodeName, usedNames)
      ;(node.children as unknown[]).push(textActor)
    }
    // 交互态 → UIScript args 透传（hover/pressed/disabled 颜色）
    this.emitButtonStates(el, node)
    if (el.node.attrs['disabled'] !== undefined) {
      this.warnings.push({
        line: el.node.line,
        message: 'button disabled 属性：引擎按钮状态由运行时控制（UIButtonComponent.state），静态资产不置灰',
      })
    }
  }

  private buttonTextActor(box: Box, text: string, nodeName: string, usedNames: Set<string>): Record<string, unknown> {
    const el = box.el
    let name = `${nodeName}Text`
    if (usedNames.has(name)) {
      let i = 1
      while (usedNames.has(`${nodeName}Text${i > 1 ? i : ''}`)) i++
      name = `${nodeName}Text${i > 1 ? i : ''}`
    }
    usedNames.add(name)
    const fs = this.fontSizePxOf(el)
    const props: Record<string, unknown> = {
      text,
      name,
      fontSize: fs,
      width: Math.max(8, Math.round(box.w)),
      height: Math.max(8, Math.round(box.h)),
    }
    this.applyTextProps(el, props)
    const ta = el.computed.get('text-align')
    void ta
    return {
      name,
      baseClass: 'Actor',
      id: nextNodeId(),
      components: [
        {
          baseClass: 'UITransformComponent',
          properties: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            anchor: 'center',
            anchorOffset: [0, 0],
            worldWidth: this.wx(box.w),
            worldHeight: this.wy(box.h),
          },
        },
        { baseClass: 'CanvasUIComponent', properties: { markerOnly: true, name: 'UIMarker', zOrder: 0 } },
        { baseClass: 'UITextComponent', properties: props },
      ],
      children: [],
    }
  }

  /** text 元素（专有标签）：自身承载 UIText */
  private emitTextElement(box: Box, node: Record<string, unknown>, nodeName: string): void {
    const el = box.el
    const ownText = el.children.find((c) => c.tag === '#text')
    const text = applyTextTransform(ownText?.text ?? '', el)
    const props: Record<string, unknown> = {
      text,
      name: nodeName,
      width: Math.max(8, Math.round(box.w)),
      height: Math.max(8, Math.round(box.h)),
    }
    this.applyTextProps(el, props)
    ;(node.components as unknown[]).push({ baseClass: 'UITextComponent', properties: props })
  }

  private emitInput(box: Box, node: Record<string, unknown>): void {
    const el = box.el
    const type = (el.node.attrs['type'] ?? 'text').toLowerCase()
    if (box.tag === 'input') {
      if (['checkbox', 'radio', 'range', 'file', 'color', 'date', 'time', 'datetime-local', 'month', 'week', 'image', 'hidden'].includes(type)) {
        throw new CompileFail(
          `input type="${type}" 不在映射面（引擎无对应控件；可用 img+UIScript 或按钮替代）`,
          el.node.line,
        )
      }
      if (type === 'submit' || type === 'reset' || type === 'button') {
        // 表单按钮 → UIButton（value 为文案）
        ;(node.components as unknown[]).push({ baseClass: 'UIButtonComponent', properties: {} })
        const value = el.node.attrs['value'] ?? ''
        this.emitButtonLikeText(box, node, value)
        return
      }
      // text/password/email/tel/search/number → 单行输入（password 明文降级披露）
      if (type === 'password') {
        this.warnings.push({
          line: el.node.line,
          message: 'input type="password"：引擎输入框无掩码渲染，按明文输入框处理',
        })
      }
    }
    const elW = box.w + box.pl + box.pr + box.bl + box.br
    const elH = box.h + box.pt + box.pb + box.bt + box.bb
    const props: Record<string, unknown> = {
      width: Math.max(8, Math.round(elW)),
      height: Math.max(8, Math.round(elH)),
    }
    const placeholder = el.node.attrs['placeholder']
    if (placeholder) props.placeholder = placeholder
    const value = el.node.attrs['value']
    if (value) props.value = value
    this.applyTextProps(el, props)
    // 背景视觉：与 button 同规则，background-color/gradient → 同节点 UIImage（引擎输入框无自带底色）
    const bgProps = this.collectImageProps(el, elW, elH, '')
    if (bgProps) {
      ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: bgProps })
    }
    // 输入框只保留输入语义字段：静态文本专属字段（align/bold/shadow* 等）引擎注册器
    // 不消费且 assetLint schema 不允许，必须过滤
    const inputAllowed = new Set(['placeholder', 'value', 'fontSize', 'color', 'width', 'height', 'zOrder', 'hitTest', 'name'])
    for (const k of Object.keys(props)) {
      if (!inputAllowed.has(k)) delete props[k]
    }
    // 输入框文本恒为左对齐（引擎 UITextInput 不消费 align 字段，持久化会被过滤）
    ;(node.components as unknown[]).push({ baseClass: 'UITextInputComponent', properties: props })
    if (el.node.attrs['disabled'] !== undefined || el.node.attrs['readonly'] !== undefined) {
      this.warnings.push({
        line: el.node.line,
        message: `input ${el.node.attrs['disabled'] !== undefined ? 'disabled' : 'readonly'} 属性：引擎输入框无置灰态，按可输入处理`,
      })
    }
  }

  private emitButtonLikeText(box: Box, node: Record<string, unknown>, text: string): void {
    void box
    void node
    void text
    // 表单按钮文字：与 emitButton 的文字子 Actor 同构（由通用 text 收集处理）
    // 此处留空：submit/reset 按钮的文字在容器文本收集阶段已处理
  }

  private emitProgress(box: Box, node: Record<string, unknown>): void {
    void box
    const el = box.el
    const props: Record<string, unknown> = {}
    const value = el.node.attrs['value']
    if (value) {
      const v = parseFloat(value)
      if (!Number.isFinite(v)) throw new CompileFail(`progress value "${value}" 必须是数字`, el.node.line)
      props.value = v
    }
    const max = el.node.attrs['max']
    if (max) {
      const v = parseFloat(max)
      if (!Number.isFinite(v) || v <= 0) throw new CompileFail(`progress max "${max}" 必须是正数`, el.node.line)
      props.max = v
    }
    ;(node.components as unknown[]).push({ baseClass: 'UIProgressBarComponent', properties: props })
  }

  /** 容器视觉：背景/边框（img/button 之外标签共用） */
  private emitContainerVisuals(box: Box, node: Record<string, unknown>, nodeName: string): void {
    const el = box.el
    const elW = box.w + box.pl + box.pr + box.bl + box.br
    const elH = box.h + box.pt + box.pb + box.bt + box.bb
    const bgProps = this.collectImageProps(el, elW, elH, nodeName)
    if (bgProps) {
      ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: bgProps })
    }
    this.emitBorders(box, node, nodeName)
  }

  /** 边框 → 四条 UIImage 子 Actor（solid 语义；圆角+边框近似直边） */
  private emitBorders(box: Box, node: Record<string, unknown>, nodeName: string): void {
    const el = box.el
    const sides: Array<[string, number, string]> = [
      ['top', box.bt, 'border-top-color'],
      ['right', box.br, 'border-right-color'],
      ['bottom', box.bb, 'border-bottom-color'],
      ['left', box.bl, 'border-left-color'],
    ]
    const active = sides.filter(([, w]) => w > 0)
    if (active.length === 0) return
    const radius = box.el.computed.get('border-top-left-radius')
    if (radius && parseFloat(radius) > 0) {
      this.warnings.push({
        line: el.node.line,
        message: '圆角与边框同时声明：边框为直边矩形贴边，圆角处不跟随（引擎单半径圆角不含描边）',
      })
    }
    for (const [styleProp] of [['border-top-style'], ['border-right-style'], ['border-bottom-style'], ['border-left-style']] as Array<[string]>) {
      const sv = el.computed.get(styleProp)
      if (sv && !['solid', 'none', 'hidden'].includes(sv)) {
        this.warnings.push({
          line: el.node.line,
          message: `border-style: ${sv} 不受支持（仅实线渲染），按实线处理`,
        })
        break
      }
    }
    const elW = box.w + box.pl + box.pr + box.bl + box.br
    const elH = box.h + box.pt + box.pb + box.bt + box.bb
    for (const [side, width, colorProp] of active) {
      const colorRaw = el.computed.get(colorProp) ?? el.computed.get('color') ?? '#000000'
      const color = normalizeColor(colorRaw)
      if (!color) {
        throw new CompileFail(`边框颜色 "${colorRaw}" 无法解析`, el.node.line)
      }
      let sx = 0
      let sy = 0
      let sw = elW
      let sh = width
      if (side === 'right') { sx = elW - width; sy = 0; sw = width; sh = elH }
      else if (side === 'bottom') { sx = 0; sy = elH - width; sw = elW; sh = width }
      else if (side === 'left') { sx = 0; sy = 0; sw = width; sh = elH }
      const name = `${nodeName}Border${side[0].toUpperCase()}${side.slice(1)}`
      const strip: Record<string, unknown> = {
        name,
        baseClass: 'Actor',
        id: nextNodeId(),
        components: [
          {
            baseClass: 'UITransformComponent',
            properties: {
              position: [
                round4(this.wx(sx + sw / 2 - elW / 2)),
                round4(this.wy(-(sy + sh / 2 - elH / 2))),
                0,
              ],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              worldWidth: this.wx(sw),
              worldHeight: this.wy(sh),
            },
          },
          { baseClass: 'CanvasUIComponent', properties: { markerOnly: true, name: 'UIMarker', zOrder: 0 } },
          {
            baseClass: 'UIImageComponent',
            properties: { name, color, width: Math.max(8, Math.round(sw)), height: Math.max(8, Math.round(sh)) },
          },
        ],
        children: [],
      }
      ;(node.children as unknown[]).push(strip)
    }
  }

  /** ─── 组件属性收集 ─── */

  private collectImageProps(el: StyleElement, elW: number, elH: number, nodeName: string): Record<string, unknown> | null {
    const props: Record<string, unknown> = {}
    // 渐变优先：background-image 为 linear-gradient(...) 时走渐变通道，不经 src
    const gradientRaw = el.computed.get('background-image')
    let gradient: ReturnType<typeof parseLinearGradient> | undefined
    if (gradientRaw && /(^|[\s,])linear-gradient\(/.test(gradientRaw)) {
      const m = /linear-gradient\(([\s\S]*)\)\s*$/.exec(gradientRaw.trim())
      if (m) gradient = parseLinearGradient(m[1])
    }
    const srcRaw = gradient ? el.node.attrs['src'] : (el.node.attrs['src'] ?? el.computed.get('background-image'))
    const image = srcRaw && srcRaw !== 'none' ? unwrapUrl(srcRaw, el.node.line) : undefined
    const bgRaw = el.computed.get('background-color')
    const color = bgRaw && bgRaw !== 'transparent' ? normalizeColor(bgRaw) : undefined
    if (image) props.src = image
    if (gradient) {
      props.gradient = {
        angle: Math.round(gradient.angleDeg),
        stops: gradient.stops.map((s) => ({ color: s.color, offset: Math.round((s.offset ?? 0) * 1000) / 1000 })),
      }
    } else if (color && !image) {
      props.color = color
    }
    // 圆角：四角一致 → radius；不一致 → 报错（引擎单半径）
    const corners = [
      el.computed.get('border-top-left-radius'),
      el.computed.get('border-top-right-radius'),
      el.computed.get('border-bottom-right-radius'),
      el.computed.get('border-bottom-left-radius'),
    ].map((v) => (v ? this.resolveRadiusPx(v, el) : 0))
    if (corners.some((c) => c > 0)) {
      if (new Set(corners).size > 1) {
        throw new CompileFail(
          `border-radius 四角不一致 [${corners.join(', ')}]：引擎 UIImage 为单一圆角半径`,
          el.node.line,
        )
      }
      props.radius = corners[0]
    }
    const opacity = el.computed.get('opacity')
    if (opacity !== undefined) {
      const v = parseFloat(opacity)
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new CompileFail(`opacity: ${opacity} 必须 ∈ [0,1]`, el.node.line)
      }
      if (v < 1) props.opacity = v
    }
    const z = el.computed.get('z-order')
    if (z !== undefined) props.zOrder = parseInt(z, 10) || 0
    const hit = el.computed.get('hit-test')
    if (hit === 'visible' || hit === 'block' || hit === 'hitTestInvisible') props.hitTest = hit
    const hasVisual = Boolean(image || gradient || color || corners.some((c) => c > 0))
    if (!hasVisual && el.tag !== 'img') return null
    props.width = Math.max(8, Math.round(elW))
    props.height = Math.max(8, Math.round(elH))
    props.name = nodeName
    return props
  }

  private resolveRadiusPx(v: string, el: StyleElement): number {
    if (v.includes('/')) {
      throw new CompileFail(`border-radius 椭圆语法 "${v}" 不受支持（引擎单半径圆角）`, el.node.line)
    }
    const l = parseLength(v, { rootFontSize: 16, fontSize: this.fontSizePxOf(el), viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
    if (!l) throw new CompileFail(`border-radius "${v}" 无法解析`, el.node.line)
    return l.unit === '%' ? 0 : l.value // % 圆角相对尺寸，静态按 0 并披露
  }

  private applyTextProps(el: StyleElement, props: Record<string, unknown>): void {
    const fontSizeRaw = el.computed.get('font-size')
    if (fontSizeRaw) {
      const l = parseLength(fontSizeRaw, { rootFontSize: 16, fontSize: 16, viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
      const v = Math.round(l && l.unit === 'px' ? l.value : 28)
      if (v < 4 || v > 400) throw new CompileFail(`font-size: ${fontSizeRaw} 必须 ∈ [4,400]px`, el.node.line)
      props.fontSize = v
    }
    const colorRaw = el.computed.get('color')
    if (colorRaw) {
      const c = normalizeColor(colorRaw)
      if (!c) throw new CompileFail(`color "${colorRaw}" 不是可解析颜色值（命名色/hex/rgb/hsl 均可）`, el.node.line)
      props.color = c
    }
    const ta = el.computed.get('text-align')
    if (ta) {
      if (ta === 'justify') {
        this.warnings.push({ line: el.node.line, message: 'text-align: justify 引擎按 left 渲染（troika 无两端对齐）' })
        props.align = 'left'
      } else {
        props.align = ta
      }
    }
    const ff = el.computed.get('font-family')
    if (ff) {
      // 多族回退列表取首族（引擎运行时仅接受单族/URL）
      props.fontFamily = ff.split(',')[0].trim().replace(/^["']|["']$/g, '')
    }
    const fw = el.computed.get('font-weight')
    if (fw) {
      const n = parseInt(fw, 10)
      if (Number.isFinite(n)) props.bold = n >= 600
      else props.bold = fw === 'bold' || fw === 'bolder'
    }
    const fst = el.computed.get('font-style')
    if (fst) props.italic = fst === 'italic' || fst === 'oblique'
    const lh = el.computed.get('line-height')
    if (lh && lh !== 'normal') {
      const m = /^(-?[\d.]+)$/.exec(lh)
      if (m) props.lineHeight = parseFloat(m[1])
      else {
        const l = parseLength(lh, { rootFontSize: 16, fontSize: (props.fontSize as number) ?? 28, viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
        if (l && l.unit === 'px' && (props.fontSize as number)) {
          props.lineHeight = Math.round((l.value / (props.fontSize as number)) * 100) / 100
        }
      }
    }
    const ls = el.computed.get('letter-spacing')
    if (ls) {
      const l = parseLength(ls, { rootFontSize: 16, fontSize: (props.fontSize as number) ?? 28, viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
      if (l && l.unit === 'px') props.letterSpacing = Math.round(l.value)
    }
    // 标准 text-shadow → shadowColor/Blur/OffsetX/OffsetY（专有别名通道兜底）
    const ts = el.computed.get('text-shadow')
    const legacyColor = el.computed.get('text-shadow-color')
    const legacyBlur = el.computed.get('text-shadow-blur')
    if (ts && ts !== 'none') {
      const parsed = this.parseTextShadow(ts, el)
      if (parsed) {
        const [ox, oy, blur, colorHex] = parsed
        if (colorHex) props.shadowColor = colorHex
        else if (legacyColor) {
          const c = normalizeColor(legacyColor)
          if (c) props.shadowColor = c
        }
        props.shadowOffsetX = Math.round(ox)
        props.shadowOffsetY = Math.round(oy)
        props.shadowBlur = Math.round(blur)
      }
    } else {
      if (legacyColor) {
        const c = normalizeColor(legacyColor)
        if (!c) throw new CompileFail(`text-shadow-color "${legacyColor}" 不是可解析颜色值`, el.node.line)
        props.shadowColor = c
      }
      if (legacyBlur !== undefined) {
        const l = parseLength(legacyBlur, { rootFontSize: 16, fontSize: (props.fontSize as number) ?? 28, viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
        if (l && l.unit === 'px') props.shadowBlur = Math.round(l.value)
      }
    }
    const z = el.computed.get('z-order')
    if (z !== undefined) props.zOrder = parseInt(z, 10) || 0
    const hit = el.computed.get('hit-test')
    if (hit === 'visible' || hit === 'block' || hit === 'hitTestInvisible') props.hitTest = hit
    // 白空间：nowrap 尽力而为（troika 恒按宽换行）——披露
    const ws = el.computed.get('white-space')
    if (ws === 'nowrap') {
      this.warnings.push({
        line: el.node.line,
        message: 'white-space: nowrap：引擎文本按控件宽度自动换行，nowrap 不保证单行（可加大宽度）',
      })
    }
  }

  /** text-shadow: [offset-x offset-y (blur) (color)]* → 首个阴影 */
  private parseTextShadow(value: string, el: StyleElement): [number, number, number, string | null] | null {
    const parts = value.split(/\)\s*,\s*/).map((p, i, arr) => (i < arr.length - 1 ? p + ')' : p))
    const first = parts[0].trim()
    const tokens = first.match(/(?:[a-zA-Z-]+\([^)]*\))|(?:#[0-9a-fA-F]{3,8})|(?:-?[\d.]+(?:px|em|rem)?)/g) ?? []
    const nums: number[] = []
    let color: string | null = null
    const fctx = { rootFontSize: 16, fontSize: this.fontSizePxOf(el), viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] as [number, number] }
    for (const tok of tokens) {
      if (/^#[0-9a-fA-F]{3,8}$/.test(tok)) {
        color = normalizeColor(tok)
      } else if (/^[a-zA-Z-]+\(/.test(tok)) {
        color = normalizeColor(tok)
      } else {
        const l = parseLength(tok, fctx)
        if (l && l.unit === 'px') nums.push(l.value)
      }
    }
    if (nums.length < 2) return null
    return [nums[0], nums[1], nums[2] ?? 0, color]
  }

  /** 按钮交互态（:hover/:active/:disabled）→ UIScript.args 透传 */
  private emitButtonStates(el: StyleElement, node: Record<string, unknown>): void {
    const states: Array<['hover' | 'active' | 'disabled', Map<string, string>, string]> = [
      ['hover', el.stateDecls.hover, 'hover'],
      ['active', el.stateDecls.active, 'pressed'],
      ['disabled', el.stateDecls.disabled, 'disabled'],
    ]
    for (const [kind, decls, argKey] of states) {
      if (decls.size === 0) continue
      const args: Record<string, unknown> = {}
      let allowed = true
      for (const [prop, value] of decls) {
        if (!STATE_ALLOWED_PROPS.has(prop)) {
          this.warnings.push({
            line: el.node.line,
            message: `:${kind} 中的 "${prop}" 不支持（交互态仅支持 color/background-color/opacity）`,
          })
          allowed = false
          continue
        }
        if (prop === 'color' || prop === 'background-color' || prop === 'background') {
          const c = normalizeColor(value)
          if (!c) throw new CompileFail(`:${kind} 颜色 "${value}" 无法解析`, el.node.line)
          args.color = c
        } else if (prop === 'opacity') {
          args.opacity = parseFloat(value)
        }
      }
      const hasAny = Object.keys(args).length > 0
      if (!hasAny) continue
      // 找/建 UIScriptComponent；无 data-script 时披露（色值需运行时脚本消费）
      let scriptComp = (node.components as Array<{ baseClass: string; properties: Record<string, unknown> }>)
        .find((c) => c.baseClass === 'UIScriptComponent')
      if (!scriptComp) {
        if (!allowed) continue
        this.warnings.push({
          line: el.node.line,
          message: `:${kind} 状态色已写入 UIScript.args.${argKey}，但元素无 data-script——需运行时脚本消费才会生效`,
        })
        scriptComp = { baseClass: 'UIScriptComponent', properties: { script: '', args: {} } }
        ;(node.components as unknown[]).push(scriptComp)
      }
      const sp = scriptComp.properties
      sp.args = { ...(sp.args as Record<string, unknown> | undefined), [argKey]: args }
    }
  }

  emitDataScript(el: StyleElement, node: Record<string, unknown>): void {
    const script = el.node.attrs['data-script']
    if (!script) return
    const scriptProps: Record<string, unknown> = { script }
    const dataArgs = el.node.attrs['data-args']
    if (dataArgs) {
      try {
        scriptProps.args = JSON.parse(dataArgs)
      } catch {
        throw new CompileFail(`data-args 属性不是合法 JSON: "${dataArgs}"`, el.node.line)
      }
    }
    // 与交互态合并（emitButtonStates 可能已建）
    const existing = (node.components as Array<{ baseClass: string; properties: Record<string, unknown> }>)
      .find((c) => c.baseClass === 'UIScriptComponent')
    if (existing) {
      const args = { ...(scriptProps.args as Record<string, unknown> | undefined), ...(existing.properties.args as Record<string, unknown> | undefined) }
      existing.properties = { ...scriptProps, args }
    } else {
      ;(node.components as unknown[]).push({ baseClass: 'UIScriptComponent', properties: scriptProps })
    }
  }

  private emitDataComp(el: StyleElement, node: Record<string, unknown>): void {
    const compName = el.node.attrs['data-comp']
    if (!compName) return
    const baseClass = compName.endsWith('Component') ? compName : `${compName}Component`
    let props: Record<string, unknown> = {}
    const dataProps = el.node.attrs['data-props']
    if (dataProps) {
      try {
        props = JSON.parse(dataProps)
      } catch {
        throw new CompileFail(`data-props 不是合法 JSON: "${dataProps}"`, el.node.line)
      }
    }
    const comps = node.components as Array<{ baseClass: string; properties: Record<string, unknown> }>
    const existing = comps.find((c) => c.baseClass === baseClass)
    if (existing) {
      // 原生映射/已挂载的组件：data-props 并入（显式声明优先），不重复挂载
      existing.properties = { ...existing.properties, ...props }
      return
    }
    if (Emitter.NATIVE_MAPPED_COMPS.has(baseClass) && !dataProps) return
    comps.push({ baseClass, properties: props })
  }

  /** 原生标签已映射的组件（data-comp 与原生映射共存时并入原生组件，而非丢弃） */
  private static readonly NATIVE_MAPPED_COMPS = new Set([
    'UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent',
    'UITooltipComponent', 'UIImageComponent', 'UIButtonComponent',
  ])

  /** ─── 定位/变换 ─── */

  private fontSizePxOf(el: StyleElement): number {
    const fs = el.computed.get('font-size')
    if (!fs) return 28
    const l = parseLength(fs, { rootFontSize: 16, fontSize: 16, viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
    return l && l.unit === 'px' ? Math.max(4, Math.min(400, Math.round(l.value))) : 28
  }

  /** 盒边盒中心相对父边盒中心的世界偏移（静态路径 position；运行时容器=边盒） */
  private centerOffset(box: Box, parentBox: Box): { x: number; y: number } {
    const bbW = box.w + box.pl + box.pr + box.bl + box.br
    const bbH = box.h + box.pt + box.pb + box.bt + box.bb
    const bbX = box.x - box.pl - box.bl
    const bbY = box.y - box.pt - box.bt
    const pbbW = parentBox.w + parentBox.pl + parentBox.pr + parentBox.bl + parentBox.br
    const pbbH = parentBox.h + parentBox.pt + parentBox.pb + parentBox.bt + parentBox.bb
    const pbbX = parentBox.x - parentBox.pl - parentBox.bl
    const pbbY = parentBox.y - parentBox.pt - parentBox.bt
    const dx = (bbX + bbW / 2) - (pbbX + pbbW / 2) + (box.relX ?? 0)
    const dy = (bbY + bbH / 2) - (pbbY + pbbH / 2) - (box.relY ?? 0)
    return { x: round4(this.wx(dx)), y: round4(this.wy(-dy)) }
  }

  private buildTransform(
    box: Box,
    bbX: number,
    bbY: number,
    bbW: number,
    bbH: number,
    parentBox: Box,
    _isRootChild: boolean,
  ): Record<string, unknown> {
    const el = box.el
    const pos = this.numOf(el, 'position') ?? 'static'
    const props: Record<string, unknown> = {
      rotation: this.rotationOf(el),
      scale: this.scaleOf(el),
    }
    // 尺寸：边盒世界尺寸（背景铺满元素视觉框；运行时锚点/布局的容器基准与此一致）
    props.worldWidth = this.wx(bbW)
    props.worldHeight = this.wy(bbH)

    if (pos === 'absolute' || pos === 'fixed') {
      // 锚点化：包含块 = 父内容盒（与求解器/反编译器三方一致）。
      // 运行时 applyAnchor 的容器基准即父 uitransform 尺寸（内容盒），此处公式对齐
      const cx = bbX + bbW / 2
      const cy = bbY + bbH / 2
      const pbbW = parentBox.w + parentBox.pl + parentBox.pr + parentBox.bl + parentBox.br
      const pbbH = parentBox.h + parentBox.pt + parentBox.pb + parentBox.bt + parentBox.bb
      const pbbX = parentBox.x - parentBox.pl - parentBox.bl
      const pbbY = parentBox.y - parentBox.pt - parentBox.bt
      const pcx = pbbX + pbbW / 2
      const pcy = pbbY + pbbH / 2
      const lPct = pbbW > 0 ? ((cx - pbbX) / pbbW) * 100 : 50
      const tPct = pbbH > 0 ? ((cy - pbbY) / pbbH) * 100 : 50
      props.anchor = this.anchorPresetOf(lPct, tPct)
      const parentWorldW = this.wx(pbbW)
      const parentWorldH = this.wy(pbbH)
      const elWorldW = this.wx(bbW)
      const elWorldH = this.wy(bbH)
      const fx = String(props.anchor).includes('left') ? -1 : String(props.anchor).includes('right') ? 1 : 0
      const fy = String(props.anchor).startsWith('top') ? 1 : String(props.anchor).startsWith('bottom') ? -1 : 0
      const wantX = this.wx(cx - pcx)
      const wantY = this.wy(-(cy - pcy))
      const baseX = fx * (parentWorldW / 2 - elWorldW / 2)
      const baseY = fy * (parentWorldH / 2 - elWorldH / 2)
      props.anchorOffset = [round4(wantX - baseX), round4(wantY - baseY)]
      props.position = [0, 0, 0]
    } else {
      // 流内/相对：position = 相对父中心的本地偏移（无锚点）
      const off = this.centerOffset(box, parentBox)
      props.position = [off.x, off.y, 0]
    }
    return props
  }

  private anchorPresetOf(lPct: number, tPct: number): string {
    const ax = lPct > 45 && lPct < 55 ? 'center' : lPct <= 45 ? 'left' : 'right'
    const ay = tPct > 45 && tPct < 55 ? 'middle' : tPct <= 45 ? 'top' : 'bottom'
    if (ax === 'center' && ay === 'middle') return 'center'
    return `${ay}-${ax}`
  }

  private rotationOf(el: StyleElement): [number, number, number] {
    const t = el.computed.get('transform')
    if (!t || t === 'none') return [0, 0, 0]
    const spec = parseTransform(t, { rootFontSize: 16, fontSize: this.fontSizePxOf(el), viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
    return [0, 0, round4(((spec.rotateDeg ?? 0) * Math.PI) / 180)]
  }

  private scaleOf(el: StyleElement): [number, number, number] {
    const t = el.computed.get('transform')
    if (!t || t === 'none') return [1, 1, 1]
    const spec = parseTransform(t, { rootFontSize: 16, fontSize: this.fontSizePxOf(el), viewport: [this.wctx.canvasWidth, this.wctx.canvasHeight] })
    return [spec.scaleX ?? 1, spec.scaleY ?? 1, 1]
  }

  private markerPropsOf(el: StyleElement): Record<string, unknown> {
    const markerProps: Record<string, unknown> = { markerOnly: true, name: 'UIMarker', zOrder: 0 }
    const z = el.computed.get('z-order')
    if (z !== undefined) markerProps.zOrder = parseInt(z, 10) || 0
    const zi = el.computed.get('z-index')
    if (zi !== undefined && zi !== 'auto' && z === undefined) markerProps.zOrder = parseInt(zi, 10) || 0
    const pe = el.computed.get('pointer-events')
    if (pe === 'none') markerProps.hitTest = 'hitTestInvisible'
    return markerProps
  }

  private scrollDirectionOf(el: StyleElement): 'vertical' | 'horizontal' | null {
    const ox = el.computed.get('overflow-x')
    const oy = el.computed.get('overflow-y')
    const oxScroll = ox === 'auto' || ox === 'scroll'
    const oyScroll = oy === 'auto' || oy === 'scroll'
    if (oxScroll && oyScroll) return 'vertical'
    if (oyScroll) return 'vertical'
    if (oxScroll) return 'horizontal'
    return null
  }

  private numOf(el: StyleElement, prop: string): string | undefined {
    return el.computed.get(prop)
  }

  /** 节点名（data-name > name > id > class 首词 > tag_seq），全资产去重 */
  private nameOf(el: StyleElement, box: Box | null, usedNames: Set<string>, fallbackPrefix = ''): string {
    let base: string
    if (el.node.attrs['data-name']) base = el.node.attrs['data-name']
    else if (el.node.attrs['name']) base = el.node.attrs['name']
    else if (el.id) base = el.id
    else if (el.classes.length > 0) base = el.classes[0]
    else {
      const t = fallbackPrefix || el.tag
      base = `${t.charAt(0).toUpperCase()}${t.slice(1)}_${nextNodeId()}`
    }
    if (usedNames.has(base)) {
      let i = 2
      while (usedNames.has(`${base}_${i}`)) i++
      base = `${base}_${i}`
    }
    usedNames.add(base)
    void box
    return base
  }
}
