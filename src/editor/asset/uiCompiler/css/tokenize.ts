/**
 * css/tokenize — CSS 词法/规则切分（完整语法面）
 *
 * 支持：选择器（复合链：tag/.class/#id/伪类 + 后代/子代组合器）、声明（含
 * 自定义属性 --x）、@media（条件静态评估用）、@import（回调内联）、
 * 嵌套花括号、注释。@keyframes/@font-face 等其它 @规则切分后交编译层报错。
 *
 * 解析层不判语义白名单——那是 cascade/编译层的职责。
 */

export class CssParseError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

/** 计算位置 → 行号 */
function lineOf(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++
  }
  return line
}

/** 单个复合选择器（compound）中的一段：tag#id.cls:pseudo */
export interface SelectorCompound {
  /** 标签通配/具体名（'*' = 任意；undefined = 无标签段） */
  tag?: string
  id?: string
  classes: string[]
  /** 伪类（:hover / :nth-child(2n+1) / :not(.x)），伪元素记 name 前缀 '::' */
  pseudos: Array<{ name: string; args?: string }>
}

/** 组合器 */
export type Combinator = 'descendant' | 'child'

/** 完整选择器：compounds[0] 为最左祖先，末位为目标主体 */
export interface CssSelector {
  compounds: SelectorCompound[]
  combinators: Combinator[]
}

/** 样式表解析产物 */
export interface Stylesheet {
  rules: CssRule[]
  imports: CssImport[]
  /** @media 规则（编译层按画布尺寸静态评估后并入） */
  medias: Array<{ condition: string; rules: CssRule[]; line: number }>
  /** 切到但明确不支持的 @规则（@keyframes 等，编译层报错用） */
  unsupportedAtRules: Array<{ name: string; line: number }>
}
/** 级联规则 */
export interface CssRule {
  selector: CssSelector
  /** 选择器源文本（报错用） */
  selectorText: string
  /** 普通声明（prop 小写 → 原始值；含 !important 标记分离） */
  decls: Map<string, { value: string; important: boolean }>
  /** 自定义属性声明（--x → 值） */
  customProps: Map<string, string>
  /** 规则在样式表中的序号（级联平局裁决） */
  order: number
  /** 来源层：0=UA 默认 / 1=作者样式表 */
  origin: 0 | 1
  line: number
}

/** @import 项（编译层回调解析内联后递归 tokenize） */
export interface CssImport {
  href: string
  line: number
}

/** ─── 选择器解析 ─── */

/**
 * 切分选择器组并解析为结构化形式。
 * 支持：tag / * / .cls / #id / :pseudo(args) / ::pseudo-element，组合器 空格 与 ">"。
 * 不支持（报错）：属性选择器 [..]、通用兄弟 ~、相邻 +、命名空间 |。
 */
export function parseSelector(text: string, line: number): CssSelector {
  const src = text.trim()
  if (!src) throw new CssParseError('空选择器', line)
  const compounds: SelectorCompound[] = []
  const combinators: Combinator[] = []
  let i = 0

  const readCompound = (): SelectorCompound => {
    const c: SelectorCompound = { classes: [], pseudos: [] }
    let sawAtom = false
    while (i < src.length) {
      const ch = src[i]
      if (ch === '*') {
        c.tag = '*'
        sawAtom = true
        i++
      } else if (ch === '.' || ch === '#') {
        const nm = /^[A-Za-z_-][\w-]*/.exec(src.slice(i + 1))
        if (!nm) throw new CssParseError(`选择器 "${src}" 中 ${ch} 后缺少名称`, line)
        if (ch === '.') c.classes.push(nm[0])
        else c.id = nm[0]
        sawAtom = true
        i += 1 + nm[0].length
      } else if (ch === ':') {
        const dbl = src[i + 1] === ':'
        i += dbl ? 2 : 1
        const pm = /^([A-Za-z-]+)/.exec(src.slice(i))
        if (!pm) throw new CssParseError(`选择器 "${src}" 中伪类缺少名称`, line)
        let name = pm[1].toLowerCase()
        i += pm[1].length
        let args: string | undefined
        if (src[i] === '(') {
          let depth = 1
          let j = i + 1
          while (j < src.length && depth > 0) {
            if (src[j] === '(') depth++
            else if (src[j] === ')') depth--
            j++
          }
          if (depth !== 0) throw new CssParseError(`选择器 "${src}" 伪类括号未闭合`, line)
          args = src.slice(i + 1, j - 1).trim()
          i = j
        }
        if (dbl) name = `::${name}`
        c.pseudos.push({ name, args })
        sawAtom = true
      } else if (/[A-Za-z]/.test(ch)) {
        const tm = /^[A-Za-z][\w-]*/.exec(src.slice(i))!
        if (sawAtom) throw new CssParseError(`选择器 "${src}" 复合段中标签段位置非法`, line)
        c.tag = tm[0].toLowerCase()
        sawAtom = true
        i += tm[0].length
      } else {
        break
      }
    }
    if (!sawAtom) throw new CssParseError(`选择器 "${src}" 存在空复合段`, line)
    return c
  }

  compounds.push(readCompound())
  while (i < src.length) {
    // 组合器：空白（后代）或 '>'（子代；空白可夹两侧）
    let ws = false
    while (i < src.length && /\s/.test(src[i])) {
      ws = true
      i++
    }
    if (i >= src.length) break
    if (src[i] === '>') {
      combinators.push('child')
      i++
      continue
    }
    if (src[i] === '~' || src[i] === '+') {
      throw new CssParseError(`选择器 "${src}"：兄弟组合器 ~/+ 不受支持（用后代/子代组合器表达）`, line)
    }
    if (src[i] === '[') {
      throw new CssParseError(`选择器 "${src}"：属性选择器 [...] 不受支持（用 class 表达）`, line)
    }
    if (src[i] === '|') {
      throw new CssParseError(`选择器 "${src}"：命名空间 | 不受支持`, line)
    }
    if (!ws) throw new CssParseError(`选择器 "${src}" 语法错误（位置 ${i} "${src[i]}"）`, line)
    combinators.push('descendant')
    compounds.push(readCompound())
  }
  return { compounds, combinators }
}

/** ─── 声明块解析 ─── */

interface RawDecl {
  prop: string
  value: string
  important: boolean
  custom: boolean
}

function parseDecls(body: string, line: number): RawDecl[] {
  const out: RawDecl[] = []
  // 按 ';' 切分，但括号内（url(data:;base64) 等）与引号内的分号不切
  const parts: string[] = []
  let buf = ''
  let paren = 0
  let quote: string | null = null
  for (const ch of body) {
    if (quote) {
      buf += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '(') paren++
    if (ch === ')') paren--
    if (ch === ';' && paren <= 0) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf)

  for (const rawPart of parts) {
    const d = rawPart.trim()
    if (!d) continue
    const colon = d.indexOf(':')
    if (colon === -1) throw new CssParseError(`CSS 声明缺少冒号: "${d.slice(0, 40)}"`, line)
    let prop = d.slice(0, colon).trim().toLowerCase()
    let value = d.slice(colon + 1).trim()
    let important = false
    const impM = /!\s*important\s*$/i.exec(value)
    if (impM) {
      important = true
      value = value.slice(0, impM.index).trim()
    }
    const custom = prop.startsWith('--')
    if (!custom && !/^[a-z-][a-z0-9-]*$/.test(prop)) {
      throw new CssParseError(`CSS 属性名非法: "${prop}"`, line)
    }
    out.push({ prop, value, important, custom })
  }
  return out
}

/** ─── 样式表解析 ─── */

export interface TokenizeOptions {
  /** 样式来源层（0=UA / 1=作者），默认 1 */
  origin?: 0 | 1
}

/**
 * 解析 CSS 文本为规则表。
 * @media 条件在编译期静态评估（见 evaluateMediaCondition 的调用方），
 * 条件以 `@media ... {` 前缀原文暂存于 unsupportedAtRules 之外单独返回。
 */
export function tokenizeStylesheet(css: string, opts: TokenizeOptions = {}): {
  rules: CssRule[]
  imports: CssImport[]
  medias: Array<{ condition: string; rules: CssRule[]; line: number }>
  unsupportedAtRules: Array<{ name: string; line: number }>
} {
  const origin = opts.origin ?? 1
  // 去注释（保留换行数，行号不漂移）
  const noComment = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

  const rules: CssRule[] = []
  const imports: CssImport[] = []
  const medias: Array<{ condition: string; rules: CssRule[]; line: number }> = []
  const unsupportedAtRules: Array<{ name: string; line: number }> = []
  let order = 0

  let i = 0
  while (i < noComment.length) {
    while (i < noComment.length && /\s/.test(noComment[i])) i++
    if (i >= noComment.length) break

    if (noComment[i] === '@') {
      const m = /^@([a-zA-Z-]+)/.exec(noComment.slice(i))
      const name = m?.[1]?.toLowerCase() ?? '?'
      const line = lineOf(noComment, i)
      if (name === 'import') {
        // @import "x.css"; / @import url(x.css);
        const semi = findTopLevelSemicolon(noComment, i)
        if (semi === -1) throw new CssParseError('@import 缺少结尾分号', line)
        const body = noComment.slice(i + name.length + 1, semi).trim()
        const hm = /^(?:"([^"]*)"|'([^']*)'|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+?))\s*\))/.exec(body)
        const href = hm?.[1] ?? hm?.[2] ?? hm?.[3] ?? hm?.[4] ?? hm?.[5]?.trim()
        if (!href) throw new CssParseError(`@import 语法无法解析: "${body.slice(0, 40)}"`, line)
        imports.push({ href, line })
        i = semi + 1
        continue
      }
      if (name === 'media') {
        const brace = noComment.indexOf('{', i)
        if (brace === -1) throw new CssParseError('@media 缺少规则体 {', line)
        const condition = noComment.slice(i + name.length + 1, brace).trim()
        const [bodyStart, bodyEnd] = readBracedBlock(noComment, brace)
        // 递归切内部规则（条件评估由编译层做——这里先全部解析保留）
        const inner = tokenizeStylesheet(noComment.slice(bodyStart, bodyEnd), { origin })
        medias.push({ condition, rules: inner.rules, line })
        for (const im of inner.imports) imports.push(im)
        for (const u of inner.unsupportedAtRules) unsupportedAtRules.push(u)
        i = bodyEnd + 1
        continue
      }
      // keyframes/font-face/supports/property/container/layer 等：切掉规则体，记录为不支持
      const brace = noComment.indexOf('{', i)
      unsupportedAtRules.push({ name, line })
      if (brace !== -1) {
        const [, bodyEnd] = readBracedBlock(noComment, brace)
        i = bodyEnd
      } else {
        const semi = findTopLevelSemicolon(noComment, i)
        i = semi === -1 ? noComment.length : semi + 1
      }
      continue
    }

    // 普通规则：选择器（到 '{'）+ 声明块
    const brace = noComment.indexOf('{', i)
    if (brace === -1) break
    const selectorText = noComment.slice(i, brace).trim()
    const line = lineOf(noComment, i)
    const [bodyStart, bodyEnd] = readBracedBlock(noComment, brace)
    if (!selectorText) {
      throw new CssParseError('CSS 规则缺少选择器', line)
    }
    const decls = new Map<string, { value: string; important: boolean }>()
    const customProps = new Map<string, string>()
    for (const d of parseDecls(noComment.slice(bodyStart, bodyEnd), line)) {
      if (d.custom) customProps.set(d.prop, d.value)
      else decls.set(d.prop, { value: d.value, important: d.important })
    }
    for (const selText of splitSelectorGroup(selectorText)) {
      const selector = parseSelector(selText, line)
      rules.push({ selector, selectorText: selText, decls, customProps, order: order++, origin, line })
    }
    i = bodyEnd + 1
  }

  return { rules, imports, medias, unsupportedAtRules }
}

/** 选择器组按顶层逗号切分（括号内逗号不切，如 :nth-child(2n+1), :is(a,b) 简单场景） */
function splitSelectorGroup(text: string): string[] {
  const out: string[] = []
  let buf = ''
  let paren = 0
  let quote: string | null = null
  for (const ch of text) {
    if (quote) {
      buf += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '(') paren++
    if (ch === ')') paren--
    if (ch === ',' && paren <= 0) {
      out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/** 读取 {..} 配对块，返回 [内容起, 内容止(不含 '}')] */
function readBracedBlock(src: string, openBrace: number): [number, number] {
  let depth = 1
  let j = openBrace + 1
  while (j < src.length && depth > 0) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') depth--
    j++
  }
  if (depth !== 0) {
    throw new CssParseError('CSS 规则花括号未闭合', lineOf(src, openBrace))
  }
  return [openBrace + 1, j - 1]
}

/** 找顶层（非引号/非括号内）分号 */
function findTopLevelSemicolon(src: string, from: number): number {
  let quote: string | null = null
  let paren = 0
  for (let i = from; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') paren++
    else if (ch === ')') paren--
    else if (ch === ';' && paren <= 0) return i
  }
  return -1
}
