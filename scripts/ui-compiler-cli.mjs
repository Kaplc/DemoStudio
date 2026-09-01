/**
 * ui-compiler CLI — Node 命令行编译/反编译 .widget.html ↔ .widget.json
 *
 * 用法（项目根目录）：
 *   node scripts/ui-compiler-cli.mjs compile  <.../xxx.widget.html> [输出.json]
 *   node scripts/ui-compiler-cli.mjs decompile <.../xxx.widget.json> [输出.html]
 *
 * 实现说明：自包含纯 JS 实现（与 src/editor/asset/uiCompiler 的 TS 版映射规则一致），
 * 零 npm 依赖、无浏览器/编辑器依赖，CI 与手工均可跑。映射规则若调整需与 TS 版同步。
 * assetLint 零错误门槛：compile 成功后自动探测本机运行中的编辑器实例（MCP API :9877+），
 * 经 HTTP 调 run_asset_lint 全量扫描并过滤本资产违规——error 档阻断（exit 4）、warn 档透传；
 * 编辑器未运行时降级跳过（由编辑器内 ui_compile/MCP 兜底把关）。
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , cmd, inputArg, outputArg] = process.argv

function usage() {
  console.log(`用法:
  node scripts/ui-compiler-cli.mjs compile <xxx.widget.html> [输出路径.json]
  node scripts/ui-compiler-cli.mjs decompile <xxx.widget.json> [输出路径.html]`)
}

if (!cmd || !inputArg) {
  usage()
  process.exit(cmd ? 0 : 1)
}

const inputPath = path.resolve(process.cwd(), inputArg)
if (!fs.existsSync(inputPath)) {
  console.error(`输入文件不存在: ${inputPath}`)
  process.exit(1)
}

// ════════════════ 映射常量（与 widgetMapping.ts 一致）════════════════
// px↔米按根画布比例换算：x: px/canvasWidth×worldWidth；y: px/canvasHeight×worldHeight
const FULLSCREEN_WORLD_WIDTH = 4.8
const FULLSCREEN_CANVAS_WIDTH = 1920
const FULLSCREEN_CANVAS_HEIGHT = 1080

function round2(v) {
  return Math.round(v * 100) / 100
}
function round4(v) {
  return Math.round(v * 10000) / 10000
}
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`
}

// ════════════════ 解析（与 miniParser.ts 同构）════════════════

function lineOf(src, index) {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

class ParseError extends Error {
  constructor(message, line) {
    super(message)
    this.line = line
  }
}

function tokenizeCss(css) {
  const rules = []
  const noComment = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  let i = 0
  while (i < noComment.length) {
    while (i < noComment.length && /\s/.test(noComment[i])) i++
    if (i >= noComment.length) break
    if (noComment[i] === '@') {
      const m = /^@([a-zA-Z-]+)/.exec(noComment.slice(i))
      throw new ParseError(`CSS @规则 "@${m?.[1] ?? '?'}" 不受支持`, lineOf(noComment, i))
    }
    const braceIdx = noComment.indexOf('{', i)
    if (braceIdx === -1) break
    const selector = noComment.slice(i, braceIdx).trim()
    const line = lineOf(noComment, i)
    if (!selector) throw new ParseError('CSS 规则缺少选择器', line)
    let depth = 1
    let j = braceIdx + 1
    while (j < noComment.length && depth > 0) {
      if (noComment[j] === '{') depth++
      else if (noComment[j] === '}') depth--
      j++
    }
    if (depth !== 0) throw new ParseError(`CSS 规则 "${selector}" 花括号未闭合`, line)
    const body = noComment.slice(braceIdx + 1, j - 1)
    const decls = []
    for (const rawDecl of body.split(';')) {
      const d = rawDecl.trim()
      if (!d) continue
      const colon = d.indexOf(':')
      if (colon === -1) throw new ParseError(`CSS 声明缺少冒号: "${d.slice(0, 40)}"`, line)
      decls.push({ prop: d.slice(0, colon).trim().toLowerCase(), value: d.slice(colon + 1).trim() })
    }
    rules.push({ selector, decls, line })
    i = j
  }
  return rules
}

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])

function tokenizeHtml(src) {
  const clean = src.replace(/^\uFEFF/, '')
  const noComment = clean.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  let pos = 0
  const root = parseElement()
  if (!root || root.tag !== 'widget') {
    throw new ParseError('根元素必须是 <widget>', 1)
  }
  let styleCss = ''
  for (const c of root.children) {
    if (c.tag === 'style') {
      styleCss = c.children.filter((t) => t.tag === '#text').map((t) => t.text).join('\n')
      break
    }
  }
  return { root, styleCss }

  function parseElement() {
    skipWs()
    if (pos >= noComment.length) return null
    if (noComment[pos] !== '<') throw new ParseError(`意外的字符（期望标签）`, lineOf(noComment, pos))
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(noComment.slice(pos))
    if (!m) throw new ParseError('非法标签起始', lineOf(noComment, pos))
    const tag = m[1].toLowerCase()
    const line = lineOf(noComment, pos)
    pos += m[0].length
    const attrs = {}
    while (pos < noComment.length) {
      skipWs()
      if (noComment[pos] === '>' || noComment.startsWith('/>', pos)) break
      const am = /^([a-zA-Z_][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(noComment.slice(pos))
      if (!am) throw new ParseError(`标签 <${tag}> 属性格式非法`, lineOf(noComment, pos))
      attrs[am[1].toLowerCase()] = am[2] ?? am[3] ?? ''
      pos += am[0].length
    }
    if (noComment.startsWith('/>', pos)) {
      pos += 2
      return { tag, attrs, children: [], text: '', line }
    }
    if (noComment[pos] !== '>') throw new ParseError(`标签 <${tag}> 未正确闭合`, lineOf(noComment, pos))
    pos++
    if (VOID_TAGS.has(tag)) return { tag, attrs, children: [], text: '', line }
    const children = []
    let textBuf = ''
    let textLine = line
    while (pos < noComment.length) {
      if (noComment.startsWith(`</${tag}`, pos)) {
        const closeEnd = noComment.indexOf('>', pos)
        if (closeEnd === -1) throw new ParseError(`标签 <${tag}> 闭合符缺失`, lineOf(noComment, pos))
        flushText()
        pos = closeEnd + 1
        return { tag, attrs, children, text: '', line }
      }
      if (noComment[pos] === '<') {
        flushText()
        const child = parseElement()
        if (child) children.push(child)
      } else {
        if (!textBuf) textLine = lineOf(noComment, pos)
        textBuf += noComment[pos]
        pos++
      }
    }
    throw new ParseError(`标签 <${tag}> 未闭合`, line)

    function flushText() {
      const t = textBuf.trim()
      if (t) children.push({ tag: '#text', attrs: {}, children: [], text: t, line: textLine })
      textBuf = ''
    }
  }

  function skipWs() {
    while (pos < noComment.length && /\s/.test(noComment[pos])) pos++
  }
}

// ════════════════ 编译（与 compile.ts 同构）════════════════

const JUSTIFY_MAP = {
  'flex-start': 'start', start: 'start', center: 'center',
  'flex-end': 'end', end: 'end',
  'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly',
}
const ALIGN_MAP = {
  'flex-start': 'start', start: 'start', center: 'center',
  'flex-end': 'end', end: 'end', stretch: 'stretch',
}
const TEXT_ALIGN_MAP = { left: 'left', center: 'center', right: 'right' }
const COLOR_RE = /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/

class CompileFail extends Error {
  constructor(message, line) {
    super(message)
    this.line = line
  }
}

let nodeIdSeq = 0
function nextNodeId() {
  nodeIdSeq += 1
  return 13200 + nodeIdSeq
}

// px↔米换算（compileWidgetHtml/decompileWidgetJson 入口按根画布赋值）
let pxToWorldX = (px) => px
let pxToWorldY = (px) => px
let worldToPxX = (m) => m
let worldToPxY = (m) => m
let worldWidthM = 4.8
let worldHeightM = 2.7

function compileWidgetHtml(source) {
  const errors = []
  nodeIdSeq = 0
  // 函数级共享（内部辅助函数可见）：样式表 + 画布基准
  let styles = new Map()
  let canvasWidth = 1920
  let canvasHeight = 1080
  try {
    const { root, styleCss } = tokenizeHtml(source)
    const cssRules = tokenizeCss(styleCss)
    styles = collectClassStyles(cssRules)

    const name = root.attrs['name'] ?? root.attrs['data-name']
    if (!name) throw new CompileFail('<widget> 缺少 name 属性', root.line)
    const canvasStr = root.attrs['canvas'] ?? '1920x1080'
    const cm = /^(\d+)x(\d+)$/.exec(canvasStr)
    if (!cm) throw new CompileFail('<widget> canvas 属性格式应为 "宽x高"', root.line)
    const canvasWidth = parseInt(cm[1], 10)
    const canvasHeight = parseInt(cm[2], 10)
    // 根画布世界尺寸：world="WxH"（米）声明；缺省 = 全屏宽 4.8，高按画布比例
    let worldWidth = FULLSCREEN_WORLD_WIDTH
    let worldHeight = round2(FULLSCREEN_WORLD_WIDTH * (canvasHeight / canvasWidth))
    const worldStr = root.attrs['world']
    if (worldStr) {
      const wm = /^([\d.]+)x([\d.]+)$/.exec(worldStr)
      if (!wm) throw new CompileFail('<widget> world 属性格式应为 "宽x高"（米）', root.line)
      worldWidth = round2(parseFloat(wm[1]))
      worldHeight = round2(parseFloat(wm[2]))
    }
    // px↔米换算上下文（内部辅助函数经闭包共享）
    pxToWorldX = (px) => round4((px / canvasWidth) * worldWidth)
    pxToWorldY = (px) => round4((px / canvasHeight) * worldHeight)
    worldToPxX = (m) => (m / worldWidth) * canvasWidth
    worldToPxY = (m) => (m / worldHeight) * canvasHeight
    worldWidthM = worldWidth
    worldHeightM = worldHeight

    const doc = {
      name,
      baseClass: 'Actor',
      sourceHash: fnv1a(source.replace(/^\uFEFF/, '')),
      components: [],
      children: [],
    }

    const rootTfProps = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      worldWidth,
      worldHeight,
    }
    const rootAnchor = root.attrs['anchor']
    if (rootAnchor) {
      rootTfProps.anchor = rootAnchor
      const off = [0, 0]
      if (root.attrs['offset']) {
        const parts = root.attrs['offset'].split(',').map((s) => parseFloat(s.trim()))
        if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) {
          throw new CompileFail('<widget> offset 属性格式应为 "x,y"', root.line)
        }
        off[0] = round4(parts[0])
        off[1] = round4(parts[1])
      }
      rootTfProps.anchorOffset = off
    }
    doc.components.push({ baseClass: 'UITransformComponent', properties: rootTfProps })
    doc.components.push({
      baseClass: 'CanvasUIComponent',
      properties: { width: canvasWidth, height: canvasHeight, name: 'Canvas', zOrder: 0, active: true },
    })

    for (const c of root.children) {
      if (c.tag === 'style') continue
      if (c.tag === '#text') {
        throw new CompileFail('<widget> 根下不允许直接文本节点', c.line)
      }
      compileNode(c, doc, styles)
    }
    return { ok: true, errors: [], doc }
  } catch (e) {
    if (e instanceof CompileFail || e instanceof ParseError) {
      errors.push({ line: e.line, message: e.message })
    } else {
      errors.push({ line: 0, message: `编译异常: ${e.message}` })
    }
    return { ok: false, errors, doc: undefined }
  }

  function collectClassStyles(rules) {
    const out = new Map()
    for (const rule of rules) {
      const sel = rule.selector.trim()
      const hoverM = /^\.([\w-]+):hover$/.exec(sel)
      if (hoverM) {
        const info = out.get(hoverM[1]) ?? { decls: new Map(), hoverDecls: new Map() }
        for (const d of rule.decls) info.hoverDecls.set(d.prop, { value: d.value, line: rule.line })
        out.set(hoverM[1], info)
        continue
      }
      const clsM = /^\.([\w-]+)$/.exec(sel)
      if (clsM) {
        const info = out.get(clsM[1]) ?? { decls: new Map(), hoverDecls: new Map() }
        for (const d of rule.decls) info.decls.set(d.prop, { value: d.value, line: rule.line })
        out.set(clsM[1], info)
        continue
      }
      if (/^(div|img|button|text|span|input|textarea|progress)$/.test(sel)) {
        const info = out.get(`@${sel}`) ?? { decls: new Map(), hoverDecls: new Map() }
        for (const d of rule.decls) info.decls.set(d.prop, { value: d.value, line: rule.line })
        out.set(`@${sel}`, info)
        continue
      }
      throw new CompileFail(`不支持的选择器 "${sel}"`, rule.line)
    }
    return out
  }

  function styleOf(el) {
    const cls = el.attrs['class']?.split(/\s+/)[0]
    if (cls && styles.has(cls)) return styles.get(cls)
    if (styles.has(`@${el.tag}`)) return styles.get(`@${el.tag}`)
    return { decls: new Map(), hoverDecls: new Map() }
  }

  function compileNode(el, parent) {
    const style = styleOf(el)
    const cls = el.attrs['class']?.split(/\s+/)[0]
    const nodeName = el.attrs['data-name'] ?? el.attrs['name'] ?? cls ?? `${el.tag}_${nextNodeId()}`
    const node = { name: nodeName, baseClass: 'Actor', id: nextNodeId(), components: [], children: [] }

    const tfProps = buildTransformProps(el, style)
    node.components.push({ baseClass: 'UITransformComponent', properties: tfProps })
    const markerProps = { markerOnly: true, name: 'UIMarker', zOrder: 0 }
    const z = style.decls.get('z-order')
    if (z) markerProps.zOrder = parseZOrder(z.value, z.line)
    node.components.push({ baseClass: 'CanvasUIComponent', properties: markerProps })

    const display = style.decls.get('display')?.value
    const flexDirection = style.decls.get('flex-direction')?.value
    if (display === 'flex') {
      if (flexDirection && flexDirection !== 'row' && flexDirection !== 'column') {
        throw new CompileFail(`flex-direction: ${flexDirection} 不受支持（仅 row / column）`, style.decls.get('flex-direction').line)
      }
      const layoutProps = { mode: flexDirection === 'column' ? 'vertical' : 'horizontal', spacingX: 0, spacingY: 0, autoLayout: true }
      const gap = style.decls.get('gap')
      if (gap) {
        const g = pxToWorldX(parsePx(gap.value, 'gap', gap.line))
        layoutProps.spacingX = g
        layoutProps.spacingY = g
      }
      const jc = style.decls.get('justify-content')
      if (jc) layoutProps.justify = mapEnum(JUSTIFY_MAP, jc.value, 'justify-content', jc.line)
      const ai = style.decls.get('align-items')
      if (ai) layoutProps.align = mapEnum(ALIGN_MAP, ai.value, 'align-items', ai.line)
      node.components.push({ baseClass: 'UILayoutComponent', properties: layoutProps })
    }

    // overflow: auto（任意元素）→ UIScrollListComponent（overflow-x: auto → horizontal）。
    // 在标签分支与 data-comp 之前执行：后者按 baseClass 合并，不重复挂载
    compileOverflow(el, style, node)

    if (el.tag === 'img') {
      compileImage(el, style, node)
    } else if (el.tag === 'button') {
      compileButton(el, style, node)
    } else if (el.tag === 'text') {
      const ownText = el.children.find((c) => c.tag === '#text')
      compileTextProps(el, style, ownText?.text ?? '', node)
    } else if (el.tag === 'input' || el.tag === 'textarea') {
      compileInput(el, style, node)
    } else if (el.tag === 'progress') {
      compileProgress(el, node)
    } else {
      // div：背景视觉声明（background/border-radius/opacity）→ UIImageComponent（反编译 div 降级的对称通道）
      const tsfBg = node.components[0].properties
      const bgProps = collectImageProps(el, style, tsfBg, nodeName)
      if (bgProps) node.components.push({ baseClass: 'UIImageComponent', properties: bgProps })
      const textChild = el.children.find((c) => c.tag === '#text')
      if (textChild) compileChildText(el, style, textChild.text, node)
      else if (el.attrs['data-comp']) compileDataComp(el, node)
    }

    const script = el.attrs['data-script']
    if (script) {
      const scriptProps = { script }
      if (el.attrs['data-args']) {
        try {
          scriptProps.args = JSON.parse(el.attrs['data-args'])
        } catch {
          throw new CompileFail(`data-args 不是合法 JSON`, el.line)
        }
      }
      node.components.push({ baseClass: 'UIScriptComponent', properties: scriptProps })
    }
    if (el.attrs['data-comp'] && el.tag !== 'div') {
      const compName = el.attrs['data-comp']
      const baseClass = compName.endsWith('Component') ? compName : `${compName}Component`
      if (!['UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent', 'UITooltipComponent'].includes(baseClass)) {
        compileDataComp(el, node)
      }
    }

    // title 属性 → UITooltipComponent（任意元素可挂，与 data-script 同级通用）
    if (el.attrs['title']) {
      node.components.push({ baseClass: 'UITooltipComponent', properties: { text: el.attrs['title'] } })
    }

    for (const c of el.children) {
      if (c.tag === '#text') continue
      compileNode(c, node)
    }
    parent.children.push(node)
  }

  function buildTransformProps(el, style) {
    const props = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const w = style.decls.get('width')
    const h = style.decls.get('height')
    if (w) props.worldWidth = pxToWorldX(parsePx(w.value, 'width', w.line))
    if (h) props.worldHeight = pxToWorldY(parsePx(h.value, 'height', h.line))

    const position = style.decls.get('position')
    if (position && position.value !== 'absolute') {
      throw new CompileFail(`position: ${position.value} 不受支持（仅 absolute）`, position.line)
    }
    const left = style.decls.get('left')
    const top = style.decls.get('top')
    if (position?.value === 'absolute' || left || top) {
      const lPct = left ? parsePos(left.value, 'left', left.line) : 50
      const tPct = top ? parsePos(top.value, 'top', top.line) : 50
      const anchor = anchorOf(lPct, tPct)
      props.anchor = anchor
      const wW = props.worldWidth ?? 0
      const wH = props.worldHeight ?? 0
      const wantX = ((lPct - 50) / 100) * worldWidthM
      const wantY = ((50 - tPct) / 100) * worldHeightM
      const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
      const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
      const baseX = fx * (worldWidthM / 2 - wW / 2)
      const baseY = fy * (worldHeightM / 2 - wH / 2)
      props.anchorOffset = [round4(wantX - baseX), round4(wantY - baseY)]
    }
    return props
  }

  function parsePos(value, prop, line) {
    if (value.endsWith('%')) return parsePct(value, prop, line)
    const base = prop === 'top' ? canvasHeight : canvasWidth
    return (parsePx(value, prop, line) / base) * 100
  }

  function parsePct(value, prop, line) {
    const m = /^(-?[\d.]+)%$/.exec(value)
    if (!m) throw new CompileFail(`属性 "${prop}: ${value}" 仅支持 % 单位`, line)
    return parseFloat(m[1])
  }

  function parsePx(value, prop, line) {
    const m = /^(-?[\d.]+)px$/.exec(value)
    if (!m) throw new CompileFail(`属性 "${prop}: ${value}" 仅支持 px 单位`, line)
    const v = parseFloat(m[1])
    if (!Number.isFinite(v)) throw new CompileFail(`属性 "${prop}: ${value}" 数值非法`, line)
    return v
  }

  function parseZOrder(value, line) {
    const v = parseInt(value, 10)
    if (!Number.isFinite(v) || String(v) !== value.trim()) {
      throw new CompileFail(`z-order 取值 "${value}" 必须是整数`, line)
    }
    return v
  }

  function mapEnum(map, value, prop, line) {
    const v = map[value]
    if (v === undefined) {
      throw new CompileFail(`属性 "${prop}: ${value}" 不在支持范围`, line)
    }
    return v
  }

  function anchorOf(lPct, tPct) {
    const ax = lPct === 50 ? 'center' : lPct < 50 ? 'left' : 'right'
    const ay = tPct === 50 ? 'middle' : tPct < 50 ? 'top' : 'bottom'
    if (ax === 'center' && ay === 'middle') return 'center'
    return `${ay}-${ax}`
  }

  // ─── input/textarea → UITextInputComponent（引擎单行输入控件；textarea 为 input 别名）───
  function compileInput(el, style, node) {
    const tsf = node.components[0].properties
    const worldW = tsf.worldWidth ?? 1
    const worldH = tsf.worldHeight ?? 1
    const props = {}
    if (el.attrs['placeholder']) props.placeholder = el.attrs['placeholder']
    if (el.attrs['value']) props.value = el.attrs['value']
    const fontSize = style.decls.get('font-size')
    if (fontSize) {
      const v = parsePx(fontSize.value, 'font-size', fontSize.line)
      if (v < 4 || v > 400) throw new CompileFail(`font-size: ${fontSize.value} 必须 ∈ [4,400]px`, fontSize.line)
      props.fontSize = Math.round(v)
    }
    const color = style.decls.get('color')
    if (color) {
      if (!COLOR_RE.test(color.value)) throw new CompileFail(`color "${color.value}" 不是合法颜色值`, color.line)
      props.color = color.value
    }
    const z = style.decls.get('z-order')
    if (z) props.zOrder = parseZOrder(z.value, z.line)
    const hit = style.decls.get('hit-test')
    if (hit) props.hitTest = hitTestOf(hit.value, hit.line)
    props.width = Math.max(8, Math.round(worldW * worldToPxX(1)))
    props.height = Math.max(8, Math.round(worldH * worldToPxY(1)))
    node.components.push({ baseClass: 'UITextInputComponent', properties: props })
  }

  // ─── progress → UIProgressBarComponent（value/max 原生属性；fill 子 Actor 由源内子元素承载）───
  function compileProgress(el, node) {
    const props = {}
    if (el.attrs['value']) {
      const v = parseFloat(el.attrs['value'])
      if (!Number.isFinite(v)) throw new CompileFail(`progress value "${el.attrs['value']}" 必须是数字`, el.line)
      props.value = v
    }
    if (el.attrs['max']) {
      const v = parseFloat(el.attrs['max'])
      if (!Number.isFinite(v) || v <= 0) throw new CompileFail(`progress max "${el.attrs['max']}" 必须是正数`, el.line)
      props.max = v
    }
    node.components.push({ baseClass: 'UIProgressBarComponent', properties: props })
  }

  // ─── overflow: auto/scroll → UIScrollListComponent（overflow-x: auto → horizontal；hidden/visible 报错）───
  function compileOverflow(el, style, node) {
    for (const prop of ['overflow', 'overflow-x', 'overflow-y']) {
      const d = style.decls.get(prop)
      if (!d) continue
      if (d.value !== 'auto' && d.value !== 'scroll') {
        throw new CompileFail(
          `${prop}: ${d.value} 不受支持（仅 auto / scroll 映射滚动列表；hidden/visible/clip 不做）`,
          d.line,
        )
      }
      if (node.components.some((c) => c.baseClass === 'UIScrollListComponent')) continue
      node.components.push({
        baseClass: 'UIScrollListComponent',
        properties: { direction: prop === 'overflow-x' ? 'horizontal' : 'vertical' },
      })
    }
  }

  function compileImage(el, style, node) {
    const tsf = node.components[0].properties
    const props = collectImageProps(el, style, tsf, String(node.name))
    node.components.push({ baseClass: 'UIImageComponent', properties: props }) // img 为 void 叶子，始终产出
  }

  function compileButton(el, style, node) {
    node.components.push({ baseClass: 'UIButtonComponent', properties: {} })
    const tsf = node.components[0].properties
    const bgProps = collectImageProps(el, style, tsf, String(node.name))
    if (bgProps) {
      node.components.push({ baseClass: 'UIImageComponent', properties: bgProps })
    }
    const textChild = el.children.find((c) => c.tag === '#text')
    if (textChild) compileChildText(el, style, textChild.text, node)
  }

  // ─── 共用：图像属性收集（img / div 背景面板 / button 背景）───
  function collectImageProps(el, style, tsf, nodeName) {
    const props = {}
    const src = el.attrs['src'] ?? style.decls.get('background-image')?.value
    if (src) props.src = src
    const bg = style.decls.get('background')?.value ?? style.decls.get('background-color')?.value
    if (bg && !src) props.color = bg
    const radius = style.decls.get('border-radius')
    if (radius) props.radius = parsePx(radius.value, 'border-radius', radius.line) // 画布像素直通
    const opacity = style.decls.get('opacity')
    if (opacity) {
      const v = parseFloat(opacity.value)
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new CompileFail(`opacity 必须 ∈ [0,1]`, opacity.line)
      props.opacity = v
    }
    const z = style.decls.get('z-order')
    if (z) props.zOrder = parseZOrder(z.value, z.line)
    const hit = style.decls.get('hit-test')
    if (hit) props.hitTest = hitTestOf(hit.value, hit.line)
    const hasVisual = Boolean(src || bg || radius || opacity)
    if (!hasVisual && el.tag !== 'img') return null
    props.width = Math.max(8, Math.round((tsf.worldWidth ?? 1) * worldToPxX(1)))
    props.height = Math.max(8, Math.round((tsf.worldHeight ?? 1) * worldToPxY(1)))
    props.name = nodeName
    return props
  }

  function compileTextProps(el, style, text, node) {
    const tsf = node.components[0].properties
    const worldW = tsf.worldWidth ?? 1
    const worldH = tsf.worldHeight ?? 1
    const props = collectTextProps(style, text, node.name, worldW, worldH)
    node.components.push({ baseClass: 'UITextComponent', properties: props })
  }

  function compileChildText(el, style, text, node) {
    const tsf = node.components[0].properties
    const worldW = tsf.worldWidth ?? 1
    const worldH = tsf.worldHeight ?? 1
    // 子文本节点名与父节点去重（assetLint 同资产 name 唯一），首个重名加 Text 后缀
    const baseName = String(node.name)
    const used = new Set([baseName])
    for (const c of node.children ?? []) if (c.name) used.add(c.name)
    let textName = baseName
    if (used.has(textName)) {
      let i = 1
      while (used.has(`${baseName}Text${i > 1 ? i : ''}`)) i++
      textName = `${baseName}Text${i > 1 ? i : ''}`
    }
    const props = collectTextProps(style, text, textName, worldW, worldH)
    node.children.push({
      name: textName,
      baseClass: 'Actor',
      id: nextNodeId(),
      components: [
        {
          baseClass: 'UITransformComponent',
          properties: {
            position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            anchor: 'center', anchorOffset: [0, 0],
            worldWidth: worldW, worldHeight: worldH,
          },
        },
        { baseClass: 'CanvasUIComponent', properties: { markerOnly: true, name: 'UIMarker', zOrder: 0 } },
        { baseClass: 'UITextComponent', properties: props },
      ],
      children: [],
    })
  }

  function collectTextProps(style, text, name, worldW, worldH) {
    const props = { text }
    const fontSize = style.decls.get('font-size')
    if (fontSize) {
      const v = parsePx(fontSize.value, 'font-size', fontSize.line)
      if (v < 4 || v > 400) throw new CompileFail(`font-size 必须 ∈ [4,400]px`, fontSize.line)
      props.fontSize = Math.round(v)
    }
    const color = style.decls.get('color')
    if (color) {
      if (!COLOR_RE.test(color.value)) throw new CompileFail(`color "${color.value}" 不是合法颜色值`, color.line)
      props.color = color.value
    }
    const ta = style.decls.get('text-align')
    if (ta) props.align = mapEnum(TEXT_ALIGN_MAP, ta.value, 'text-align', ta.line)
    const ff = style.decls.get('font-family')
    if (ff) props.fontFamily = ff.value
    const fw = style.decls.get('font-weight')
    if (fw) props.bold = fw.value === 'bold' || fw.value === '700'
    const fs = style.decls.get('font-style')
    if (fs) props.italic = fs.value === 'italic'
    const lh = style.decls.get('line-height')
    if (lh) {
      const m = /^([\d.]+)$/.exec(lh.value)
      if (!m) throw new CompileFail(`line-height 仅支持无单位倍数`, lh.line)
      props.lineHeight = parseFloat(m[1])
    }
    const ls = style.decls.get('letter-spacing')
    if (ls) props.letterSpacing = parsePx(ls.value, 'letter-spacing', ls.line)
    const sc = style.decls.get('text-shadow-color')
    if (sc) props.shadowColor = sc.value
    const sb = style.decls.get('text-shadow-blur')
    if (sb) props.shadowBlur = parsePx(sb.value, 'text-shadow-blur', sb.line)
    const z = style.decls.get('z-order')
    if (z) props.zOrder = parseZOrder(z.value, z.line)
    const hit = style.decls.get('hit-test')
    if (hit) props.hitTest = hitTestOf(hit.value, hit.line)
    props.name = name
    props.width = Math.max(8, Math.round(worldW * worldToPxX(1)))
    props.height = Math.max(8, Math.round(worldH * worldToPxY(1)))
    return props
  }

  function compileDataComp(el, node) {
    const compName = el.attrs['data-comp']
    const baseClass = compName.endsWith('Component') ? compName : `${compName}Component`
    let props = {}
    if (el.attrs['data-props']) {
      try {
        props = JSON.parse(el.attrs['data-props'])
      } catch {
        throw new CompileFail('data-props 不是合法 JSON', el.line)
      }
    }
    const existing = node.components.find((c) => c.baseClass === baseClass)
    if (existing) {
      existing.properties = { ...existing.properties, ...props }
    } else {
      node.components.push({ baseClass, properties: props })
    }
  }

  function hitTestOf(value, line) {
    if (value === 'visible' || value === 'block' || value === 'hitTestInvisible') return value
    throw new CompileFail(`hit-test 取值 "${value}" 不在 [visible / block / hitTestInvisible]`, line)
  }
}

// ════════════════ 反编译（与 decompile.ts 同构，规范形输出）════════════════

function fmtNum(v) {
  return String(Math.round(v * 10000) / 10000)
}
function compOf(node, baseClass) {
  return node.components?.find((c) => c.baseClass === baseClass)
}
const COMMON_COMPS = new Set(['UITransformComponent', 'CanvasUIComponent'])
const ESCAPE_COMPS = new Set(['UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent', 'UITooltipComponent'])
const NATIVE_MAPPED_COMPS = new Set(['UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent', 'UITooltipComponent'])

function decompileWidgetJson(doc) {
  const warnings = []
  // 函数级闭包（内部函数可见）：根世界尺寸（anchorToPos 反解用）
  let rootWorldW = 4.8
  let rootWorldH = 2.7
  try {
    const root = doc
    if (!root || typeof root !== 'object') return { ok: false, warnings: ['文档不是对象'], html: undefined }
    if (!('sourceHash' in root)) {
      warnings.push('该 widget.json 无 sourceHash（非编译器产物或旧资产）：尽力转换，映射不到的组件走 data-comp 逃逸')
    }
    const rootTf = compOf(root, 'UITransformComponent')?.properties ?? {}
    const rootCanvas = root.components?.find((c) => c.baseClass === 'CanvasUIComponent' && !c.properties?.markerOnly)
    const canvasProps = rootCanvas?.properties ?? {}
    const cw = Number(canvasProps.width ?? FULLSCREEN_CANVAS_WIDTH)
    const chh = Number(canvasProps.height ?? FULLSCREEN_CANVAS_HEIGHT)
    const rootTfW = compOf(root, 'UITransformComponent')?.properties ?? {}
    const wWv = Number(rootTfW.worldWidth ?? 4.8)
    const wHv = Number(rootTfW.worldHeight ?? round2(4.8 * (chh / cw)))
    rootWorldW = wWv
    rootWorldH = wHv
    // 换算上下文
    worldToPxX = (m) => (m / wWv) * cw
    worldToPxY = (m) => (m / wHv) * chh
    const name = String(root.name ?? 'Widget')

    const rootAttrs = [`name="${name}"`, `canvas="${cw}x${chh}"`, `world="${fmtNum(wWv)}x${fmtNum(wHv)}"`]
    const rootAnchor = rootTf.anchor
    if (rootAnchor) {
      rootAttrs.push(`anchor="${rootAnchor}"`)
      const off = rootTf.anchorOffset
      if (off && (off[0] !== 0 || off[1] !== 0)) rootAttrs.push(`offset="${fmtNum(off[0])},${fmtNum(off[1])}"`)
    }

    const rules = []
    const bodyNodes = []
    for (const child of root.children ?? []) {
      const emitted = emitNode(child, rules, warnings, cw, chh, 1)
      if (emitted) bodyNodes.push(emitted)
    }

    const lines = []
    lines.push(`<widget ${rootAttrs.join(' ')}>`)
    lines.push('  <style>')
    for (const r of rules) lines.push(`    ${r.selector} { ${r.decls.join('; ')}; }`)
    lines.push('  </style>')
    for (const b of bodyNodes) lines.push(b.line)
    lines.push('</widget>')
    return { ok: true, warnings, html: lines.join('\n') + '\n' }
  } catch (e) {
    warnings.push(`反编译异常: ${e.message}`)
    return { ok: false, warnings, html: undefined }
  }

  function emitNode(node, rules, warnings, canvasW, canvasH, depth) {
    const name = String(node.name ?? 'Node')
    const cls = name
    const tf = compOf(node, 'UITransformComponent')?.properties ?? {}
    const canvasComp = compOf(node, 'CanvasUIComponent')
    const decls = []
    const attrs = [`class="${cls}"`]

    const ww = Number(tf.worldWidth ?? 0)
    const wh = Number(tf.worldHeight ?? 0)
    if (ww > 0) decls.push(`width: ${fmtNum(worldToPxX(ww))}px`)
    if (wh > 0) decls.push(`height: ${fmtNum(worldToPxY(wh))}px`)

    const anchor = tf.anchor
    const offset = tf.anchorOffset ?? [0, 0]
    const pos = anchorToPos(anchor, offset, canvasW, canvasH, tf)
    if (pos) {
      decls.push('position: absolute')
      decls.push(`left: ${pos.left}`)
      decls.push(`top: ${pos.top}`)
    }

    const markerOnly = Boolean(canvasComp?.properties?.markerOnly)
    const zOrder = Number(canvasComp?.properties?.zOrder ?? 0)
    if (zOrder !== 0) decls.push(`z-order: ${zOrder}`)
    const hitTest = canvasComp?.properties?.hitTest
    if (hitTest && hitTest !== 'visible') decls.push(`hit-test: ${hitTest}`)
    if (node.active === false) warnings.push(`节点 "${name}" 为 active=false（源格式暂不表达，信息保留在 json）`)

    const funcComps = (node.components ?? []).filter((c) => !COMMON_COMPS.has(c.baseClass))
    let tag = 'div'
    let text = ''
    const dataAttrs = []

    const layoutComp = funcComps.find((c) => c.baseClass === 'UILayoutComponent')
    if (layoutComp) {
      const p = layoutComp.properties ?? {}
      decls.push('display: flex')
      decls.push(`flex-direction: ${p.mode === 'vertical' ? 'column' : 'row'}`)
      const sx = Number(p.spacingX ?? 0)
      const sy = Number(p.spacingY ?? 0)
      if (sx > 0 || sy > 0) decls.push(`gap: ${fmtNum(worldToPxX(Math.max(sx, sy)))}px`)
      if (p.justify && p.justify !== 'center') decls.push(`justify-content: ${String(p.justify)}`)
      if (p.align && p.align !== 'center') decls.push(`align-items: ${String(p.align)}`)
    }

    const scriptComp = funcComps.find((c) => c.baseClass === 'UIScriptComponent')
    if (scriptComp) {
      const p = scriptComp.properties ?? {}
      if (p.script) dataAttrs.push(`data-script="${String(p.script)}"`)
      if (p.args) dataAttrs.push(`data-args='${JSON.stringify(p.args)}'`)
    }

    const imgComp = funcComps.find((c) => c.baseClass === 'UIImageComponent')
    const textComp = funcComps.find((c) => c.baseClass === 'UITextComponent')
    const btnComp = funcComps.find((c) => c.baseClass === 'UIButtonComponent')

    if (imgComp) {
      tag = 'img'
      const p = imgComp.properties ?? {}
      if (p.src) attrs.push(`src="${String(p.src)}"`)
      else if (p.color) decls.push(`background-color: ${String(p.color)}`)
      if (p.radius) decls.push(`border-radius: ${Math.round(Number(p.radius))}px`) // 画布像素直通
      if (p.opacity !== undefined && Number(p.opacity) !== 1) decls.push(`opacity: ${fmtNum(Number(p.opacity))}`)
      if (p.zOrder !== undefined && Number(p.zOrder) !== 0) decls.push(`z-order: ${Number(p.zOrder)}`)
      if (p.hitTest && p.hitTest !== 'visible') decls.push(`hit-test: ${String(p.hitTest)}`)
      if ((node.children ?? []).length > 0 || textComp) tag = 'div'
    }
    if (btnComp) {
      tag = 'button'
      attrs.push(`data-name="${name}"`)
    }

    // ─── 原生标签还原：input/textarea/progress / overflow:auto / title ───
    const inputComp = funcComps.find((c) => c.baseClass === 'UITextInputComponent')
    const progressComp = funcComps.find((c) => c.baseClass === 'UIProgressBarComponent')
    const scrollComp = funcComps.find((c) => c.baseClass === 'UIScrollListComponent')
    const tooltipComp = funcComps.find((c) => c.baseClass === 'UITooltipComponent')

    if (inputComp) {
      tag = 'input'
      const p = inputComp.properties ?? {}
      if (p.placeholder) attrs.push(`placeholder="${String(p.placeholder)}"`)
      if (p.value) attrs.push(`value="${String(p.value)}"`)
      if (p.fontSize !== undefined) decls.push(`font-size: ${Math.round(Number(p.fontSize))}px`)
      if (p.color) decls.push(`color: ${String(p.color)}`)
      if (p.zOrder !== undefined && Number(p.zOrder) !== 0 && zOrder === 0) decls.push(`z-order: ${Number(p.zOrder)}`)
      if (p.hitTest && p.hitTest !== 'visible' && !hitTest) decls.push(`hit-test: ${String(p.hitTest)}`)
    }

    if (progressComp) {
      tag = 'progress'
      const p = progressComp.properties ?? {}
      if (p.value !== undefined) attrs.push(`value="${String(p.value)}"`)
      if (p.max !== undefined) attrs.push(`max="${String(p.max)}"`)
      const extras = {}
      if (p.min !== undefined && Number(p.min) !== 0) extras.min = p.min
      if (p.fillActorName !== undefined && p.fillActorName !== 'Fill') extras.fillActorName = p.fillActorName
      if (p.direction !== undefined && p.direction !== 'left-to-right') extras.direction = p.direction
      if (Object.keys(extras).length > 0) dataAttrs.push(`data-comp="UIProgress" data-props='${JSON.stringify(extras)}'`)
    }

    if (scrollComp) {
      const p = scrollComp.properties ?? {}
      decls.push(p.direction === 'horizontal' ? 'overflow-x: auto' : 'overflow: auto')
      const extras = { ...p }
      delete extras.direction
      if (Object.keys(extras).length > 0) dataAttrs.push(`data-comp="UIScrollList" data-props='${JSON.stringify(extras)}'`)
    }

    if (tooltipComp) {
      const p = tooltipComp.properties ?? {}
      attrs.push(`title="${String(p.text ?? '')}"`)
      const extras = {}
      if (p.delay !== undefined && Number(p.delay) !== 0.3) extras.delay = p.delay
      if (p.direction !== undefined && p.direction !== 'top') extras.direction = p.direction
      if (p.widgetPath !== undefined) extras.widgetPath = p.widgetPath
      if (Object.keys(extras).length > 0) dataAttrs.push(`data-comp="UITooltip" data-props='${JSON.stringify(extras)}'`)
    }

    for (const c of funcComps) {
      if (!ESCAPE_COMPS.has(c.baseClass)) continue
      if (NATIVE_MAPPED_COMPS.has(c.baseClass)) continue
      const short = c.baseClass.replace(/Component$/, '')
      dataAttrs.push(`data-comp="${short}" data-props='${JSON.stringify(c.properties ?? {})}'`)
      warnings.push(`节点 "${name}" 组件 ${c.baseClass} 无源格式映射：以 data-comp 逃逸承载`)
    }

    if (textComp) {
      const p = textComp.properties ?? {}
      text = String(p.text ?? '')
      if (p.fontSize !== undefined) decls.push(`font-size: ${Math.round(Number(p.fontSize))}px`)
      if (p.color) decls.push(`color: ${String(p.color)}`)
      if (p.align && p.align !== 'left') decls.push(`text-align: ${String(p.align)}`)
      if (p.bold) decls.push('font-weight: bold')
      if (p.italic) decls.push('font-style: italic')
      if (p.lineHeight !== undefined && Number(p.lineHeight) !== 1.4) decls.push(`line-height: ${fmtNum(Number(p.lineHeight))}`)
      if (p.letterSpacing) decls.push(`letter-spacing: ${Math.round(Number(p.letterSpacing))}px`) // 画布像素直通
      if (p.fontFamily) decls.push(`font-family: ${String(p.fontFamily)}`)
      if (p.shadowColor) decls.push(`text-shadow-color: ${String(p.shadowColor)}`)
      if (p.shadowBlur !== undefined && Number(p.shadowBlur) !== 4) decls.push(`text-shadow-blur: ${Math.round(Number(p.shadowBlur))}px`) // 画布像素直通
      if (p.zOrder !== undefined && Number(p.zOrder) !== 0 && zOrder === 0) decls.push(`z-order: ${Number(p.zOrder)}`)
      tag = 'text'
    }

    if (decls.length > 0) rules.push({ selector: `.${cls}`, decls })
    for (const d of dataAttrs) attrs.push(d)

    const childLines = []
    for (const c of node.children ?? []) {
      const emitted = emitNode(c, rules, warnings, canvasW, canvasH, depth + 1)
      if (emitted) childLines.push(emitted.line)
    }

    const pad = '  '.repeat(depth)
    if (tag === 'img' || tag === 'input') {
      return { line: `${pad}<${tag} ${attrs.join(' ')} />`, depth }
    }
    const openTag = [`<${tag}`, ...attrs].join(' ')
    if (childLines.length === 0 && !text) {
      return { line: `${pad}${openTag}></${tag}>`, depth }
    }
    if (childLines.length === 0) {
      return { line: `${pad}${openTag}>${text}</${tag}>`, depth }
    }
    const inner = [text, ...childLines].filter(Boolean).join(`\n${pad}`)
    return { line: `${pad}${openTag}>\n${inner}\n${pad}</${tag}>`, depth }
  }

  function anchorToPos(a, off, canvasW, canvasH, tf) {
    if (!a) return null
    let lPct = 50
    let tPct = 50
    if (a.includes('left')) lPct = 0
    else if (a.includes('right')) lPct = 100
    if (a.startsWith('top')) tPct = 0
    else if (a.startsWith('bottom')) tPct = 100
    const wW = Number(tf.worldWidth ?? 0)
    const wH = Number(tf.worldHeight ?? 0)
    const fx = a.includes('left') ? -1 : a.includes('right') ? 1 : 0
    const fy = a.startsWith('top') ? 1 : a.startsWith('bottom') ? -1 : 0
    // 反解编译端：wantX = baseX + offX（米）→ lp = 50 + wantX/worldWidth×100
    const wantXm = fx * (rootWorldW / 2 - wW / 2) + (off?.[0] ?? 0)
    const wantYm = fy * (rootWorldH / 2 - wH / 2) + (off?.[1] ?? 0)
    const lp = 50 + (wantXm / rootWorldW) * 100
    const tp = 50 - (wantYm / rootWorldH) * 100
    return { left: `${fmtNum(lp)}%`, top: `${fmtNum(tp)}%` }
  }
}

// ════════════════ 编辑器 assetLint 自动执行（compile 成功后） ════════════════
// 经编辑器 MCP HTTP API（:9877+ 多实例自动探测）调 run_asset_lint，
// 过滤本资产的违规：error 档阻断（exit 4），warn 档透传；编辑器未运行则降级跳过。

const LINT_PROBE_TIMEOUT_MS = 800
const LINT_SCAN_TIMEOUT_MS = 30000
/** 探测的起始端口（与 mcp-server.mjs 的缺省端口一致；多实例自动递增） */
const LINT_PORT_BASE = 9877
/** 最多探测的实例数 */
const LINT_PORT_SPAN = 10

async function fetchJson(url, { method = 'GET', body, timeoutMs }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 探测一个可用的编辑器实例端口（/api/status 应答 status=running 即认领）；无则返回 null。 */
async function findEditorPort() {
  for (let i = 0; i < LINT_PORT_SPAN; i++) {
    const port = LINT_PORT_BASE + i
    try {
      const status = await fetchJson(`http://127.0.0.1:${port}/api/status`, { timeoutMs: LINT_PROBE_TIMEOUT_MS })
      if (status?.status === 'running') return port
    } catch { /* 端口未监听或非编辑器：探测下一个 */ }
  }
  return null
}

/** 从 widget.json 路径推导工程 folder（src/projects/<folder>/...）与资产相对路径。 */
function parseWidgetPath(outPath) {
  const norm = outPath.replaceAll('\\', '/')
  const m = /src\/projects\/([^/]+)\/(.+\.widget\.json)$/i.exec(norm)
  if (!m) return { folder: null, assetRel: norm }
  return { folder: m[1], assetRel: `src/projects/${m[1]}/${m[2]}` }
}

/**
 * 编译成功后自动执行 assetLint。
 * 返回 0（无本资产 error）或 4（本资产存在 error 档违规）；编辑器不可用时返回 0（降级跳过）。
 */
async function runEditorAssetLint(outPath) {
  const port = await findEditorPort()
  if (port === null) {
    console.log('ℹ 未探测到运行中的编辑器实例（:9877+），跳过 assetLint 自动检查（由编辑器内 ui_compile/MCP 兜底）')
    return 0
  }
  const { folder, assetRel } = parseWidgetPath(outPath)
  const projectParam = folder ?? undefined
  console.log(`lint: 经编辑器实例 :${port} 执行 assetLint${projectParam ? `（project=${projectParam}）` : ''}...`)
  let result
  try {
    result = await fetchJson(`http://127.0.0.1:${port}/api/command`, {
      method: 'POST',
      body: { command: 'run_asset_lint', params: projectParam ? { project: projectParam } : {} },
      timeoutMs: LINT_SCAN_TIMEOUT_MS,
    })
  } catch (err) {
    console.warn(`⚠ assetLint 调用失败（${err.message}）：跳过（由编辑器内 ui_compile/MCP 兜底）`)
    return 0
  }
  if (result?.status === 'error') {
    console.warn(`⚠ assetLint 返回错误（${result.message ?? '未知'}）：跳过（由编辑器内 ui_compile/MCP 兜底）`)
    return 0
  }
  const issues = Array.isArray(result?.issues) ? result.issues : []
  // 只看本资产的违规（run_asset_lint 是工程级全量扫描）
  const mine = issues.filter((i) => String(i.file ?? '').replaceAll('\\', '/') === assetRel)
  const mineErrors = mine.filter((i) => i.severity === 'error')
  const mineWarns = mine.filter((i) => i.severity === 'warn')
  if (mine.length === 0) {
    console.log(`✅ assetLint 通过: ${assetRel} 零违规（工程共 ${result.total ?? issues.length} 个问题，均非本资产）`)
    return 0
  }
  for (const i of mine) {
    const mark = i.severity === 'error' ? '❌' : '⚠'
    console.error(`  ${mark} [${i.rule}] ${i.nodePath} > ${i.field}: ${i.message}`)
  }
  if (mineErrors.length > 0) {
    console.error(`❌ assetLint 零错误门槛未过: ${assetRel}（error ${mineErrors.length} / warn ${mineWarns.length}）`)
    return 4
  }
  console.warn(`⚠ assetLint 本资产 ${mine.length} 个 warn（不阻断）: ${assetRel}`)
  return 0
}

// ════════════════ CLI 分发 ════════════════

if (cmd === 'compile') {
  const source = fs.readFileSync(inputPath, 'utf-8')
  const result = compileWidgetHtml(source)
  if (!result.ok) {
    console.error('编译失败:')
    for (const err of result.errors) console.error(`  行 ${err.line}: ${err.message}`)
    process.exit(3)
  }
  const outPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : inputPath.replace(/\.widget\.html$/i, '.widget.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(result.doc, null, 2) + '\n', 'utf-8')
  console.log(`✅ 编译成功: ${outPath}（sourceHash=${result.doc.sourceHash}）`)
  // assetLint 零错误门槛（编辑器运行时自动执行；error 档 exitCode=4）。
  // 注意：用 exitCode + 自然退出，勿在此处 process.exit()——Windows Node 下
  // fetch(undici) 句柄清理中强退会触发 libuv 断言崩溃（uv_handle_closing）
  runEditorAssetLint(outPath).then((code) => { process.exitCode = code })
} else if (cmd === 'decompile') {
  const raw = fs.readFileSync(inputPath, 'utf-8')
  const doc = JSON.parse(raw.replace(/^\uFEFF/, ''))
  const result = decompileWidgetJson(doc)
  if (!result.ok) {
    console.error('反编译失败:')
    for (const w of result.warnings) console.error(`  ${w}`)
    process.exit(5)
  }
  const outPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : inputPath.replace(/\.widget\.json$/i, '.widget.html')
  fs.writeFileSync(outPath, result.html, 'utf-8')
  console.log(`✅ 反编译成功: ${outPath}`)
  for (const w of result.warnings) console.log(`  ⚠ ${w}`)
} else {
  usage()
  process.exit(1)
}
