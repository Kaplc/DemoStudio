/**
 * css/values — CSS 值解析与归一化
 *
 * 颜色（命名 148 色/hex/rgb/hsl/transparent/currentColor 外部处理）→ #rrggbb(aa)
 * 长度单位（px % em rem vw vh pt pc in cm mm q）→ 相对量在布局期按上下文解算，
 * 这里提供"绝对可解则解"的辅助；calc() 静态求值；var() 替换；
 * 常用简写展开（margin/padding/border/background/font/flex/gap/overflow/
 * border-radius/text-shadow/inset）；transform 函数列表；linear-gradient 解析。
 */

import { CssParseError } from './tokenize'

/** ─── 颜色 ─── */

/** CSS 命名颜色全集（CSS Color Module Level 4，148 色） */
export const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6',
  olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500',
  orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
  palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080',
  rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
  saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
  seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb',
  slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080',
  thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee',
  wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
  yellowgreen: '#9acd32',
}

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0~1 */
  a: number
}

/** 解析颜色为 RGBA；无法解析返回 null（调用方决定报错或透传） */
export function parseColor(value: string): Rgba | null {
  const s = value.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s === 'currentcolor' || s === 'inherit' || s === 'initial' || s === 'unset') return null
  const named = NAMED_COLORS[s]
  if (named) return hexToRgba(named)
  if (s.startsWith('#')) return hexToRgba(s)
  const fnM = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (fnM) {
    const fn = fnM[1]
    // 逗号语法与空格语法（css color 4：rgb(1 2 3 / 0.5)）都支持
    const body = fnM[2]
    let parts: string[]
    if (body.includes('/')) {
      const [rgb, a] = body.split('/')
      parts = [...splitWs(rgb.trim()), a.trim()]
    } else {
      parts = body.split(',').map((p) => p.trim())
    }
    const nums = parts.map((p) => parseColorComponent(p))
    if (nums.some((n) => n === null)) return null
    if (fn.startsWith('rgb')) {
      return { r: nums[0]!, g: nums[1]!, b: nums[2]!, a: nums[3] ?? 1 }
    }
    // hsl: h 度数任意, s/l 百分比
    const h = ((nums[0]! % 360) + 360) % 360
    const sPct = nums[1]! / 100
    const lPct = nums[2]! / 100
    const [r, g, b] = hslToRgb(h, sPct, lPct)
    return { r, g, b, a: nums[3] ?? 1 }
  }
  return null
}

function splitWs(s: string): string[] {
  return s.split(/\s+/).filter(Boolean)
}

/** 颜色分量：数字 / 百分比 / 角度(h) */
function parseColorComponent(p: string): number | null {
  if (p.endsWith('%')) {
    const v = parseFloat(p)
    return Number.isFinite(v) ? (v / 100) * 255 : null
  }
  if (/^(deg|turn|rad|grad)$/.test(p.replace(/^[-\d.]+/, '')) && p.match(/(deg|turn|rad|grad)$/)) {
    const v = parseFloat(p)
    if (!Number.isFinite(v)) return null
    if (p.endsWith('turn')) return v * 360
    if (p.endsWith('rad')) return (v * 180) / Math.PI
    if (p.endsWith('grad')) return v * 0.9
    return v
  }
  const v = parseFloat(p)
  return Number.isFinite(v) ? v : null
}

function hexToRgba(s: string): Rgba | null {
  let hex = s.slice(1)
  if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
  if (hex.length !== 6 && hex.length !== 8) return null
  if (!/^[0-9a-f]+$/.test(hex)) return null
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((v) => Math.round((v + m) * 255)) as [number, number, number]
}

/** RGBA → '#rrggbb' 或含透明度的 '#rrggbbaa'（引擎色值规范形） */
export function rgbaToHex(c: Rgba): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`
  return c.a < 1 ? base + h(c.a * 255) : base
}

/** 颜色值 → 引擎规范形（#rrggbb[aa]）；不可解析返回 null */
export function normalizeColor(value: string): string | null {
  const c = parseColor(value)
  return c ? rgbaToHex(c) : null
}

/** ─── 长度 / 单位 ─── */

/** 长度记号：数值 + 单位（'%' 保留相对语义交布局期解算） */
export interface LengthValue {
  /** 数值（px 等已换算为 px；% 为百分数原值） */
  value: number
  unit: 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh'
}

/** PT/PC/IN/CM/MM/Q → px 换算（1in=96px） */
const ABS_UNITS_TO_PX: Record<string, number> = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6,
}

/**
 * 解析单个长度记号。
 * @param rootFontSize rem 基准（:root font-size，px）
 * @param fontSize em 基准（当前元素 font-size，px）
 * @param viewport [vw基准, vh基准]（画布 px）
 */
export function parseLength(
  token: string,
  ctx: { rootFontSize: number; fontSize: number; viewport: [number, number] },
): LengthValue | null {
  const s = token.trim().toLowerCase()
  if (s === '0') return { value: 0, unit: 'px' }
  const m = /^(-?[\d.]+)(px|em|rem|vw|vh|%|pt|pc|in|cm|mm|q)?$/.exec(s)
  if (!m) return null
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) return null
  switch (m[2] ?? 'px') {
    case 'px': return { value: v, unit: 'px' }
    case '%': return { value: v, unit: '%' }
    case 'em': return { value: v * ctx.fontSize, unit: 'px' }
    case 'rem': return { value: v * ctx.rootFontSize, unit: 'px' }
    case 'vw': return { value: (v / 100) * ctx.viewport[0], unit: 'px' }
    case 'vh': return { value: (v / 100) * ctx.viewport[1], unit: 'px' }
    default: return { value: v * ABS_UNITS_TO_PX[m[2]], unit: 'px' }
  }
}

/** ─── calc() / var() ─── */

/**
 * 解析 calc() 表达式为数值 px（长度场景）。
 * 支持 + - * / 与括号、混合单位（长度由 ctx 解算；% 在 calc 内按指定基准解算）。
 * @param resolvePercent 百分比解算基准（px）
 */
export function evalCalc(
  expr: string,
  ctx: { rootFontSize: number; fontSize: number; viewport: [number, number] },
  resolvePercent: number,
): number | null {
  // 先把长度记号展开成 px 数字，再交给受限四则运算求值
  const tokens = expr.match(/-?[\d.]+(px|em|rem|vw|vh|%|pt|pc|in|cm|mm|q)?|[()+\-*/]/g)
  if (!tokens) return null
  const jsExpr = tokens
    .map((t) => {
      if (/^[()+\-*/]$/.test(t)) return t
      const l = parseLength(t, ctx)
      if (!l) return null
      if (l.unit === '%') return `(${(l.value / 100) * resolvePercent})`
      return `(${l.value})`
    })
    .map((t) => t ?? '\0')
    .join(' ')
  if (jsExpr.includes('\0')) return null
  try {
    // 受限表达式：仅数字/括号/四则运算
    if (!/^[-\d\s()+*/.]+$/.test(jsExpr)) return null
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${jsExpr})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** 将声明值中的 var(--x, fallback) 递归替换为自定义属性值（找不到用 fallback，否则原样保留） */
export function substituteVars(
  value: string,
  customProps: Map<string, string>,
  depth = 0,
): string {
  if (depth > 16 || !value.includes('var(')) return value
  let out = ''
  let i = 0
  while (i < value.length) {
    const idx = value.indexOf('var(', i)
    if (idx === -1) {
      out += value.slice(i)
      break
    }
    out += value.slice(i, idx)
    // 找配对右括号
    let depth2 = 1
    let j = idx + 4
    while (j < value.length && depth2 > 0) {
      if (value[j] === '(') depth2++
      else if (value[j] === ')') depth2--
      j++
    }
    if (depth2 !== 0) return out + value.slice(idx) // 括号不闭合：原样保留（后续解析报错）
    const body = value.slice(idx + 4, j - 1)
    const comma = findTopLevelComma(body)
    const name = (comma === -1 ? body : body.slice(0, comma)).trim().toLowerCase()
    const fallback = comma === -1 ? undefined : body.slice(comma + 1).trim()
    const resolved = customProps.get(name)
    if (resolved !== undefined) {
      out += substituteVars(resolved, customProps, depth + 1)
    } else if (fallback !== undefined) {
      out += substituteVars(fallback, customProps, depth + 1)
    } else {
      out += `var(${body})` // 无法解析：保留，由属性解析层报"未定义变量"
    }
    i = j
  }
  return out
}

function findTopLevelComma(s: string): number {
  let paren = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') paren++
    else if (s[i] === ')') paren--
    else if (s[i] === ',' && paren <= 0) return i
  }
  return -1
}

/** ─── 简写展开 ─── */

/** 1~4 值简写（margin/padding/border-width 等）→ [top, right, bottom, left] */
export function expandBox4(value: string): [string, string, string, string] {
  const parts = value.trim().split(/\s+/)
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  if (parts.length === 4) return [parts[0], parts[1], parts[2], parts[3]]
  throw new CssParseError(`简写值段数过多: "${value.slice(0, 40)}"`, 0)
}

/**
 * 不动点展开：简写可能多级嵌套（border → border-width → border-top-width），
 * 循环展开到全部为长手属性为止。无法识别的属性原样返回自身（单元素不变）。
 */
export function expandAll(prop: string, value: string): Array<{ prop: string; value: string }> {
  let out: Array<{ prop: string; value: string }> = [{ prop, value }]
  let changed = true
  let guard = 0
  while (changed && guard < 8) {
    changed = false
    guard++
    const next: Array<{ prop: string; value: string }> = []
    for (const { prop: p, value: v } of out) {
      const ex = expandDeclaration(p, v)
      if (ex.length === 1 && ex[0].prop === p && ex[0].value === v) next.push({ prop: p, value: v })
      else {
        next.push(...ex)
        changed = true
      }
    }
    out = next
  }
  return out
}

/**
 * 展开全部常用简写为长手属性（不覆盖已显式声明的长手属性之后处理的语义——
 * 调用方按声明顺序逐条调用 expandDeclaration 并按序写入，天然保序）。
 * 返回该声明展开出的长手属性列表；无法识别的属性原样返回自身。
 */
export function expandDeclaration(
  prop: string,
  value: string,
): Array<{ prop: string; value: string }> {
  switch (prop) {
    case 'margin': {
      const [t, r, b, l] = expandBox4(value)
      return [
        { prop: 'margin-top', value: t }, { prop: 'margin-right', value: r },
        { prop: 'margin-bottom', value: b }, { prop: 'margin-left', value: l },
      ]
    }
    case 'padding': {
      const [t, r, b, l] = expandBox4(value)
      return [
        { prop: 'padding-top', value: t }, { prop: 'padding-right', value: r },
        { prop: 'padding-bottom', value: b }, { prop: 'padding-left', value: l },
      ]
    }
    case 'inset': {
      const [t, r, b, l] = expandBox4(value)
      return [
        { prop: 'top', value: t }, { prop: 'right', value: r },
        { prop: 'bottom', value: b }, { prop: 'left', value: l },
      ]
    }
    case 'border-width': {
      const [t, r, b, l] = expandBox4(value)
      return [
        { prop: 'border-top-width', value: t }, { prop: 'border-right-width', value: r },
        { prop: 'border-bottom-width', value: b }, { prop: 'border-left-width', value: l },
      ]
    }
    case 'border-style': {
      const [t, r, b, l] = expandBox4(value)
      return [
        { prop: 'border-top-style', value: t }, { prop: 'border-right-style', value: r },
        { prop: 'border-bottom-style', value: b }, { prop: 'border-left-style', value: l },
      ]
    }
    case 'border-color': {
      const [t, r, b, l] = expandBox4(value)
      return [
        { prop: 'border-top-color', value: t }, { prop: 'border-right-color', value: r },
        { prop: 'border-bottom-color', value: b }, { prop: 'border-left-color', value: l },
      ]
    }
    case 'border':
    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      // <width> <style> <color> 任意顺序子集；'none'/'hidden' → width 0
      const side = prop === 'border' ? '' : `-${prop.slice(7)}`
      if (/^(none|hidden)$/.test(value.trim())) {
        return [{ prop: `border${side}-width`, value: '0' }, { prop: `border${side}-style`, value: 'none' }]
      }
      const out: Array<{ prop: string; value: string }> = []
      let rest = value.trim()
      const wM = /^(thin|medium|thick|-?[\d.]+(px|em|rem|pt|q))\b/.exec(rest)
      if (wM) {
        out.push({ prop: `border${side}-width`, value: wM[0] })
        rest = rest.slice(wM[0].length).trim()
      }
      const sM = /^(solid|dashed|dotted|double|groove|ridge|inset|outset|none)\b/.exec(rest)
      if (sM) {
        out.push({ prop: `border${side}-style`, value: sM[1] })
        rest = rest.slice(sM[0].length).trim()
      }
      if (rest) out.push({ prop: `border${side}-color`, value: rest })
      return out
    }
    case 'gap': {
      const [r, c] = value.trim().split(/\s+/)
      return [
        { prop: 'row-gap', value: r ?? value.trim() },
        { prop: 'column-gap', value: c ?? r ?? value.trim() },
      ]
    }
    case 'overflow': {
      const [x, y] = value.trim().split(/\s+/)
      return [
        { prop: 'overflow-x', value: x },
        { prop: 'overflow-y', value: y ?? x },
      ]
    }
    case 'place-items': {
      const [a, b] = value.trim().split(/\s+/)
      return [
        { prop: 'align-items', value: a },
        { prop: 'justify-items', value: b ?? a },
      ]
    }
    case 'place-content': {
      const [a, b] = value.trim().split(/\s+/)
      return [
        { prop: 'align-content', value: a },
        { prop: 'justify-content', value: b ?? a },
      ]
    }
    case 'flex-flow': {
      const parts = value.trim().split(/\s+/)
      return parts
        .map((p) => (/^(row|column|row-reverse|column-reverse)$/.test(p)
          ? { prop: 'flex-direction', value: p }
          : { prop: 'flex-wrap', value: p }))
    }
    case 'flex': {
      // none → 0 0 auto；auto → 1 1 auto；正数 n → n 1 0%
      const v = value.trim()
      if (v === 'none') return [{ prop: 'flex-grow', value: '0' }, { prop: 'flex-shrink', value: '0' }, { prop: 'flex-basis', value: 'auto' }]
      if (v === 'auto') return [{ prop: 'flex-grow', value: '1' }, { prop: 'flex-shrink', value: '1' }, { prop: 'flex-basis', value: 'auto' }]
      const parts = v.split(/\s+/)
      const out: Array<{ prop: string; value: string }> = [{ prop: 'flex-grow', value: parts[0] }]
      out.push({ prop: 'flex-shrink', value: parts[1] ?? '1' })
      out.push({ prop: 'flex-basis', value: parts[2] ?? '0%' })
      return out
    }
    case 'background': {
      // 单层背景：按"括号感知段"切分（linear-gradient(...) 内部空格不切）。
      // 多层背景（顶层逗号）在编译层报错；这里遇到即整体交给 background-image 由其报错
      const out: Array<{ prop: string; value: string }> = []
      const segs = splitParensAware(value.trim())
      if (segs.some((seg, i) => i > 0 && /^[^\s(]+\(/.test(seg))) {
        return [{ prop: 'background-image', value }]
      }
      const colorPart: string[] = []
      for (const tok of segs) {
        if (/^(url\([^)]*\)|[a-z-]+-gradient\([^)]*\))$/.test(tok)) {
          out.push({ prop: 'background-image', value: tok })
        } else if (/^(no-repeat|repeat|repeat-x|repeat-y|space|round)$/.test(tok)) {
          out.push({ prop: 'background-repeat', value: tok })
        } else if (/^(scroll|fixed|local)$/.test(tok)) {
          out.push({ prop: 'background-attachment', value: tok })
        } else {
          colorPart.push(tok)
        }
      }
      if (colorPart.length > 0) {
        const colorTry = colorPart.join(' ')
        if (parseColor(colorTry) || colorTry === 'transparent') {
          out.push({ prop: 'background-color', value: colorTry })
        } else {
          out.push({ prop: 'background-position', value: colorTry })
        }
      }
      return out
    }
    case 'font': {
      // font: [style||variant||weight] size[/line-height] family
      const out: Array<{ prop: string; value: string }> = []
      let rest = value.trim()
      for (;;) {
        const sM = /^(italic|oblique\b[^ ]*|normal)\b/.exec(rest)
        if (sM && sM[1] !== 'normal') {
          out.push({ prop: 'font-style', value: sM[1] })
          rest = rest.slice(sM[0].length).trim()
          continue
        }
        const wM = /^(bold\b|bolder|lighter|[1-9]00)\b/.exec(rest)
        if (wM) {
          out.push({ prop: 'font-weight', value: wM[1] })
          rest = rest.slice(wM[0].length).trim()
          continue
        }
        break
      }
      const sizeM = /^([\d.]+(px|em|rem|%|pt|vw|vh)|[\d.]+)(?:\s*\/\s*([\d.]+))?\s+/.exec(rest)
      if (!sizeM) throw new CssParseError(`font 简写缺少字号: "${value.slice(0, 40)}"`, 0)
      out.push({ prop: 'font-size', value: sizeM[1] })
      if (sizeM[3]) out.push({ prop: 'line-height', value: sizeM[3] })
      rest = rest.slice(sizeM[0].length).trim()
      if (rest) out.push({ prop: 'font-family', value: rest })
      return out
    }
    case 'text-decoration': {
      // underline/line-through 引擎不支持 → 编译层警告；这里只展开 color/style
      return [{ prop: 'text-decoration-line', value }]
    }
    case 'border-radius': {
      // 水平 1~4 值（"/垂直" 椭圆角不支持 → 解析层报错）；展开为四角
      if (value.includes('/')) {
        return [{ prop: 'border-radius', value }] // 保留原值，解析层检测 '/' 报错
      }
      const [tl, tr, br, bl] = expandBox4(value)
      return [
        { prop: 'border-top-left-radius', value: tl },
        { prop: 'border-top-right-radius', value: tr },
        { prop: 'border-bottom-right-radius', value: br },
        { prop: 'border-bottom-left-radius', value: bl },
      ]
    }
    default:
      return [{ prop, value }]
  }
}

/** ─── transform ─── */

export interface TransformSpec {
  translateX?: LengthValue
  translateY?: LengthValue
  /** 度 */
  rotateDeg?: number
  scaleX?: number
  scaleY?: number
}

/** 解析 transform 函数列表；不支持的函数抛出（编译层补行号） */
export function parseTransform(
  value: string,
  ctx: { rootFontSize: number; fontSize: number; viewport: [number, number] },
): TransformSpec {
  const spec: TransformSpec = {}
  const re = /(matrix|translate|translateX|translateY|rotate|scale|scaleX|scaleY|skew|skewX|skewY|perspective|matrix3d|translate3d|rotate3d)\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    const fn = m[1]
    const args = m[2].split(',').map((a) => a.trim())
    switch (fn) {
      case 'translate': {
        spec.translateX = parseLength(args[0] ?? '0', ctx) ?? undefined
        spec.translateY = parseLength(args[1] ?? '0', ctx) ?? undefined
        break
      }
      case 'translateX': spec.translateX = parseLength(args[0], ctx) ?? undefined; break
      case 'translateY': spec.translateY = parseLength(args[0], ctx) ?? undefined; break
      case 'rotate': spec.rotateDeg = parseAngle(args[0]); break
      case 'scale': {
        spec.scaleX = parseFloat(args[0])
        spec.scaleY = args[1] !== undefined ? parseFloat(args[1]) : spec.scaleX
        break
      }
      case 'scaleX': spec.scaleX = parseFloat(args[0]); break
      case 'scaleY': spec.scaleY = parseFloat(args[0]); break
      case 'matrix': {
        // matrix(a,b,c,d,e,f) → 旋转+缩放近似（取 a/d 主轴缩放与旋转角）
        const [a, b, , d, e, f] = args.map((v) => parseFloat(v))
        spec.scaleX = a
        spec.scaleY = d
        spec.rotateDeg = (Math.atan2(b, a) * 180) / Math.PI
        spec.translateX = { value: e, unit: 'px' }
        spec.translateY = { value: f, unit: 'px' }
        break
      }
      default:
        throw new CssParseError(
          `transform ${fn}() 不受支持（支持 translate/rotate/scale/matrix 及单轴变体）`,
          0,
        )
    }
  }
  if (spec.scaleX === undefined && spec.scaleY !== undefined) spec.scaleX = 1
  if (spec.scaleY === undefined && spec.scaleX !== undefined) spec.scaleY = 1
  return spec
}

/** 角度 → 度数 */
export function parseAngle(token: string): number {
  const s = token.trim().toLowerCase()
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/.exec(s)
  if (!m) throw new CssParseError(`角度值非法: "${token}"`, 0)
  const v = parseFloat(m[1])
  switch (m[2]) {
    case 'turn': return v * 360
    case 'rad': return (v * 180) / Math.PI
    case 'grad': return v * 0.9
    default: return v
  }
}

/** ─── 渐变（linear-gradient → 引擎 UIImage 渐变属性） ─── */

export interface GradientStop {
  color: string
  /** 0~1；未指定时按均分 */
  offset?: number
}

export interface LinearGradientSpec {
  /** 度（0=向上，90=向右，CSS 标准） */
  angleDeg: number
  stops: GradientStop[]
}

/** 解析 linear-gradient(...)（内部内容，不含函数名与括号）；radial/conic 抛错 */
export function parseLinearGradient(body: string): LinearGradientSpec {
  const parts = splitTopLevel(body, ',').map((p) => p.trim())
  if (parts.length < 2) throw new CssParseError('linear-gradient 至少需要 2 个色标', 0)
  let angleDeg = 180 // 缺省 to bottom
  let startIdx = 0
  const first = parts[0]
  const dirM = /^(-?[\d.]+(deg|turn|rad|grad))$/.exec(first)
  if (dirM) {
    angleDeg = parseAngle(first)
    startIdx = 1
  } else if (/^to\s+/.test(first)) {
    const dirs = first.slice(3).split(/\s+/)
    let a = 180
    if (dirs.includes('top')) a = 0
    if (dirs.includes('bottom')) a = 180
    if (dirs.includes('left')) a = dirs.includes('top') ? 315 : dirs.includes('bottom') ? 225 : 270
    if (dirs.includes('right')) a = dirs.includes('top') ? 45 : dirs.includes('bottom') ? 135 : 90
    angleDeg = a
    startIdx = 1
  }
  const stops: GradientStop[] = []
  const stopParts = parts.slice(startIdx)
  for (let i = 0; i < stopParts.length; i++) {
    const p = stopParts[i]
    const offM = /\s+(-?[\d.]+)%$/.exec(p)
    const colorPart = offM ? p.slice(0, offM.index) : p
    const hex = normalizeColor(colorPart)
    if (!hex) throw new CssParseError(`linear-gradient 色标颜色无法解析: "${colorPart}"`, 0)
    stops.push({
      color: hex,
      offset: offM ? parseFloat(offM[1]) / 100 : undefined,
    })
  }
  // 未指定 offset 的色标按位置均分
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].offset === undefined) {
      stops[i].offset = stops.length === 1 ? 0 : i / (stops.length - 1)
    }
  }
  return { angleDeg, stops }
}

/** 顶层逗号切分（括号/引号内不切） */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let buf = ''
  let paren = 0
  let quote: string | null = null
  for (const ch of s) {
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
    if (ch === sep && paren <= 0) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out
}

/** 顶层空白切分（括号内空格不切） */
function splitParensAware(s: string): string[] {
  const out: string[] = []
  let buf = ''
  let paren = 0
  for (const ch of s) {
    if (ch === '(') paren++
    if (ch === ')') paren--
    if (/\s/.test(ch) && paren <= 0) {
      if (buf) out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf) out.push(buf)
  return out
}
