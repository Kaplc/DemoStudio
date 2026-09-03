/**
 * layout — CSS 静态布局求解器（编译期把布局算成具体 px 矩形）
 *
 * CSS 静态布局是确定性计算：给定画布尺寸与全部声明，块级流/内联流/flex/grid/
 * 表格/绝对定位都能在编译期精确解算。求解产物 = 每个盒子的内容盒矩形
 * [x, y, w, h]（画布 px 坐标），发射器据此生成 anchor+offset+worldSize，
 * 运行时零布局计算、所见即所得。
 *
 * 能力面：盒模型（margin/padding/border、content-box/border-box）、块级流、
 * 内联流（换行、<br>、inline-block、vertical-align 近似）、flex（方向/wrap/
 * grow/shrink/basis/gap/justify/align/align-self/margin）、grid（模板轨道
 * px/%/fr/auto、repeat()、gap、auto 流与显式线位）、表格（列宽取内容最大）、
 * position(absolute/fixed/relative)、z-index、min/max 约束、aspect-ratio。
 *
 * 已知近似（编译警告或文档记录）：
 *  - 文本测宽为字体学估算（CJK≈1em/字，拉丁≈0.52em/字符），非真实字体度量；
 *    需要精确尺寸的场合显式声明 width/height
 *  - 垂直 margin 不折叠（恒相加），与浏览器有偏差但确定性更强
 *  - 混排内联内容按行框静态切片（每行一个片段），切片后不再运行时换行
 */
import type { StyleElement } from './css/cascade'
import { classesOf } from './css/cascade'
import type { HtmlNode } from './miniParser'
import { evalCalc, parseLength, parseTransform, type LengthValue } from './css/values'

export class LayoutError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

/** 求解上下文 */
export interface SolveContext {
  canvasWidth: number
  canvasHeight: number
  rootFontSize: number
  /** 布局期警告收集（非阻断） */
  warnings: Array<{ line: number; message: string }>
}

/** 盒子种类 */
export type BoxKind =
  | 'element'      // 元素盒（可带背景/边框/子树）
  | 'text'         // 纯文本片段盒（发射 UIText；el 指向其归属元素）
  | 'marker'       // 列表标记盒
  | 'run-container' // 内联行容器（不发射，仅布局辅助）

export interface Box {
  kind: BoxKind
  el: StyleElement
  tag: string
  line: number
  /** 内容盒矩形（画布 px） */
  x: number
  y: number
  w: number
  h: number
  /** 盒模型（px，已解析） */
  mt: number; mr: number; mb: number; ml: number
  pt: number; pr: number; pb: number; pl: number
  bt: number; br: number; bb: number; bl: number
  display: string
  /** 求解模式（发射器选择路径用） */
  solve: 'flow' | 'static' | 'text-block'
  /**
   * flex 容器且静态解可被运行时 UILayoutComponent 精确复现时非空
   * （等主轴尺寸/无 margin/无 padding/border/容器净/无换行/无绝对子项/space-* 需 gap=0）。
   * 发射器据此补挂 UILayoutComponent（保留 v1 动态子项重排能力）。
   */
  flexRuntime?: { isRow: boolean; gapX: number; gapY: number; justify: string; align: string }
  /** 混排内联容器：children 为已定位片段（相对内容盒原点），布局期平移即可 */
  inlineFlow?: boolean
  /** 片段在内容盒内的相对坐标（inlineFlow 平移的幂等基准） */
  fragRx?: number
  fragRy?: number
  /** 待排版的内联项（buildBox 收集，宽度解析后在 layoutSubtree 消费） */
  pendingInline?: Array<Box | { kind: 'text'; el: StyleElement; text: string; line: number }>
  children: Box[]
  /** text 盒内容 */
  text?: string
  /** 相对偏移（position:relative 保留占位的视觉偏移，px） */
  relX?: number
  relY?: number
  /** transform（视觉，不影响布局） */
  transform?: ReturnType<typeof parseTransform>
  /** 列表标记类型（li 盒） */
  listMarker?: string | null
  /** 附加说明（发射警告） */
  notes: string[]
}

interface LenCtx {
  rootFontSize: number
  fontSize: number
  viewport: [number, number]
}

/** 文本测宽估算（字体学近似；显式尺寸优先于估算） */
export function estimateTextWidth(text: string, fontSize: number, letterSpacing: number): number {
  let w = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === ' ' || ch === '\u00a0') w += 0.30
    else if (ch === '\n') continue
    else if (code >= 0x2e80) w += 1.0 // CJK 全角
    else if (/[0-9@MW]/.test(ch)) w += 0.62
    else if (/[mw]/.test(ch)) w += 0.82
    else if (/[ilj|!.,;:'"`(){}[\]]/.test(ch)) w += 0.28
    else if (/[A-Z]/.test(ch)) w += 0.68
    else w += 0.52
  }
  return w * fontSize + letterSpacing * Math.max(0, [...text].length - 1)
}

/** 文本行数估算（按宽度贪心换行；长词按字符断） */
export function estimateLineCount(
  text: string,
  fontSize: number,
  letterSpacing: number,
  maxWidth: number,
): number {
  const paras = text.split('\n')
  let lines = 0
  for (const para of paras) {
    if (!para) {
      lines++
      continue
    }
    const w = estimateTextWidth(para, fontSize, letterSpacing)
    if (w <= maxWidth) {
      lines++
    } else {
      // 近似行数：总宽/行宽向上取整（按字符断行语义，与引擎 break-word 一致）
      lines += Math.max(1, Math.ceil(w / Math.max(maxWidth, 1)))
    }
  }
  return lines
}

/** ─── 求解入口 ─── */

export function solveLayout(rootEl: StyleElement, ctx: SolveContext): Box {
  const solve = new Solver(ctx)
  const box = solve.buildBox(rootEl, 'block')
  if (!box) throw new LayoutError('根元素 display:none 不可编译', rootEl.node.line)
  solve.layoutRoot(box, rootEl.computed, rootEl)
  return box
}

class Solver {
  constructor(private ctx: SolveContext) {}

  /** 视口基准（vw/vh 单位 = 画布尺寸） */
  private get viewportSize(): [number, number] {
    return [this.ctx.canvasWidth, this.ctx.canvasHeight]
  }

  private lenCtx(fontSize: number, viewport: [number, number]): LenCtx {
    return { rootFontSize: this.ctx.rootFontSize, fontSize, viewport }
  }

  private warn(line: number, message: string): void {
    this.ctx.warnings.push({ line, message })
  }

  private fail(line: number, message: string): never {
    throw new LayoutError(message, line)
  }

  private num(el: StyleElement, prop: string): string | undefined {
    return el.computed.get(prop)
  }

  /** px 或可静态解算长度（% 用基准解算；auto 返回 null） */
  private resolveLen(
    el: StyleElement,
    prop: string,
    base: number,
    fontSize: number,
    viewport: [number, number],
  ): number | null {
    const v = this.num(el, prop)
    if (v === undefined || v === 'auto') return null
    return this.resolveLenValue(v, prop, base, fontSize, viewport, el)
  }

  private resolveLenValue(
    v: string,
    prop: string,
    base: number,
    fontSize: number,
    viewport: [number, number],
    el: StyleElement,
    line = 0,
  ): number {
    const lctx = this.lenCtx(fontSize, viewport)
    if (v.startsWith('calc(') && v.endsWith(')')) {
      const r = evalCalc(v.slice(5, -1), lctx, base)
      if (r === null) this.fail(line || el.node.line, `属性 "${prop}: ${v}" 的 calc() 无法求值`)
      return r
    }
    const l = parseLength(v, lctx)
    if (!l) this.fail(line || el.node.line, `属性 "${prop}: ${v}" 长度无法解析（支持 px/%/em/rem/vw/vh/pt/物理单位/calc()）`)
    if (l.unit === '%') return (l.value / 100) * base
    return l.value
  }

  private fontSizeOf(el: StyleElement, viewport: [number, number]): number {
    const fs = this.num(el, 'font-size')
    if (!fs) return 16
    const v = this.resolveLenValue(fs, 'font-size', viewport[0] * 0.5, 16, viewport, el)
    return Math.max(1, v)
  }

  private lineHeightOf(el: StyleElement, fontSize: number): number {
    const lh = this.num(el, 'line-height')
    if (!lh) return 1.4 * fontSize
    if (lh === 'normal') return 1.4 * fontSize
    const m = /^(-?[\d.]+)$/.exec(lh)
    if (m) return parseFloat(m[1]) * fontSize // 无单位倍数
    const l = parseLength(lh, this.lenCtx(fontSize, this.viewportSize))
    if (l && l.unit === 'px') return l.value
    return 1.4 * fontSize
  }

  /** 构建盒子树（display:none 剪枝；br/wbr 特殊处理；文本节点归并为 text 盒） */
  buildBox(el: StyleElement, fallbackDisplay: 'block' | 'inline'): Box | null {
    const viewport = this.viewportSize
    const displayRaw = this.num(el, 'display') ?? fallbackDisplay
    if (displayRaw === 'none') return null
    // br：行中断点标记（仅内联行构建期消费，永不产出 Actor）
    if (el.tag === 'br') {
      return {
        kind: 'element', el, tag: 'br', line: el.node.line,
        x: 0, y: 0, w: 0, h: 0,
        mt: 0, mr: 0, mb: 0, ml: 0, pt: 0, pr: 0, pb: 0, pl: 0, bt: 0, br: 0, bb: 0, bl: 0,
        display: 'inline', solve: 'flow', children: [], notes: [],
      }
    }
    // wbr：可选断点，忽略
    if (el.tag === 'wbr') return null

    const display = this.normalizeDisplay(displayRaw, el)
    const fontSize = this.fontSizeOf(el, viewport)

    const box: Box = {
      kind: 'element',
      el,
      tag: el.tag,
      line: el.node.line,
      x: 0, y: 0, w: 0, h: 0,
      mt: 0, mr: 0, mb: 0, ml: 0,
      pt: 0, pr: 0, pb: 0, pl: 0,
      bt: 0, br: 0, bb: 0, bl: 0,
      display,
      solve: 'flow',
      children: [],
      notes: [],
      listMarker: this.listMarkerOf(el),
    }

    // 盒模型解析。近似：% 边距/内边距按画布宽解算（浏览器按包含块宽；
    // 嵌套 % 盒模型属罕见用法，偏差记录在文档）
    const contentBase = this.ctx.canvasWidth

    for (const [key, attr] of [
      ['mt', 'margin-top'], ['mr', 'margin-right'], ['mb', 'margin-bottom'], ['ml', 'margin-left'],
      ['pt', 'padding-top'], ['pr', 'padding-right'], ['pb', 'padding-bottom'], ['pl', 'padding-left'],
      ['bt', 'border-top-width'], ['br', 'border-right-width'],
      ['bb', 'border-bottom-width'], ['bl', 'border-left-width'],
    ] as Array<[string, string]>) {
      const v = this.num(el, attr)
      if (v === undefined) continue
      if (attr.endsWith('-width')) {
        // border-width：thin/medium/thick + 长度；style none → 0
        const styleProp = attr.replace('-width', '-style')
        const styleVal = this.num(el, styleProp) ?? 'none'
        if (styleVal === 'none' || styleVal === 'hidden') {
          ;(box as unknown as Record<string, number>)[key] = 0
          continue
        }
        ;(box as unknown as Record<string, number>)[key] = this.resolveBorderWidth(v, styleVal, el)
        continue
      }
      if (v === 'auto') {
        // margin:auto（水平居中）布局期处理；先记 0
        ;(box as unknown as Record<string, number>)[key] = 0
        continue
      }
      ;(box as unknown as Record<string, number>)[key] = this.resolveLenValue(v, attr, contentBase, fontSize, viewport, el)
    }

    // 子节点收集
    const inlineItems: Array<Box | { kind: 'text'; el: StyleElement; text: string; line: number }> = []
    for (const child of el.children) {
      if (child.tag === '#text') {
        const collapsed = this.collapseText(child.text ?? '', el)
        if (collapsed) inlineItems.push({ kind: 'text', el, text: collapsed, line: child.node.line })
        continue
      }
      const cb = this.buildBox(child, fallbackDisplay)
      if (cb) inlineItems.push(cb)
    }

    // 全部为块级子项 → 直接成树；否则挂 pendingInline（等宽度解析后在内联排版）
    const allBlock = inlineItems.every((it) => it.kind !== 'text' && this.isBlockish(it as Box))
    if (allBlock) {
      box.children = inlineItems as Box[]
    } else {
      box.pendingInline = inlineItems
    }
    return box
  }

  /** 空白折叠（white-space 语义）：normal/nowrap → 连续空白折叠去 \n；pre-line 保 \n；pre 原样 */
  private collapseText(text: string, el: StyleElement): string {
    const ws = el.computed.get('white-space') ?? 'normal'
    if (ws === 'pre') return text
    if (ws === 'pre-line') return text.replace(/[^\S\n]+/g, ' ')
    return text.replace(/\s+/g, ' ')
  }

  /** display 归一化（别名/表格族 → 内部值；不支持的报错） */
  private normalizeDisplay(raw: string, el: StyleElement): string {
    switch (raw) {
      case 'block': case 'flow-root': case 'list-item': case 'inline-block':
      case 'flex': case 'inline-flex': case 'grid': case 'inline-grid': case 'inline':
      case 'table': case 'table-row': case 'table-cell': case 'table-caption':
      case 'table-row-group': case 'table-header-group': case 'table-footer-group':
      case 'table-column-group': case 'table-column': case 'contents':
        return raw
      case '-webkit-box': case '-ms-flexbox':
        return 'flex'
      case 'inline-list-item':
        return 'list-item'
      default:
        this.fail(el.node.line, `display: ${raw} 不受支持（支持 block/inline/inline-block/flex/inline-flex/grid/inline-grid/list-item/table 族/none）`)
    }
  }

  private listMarkerOf(el: StyleElement): string | null {
    if (el.tag !== 'li') return null
    const type = this.num(el, 'list-style-type') ?? 'disc'
    if (type === 'none') return null
    if (type === 'disc') return '•'
    if (type === 'circle') return '○'
    if (type === 'square') return '▪'
    if (type === 'decimal') return String(el.elementIndex + 1) + '.'
    this.warn(el.node.line, `list-style-type: ${type} 不受支持（支持 disc/circle/square/decimal/none），按 disc 处理`)
    return '•'
  }

  private resolveBorderWidth(v: string, style: string, el: StyleElement): number {
    void style
    const kw: Record<string, number> = { thin: 1, medium: 3, thick: 5 }
    if (kw[v] !== undefined) return kw[v]
    const l = parseLength(v, this.lenCtx(16, this.viewportSize))
    if (!l) this.fail(el.node.line, `border-width "${v}" 无法解析`)
    return l.unit === '%' ? (l.value / 100) * this.ctx.canvasWidth : l.value
  }

  /** ─── 子项整理：块级流分组 / 内联行收集 ─── */
  private organizeChildren(
    parent: Box,
    originalItems: Array<Box | { kind: 'text'; el: StyleElement; text: string; line: number }>,
    fontSize: number,
    viewport: [number, number],
  ): Box[] {
    let items = originalItems
    // 全部子项都是块级 → 直接返回
    const allBlock = items.every((it) => it.kind !== 'text' && this.isBlockish(it as Box))
    const hasText = items.some((it) => it.kind === 'text')
    const anyInline = hasText || items.some((it) => it.kind !== 'text' && !this.isBlockish(it as Box))

    if (allBlock && !hasText) {
      return items as Box[]
    }

    if (!anyInline) {
      return items as Box[]
    }

    // 块级容器中的纯空白文本项丢弃（浏览器块间空白不产生盒子）
    const hasBlockItem = items.some((it) => it.kind !== 'text' && this.isBlockish(it as Box))
    if (hasBlockItem) {
      items = items.filter((it) => it.kind !== 'text' || (it.text ?? '').trim() !== '')
    }
    // 存在内联内容：只含"纯文本子节点"的容器 → 单文本盒（保持运行时换行）
    const onlyPlainText = items.every((it) => it.kind === 'text')
    if (onlyPlainText && parent.display !== 'inline') {
      const textParts = (items as Array<{ kind: 'text'; text: string }>).map((t) => t.text)
      const tb: Box = {
        kind: 'text',
        el: parent.el,
        tag: '#text',
        line: parent.line,
        x: 0, y: 0, w: 0, h: 0,
        mt: 0, mr: 0, mb: 0, ml: 0, pt: 0, pr: 0, pb: 0, pl: 0, bt: 0, br: 0, bb: 0, bl: 0,
        display: 'inline',
        solve: 'text-block',
        children: [],
        text: textParts.join(''),
        notes: [],
      }
      return [tb]
    }

    // 混排：构建内联行（逐段测宽 → 换行 → 行框）
    return this.buildInlineRuns(parent, items, fontSize, viewport)
  }

  private isBlockish(box: Box): boolean {
    switch (box.display) {
      case 'block': case 'flex': case 'grid': case 'list-item': case 'table':
      case 'table-row': case 'table-caption': case 'table-row-group':
      case 'table-header-group': case 'table-footer-group': case 'flow-root':
        return true
      case 'inline-block': case 'inline-flex': case 'inline-grid': case 'inline':
      case 'table-cell': case 'contents':
        return false
      default:
        return true
    }
  }

  /** 内联内容 → 行片段盒（每行每段一个 box） */
  private buildInlineRuns(
    parent: Box,
    items: Array<Box | { kind: 'text'; el: StyleElement; text: string; line: number }>,
    _fontSize: number,
    _viewport: [number, number],
  ): Box[] {
    interface Frag {
      box: Box | null           // 元素盒（原子内联）
      textFrag: { el: StyleElement; text: string; line: number } | null
      w: number
      fontSize: number
      atomic: boolean
      h: number
      lineFrac: number // vertical-align 近似：0 top / 0.5 middle / 1 bottom
    }
    const runs: Frag[][] = [[]]
    const availW = (): number => Math.max(1, parent.w)

    for (const it of items) {
      if (it.kind === 'text') {
        const fontSize = this.fontSizeOf(it.el, this.viewportSize)
        const ls = this.resolveLen(it.el, 'letter-spacing', 0, fontSize, this.viewportSize) ?? 0
        // <br> 语义：编译期以 \n 分行
        const fullText = it.text ?? ''
        for (const seg of fullText.split('\n')) {
          if (runs[runs.length - 1].length > 0 && seg === '' && fullText.includes('\n')) {
            runs.push([])
            continue
          }
          const w = estimateTextWidth(seg, fontSize, ls)
          const avail = availW()
          if (w > avail && runs[runs.length - 1].length > 0) runs.push([])
          runs[runs.length - 1].push({
            box: null,
            textFrag: { el: it.el, text: seg, line: it.line },
            w: Math.min(w, avail),
            fontSize,
            atomic: false,
            h: this.lineHeightOf(it.el, fontSize),
            lineFrac: 0.5,
          })
        }
        continue
      }
      const elBox = it as Box
      if (elBox.display === 'inline' && elBox.children.length >= 0 && elBox.tag !== 'br' && this.inlineElIsStylable(elBox)) {
        // 纯样式内联元素：其文本子内容展开进当前行（样式跟随其 el）
        for (const t of this.collectInlineText(elBox)) {
          const fontSize = this.fontSizeOf(t.el, this.viewportSize)
          const ls = this.resolveLen(t.el, 'letter-spacing', 0, fontSize, this.viewportSize) ?? 0
          for (const seg of t.text.split('\n')) {
            const w = estimateTextWidth(seg, fontSize, ls)
            const avail = availW()
            if (w > avail && runs[runs.length - 1].length > 0) runs.push([])
            runs[runs.length - 1].push({
              box: null,
              textFrag: { el: t.el, text: seg, line: elBox.line },
              w: Math.min(w, avail),
              fontSize,
              atomic: false,
              h: this.lineHeightOf(t.el, fontSize),
              lineFrac: 0.5,
            })
          }
        }
        continue
      }
      // 原子内联（img/button/input/inline-block/br…）
      if (elBox.tag === 'br') {
        runs.push([])
        continue
      }
      // 原子项尺寸解析 + 子树布局（测高）
      this.resolveChildWidth(elBox, parent, availW())
      this.layoutSubtree(elBox)
      const w = elBox.w || 40
      const avail = availW()
      if (w > avail && runs[runs.length - 1].length > 0) runs.push([])
      runs[runs.length - 1].push({
        box: elBox,
        textFrag: null,
        w: Math.min(w, avail),
        fontSize: this.fontSizeOf(elBox.el, this.viewportSize),
        atomic: true,
        h: elBox.h || this.lineHeightOf(elBox.el, this.fontSizeOf(elBox.el, this.viewportSize)),
        lineFrac: 0.5,
      })
    }

    // 行框 → 片段盒
    const out: Box[] = []
    let lineY = parent.pt
    const contentW = availW()
    for (const run of runs) {
      if (run.length === 0) {
        lineY += this.lineHeightOf(parent.el, this.fontSizeOf(parent.el, this.viewportSize))
        continue
      }
      const lineH = Math.max(...run.map((f) => f.h))
      let cx = parent.pl
      for (const f of run) {
        const y = lineY + (lineH - f.h) * f.lineFrac
        if (f.atomic && f.box) {
          f.box.x = cx
          f.box.y = y
          f.box.fragRx = cx
          f.box.fragRy = y
          out.push(f.box)
        } else if (f.textFrag) {
          const tb = this.makeTextBox(f.textFrag.el, f.textFrag.text, cx, y, f.w, f.h, f.textFrag.line)
          tb.fragRx = cx
          tb.fragRy = y
          out.push(tb)
        }
        cx += f.w
      }
      lineY += lineH
    }
    void contentW
    parent.inlineFlow = true
    return out
  }

  /** 纯样式内联元素（span/b/i 等）：收集其后代文本（el 指向样式归属元素） */
  private collectInlineText(box: Box): Array<{ el: StyleElement; text: string }> {
    const out: Array<{ el: StyleElement; text: string }> = []
    const walk = (el: StyleElement): void => {
      for (const c of el.children) {
        if (c.tag === '#text') out.push({ el, text: c.text ?? '' })
        else walk(c as unknown as StyleElement)
      }
    }
    // el.children 是 StyleElement（buildBox 的输入树）
    walk(box.el)
    return out
  }

  private inlineElIsStylable(_box: Box): boolean {
    // 简化：所有 display:inline 元素的内容都展开为文本片段（样式随片段 el）
    return true
  }

  private makeTextBox(el: StyleElement, text: string, x: number, y: number, w: number, h: number, line: number): Box {
    return {
      kind: 'text',
      el,
      tag: '#text',
      line,
      x, y, w, h,
      mt: 0, mr: 0, mb: 0, ml: 0, pt: 0, pr: 0, pb: 0, pl: 0, bt: 0, br: 0, bb: 0, bl: 0,
      display: 'inline',
      solve: 'text-block',
      children: [],
      text,
      notes: [],
    }
  }

  /** ─── 根布局：尺寸解析 + 各布局模式 ─── */
  layoutRoot(box: Box, computed: Map<string, string>, el: StyleElement): void {
    this.consumePendingInline(box)
    const canvasW = this.ctx.canvasWidth
    const canvasH = this.ctx.canvasHeight
    // 根盒：边盒=画布；padding/border 内缩
    const pb = box.pb + box.bt
    const pl = box.pl + box.bl
    const pr = box.pr + box.br
    const pt = box.pt + box.bt
    box.x = pl
    box.y = pt
    box.w = Math.max(0, canvasW - pl - pr)
    box.h = Math.max(0, canvasH - pt - pb)
    void computed
    this.layoutBlockChildren(box, el)
    this.finishAutoHeight(box, el)
    // 根盒高度固定为画布（内容超出 = 溢出，不做视觉裁剪）
    box.h = Math.max(0, canvasH - pt - pb)
  }

  /** 块级流布局：在 parent 内容盒内堆排子项（含 flex/grid/table 子树递归） */
  private layoutBlockChildren(parent: Box, parentEl: StyleElement): void {
    const availW = parent.w
    let cursorY = 0
    const flowChildren = parent.children.filter((c) => {
      const pos = this.num(c.el, 'position') ?? 'static'
      return c.kind !== 'run-container' && pos !== 'absolute' && pos !== 'fixed'
    })
    const absChildren = parent.children.filter((c) => {
      const pos = this.num(c.el, 'position')
      return pos === 'absolute' || pos === 'fixed'
    })

    // 第一遍：宽度解析
    for (const child of flowChildren) {
      this.resolveChildWidth(child, parent, availW)
    }

    // 第二遍：垂直堆排。坐标约定：Box.x/y = 内容盒原点；
    // 子项内容原点 = 父内容原点 + 子 margin + 子自身 padding/border
    for (const child of flowChildren) {
      child.x = parent.x + child.ml + child.pl + child.bl
      child.y = parent.y + cursorY + child.mt + child.pt + child.bt
      // 自适应水平 margin:auto → 居中
      const mlAuto = (this.num(child.el, 'margin-left') ?? '') === 'auto'
      const mrAuto = (this.num(child.el, 'margin-right') ?? '') === 'auto'
      if (mlAuto || mrAuto) {
        const free = Math.max(0, availW - child.ml - child.mr - this.borderBoxWidth(child))
        if (mlAuto && mrAuto) child.x = parent.x + free / 2 + child.pl + child.bl
        else if (mlAuto) child.x = parent.x + free + child.pl + child.bl
      }
      // 布置子树（flex/grid/table/块级各自求解）
      this.layoutSubtree(child)
      // borderBoxHeight 已含 mt/mb（margin 盒），不可再叠加，否则父内容高被双计撑大
      cursorY += this.borderBoxHeight(child)
    }

    // 内容高度 = 流内容底部；仅 auto 高（h=0）容器被内容撑大，
    // 显式 height 是固定视口语义——内容溢出交 overflow 处理（hidden/auto → UIMask/ScrollContainer）
    if (parent.h === 0) parent.h = cursorY

    // 绝对定位子项（含 fixed：包含块=画布）
    for (const child of absChildren) {
      this.layoutAbsolute(child, parent, parentEl)
    }
  }

  private borderBoxWidth(b: Box): number {
    return b.ml + b.bl + b.pl + b.w + b.pr + b.br + b.mr
  }
  private borderBoxHeight(b: Box): number {
    return b.mt + b.bt + b.pt + b.h + b.pb + b.bb + b.mb
  }

  /** 子项宽度解析（显式/auto/min/max/box-sizing） */
  private resolveChildWidth(child: Box, parent: Box, availW: number): void {
    const fontSize = this.fontSizeOf(child.el, this.viewportSize)
    const explicit = this.resolveLen(child.el, 'width', availW, fontSize, this.viewportSize)
    const boxSizing = this.num(child.el, 'box-sizing') ?? 'content-box'
    const padBorder = child.pl + child.pr + child.bl + child.br

    let w: number
    if (explicit !== null) {
      w = explicit
      if (boxSizing === 'border-box') {
        w = Math.max(0, w - padBorder)
      }
    } else {
      switch (child.display) {
        case 'flex': case 'grid': case 'table':
          w = availW - child.ml - child.mr - padBorder
          break
        case 'inline-block': case 'inline-flex': case 'inline-grid':
          // shrink-to-fit：子内容测宽（下限 min-content 上限 available）
          w = this.shrinkToFitWidth(child, availW - child.ml - child.mr - padBorder)
          break
        default:
          w = availW - child.ml - child.mr - padBorder
      }
    }
    const minW = this.resolveLen(child.el, 'min-width', availW, fontSize, this.viewportSize)
    const maxW = this.resolveLen(child.el, 'max-width', availW, fontSize, this.viewportSize)
    if (minW !== null && w < minW) w = minW
    if (maxW !== null && w > maxW) w = maxW
    child.w = Math.max(0, w)

    // 高度：显式解析（% 相对父内容高——父 auto 高时按 auto 处理即 0）
    const heightRaw = this.num(child.el, 'height')
    let explicitH = heightRaw !== undefined && heightRaw !== 'auto' && heightRaw.includes('%') && parent.h <= 0
      ? null
      : this.resolveLen(child.el, 'height', parent.h > 0 ? parent.h : 0, fontSize, this.viewportSize)
    // border-box 同 width 语义：显式高度含纵向 padding/border（注意扣 Y 轴和，非 X 轴）
    if (explicitH !== null && boxSizing === 'border-box') {
      explicitH = Math.max(0, explicitH - (child.pt + child.pb + child.bt + child.bb))
    }
    child.h = explicitH ?? 0
    const aspect = this.num(child.el, 'aspect-ratio')
    if (explicitH === null && explicit !== null && aspect) {
      const [aw, ah] = aspect.split(/\s*\/\s*/).map((v) => parseFloat(v))
      if (Number.isFinite(aw) && Number.isFinite(ah) && ah !== 0) {
        child.h = (child.w * ah) / aw
      }
    }
  }

  /** shrink-to-fit 测宽（inline-block/原子内联）：max(子最大内容宽, min(首选宽, available)) */
  private shrinkToFitWidth(box: Box, available: number): number {
    const maxContent = this.maxContentWidth(box)
    return Math.min(available, Math.max(0, maxContent))
  }

  /** 最大内容宽度估算（块级子项取 max；文本取整段测宽） */
  private maxContentWidth(box: Box): number {
    let max = 0
    const fs = this.fontSizeOf(box.el, this.viewportSize)
    const ls = this.resolveLen(box.el, 'letter-spacing', 0, fs, this.viewportSize) ?? 0
    if (box.kind === 'text' && box.text) {
      return estimateTextWidth(box.text, fs, ls)
    }
    for (const t of this.directTexts(box.el)) {
      max = Math.max(max, estimateTextWidth(t, fs, ls))
    }
    for (const c of box.children) {
      const cw = this.borderBoxWidth(c) || this.maxContentWidth(c)
      max = Math.max(max, cw)
    }
    return max
  }

  private directTexts(el: StyleElement): string[] {
    const out: string[] = []
    for (const c of el.children) {
      if (c.tag === '#text') out.push(c.text ?? '')
    }
    return out
  }

  /** 内联排版延后消费：宽度解析后（box.w 就绪）再排版（幂等） */
  private consumePendingInline(box: Box): void {
    if (!box.pendingInline) return
    const items = box.pendingInline
    box.pendingInline = undefined
    const fontSize = this.fontSizeOf(box.el, this.viewportSize)
    box.children = this.organizeChildren(box, items, fontSize, this.viewportSize)
  }

  /** 子树布局分发（确定 solve 模式并递归） */
  private layoutSubtree(box: Box): void {
    this.consumePendingInline(box)
    const pos = this.num(box.el, 'position') ?? 'static'
    if (pos === 'relative') {
      const fs = this.fontSizeOf(box.el, this.viewportSize)
      const dx = this.resolveLen(box.el, 'left', box.w, fs, this.viewportSize)
        ?? (this.num(box.el, 'right') ? -this.resolveLen(box.el, 'right', box.w, fs, this.viewportSize)! : null)
      const dy = this.resolveLen(box.el, 'top', box.h, fs, this.viewportSize)
        ?? (this.num(box.el, 'bottom') ? -this.resolveLen(box.el, 'bottom', box.h, fs, this.viewportSize)! : null)
      box.relX = dx ?? 0
      box.relY = dy ?? 0
    }

    switch (box.display) {
      case 'flex': case 'inline-flex':
        this.layoutFlex(box)
        break
      case 'grid': case 'inline-grid':
        this.layoutGrid(box)
        break
      case 'table':
        this.layoutTable(box)
        break
      case 'table-row':
        this.layoutTableRow(box)
        break
      case 'contents':
        // display:contents 子项提升——简化：按块级排布
        this.layoutBlockChildren(box, box.el)
        this.finishAutoHeight(box, box.el)
        break
      default: {
        // 混排内联容器：片段相对坐标 → 画布坐标（幂等）+ 自适应高
        if (box.inlineFlow) {
          let bottom = 0
          for (const frag of box.children) {
            frag.x = box.x + (frag.fragRx ?? 0) + frag.pl + frag.bl
            frag.y = box.y + (frag.fragRy ?? 0) + frag.pt + frag.bt
            bottom = Math.max(bottom, frag.y + frag.h + frag.pb + frag.bb - box.y)
          }
          if (box.h === 0) box.h = bottom
          box.solve = 'static'
          break
        }
        // 单文本盒：文本占满内容盒（发射单 UIText，运行时 troika 换行）
        const tb = box.children.length === 1 && box.children[0].kind === 'text' ? box.children[0] : null
        if (tb) {
          tb.x = box.x
          tb.y = box.y
          tb.w = box.w
          if (box.h > 0) tb.h = box.h
          else {
            const fs = this.fontSizeOf(box.el, this.viewportSize)
            const ls = this.resolveLen(box.el, 'letter-spacing', 0, fs, this.viewportSize) ?? 0
            const lines = estimateLineCount(tb.text ?? '', fs, ls, Math.max(1, box.w))
            tb.h = lines * this.lineHeightOf(box.el, fs)
            box.h = tb.h
          }
          box.solve = 'text-block'
          break
        }
        if (box.children.length > 0) {
          this.layoutBlockChildren(box, box.el)
        } else if (box.h === 0) {
          // 空内容块级盒：按一行行高兜底（浏览器空 div 高 0，但这里保排版可见性）
          box.h = 0
        }
        this.finishAutoHeight(box, box.el)
        break
      }
    }

    // overflow 可滚动方向（发射器消费；双轴滚动按垂直，引擎滚动列表单方向）
    const ox = this.num(box.el, 'overflow-x')
    const oy = this.num(box.el, 'overflow-y')
    void ox
    void oy
  }

  /** auto 高度收尾：块级容器内容高度已由堆排写入；此处处理显式 height 与 min/max */
  private finishAutoHeight(box: Box, el: StyleElement): void {
    const fs = this.fontSizeOf(el, this.viewportSize)
    const minH = this.resolveLen(el, 'min-height', this.ctx.canvasHeight, fs, this.viewportSize)
    const maxH = this.resolveLen(el, 'max-height', this.ctx.canvasHeight, fs, this.viewportSize)
    if (minH !== null && box.h < minH) box.h = minH
    if (maxH !== null && box.h > maxH) box.h = maxH
  }

  /** ─── 绝对定位 ─── */
  private layoutAbsolute(child: Box, parent: Box, parentEl: StyleElement): void {
    void parentEl
    const fs = this.fontSizeOf(child.el, this.viewportSize)
    const isFixed = this.num(child.el, 'position') === 'fixed'
    // 包含块：fixed=画布；absolute=最近定位祖先（简化：直接父，编译期祖先定位链
    // 已在前置校验保证；直接父非定位时浏览器语义应上溯——此处上溯由父盒携带的
    // absContainer 标记缺失时退化为父盒，文档记录近似）
    // 包含块 = 父内容盒（与发射器/反编译器三方一致的简化语义；浏览器为最近定位
    // 祖先的 padding 边缘，嵌套定位场景的偏差记录在文档）
    const cb = isFixed
      ? { x: 0, y: 0, w: this.ctx.canvasWidth, h: this.ctx.canvasHeight }
      : { x: parent.x, y: parent.y, w: parent.w, h: parent.h }

    // 第一遍：解尺寸与内容（临时原点测量，auto 尺寸/内容高依赖子树）
    this.resolveChildWidth(child, parent, parent.w)
    this.layoutSubtree(child)

    const left = this.resolveLen(child.el, 'left', cb.w, fs, this.viewportSize)
    const right = this.resolveLen(child.el, 'right', cb.w, fs, this.viewportSize)
    const top = this.resolveLen(child.el, 'top', cb.h, fs, this.viewportSize)
    const bottom = this.resolveLen(child.el, 'bottom', cb.h, fs, this.viewportSize)

    const bw = child.bl + child.pl + child.w + child.pr + child.br
    const bh = child.bt + child.pt + child.h + child.pb + child.bb

    if (left !== null) child.x = cb.x + left + child.ml + child.pl + child.bl
    else if (right !== null) child.x = cb.x + cb.w - right - bw + child.ml + child.pl + child.bl
    else child.x = parent.x + child.ml + child.pl + child.bl // 近似静态位置
    if (top !== null) child.y = cb.y + top + child.mt + child.pt + child.bt
    else if (bottom !== null) child.y = cb.y + cb.h - bottom - bh + child.mt + child.pt + child.bt
    else child.y = parent.y + child.mt + child.pt + child.bt

    // auto 尺寸补全（shrink-to-fit 高度：子树内容底，相对子项内容原点）
    if (child.h === 0 && child.children.length > 0) {
      let bottomMost = 0
      for (const c of child.children) {
        bottomMost = Math.max(bottomMost, c.y + c.h + c.pb + c.bb - child.y)
      }
      child.h = Math.max(0, bottomMost)
    }
    // 第二遍终排：定位定死后再布局子树（子项坐标随容器落位平移）
    this.layoutSubtree(child)
  }

  /** ─── Flex 布局 ─── */
  private layoutFlex(box: Box): void {
    const el = box.el
    const fs = this.fontSizeOf(el, this.viewportSize)
    const viewport = this.viewportSize
    const dirRaw = this.num(el, 'flex-direction') ?? 'row'
    if (dirRaw === 'row-reverse' || dirRaw === 'column-reverse') {
      this.fail(box.line, `flex-direction: ${dirRaw} 不受支持（引擎布局与静态求解均不含 reverse）`)
    }
    const isRow = dirRaw === 'row'
    const wrapRaw = this.num(el, 'flex-wrap') ?? 'nowrap'
    const wrap = wrapRaw === 'wrap'
    if (wrapRaw !== 'nowrap' && wrapRaw !== 'wrap') {
      this.fail(box.line, `flex-wrap: ${wrapRaw} 不受支持（支持 nowrap/wrap）`)
    }
    const colGap = this.resolveLen(el, 'column-gap', 0, fs, viewport) ?? 0
    const rowGap = this.resolveLen(el, 'row-gap', 0, fs, viewport) ?? 0
    const justify = this.num(el, 'justify-content') ?? 'flex-start'
    const alignItems = this.num(el, 'align-items') ?? 'stretch'

    const items = box.children.filter((c) => {
      const pos = this.num(c.el, 'position') ?? 'static'
      return pos !== 'absolute' && pos !== 'fixed'
    })
    const absChildren = box.children.filter((c) => {
      const pos = this.num(c.el, 'position')
      return pos === 'absolute' || pos === 'fixed'
    })

    const mainAvail = (isRow ? box.w : box.h) - (isRow ? box.pl + box.pr : box.pt + box.pb)
    const crossAvail = (isRow ? box.h : box.w) - (isRow ? box.pt + box.pb : box.pl + box.pr)

    // flex-basis / 主轴基准尺寸
    interface FlexItem { box: Box; grow: number; shrink: number; basisMain: number; marginMain: number }
    const flexItems: FlexItem[] = []
    for (const item of items) {
      this.resolveChildWidth(item, box, isRow ? box.w : box.h)
      if (item.display === 'flex' || item.display === 'grid' || item.display === 'table' || item.display === 'table-row' || item.children.length > 0) {
        // 子树布局在尺寸定死后执行（下面统一）
      }
      const grow = parseFloat(this.num(item.el, 'flex-grow') ?? '0') || 0
      const shrink = parseFloat(this.num(item.el, 'flex-shrink') ?? '1')
      const basis = this.num(item.el, 'flex-basis') ?? 'auto'
      const basisLen = basis === 'auto' || basis === 'content'
        ? null
        : this.resolveLen(item.el, 'flex-basis', mainAvail, fs, viewport)
      const mainSize = isRow ? item.w : item.h
      const basisMain = basisLen ?? mainSize
      const marginMain = isRow ? item.ml + item.mr : item.mt + item.mb
      flexItems.push({ box: item, grow, shrink, basisMain, marginMain })
    }

    // 换行分行
    const lines: FlexItem[][] = []
    if (!wrap) {
      lines.push(flexItems)
    } else {
      let cur: FlexItem[] = []
      let curSum = 0
      for (const fi of flexItems) {
        const need = fi.basisMain + fi.marginMain + (cur.length > 0 ? (isRow ? colGap : rowGap) : 0)
        if (cur.length > 0 && curSum + need > mainAvail) {
          lines.push(cur)
          cur = []
          curSum = 0
        }
        curSum += fi.basisMain + fi.marginMain + (cur.length > 0 ? (isRow ? colGap : rowGap) : 0)
        cur.push(fi)
      }
      if (cur.length > 0) lines.push(cur)
    }

    // 逐行求解（游标相对内容原点）
    let lastLineFree = 0
    let crossCursor = 0
    const lineCrossSizes: number[] = []
    // 先原地测量各子项内容高（定位前的交叉尺寸基准；终排在定位后重跑）
    for (const fi of flexItems) this.layoutSubtree(fi.box)
    for (const line of lines) {
      const gapMain = isRow ? colGap : rowGap
      const sumBasis = line.reduce((s, fi) => s + fi.basisMain, 0)
      const sumMargin = line.reduce((s, fi) => s + fi.marginMain, 0)
      const free = mainAvail - sumBasis - sumMargin - gapMain * (line.length - 1)

      lastLineFree = free
      // grow / shrink 分配
      if (free > 0) {
        const totalGrow = line.reduce((s, fi) => s + fi.grow, 0)
        if (totalGrow > 0) {
          for (const fi of line) fi.basisMain += (free * fi.grow) / totalGrow
        }
      } else if (free < 0) {
        const totalShrink = line.reduce((s, fi) => s + fi.shrink, 0)
        if (totalShrink > 0) {
          for (const fi of line) {
            fi.basisMain += (free * fi.shrink) / totalShrink // shrink 加权
          }
        }
      }

      // 主轴尺寸写回（子树布局延后到定位后终排）
      for (const fi of line) {
        const b = fi.box
        if (isRow) b.w = Math.max(0, fi.basisMain)
        else b.h = Math.max(0, fi.basisMain)
      }

      // 交叉轴尺寸（align-items/align-self：stretch 交叉尺寸未显式者拉伸）
      let lineCross = 0
      for (const fi of line) {
        const b = fi.box
        const alignSelf = this.num(b.el, 'align-self') ?? alignItems
        const crossExplicit = isRow
          ? this.resolveLen(b.el, 'height', crossAvail, fs, viewport) !== null
          : this.resolveLen(b.el, 'width', crossAvail, fs, viewport) !== null
        if (alignSelf === 'stretch' && !crossExplicit) {
          if (isRow) b.h = Math.max(0, crossAvail - b.bt - b.pb - b.bb - b.mt - b.mb)
          else b.w = Math.max(0, crossAvail - b.bl - b.pl - b.br - b.ml - b.mr)
        }
        const crossSize = isRow ? b.h : b.w
        const marginCross = isRow ? b.mt + b.mb : b.ml + b.mr
        lineCross = Math.max(lineCross, crossSize + marginCross)
      }
      lineCrossSizes.push(lineCross)

      // 主轴 justify 分布
      const lineMainTotal = line.reduce((s, fi) => s + fi.basisMain + fi.marginMain, 0) + gapMain * (line.length - 1)
      let cursor = 0
      let spacing = gapMain
      switch (justify) {
        case 'center': cursor += (mainAvail - lineMainTotal) / 2; break
        case 'flex-end': case 'end': cursor += mainAvail - lineMainTotal; break
        case 'space-between': spacing = line.length > 1 ? gapMain + (mainAvail - lineMainTotal) / (line.length - 1) : gapMain; break
        case 'space-around': {
          const a = (mainAvail - lineMainTotal) / (2 * line.length)
          cursor += a
          spacing = gapMain + 2 * a
          break
        }
        case 'space-evenly': {
          const g = (mainAvail - lineMainTotal) / (line.length + 1)
          cursor += g
          spacing = gapMain + g
          break
        }
        default: break // flex-start
      }
      for (const fi of line) {
        const b = fi.box
        if (isRow) {
          b.x = box.x + cursor + b.ml + b.pl + b.bl
          cursor += b.w + b.bl + b.pl + b.pr + b.br + b.ml + b.mr + spacing
        } else {
          b.y = box.y + cursor + b.mt + b.pt + b.bt
          cursor += b.h + b.bt + b.pt + b.pb + b.bb + b.mt + b.mb + spacing
        }
      }

      // 交叉轴 align（行内逐项）。
      // 单行 flex 的行交叉尺寸 = 容器内容交叉尺寸（CSS 单行 align-content:stretch 默认），
      // 居中/末端对齐以容器为基准；多行、内容溢出容器、或行向容器高度 auto
      //（box.h 为内容自适应、此处尚不可靠）时退回 lineCross（行内最大子项，
      // 与容器 auto 补全/溢出场景的几何自洽）。
      const containerCrossOk = isRow
        ? this.resolveLen(el, 'height', crossAvail, fs, viewport) !== null
        : lineCross <= crossAvail
      const alignBase = lines.length === 1 && containerCrossOk ? crossAvail : lineCross
      for (const fi of line) {
        const b = fi.box
        const alignSelf = this.num(b.el, 'align-self') ?? alignItems
        const crossSize = isRow ? b.h : b.w
        const marginBefore = isRow ? b.mt : b.ml
        let crossOff = crossCursor + marginBefore
        if (alignSelf === 'center') crossOff += (alignBase - crossSize) / 2
        else if (alignSelf === 'flex-end' || alignSelf === 'end') crossOff += alignBase - crossSize
        if (isRow) b.y = box.y + crossOff + b.pt + b.bt
        else b.x = box.x + crossOff + b.pl + b.bl
      }

      // 终排：位置定死后再布局子树（行交叉尺寸已含内容高）
      for (const fi of line) this.layoutSubtree(fi.box)

      crossCursor += lineCross + (isRow ? rowGap : colGap)
    }

    // 容器 auto 高/宽：内容累计（crossCursor 已相对内容原点）
    const usedCross = crossCursor - (isRow ? rowGap : colGap)
    if (isRow) {
      if (this.resolveLen(el, 'height', crossAvail, fs, viewport) === null) {
        box.h = Math.max(box.h, usedCross)
      }
    } else {
      if (this.resolveLen(el, 'width', crossAvail, fs, viewport) === null) {
        box.w = Math.max(box.w, usedCross)
      }
    }

    // 运行时 UILayoutComponent 可复现判定（发射器据此补挂，保留 v1 动态子项重排）：
    // 引擎布局无 wrap/margin/盒模型概念、步长取首子项边盒主轴尺寸、容器=边盒；
    // space-* 引擎公式与 CSS 在 gap>0 时不一致（引擎把 gap 保留在分布外）→ gap=0 才可复现
    const boxPlain = (b: Box): boolean =>
      b.mt === 0 && b.mr === 0 && b.mb === 0 && b.ml === 0
      && b.pt === 0 && b.pr === 0 && b.pb === 0 && b.pl === 0
      && b.bt === 0 && b.br === 0 && b.bb === 0 && b.bl === 0
    const bbMain = (b: Box): number => isRow
      ? b.w + b.pl + b.pr + b.bl + b.br
      : b.h + b.pt + b.pb + b.bt + b.bb
    const spaceJustify = justify === 'space-between' || justify === 'space-around' || justify === 'space-evenly'
    const runtimeOk = !wrap && absChildren.length === 0 && items.length > 0
      && boxPlain(box) && items.every(boxPlain)
      && items.every((it) => Math.abs(bbMain(it) - bbMain(items[0])) < 0.01)
      && (!spaceJustify || (colGap === 0 && rowGap === 0))
    box.flexRuntime = runtimeOk
      ? { isRow, gapX: colGap, gapY: rowGap, justify, align: alignItems }
      : undefined
    box.solve = 'static'

    for (const child of absChildren) this.layoutAbsolute(child, box, el)
  }

  /** ─── Grid 布局（轨道 px/%/fr/auto、repeat()、gap、auto 流 + 显式线位） ─── */
  private layoutGrid(box: Box): void {
    const el = box.el
    const fs = this.fontSizeOf(el, this.viewportSize)
    const viewport = this.viewportSize
    const contentW = box.w - box.pl - box.pr
    const contentH = box.h - box.pt - box.pb

    const templateCols = this.parseTracks(this.num(el, 'grid-template-columns') ?? 'none', contentW, fs, viewport)
    const templateRows = this.parseTracks(this.num(el, 'grid-template-rows') ?? 'none', contentH, fs, viewport)
    const colGap = this.resolveLen(el, 'column-gap', 0, fs, viewport) ?? 0
    const rowGap = this.resolveLen(el, 'row-gap', 0, fs, viewport) ?? 0
    const autoFlow = this.num(el, 'grid-auto-flow') ?? 'row'
    if (autoFlow.includes('dense')) this.warn(box.line, 'grid-auto-flow: dense 不受支持，按普通流处理')

    const items = box.children.filter((c) => {
      const pos = this.num(c.el, 'position') ?? 'static'
      return pos !== 'absolute' && pos !== 'fixed'
    })

    // 先布置全部子项内容（尺寸解算需要）
    for (const item of items) this.resolveChildWidth(item, box, contentW)

    // 列数确定
    let colCount = templateCols.type === 'explicit' ? templateCols.sizes.length : 0
    // 显式线位扫描
    const placements = new Map<Box, { col: number; row: number; colSpan: number; rowSpan: number }>()
    let maxCol = 0
    for (const item of items) {
      const gc = this.parseLineSpec(this.num(item.el, 'grid-column'))
      const gr = this.parseLineSpec(this.num(item.el, 'grid-row'))
      const col = gc?.start
      const row = gr?.start
      const colSpan = gc?.span ?? 1
      const rowSpan = gr?.span ?? 1
      if (colSpan > 1 || rowSpan > 1) {
        // 跨行/列：仅支持显式线位 + 简单跨距
      }
      if (col !== undefined) maxCol = Math.max(maxCol, col + colSpan - 1)
      if (col === undefined) maxCol = Math.max(maxCol, colSpan)
      placements.set(item, {
        col: col ?? -1, row: row ?? -1,
        colSpan, rowSpan,
      })
    }
    if (colCount === 0) colCount = Math.max(1, maxCol)

    // auto 流填充
    let autoRow = 0
    let autoCol = 0
    const occupied = new Set<string>()
    const place = (item: Box, p: { col: number; row: number; colSpan: number; rowSpan: number }): void => {
      if (p.col >= 0 && p.row >= 0) {
        for (let r = p.row; r < p.row + p.rowSpan; r++) {
          for (let c = p.col; c < p.col + p.colSpan; c++) occupied.add(`${r}:${c}`)
        }
        return
      }
      if (p.col >= 0 && p.row < 0) {
        // 指定列，找行
        let r = 0
        for (;; r++) {
          let ok = true
          for (let c = p.col; c < p.col + p.colSpan; c++) if (occupied.has(`${r}:${c}`)) ok = false
          if (ok) {
            p.row = r
            break
          }
        }
        for (let rr = p.row; rr < p.row + p.rowSpan; rr++) for (let c = p.col; c < p.col + p.colSpan; c++) occupied.add(`${rr}:${c}`)
        return
      }
      // 全 auto
      for (;;) {
        if (autoCol + p.colSpan > colCount) {
          autoRow++
          autoCol = 0
        }
        let ok = true
        for (let r = autoRow; r < autoRow + p.rowSpan; r++) {
          for (let c = autoCol; c < autoCol + p.colSpan; c++) if (occupied.has(`${r}:${c}`)) ok = false
        }
        if (ok) break
        autoCol++
      }
      p.row = autoRow
      p.col = autoCol
      for (let rr = p.row; rr < p.row + p.rowSpan; rr++) {
        for (let c = p.col; c < p.col + p.colSpan; c++) occupied.add(`${rr}:${c}`)
      }
      autoCol += p.colSpan
    }

    let maxRow = 0
    for (const item of items) {
      const p = placements.get(item)!
      place(item, p)
      maxRow = Math.max(maxRow, p.row + p.rowSpan)
    }
    const rowCount = templateRows.type === 'explicit' ? Math.max(templateRows.sizes.length, maxRow) : maxRow

    // 轨道尺寸：显式轨道 + 补齐隐式轨道（auto → 内容最大）
    const colSizes = this.finalizeTracks(templateCols, colCount, (span) => {
      // auto 列宽 = 落在该列的项的最大内容宽
      let m = 0
      for (const item of items) {
        const p = placements.get(item)!
        if (p.col <= span && span < p.col + p.colSpan) {
          m = Math.max(m, this.maxContentWidth(item) + item.ml + item.mr + item.bl + item.br + item.pl + item.pr)
        }
      }
      return m
    }, contentW, colGap)
    const rowSizes = this.finalizeTracks(templateRows, rowCount, (span) => {
      let m = 0
      for (const item of items) {
        const p = placements.get(item)!
        if (p.row <= span && span < p.row + p.rowSpan) {
          // 行高：子项内容高（布置后再量——此处先按显式高度/内容估算）
          if (item.h > 0) m = Math.max(m, item.h + item.mt + item.mb + item.bt + item.pb + item.bb)
        }
      }
      return m
    }, contentH, rowGap)

    // fr 分配：剩余空间按 fr 权重
    this.distributeFr(colSizes, contentW, colGap)
    this.distributeFr(rowSizes, contentH, rowGap)

    // 定位
    const colOffsets: number[] = []
    let acc = box.x
    for (const s of colSizes.px) {
      colOffsets.push(acc)
      acc += s + colGap
    }
    const rowOffsets: number[] = []
    acc = box.y
    for (const s of rowSizes.px) {
      rowOffsets.push(acc)
      acc += s + rowGap
    }

    for (const item of items) {
      const p = placements.get(item)!
      const x0 = colOffsets[Math.min(p.col, colSizes.px.length - 1)] ?? box.x + box.pl
      const y0 = rowOffsets[Math.min(p.row, rowSizes.px.length - 1)] ?? box.y + box.pt
      let wSum = 0
      for (let c = p.col; c < Math.min(p.col + p.colSpan, colSizes.px.length); c++) wSum += colSizes.px[c]
      wSum += colGap * (p.colSpan - 1)
      let hSum = 0
      for (let r = p.row; r < Math.min(p.row + p.rowSpan, rowSizes.px.length); r++) hSum += rowSizes.px[r]
      hSum += rowGap * (p.rowSpan - 1)

      item.x = x0 + item.ml + item.pl + item.bl
      item.y = y0 + item.mt + item.pt + item.bt
      if (this.resolveLen(item.el, 'width', contentW, fs, viewport) === null) item.w = Math.max(0, wSum - item.ml - item.mr - item.bl - item.pl - item.pr - item.br)
      if (this.resolveLen(item.el, 'height', contentH, fs, viewport) === null) item.h = Math.max(0, hSum - item.mt - item.mb - item.bt - item.pt - item.pb - item.bb)
      this.layoutSubtree(item)
    }

    // 容器尺寸
    if (templateRows.type !== 'explicit' && this.resolveLen(el, 'height', contentH, fs, viewport) === null) {
      box.h = Math.max(box.h, rowOffsets[rowOffsets.length - 1] + rowSizes.px[rowSizes.px.length - 1] - box.y)
    }
    // 绝对定位子项（不参与网格流，按包含块布置）
    for (const child of box.children) {
      const pos = this.num(child.el, 'position')
      if (pos === 'absolute' || pos === 'fixed') this.layoutAbsolute(child, box, el)
    }
    box.solve = 'static'
  }

  /** 轨道模板解析：none | repeat(n, ...) | px/%/fr/auto 列表 */
  private parseTracks(
    raw: string,
    base: number,
    fontSize: number,
    viewport: [number, number],
  ): { type: 'none' | 'explicit'; sizes: Array<{ kind: 'px' | 'fr' | 'auto'; value: number }> } {
    if (raw === 'none' || !raw) return { type: 'none', sizes: [] }
    const sizes: Array<{ kind: 'px' | 'fr' | 'auto'; value: number }> = []
    const tokens = raw.match(/repeat\([^)]*\)|[^\s]+/g) ?? []
    for (const tok of tokens) {
      const repM = /^repeat\((\d+),\s*(.+)\)$/.exec(tok)
      if (repM) {
        const n = parseInt(repM[1], 10)
        for (let i = 0; i < n; i++) sizes.push(...this.parseTracks(repM[2], base, fontSize, viewport).sizes)
        continue
      }
      if (tok === 'auto') sizes.push({ kind: 'auto', value: 0 })
      else if (tok.endsWith('fr')) sizes.push({ kind: 'fr', value: parseFloat(tok) })
      else {
        const l = parseLength(tok, this.lenCtx(fontSize, viewport))
        if (!l) this.fail(0, `grid 轨道尺寸 "${tok}" 无法解析（支持 px/%/fr/auto 与 repeat()）`)
        sizes.push({ kind: 'px', value: l.unit === '%' ? (l.value / 100) * base : l.value })
      }
    }
    return { type: 'explicit', sizes }
  }

  private finalizeTracks(
    tpl: { type: 'none' | 'explicit'; sizes: Array<{ kind: 'px' | 'fr' | 'auto'; value: number }> },
    count: number,
    autoMeasure: (span: number) => number,
    _base: number,
    _gap: number,
  ): { px: number[]; frFlags: number[] } {
    const px: number[] = []
    const frFlags: number[] = []
    for (let i = 0; i < count; i++) {
      const t = tpl.sizes[i]
      if (!t) {
        px.push(autoMeasure(i))
        frFlags.push(0)
        continue
      }
      if (t.kind === 'fr') {
        px.push(0)
        frFlags.push(t.value)
      } else if (t.kind === 'auto') {
        px.push(autoMeasure(i))
        frFlags.push(0)
      } else {
        px.push(t.value)
        frFlags.push(0)
      }
    }
    return { px, frFlags }
  }

  private distributeFr(tracks: { px: number[]; frFlags: number[] }, total: number, gap: number): void {
    const usedFixed = tracks.px.reduce((s, v, i) => s + (tracks.frFlags[i] > 0 ? 0 : v), 0) + gap * Math.max(0, tracks.px.length - 1)
    const free = total - usedFixed
    const totalFr = tracks.frFlags.reduce((s, v) => s + v, 0)
    if (totalFr > 0 && free > 0) {
      for (let i = 0; i < tracks.px.length; i++) {
        if (tracks.frFlags[i] > 0) tracks.px[i] = (free * tracks.frFlags[i]) / totalFr
      }
    }
  }

  /** grid-column/row 线位解析："2" / "2 / 4" / "span 2" / "1 / span 2" */
  private parseLineSpec(raw: string | undefined): { start: number; span: number } | null {
    if (!raw || raw === 'auto') return null
    const parts = raw.split('/').map((p) => p.trim())
    const parseOne = (s: string): { line?: number; span?: number } => {
      const spanM = /^span\s+(\d+)$/.exec(s)
      if (spanM) return { span: parseInt(spanM[1], 10) }
      const n = parseInt(s, 10)
      return Number.isFinite(n) ? { line: n } : {}
    }
    const a = parseOne(parts[0])
    const b = parts[1] !== undefined ? parseOne(parts[1]) : {}
    let start = 0
    let span = 1
    if (a.line !== undefined) start = a.line - 1
    if (a.span !== undefined) span = a.span
    if (b.span !== undefined) span = b.span
    if (b.line !== undefined && a.line !== undefined) span = Math.max(1, b.line - a.line)
    return { start, span }
  }

  /** ─── 表格 ─── */
  private layoutTable(box: Box): void {
    // table → 行堆叠；列宽 = 各列单元格内容最大宽（两遍）
    const rows = box.children.filter((c) => c.display === 'table-row' || c.display === 'table-row-group' || c.display === 'table-header-group' || c.display === 'table-footer-group')
    // 展平 row-group
    const flatRows: Box[] = []
    for (const r of rows) {
      if (r.display === 'table-row') flatRows.push(r)
      else flatRows.push(...r.children.filter((c) => c.display === 'table-row'))
    }
    // 列宽
    const colCount = Math.max(0, ...flatRows.map((r) => r.children.length))
    const colWidths: number[] = new Array(colCount).fill(0)
    for (const r of flatRows) {
      for (let c = 0; c < r.children.length; c++) {
        const cell = r.children[c]
        const cw = this.borderBoxWidth(cell) || this.maxContentWidth(cell)
        colWidths[c] = Math.max(colWidths[c], cw)
      }
    }
    const contentW = box.w - box.pl - box.pr
    const totalCols = colWidths.reduce((s, v) => s + v, 0)
    if (totalCols > 0 && totalCols < contentW) {
      // 剩余宽度按列比例摊（近似浏览器 auto 布局的拉伸语义）
      const scale = contentW / totalCols
      for (let c = 0; c < colCount; c++) colWidths[c] *= scale
    }

    let y = box.y
    for (const r of flatRows) {
      r.x = box.x
      r.y = y
      r.w = contentW
      let x = r.x
      let rowH = 0
      for (let c = 0; c < r.children.length; c++) {
        const cell = r.children[c]
        cell.x = x + cell.ml + cell.pl + cell.bl
        cell.y = y + cell.mt + cell.pt + cell.bt
        cell.w = Math.max(0, colWidths[c] - cell.bl - cell.pl - cell.pr - cell.br - cell.ml - cell.mr)
        this.layoutSubtree(cell)
        if (cell.h === 0) {
          // 内容高
          let bottom = 0
          for (const cc of cell.children) bottom = Math.max(bottom, cc.y + cc.h + cc.pb + cc.bb - cell.y)
          cell.h = Math.max(0, bottom - cell.pt)
        }
        rowH = Math.max(rowH, cell.h + cell.bt + cell.pt + cell.pb + cell.bb + cell.mt + cell.mb)
        x += colWidths[c]
      }
      r.h = rowH
      // 单元格交叉轴拉伸至行高（浏览器表格语义）
      for (const cell of r.children) {
        if (cell.h + cell.bt + cell.pt + cell.pb + cell.bb < rowH) {
          cell.h = rowH - cell.bt - cell.pt - cell.pb - cell.bb
          this.layoutSubtree(cell)
        }
      }
      y += rowH
    }
    if (this.resolveLen(box.el, 'height', box.h, this.fontSizeOf(box.el, this.viewportSize), this.viewportSize) === null) {
      box.h = Math.max(box.h, y - box.y)
    }
    for (const child of box.children) {
      const pos = this.num(child.el, 'position')
      if (pos === 'absolute' || pos === 'fixed') this.layoutAbsolute(child, box, box.el)
    }
    box.solve = 'static'
  }

  private layoutTableRow(_box: Box): void {
    // 由 layoutTable 统一布置；独立出现时退化为块级
  }
}
