/**
 * css/cascade — 选择器匹配、级联、继承与计算样式
 *
 *  - 选择器匹配：tag/.class/#id/复合、后代/子代组合器、:first-child/:last-child/
 *    :nth-child(an+b)/:not()/::before/::after；:hover/:active/:disabled 记入
 *    交互态声明（仅 button 生效，编译层消费）
 *  - 级联：来源层（UA < 作者）× !important × 特异性 × 声明顺序；inline style 最高
 *  - 自定义属性：--x 作用域继承 + var() 替换
 *  - 继承：可继承属性（color、font 系列、text-align、line-height、letter-spacing、
 *    visibility、white-space 等）从父计算值下传；其余取初始值
 */
import type { HtmlNode } from '../miniParser'
import type { CssRule, CssSelector, SelectorCompound } from './tokenize'
import { expandAll, substituteVars } from './values'

/** 参与级联的一个元素节点 */
export interface StyleElement {
  node: HtmlNode
  tag: string
  id?: string
  classes: string[]
  parent: StyleElement | null
  /** 子节点：元素为 StyleElement；文本节点为 tag='#text' 的携带项（text 存内容） */
  children: StyleElement[]
  /** 文本内容（仅 tag='#text' 的携带项） */
  text?: string
  /** 兄弟序（含文本节点计数前的元素序） */
  elementIndex: number
  /** 同级元素总数 */
  siblingElementCount: number
  /** inline style 声明（已展开为长手属性） */
  inlineDecls: Map<string, { value: string; important: boolean }>
  /** 计算样式（级联+继承后） */
  computed: Map<string, string>
  /** 交互态声明（:hover/:active/:disabled 命中的 prop→value，仅 button 消费） */
  stateDecls: {
    hover: Map<string, string>
    active: Map<string, string>
    disabled: Map<string, string>
  }
}

/** 可继承属性（CSS 继承语义子集） */
const INHERITED_PROPS = new Set([
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'white-space', 'word-spacing', 'visibility', 'cursor', 'list-style-type',
])

/** 特异性 [ids, classes+pseudos, tags] 比较 */
function specificity(compounds: SelectorCompound[]): [number, number, number] {
  let ids = 0
  let classes = 0
  let tags = 0
  for (const c of compounds) {
    if (c.id) ids++
    classes += c.classes.length + c.pseudos.length
    if (c.tag && c.tag !== '*') tags++
  }
  return [ids, classes, tags]
}

function cmpSpec(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** :nth-child(an+b) 参数解析 → 谓词 */
function nthChildPredicate(args: string): ((i: number) => boolean) | null {
  const s = args.trim().toLowerCase().replace(/\s+/g, '')
  if (s === 'odd') return (i) => i % 2 === 1 // 1-based 奇数
  if (s === 'even') return (i) => i % 2 === 0
  const plain = /^(\d+)$/.exec(s)
  if (plain) return (i) => i === parseInt(plain[1], 10)
  const anb = /^([+-]?\d*)n([+-]\d+)?$/.exec(s)
  if (!anb) return null
  const aStr = anb[1]
  const a = aStr === '' || aStr === '+' ? 1 : aStr === '-' ? -1 : parseInt(aStr, 10)
  const b = anb[2] ? parseInt(anb[2], 10) : 0
  return (i) => {
    const diff = i - b
    if (a === 0) return diff === 0
    return diff % a === 0 && diff / a >= 0
  }
}

interface MatchContext {
  hover: Map<string, string>
  active: Map<string, string>
  disabled: Map<string, string>
}

/** 匹配单个复合段 */
function matchCompound(c: SelectorCompound, el: StyleElement, mc: MatchContext): boolean {
  if (c.tag && c.tag !== '*' && c.tag !== el.tag) return false
  if (c.id && c.id !== el.id) return false
  for (const cls of c.classes) {
    if (!el.classes.includes(cls)) return false
  }
  for (const p of c.pseudos) {
    switch (p.name) {
      case 'hover':
      case 'active':
      case 'disabled':
      case 'focus':
      case 'focus-visible':
      case 'checked':
      case 'visited':
      case 'link':
        // 交互态伪类不参与"是否命中"判定（元素始终命中，声明进状态表由编译层消费）
        break
      case 'first-child':
        if (el.elementIndex !== 0) return false
        break
      case 'last-child':
        if (el.elementIndex !== el.siblingElementCount - 1) return false
        break
      case 'nth-child': {
        const pred = p.args ? nthChildPredicate(p.args) : null
        if (!pred) return false
        if (!pred(el.elementIndex + 1)) return false
        break
      }
      case 'not': {
        // :not(简单复合) —— 解析参数为单复合段
        const inner = p.args ?? ''
        const sub = parseSimpleCompound(inner)
        if (!sub) return false
        if (matchCompound(sub, el, { hover: new Map(), active: new Map(), disabled: new Map() })) return false
        break
      }
      case 'root':
        if (el.parent !== null) return false
        break
      case 'empty':
        if (el.children.some((ch) => ch.tag !== '#text' || (ch.text ?? '') !== '')) return false
        break
      default:
        return false // 未知伪类 = 不匹配
    }
  }
  return true
}

/** :not() 参数 → 单复合段（复用 tokenize 的结构手工构造） */
function parseSimpleCompound(text: string): SelectorCompound | null {
  const t = text.trim()
  if (!t || /[\s>~+]/.test(t)) return null
  const c: SelectorCompound = { classes: [], pseudos: [] }
  let i = 0
  let saw = false
  while (i < t.length) {
    const ch = t[i]
    if (ch === '*') { c.tag = '*'; saw = true; i++ }
    else if (ch === '.') {
      const m = /^[A-Za-z_-][\w-]*/.exec(t.slice(i + 1))
      if (!m) return null
      c.classes.push(m[0]); saw = true; i += 1 + m[0].length
    } else if (ch === '#') {
      const m = /^[A-Za-z_-][\w-]*/.exec(t.slice(i + 1))
      if (!m) return null
      c.id = m[0]; saw = true; i += 1 + m[0].length
    } else if (/[A-Za-z]/.test(ch)) {
      const m = /^[A-Za-z][\w-]*/.exec(t.slice(i))
      if (!m || saw) return null
      c.tag = m[0].toLowerCase(); saw = true; i += m[0].length
    } else {
      return null
    }
  }
  return saw ? c : null
}

/** 匹配完整选择器（右端为主体） */
function matchSelector(sel: CssSelector, el: StyleElement, mc: MatchContext): boolean {
  const { compounds, combinators } = sel
  if (!matchCompound(compounds[compounds.length - 1], el, mc)) return false
  let cur = el
  for (let i = combinators.length - 1; i >= 0; i--) {
    const comb = combinators[i]
    const target = compounds[i]
    if (comb === 'child') {
      if (!cur.parent) return false
      cur = cur.parent
      if (!matchCompound(target, cur, mc)) return false
    } else {
      // descendant：向上逐级找任一命中祖先
      let anc = cur.parent
      let found = false
      while (anc) {
        if (matchCompound(target, anc, mc)) {
          cur = anc
          found = true
          break
        }
        anc = anc.parent
      }
      if (!found) return false
    }
  }
  return true
}

/** 从 HtmlNode 抽取类/ID（class 属性全量保留） */
export function classesOf(node: HtmlNode): string[] {
  const cls = node.attrs['class']
  return cls ? cls.split(/\s+/).filter(Boolean) : []
}

/** 根据规则表为整棵元素树计算样式（级联 + 自定义属性 + 继承） */
export function computeStyles(
  root: StyleElement,
  rules: CssRule[],
): { line?: number } {
  applyToSubtree(root, rules)
  return {}

  function applyToSubtree(el: StyleElement, allRules: CssRule[]): void {
    // 每元素作用域的自定义属性表（继承父级 + 本元素及后代声明）
    const customScope = new Map<string, string>()
    // 继承父作用域（计算时已写入 el.computed 的 --x）
    if (el.parent) {
      for (const [k, v] of el.parent.computed) {
        if (k.startsWith('--')) customScope.set(k, v)
      }
    }

    // 收集命中声明：[specificity, order, important, origin, value]
    interface Hit { spec: [number, number, number]; order: number; important: boolean; origin: number; value: string; line: number }
    const propHits = new Map<string, Hit>()
    const customHits = new Map<string, Hit>()
    const stateSets: Array<{ kind: 'hover' | 'active' | 'disabled'; decls: Array<[string, string]> }> = []

    const consider = (
      prop: string,
      value: string,
      important: boolean,
      origin: number,
      spec: [number, number, number],
      order: number,
      line: number,
    ) => {
      if (prop.startsWith('--')) {
        const prev = customHits.get(prop)
        if (!prev || better(prev, { important, origin, spec, order })) {
          customHits.set(prop, { spec, order, important, origin, value, line })
        }
        return
      }
      const prev = propHits.get(prop)
      if (!prev || better(prev, { important, origin, spec, order })) {
        propHits.set(prop, { spec, order, important, origin, value, line })
      }
    }
    const better = (
      prev: { important: boolean; origin: number; spec: [number, number, number]; order: number },
      next: { important: boolean; origin: number; spec: [number, number, number]; order: number },
    ): boolean => {
      if (next.important !== prev.important) return next.important
      if (next.origin !== prev.origin) return next.origin > prev.origin
      const c = cmpSpec(next.spec, prev.spec)
      if (c !== 0) return c > 0
      return next.order > prev.order
    }

    const mc: MatchContext = {
      hover: new Map(), active: new Map(), disabled: new Map(),
    }

    for (const rule of allRules) {
      if (!matchSelector(rule.selector, el, mc)) continue
      const spec = specificity(rule.selector.compounds)
      // 交互态伪类（:hover/:active/:disabled）始终命中但只属于交互态：
      // 声明只进状态表，绝不进基础级联（否则 :active 色会以其更高特异性盖掉底色）
      const hasStatePseudo = (c: { pseudos: Array<{ name: string }> }) =>
        c.pseudos.some((p) => p.name === 'hover' || p.name === 'active' || p.name === 'disabled')
      const lastIsState = hasStatePseudo(rule.selector.compounds[rule.selector.compounds.length - 1])
      const anyIsState = rule.selector.compounds.some(hasStatePseudo)
      if (!anyIsState) {
        // var() 替换 + 简写展开后逐条计入
        for (const [prop, { value, important }] of rule.decls) {
          const resolved = substituteVars(value, customScope)
          for (const ex of expandAll(prop, resolved)) {
            consider(ex.prop, ex.value, important, rule.origin, spec, rule.order, rule.line)
          }
        }
        for (const [prop, value] of rule.customProps) {
          consider(prop, value, false, rule.origin, spec, rule.order, rule.line)
        }
      } else if (!lastIsState) {
        // 嵌套状态选择器（如 .a:hover .b）语义不支持，声明整体忽略
        continue
      }
      // 交互态伪类命中：收集状态声明
      const last = rule.selector.compounds[rule.selector.compounds.length - 1]
      for (const p of last.pseudos) {
        if (p.name === 'hover' || p.name === 'active' || p.name === 'disabled') {
          const bucket: Array<[string, string]> = []
          for (const [prop, { value }] of rule.decls) {
            for (const ex of expandAll(prop, substituteVars(value, customScope))) {
              bucket.push([ex.prop, ex.value])
            }
          }
          stateSets.push({ kind: p.name as 'hover' | 'active' | 'disabled', decls: bucket })
        }
      }
    }

    // inline style：最高优先级（相当于无限特异性作者层；!important 再抬层）
    for (const [prop, { value, important }] of el.inlineDecls) {
      consider(prop, value, important, 1, [99, 99, 99], Number.MAX_SAFE_INTEGER, 0)
    }

    // 生成计算样式：先自定义属性，再普通属性
    for (const [k, hit] of customHits) el.computed.set(k, hit.value)
    for (const [prop, hit] of propHits) el.computed.set(prop, hit.value)

    // 继承：无命中且可继承 → 父计算值；不可继承无命中 → 不写（布局/发射层按初始值）
    if (el.parent) {
      for (const prop of INHERITED_PROPS) {
        if (!el.computed.has(prop)) {
          const pv = el.parent.computed.get(prop)
          if (pv !== undefined) el.computed.set(prop, pv)
        }
      }
    }

    // 交互态声明（var 替换已完成）
    for (const { kind, decls } of stateSets) {
      for (const [prop, value] of decls) {
        el.stateDecls[kind].set(prop, value)
      }
    }

    // 递归子元素（文本携带项共享父计算样式，跳过）
    for (const child of el.children) {
      if (child.tag === '#text') continue
      applyToSubtree(child, allRules)
    }
  }
}

/** 由 HtmlNode 树构建 StyleElement 树（含 inline style 预解析） */
export function buildStyleTree(
  node: HtmlNode,
  parent: StyleElement | null,
  parseInline: (styleText: string) => Map<string, { value: string; important: boolean }>,
): StyleElement {
  const el: StyleElement = {
    node,
    tag: node.tag,
    id: node.attrs['id'],
    classes: classesOf(node),
    parent,
    children: [],
    elementIndex: 0,
    siblingElementCount: 0,
    inlineDecls: node.attrs['style'] ? parseInline(node.attrs['style']) : new Map(),
    computed: new Map(),
    stateDecls: { hover: new Map(), active: new Map(), disabled: new Map() },
  }
  if (parent) parent.children.push(el)
  const elementChildren = node.children.filter((c) => c.tag !== '#text')
  el.siblingElementCount = elementChildren.length
  // 文本节点以 tag='#text' 携带项进入 children（布局层消费；不参与元素序）
  for (const c of node.children) {
    if (c.tag === '#text') {
      el.children.push({
        node: c,
        tag: '#text',
        classes: [],
        parent: el,
        children: [],
        text: c.text,
        elementIndex: 0,
        siblingElementCount: 0,
        inlineDecls: new Map(),
        computed: el.computed, // 文本共享父元素计算样式（继承语义）
        stateDecls: el.stateDecls,
      })
      continue
    }
    const childEl = buildStyleTree(c, el, parseInline)
    childEl.elementIndex = countElements(el.children) - 1
  }
  return el
}

/** 已入 children 的元素子节点数（不含文本携带项） */
function countElements(children: StyleElement[]): number {
  return children.filter((c) => c.tag !== '#text').length
}
