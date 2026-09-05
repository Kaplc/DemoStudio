/**
 * miniParser — HTML 解析器 v2（零依赖，带行号错误定位；完整原生 HTML 语法面）
 *
 * v2（完整映射版）：在 v1 受控子集之上扩展为完整 HTML 语法解析——
 *  - 实体解码（&amp; &lt; &#x..; &nbsp; 等，文本与属性值均解码）
 *  - 原始文本元素（script/style：内容不解析子节点、不解码实体）
 *  - 完整 void 标签表；无值属性（disabled 等）与单引号/无引号属性值
 *  - DOCTYPE / <?..?> / CDATA 跳过；HTML 注释剥离
 *  - <html>/<body>/<head> 结构容许（编译层负责剥离取 body 内容）
 *
 * 解析层只做语法切分（接受任意标签名），语义白名单（哪些标签/属性可映射）
 * 由编译层把关——越界一律硬报错，绝不静默降级。
 */

/** HTML 节点 */
export interface HtmlNode {
  /** 标签名小写（'#text' = 纯文本节点） */
  tag: string
  /** 属性表（值已实体解码；无值属性为 ''） */
  attrs: Record<string, string>
  /** 子节点（文本节点 tag='#text'；rawText 元素无子节点） */
  children: HtmlNode[]
  /** 文本内容（仅 tag='#text'） */
  text: string
  /** 源行号（1 起） */
  line: number
  /** 原始文本内容（仅 script/style 等 rawText 元素） */
  raw?: string
  /** 源偏移：元素 '<' 起点（注释按等长空格剥离，偏移与原始源一致；'#text' 无） */
  start?: number
  /** 源偏移：开标签 '>' 之后 */
  openEnd?: number
  /** 源偏移：闭合标签 '</tag' 起点（void/自闭合/rawText 无） */
  closeStart?: number
  /** 源偏移：元素终点（闭合 '>' / '/>' / rawText 闭合 '>' 之后） */
  end?: number
  /** 源偏移：rawText 内容区间 [rawStart, rawEnd)（仅 script/style） */
  rawStart?: number
  rawEnd?: number
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

/** ─── 实体解码 ─── */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', times: '×', divide: '÷', plusmn: '±', deg: '°',
  middot: '·', bull: '•', dagger: '†', sect: '§', para: '¶', euro: '€',
  pound: '£', yen: '¥', cent: '¢', sup2: '²', sup3: '³', frac12: '½',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', half: '½',
}

/** 解码 HTML 实体（文本与属性值共用；未知实体原样保留） */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      if (!Number.isFinite(n) || n < 1 || n > 0x10ffff) return m
      try {
        return String.fromCodePoint(n)
      } catch {
        return m
      }
    }
    const named = NAMED_ENTITIES[code.toLowerCase()]
    return named ?? m
  })
}

/** ─── HTML 解析 ─── */

/** void 元素（HTML 标准全集） */
export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** 原始文本元素：内容不解析为子节点、不解码实体（properties = 参数区原始 JSON，见 properties-region.md） */
export const RAW_TEXT_TAGS = new Set(['script', 'style', 'properties'])

/**
 * 解析 HTML 源为节点树。
 * 属性值支持双引号/单引号/无引号；无值属性记 ''；值做实体解码。
 */
export function tokenizeHtml(src: string): { root: HtmlNode } {
  const clean = src.replace(/^\uFEFF/, '')
  // 剥离注释/DOCTYPE/处理指令/CDATA（保留换行数，行号不漂移）
  const noComment = clean
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!DOCTYPE[^>]*>/gi, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<\?[\s\S]*?\?>/g, (m) => m.replace(/[^\n]/g, ' '))

  let pos = 0
  const root = parseElement()
  if (!root) throw new ParseError('源为空（未找到根元素）', 1)
  return { root }

  /** 解析一个元素（递归） */
  function parseElement(): HtmlNode | null {
    skipWs()
    if (pos >= noComment.length) return null
    if (noComment[pos] !== '<') {
      throw new ParseError(`意外的字符 "${noComment[pos]}"（期望标签）`, lineOf(noComment, pos))
    }
    // 容错：顶层出现的游离 '</xxx>' 闭合符（解析器状态机已在元素内消化配对，正常不会到这）
    if (noComment.startsWith('</', pos)) {
      throw new ParseError(`多余的闭合标签`, lineOf(noComment, pos))
    }

    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(noComment.slice(pos))
    if (!m) {
      throw new ParseError('非法标签起始', lineOf(noComment, pos))
    }
    const tag = m[1].toLowerCase()
    const line = lineOf(noComment, pos)
    const elemStart = pos
    pos += m[0].length

    // 属性
    const attrs: Record<string, string> = {}
    while (pos < noComment.length) {
      skipWs()
      if (noComment[pos] === '>' || noComment.startsWith('/>', pos)) break
      // 属性名：字母/数字/_/:/.//-（无值属性直接记 ''）
      const am = /^([a-zA-Z_][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.exec(noComment.slice(pos))
      if (!am) {
        throw new ParseError(`标签 <${tag}> 属性格式非法`, lineOf(noComment, pos))
      }
      attrs[am[1].toLowerCase()] = decodeEntities(am[2] ?? am[3] ?? am[4] ?? '')
      pos += am[0].length
    }

    // 自闭合
    if (noComment.startsWith('/>', pos)) {
      pos += 2
      return { tag, attrs, children: [], text: '', line, start: elemStart, openEnd: pos, end: pos }
    }
    if (noComment[pos] !== '>') {
      throw new ParseError(`标签 <${tag}> 未正确闭合`, lineOf(noComment, pos))
    }
    pos++ // 越过 '>'
    const openEnd = pos

    if (VOID_TAGS.has(tag)) {
      return { tag, attrs, children: [], text: '', line, start: elemStart, openEnd, end: pos }
    }

    // 原始文本元素：内容直读到对应闭合标签，不解析、不解码
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = noComment.indexOf(`</${tag}`, pos)
      if (close === -1) throw new ParseError(`标签 <${tag}> 未闭合（缺少 </${tag}>）`, line)
      const raw = noComment.slice(pos, close)
      let closeEnd = noComment.indexOf('>', close)
      if (closeEnd === -1) throw new ParseError(`标签 <${tag}> 闭合符缺失`, lineOf(noComment, close))
      pos = closeEnd + 1
      return { tag, attrs, children: [], text: '', line, raw, start: elemStart, openEnd, end: pos, rawStart: openEnd, rawEnd: close }
    }

    // 子内容
    const children: HtmlNode[] = []
    let textBuf = ''
    let textLine = line
    while (pos < noComment.length) {
      if (noComment.startsWith(`</${tag}`, pos)) {
        const closeEnd = noComment.indexOf('>', pos)
        if (closeEnd === -1) throw new ParseError(`标签 <${tag}> 闭合符缺失`, lineOf(noComment, pos))
        const closeStart = pos
        flushText()
        pos = closeEnd + 1
        return { tag, attrs, children, text: '', line, start: elemStart, openEnd, closeStart, end: pos }
      }
      if (noComment[pos] === '<') {
        // 子元素（</ 在元素内出现而不匹配自身 = 子元素提前闭合，报错定位到下层）
        if (noComment.startsWith('</', pos)) {
          const wrongM = /^<\/([a-zA-Z][a-zA-Z0-9-]*)/.exec(noComment.slice(pos))
          throw new ParseError(
            `闭合标签 </${wrongM?.[1] ?? '?'}> 与当前元素 <${tag}> 不匹配`,
            lineOf(noComment, pos),
          )
        }
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
      if (!textBuf) return
      const decoded = decodeEntities(textBuf)
      const t = decoded.trim()
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
