/**
 * miniParser — 轻量 HTML/CSS 解析器（零依赖，带行号错误定位）
 *
 * 方案 §6：不引入第三方解析库，实现受控子集所需的解析能力：
 *  - tokenizeCss：规则块（选择器 + 声明列表）+ @规则拦截（@media/@keyframes 报错）
 *  - tokenizeHtml：标签树（元素/文本），记录每个节点的源行号（编译报错定位）
 *
 * 受控子集之外的结构在解析层就报错（行号指向 .widget.html），
 * 编译层再对属性值做白名单校验——双层把关，越界写法绝不静默降级。
 */

/** CSS 声明 */
export interface CssDecl {
  prop: string
  value: string
}

/** CSS 规则块 */
export interface CssRule {
  /** 选择器（单 class / 单元素 / 单伪类，解析层只做切分，合法性由编译层校验） */
  selector: string
  decls: CssDecl[]
  /** 规则在源文件中的行号（1 起） */
  line: number
}

/** HTML 节点 */
export interface HtmlNode {
  /** 标签名小写（'#text' = 纯文本节点） */
  tag: string
  /** 属性表（class/data-* 等） */
  attrs: Record<string, string>
  /** 子节点（文本节点视为 tag='text' 的子项） */
  children: HtmlNode[]
  /** 文本内容（仅 tag='text'） */
  text: string
  /** 源行号（1 起） */
  line: number
}

export class ParseError extends Error {
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

/** ─── CSS 解析 ─── */

/**
 * 解析 <style> 内容为规则列表。
 * 支持：selector { prop: value; prop2: value2 }；支持注释 /* *\/。
 * 拦截：@media/@keyframes/@import 等一切 @规则（方案 §5 明确不做）。
 */
export function tokenizeCss(css: string): CssRule[] {
  const rules: CssRule[] = []
  // 去注释（保留换行数，行号不漂移）
  const noComment = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

  let i = 0
  while (i < noComment.length) {
    // 跳过空白
    while (i < noComment.length && /\s/.test(noComment[i])) i++
    if (i >= noComment.length) break

    // @规则：硬报错（受控子集不含 @media/@keyframes/@import）
    if (noComment[i] === '@') {
      const m = /^@([a-zA-Z-]+)/.exec(noComment.slice(i))
      throw new ParseError(
        `CSS @规则 "@${m?.[1] ?? '?'}" 不受支持（受控子集仅支持普通规则块）`,
        lineOf(noComment, i),
      )
    }

    // 选择器：读到 '{'
    const braceIdx = noComment.indexOf('{', i)
    if (braceIdx === -1) break
    const selector = noComment.slice(i, braceIdx).trim()
    const line = lineOf(noComment, i)
    if (!selector) {
      throw new ParseError('CSS 规则缺少选择器', line)
    }

    // 声明块：读到配对 '}'
    let depth = 1
    let j = braceIdx + 1
    while (j < noComment.length && depth > 0) {
      if (noComment[j] === '{') depth++
      else if (noComment[j] === '}') depth--
      j++
    }
    if (depth !== 0) {
      throw new ParseError(`CSS 规则 "${selector}" 花括号未闭合`, line)
    }
    const body = noComment.slice(braceIdx + 1, j - 1)

    // 声明解析：prop: value;（允许最后一个省略分号）
    const decls: CssDecl[] = []
    for (const rawDecl of body.split(';')) {
      const d = rawDecl.trim()
      if (!d) continue
      const colon = d.indexOf(':')
      if (colon === -1) {
        throw new ParseError(`CSS 声明缺少冒号: "${d.slice(0, 40)}"`, line)
      }
      decls.push({ prop: d.slice(0, colon).trim().toLowerCase(), value: d.slice(colon + 1).trim() })
    }

    rules.push({ selector, decls, line })
    i = j
  }
  return rules
}

/** ─── HTML 解析 ─── */

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])

/**
 * 解析 .widget.html 内容为节点树。
 * 要求：根元素必须是 <widget>；img 为 void 标签；属性值用引号包裹。
 */
export function tokenizeHtml(src: string): { root: HtmlNode; styleCss: string; styleLine: number } {
  const BOM = /^\uFEFF/
  const clean = src.replace(BOM, '')
  // 剥离 HTML 注释（保留换行）
  const noComment = clean.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))

  let pos = 0
  const root = parseElement()
  if (!root || root.tag !== 'widget') {
    throw new ParseError('根元素必须是 <widget>（如 <widget name="xxx" canvas="960x540">）', 1)
  }

  // 收集 <style> 内容（仅根直接子级第一个；CSS 文本存于子级 '#text' 节点）
  let styleCss = ''
  let styleLine = 1
  for (const c of root.children) {
    if (c.tag === 'style') {
      styleCss = c.children.filter((t) => t.tag === '#text').map((t) => t.text).join('\n')
      styleLine = c.line
      break
    }
  }

  return { root, styleCss, styleLine }

  /** 解析一个元素（递归） */
  function parseElement(): HtmlNode | null {
    skipWs()
    if (pos >= noComment.length) return null
    if (noComment[pos] !== '<') {
      throw new ParseError(`意外的字符 "${noComment[pos]}"（期望标签）`, lineOf(noComment, pos))
    }

    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(noComment.slice(pos))
    if (!m) {
      throw new ParseError('非法标签起始', lineOf(noComment, pos))
    }
    const tag = m[1].toLowerCase()
    const line = lineOf(noComment, pos)
    pos += m[0].length

    // 属性
    const attrs: Record<string, string> = {}
    while (pos < noComment.length) {
      skipWs()
      if (noComment[pos] === '>' || noComment.startsWith('/>', pos)) break
      const am = /^([a-zA-Z_][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(noComment.slice(pos))
      if (!am) {
        throw new ParseError(`标签 <${tag}> 属性格式非法（属性值需引号包裹）`, lineOf(noComment, pos))
      }
      attrs[am[1].toLowerCase()] = am[2] ?? am[3] ?? ''
      pos += am[0].length
    }

    // 自闭合
    if (noComment.startsWith('/>', pos)) {
      pos += 2
      return { tag, attrs, children: [], text: '', line }
    }
    if (noComment[pos] !== '>') {
      throw new ParseError(`标签 <${tag}> 未正确闭合`, lineOf(noComment, pos))
    }
    pos++ // 越过 '>'

    if (VOID_TAGS.has(tag)) {
      return { tag, attrs, children: [], text: '', line }
    }

    // 子内容
    const children: HtmlNode[] = []
    let textBuf = ''
    let textLine = line
    while (pos < noComment.length) {
      if (noComment.startsWith(`</${tag}`, pos)) {
        // 闭合
        const closeEnd = noComment.indexOf('>', pos)
        if (closeEnd === -1) throw new ParseError(`标签 <${tag}> 闭合符缺失`, lineOf(noComment, pos))
        // 尾部纯文本
        flushText()
        pos = closeEnd + 1
        return { tag, attrs, children, text: '', line }
      }
      if (noComment[pos] === '<') {
        // 子元素或文本
        flushText()
        const child = parseElement()
        if (child) children.push(child)
      } else {
        if (!textBuf) textLine = lineOf(noComment, pos)
        textBuf += noComment[pos]
        pos++
      }
    }
    throw new ParseError(`标签 <${tag}> 未闭合（缺少 </${tag}>）`, line)

    function flushText() {
      const t = textBuf.trim()
      if (t) {
        // '#text'：纯文本节点（DOM 惯例），与 <text> 文本元素区分
        children.push({ tag: '#text', attrs: {}, children: [], text: t, line: textLine })
      }
      textBuf = ''
    }
  }

  function skipWs() {
    while (pos < noComment.length && /\s/.test(noComment[pos])) pos++
  }
}
