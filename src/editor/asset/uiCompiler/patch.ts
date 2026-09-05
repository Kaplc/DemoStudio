/**
 * patch — UI 源「原地数值补丁」：widget 手动保存回写时只改动真实变化的值，
 * 保留用户排版（注释/换行/缩进/属性顺序），替代整篇反编译重写（decompile.ts）。
 *
 * 前提（产品约定）：widget 资产的人工编辑只有「属性值修改」（大纲已移除创建/复制/
 * 删除节点入口，结构性改动一律走 AI 改 HTML 源 → ui_compile 全量重编译）。
 *
 * 流程（编译差分 → 源码定位 → 原地替换 → 重编译验证）：
 *  1. 编译现有源得 oldDoc，与保存的 newDoc 按「子树索引」配对做属性级差分
 *     （人工编辑不增删节点，索引即身份；名字不同的配对 = 改名 → class 属性直写）
 *  2. 每处差分定位到源 span 后原地替换：
 *     - data-comp 系组件 → data-props 属性 JSON（保持原键序逐键合并）
 *     - 布局类（position/尺寸）→ CSS left/top/width/height 声明增量换算：
 *       绝对定位下 pos.x = left + w/2 - 父中心 ⇒ dLeft = dPosX - dWorldWidth/2；
 *       pos.y 经 wy(-dy) 翻转 ⇒ dTop = -dPosY - dWorldHeight/2
 *     - 样式标量（color/font-size/z-index/border-radius/hit-test...）→ 声明值直写
 *     - 根 canvas/anchor/offset、data-script/data-args、<text> 内容 → 直写
 *     无法定位/不支持的差分 → 整体放弃（ok:false）
 *  3. 补丁后重编译，与 newDoc 严格语义对比（忽略 id/sourceHash，数值容差 1e-6）
 *     验证失败同样回退——调用方（uiSourceSync.decompileBackOnSave）回退整篇反编译重写。
 *
 * 定位依赖 miniParser 的源偏移（注释按等长空格剥离，偏移与原始源一致）。
 */
import { compileWidgetHtml } from './compile'
import { decodeEntities, tokenizeHtml, type HtmlNode } from './miniParser'

/** 补丁结果；ok=false 时调用方应回退整篇反编译（html 原样返回） */
export interface PatchResult {
  ok: boolean
  html: string
  /** 人类可读的补丁动作列表（日志用） */
  edits: string[]
  /** ok=false 时的回退原因 */
  reason?: string
}

/** 不可原地解决 → 回退整篇反编译 */
class PatchBail extends Error {}

interface Edit {
  start: number
  end: number
  text: string
  desc: string
}

type DocNode = Record<string, unknown>
type DocComp = { baseClass: string; properties: Record<string, unknown> }

/** 以 data-props JSON 承载的组件（值变化 → data-props 属性整体合并重写） */
const DATA_COMP_FAMILY = new Set([
  'UIWorldAnchorComponent', 'UILayoutComponent', 'UIScrollListComponent', 'UIScrollContainerComponent',
  'UITooltipComponent', 'UIProgressComponent', 'UITextInputComponent', 'UIProgressBarComponent',
])
/** 有专用源映射的组件；其余组件（UIButton/UIImage 子状态等）出现差分一律回退 */
const MAPPED_COMPS = new Set([
  'UITransformComponent', 'CanvasUIComponent', 'UITextComponent', 'UIImageComponent',
  'UIScriptComponent', ...DATA_COMP_FAMILY,
])

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** 语义深比较：忽略 id/sourceHash，数值容差 1e-6，键序不敏感 */
function docEquals(a: unknown, b: unknown): boolean {
  return firstMismatch(a, b) === null
}

/** 首个语义不一致点的路径（诊断用；一致返回 null） */
function firstMismatch(a: unknown, b: unknown, path = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6 ? null : path
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return path
    for (let i = 0; i < a.length; i++) {
      const m = firstMismatch(a[i], b[i], `${path}[${i}]`)
      if (m !== null) return m
    }
    return null
  }
  if (!isObj(a) || !isObj(b)) return a === b ? null : path
  const ka = Object.keys(a).filter((k) => k !== 'id' && k !== 'sourceHash').sort()
  const kb = Object.keys(b).filter((k) => k !== 'id' && k !== 'sourceHash').sort()
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${path}{keys}`
  for (const k of ka) {
    const m = firstMismatch(a[k], b[k], path ? `${path}.${k}` : k)
    if (m !== null) return m
  }
  return null
}

function childrenOf(n: DocNode): DocNode[] {
  return (n.children as DocNode[] | undefined) ?? []
}
function compsOf(n: DocNode): DocComp[] {
  return (n.components as DocComp[] | undefined) ?? []
}

/** 收集叶子级差分路径（如 position.0 / text / pxPerMeter） */
function leafDiffs(oldP: Record<string, unknown>, newP: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  const keys = new Set([...Object.keys(oldP), ...Object.keys(newP)])
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k
    const a = oldP[k]
    const b = newP[k]
    if (isObj(a) && isObj(b)) out.push(...leafDiffs(a, b, path))
    else if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.every((v, i) => docEquals(v, b[i]))) out.push(path)
    } else if (!docEquals(a, b)) out.push(path)
  }
  return out
}

// ─── 源码定位辅助 ───

interface DeclSpan {
  start: number
  end: number
  value: string
}

/** class 名 → (css 属性 → 声明值 span)。只收单类选择器（.A / .A, .B），伪类/@规则不收 */
function collectStyleDecls(clean: string, widgetEl: HtmlNode): Map<string, Map<string, DeclSpan>> {
  const map = new Map<string, Map<string, DeclSpan>>()
  const visit = (el: HtmlNode): void => {
    if (el.tag === 'style' && el.rawStart !== undefined && el.rawEnd !== undefined) {
      const raw = clean.slice(el.rawStart, el.rawEnd)
      let i = 0
      while (i < raw.length) {
        while (i < raw.length && /\s/.test(raw[i])) i++
        if (i >= raw.length) break
        const brace = raw.indexOf('{', i)
        if (brace === -1) break
        const selector = raw.slice(i, brace).trim()
        let blockEnd = raw.indexOf('}', brace)
        if (blockEnd === -1) blockEnd = raw.length
        if (!selector.startsWith('@') && !selector.includes(':')) {
          const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1])
          if (classes.length > 0) {
            const block = raw.slice(brace + 1, blockEnd)
            let j = 0
            while (j < block.length) {
              const colon = block.indexOf(':', j)
              if (colon === -1) break
              let semi = block.indexOf(';', colon)
              if (semi === -1) semi = block.length
              const prop = block.slice(j, colon).trim().toLowerCase()
              const rawVal = block.slice(colon + 1, semi)
              const lead = rawVal.length - rawVal.trimStart().length
              const value = rawVal.trim()
              if (prop) {
                // span 只覆盖去掉首尾空白后的值文本：替换时保留 `prop: ` 与 `;` 前的原排版
                const absStart = el.rawStart! + brace + 1 + colon + 1 + lead
                const absEnd = absStart + value.length
                for (const c of classes) {
                  if (!map.has(c)) map.set(c, new Map())
                  map.get(c)!.set(prop, { start: absStart, end: absEnd, value })
                }
              }
              j = semi + 1
            }
          }
        }
        i = blockEnd + 1
      }
    }
    for (const c of el.children) visit(c)
  }
  visit(widgetEl)
  return map
}

function classesOfEl(el: HtmlNode): string[] {
  return (el.attrs['class'] ?? '').trim().split(/\s+/).filter(Boolean)
}

/** 元素的某 css 属性声明 span：命中 0 或 >1 处（多类冲突）都视为不可定位 */
function findDecl(styleMap: Map<string, Map<string, DeclSpan>>, el: HtmlNode, prop: string): DeclSpan | null {
  let found: DeclSpan | null = null
  for (const c of classesOfEl(el)) {
    const d = styleMap.get(c)?.get(prop)
    if (!d) continue
    if (found && found.start !== d.start) return null
    found = d
  }
  return found
}

interface AttrSpan {
  quote: string
  valueStart: number
  valueEnd: number
}

function findAttrSpan(clean: string, el: HtmlNode, name: string): AttrSpan | null {
  if (el.start === undefined || el.openEnd === undefined) return null
  const open = clean.slice(el.start, el.openEnd)
  const re = new RegExp(`\\s${name}(\\s*=\\s*)("([^"]*)"|'([^']*)'|[^\\s"'=<>` + '`])', 'i')
  const m = re.exec(open)
  if (!m || m[2] === undefined) return null
  const quote = m[2][0]
  const quoted = quote === '"' || quote === "'"
  const valueStart = el.start + m.index + m[0].length - m[2].length + (quoted ? 1 : 0)
  const valueEnd = valueStart + m[2].length - (quoted ? 2 : 0)
  return { quote: quoted ? quote : '', valueStart, valueEnd }
}

function encodeAttrValue(v: string, quote: string): string {
  let s = v.replace(/&/g, '&amp;').replace(/\n/g, ' ')
  if (quote === '"') s = s.replace(/"/g, '&quot;')
  else s = s.replace(/'/g, '&#39;')
  return s
}

/** data-* JSON 属性合并：保持原键序覆盖，新增键追加，newProps 缺键即删除 */
function mergeDataProps(oldAttrRaw: string, newProps: Record<string, unknown>): string | null {
  let old: Record<string, unknown>
  try {
    old = JSON.parse(decodeEntities(oldAttrRaw)) as Record<string, unknown>
  } catch {
    return null
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(old)) if (k in newProps) out[k] = newProps[k]
  for (const k of Object.keys(newProps)) if (!(k in out)) out[k] = newProps[k]
  return JSON.stringify(out)
}

// ─── 主入口 ───

export function patchWidgetHtmlInPlace(source: string, newDoc: DocNode): PatchResult {
  const fail = (reason: string): PatchResult => ({ ok: false, html: source, edits: [], reason })
  try {
    const clean = source.replace(/^\uFEFF/, '')
    const oldCompile = compileWidgetHtml(source)
    if (!oldCompile.ok || !oldCompile.doc) return fail('现有源编译失败')
    const oldDoc = oldCompile.doc as DocNode

    // 解析（与编译器同一解析器）拿源 span
    const { root } = tokenizeHtml(clean)
    let widgetEl: HtmlNode | undefined = root.tag === 'widget' ? root : undefined
    if (!widgetEl) {
      const visit = (el: HtmlNode): void => {
        if (widgetEl) return
        if (el.tag === 'widget') { widgetEl = el; return }
        for (const c of el.children) visit(c)
      }
      visit(root)
    }
    if (!widgetEl || widgetEl.start === undefined || widgetEl.openEnd === undefined || widgetEl.end === undefined) {
      return fail('未找到 <widget> 根元素')
    }
    const wEl: HtmlNode = widgetEl

    // class 名 → 元素（编译器名字 = class 约定；同名取首个，重复类名方后续定位必失败回退）
    const elementByName = new Map<string, HtmlNode>()
    const walkEls = (el: HtmlNode): void => {
      const c = (el.attrs['class'] ?? '').trim().split(/\s+/)[0]
      if (c && !elementByName.has(c)) elementByName.set(c, el)
      for (const child of el.children) walkEls(child)
    }
    walkEls(wEl)
    const styleMap = collectStyleDecls(clean, wEl)

    const edits: Edit[] = []
    const descs: string[] = []
    /**
     * 放宽验证的节点名集合：position/尺寸发生增量的锚定元素，编译器会从 left/top
     * 同步重推导 anchor/anchorOffset，而 newDoc 只更新了 position（预览保存链路的
     * 既有语义）——验证时对这几个节点的 anchor/anchorOffset 免比较，运行时布局
     * 本来就由锚点系统驱动，重编译值才是与新 left/top 一致的正确落点。
     */
    const relaxAnchorNames = new Set<string>()
    const label = (el: HtmlNode): string => el.attrs['class'] ?? '(根)'

    /** css 声明值直写 */
    const writeDecl = (el: HtmlNode, prop: string, newValue: string, what: string): void => {
      const d = findDecl(styleMap, el, prop)
      if (!d) throw new PatchBail(`${label(el)} 缺少 ${prop} 声明`)
      if (d.value === newValue) return
      edits.push({ start: d.start, end: d.end, text: newValue, desc: `${label(el)} ${prop}: ${d.value} → ${newValue}` })
      void what
    }
    /** px 长度增量（原值必须是纯 <num>px；delta 0 跳过） */
    const deltaLenDecl = (el: HtmlNode, prop: string, delta: number): void => {
      if (delta === 0) return
      const d = findDecl(styleMap, el, prop)
      if (!d) throw new PatchBail(`${label(el)} 缺少 ${prop} 声明`)
      const m = /^(-?\d+(?:\.\d+)?)px$/.exec(d.value)
      if (!m) throw new PatchBail(`${label(el)} ${prop} 值 "${d.value}" 非 px 长度`)
      edits.push({ start: d.start, end: d.end, text: `${round4(parseFloat(m[1]) + delta)}px`, desc: `${label(el)} ${prop}: ${d.value} → ${round4(parseFloat(m[1]) + delta)}px` })
    }
    /** 属性值直写（源里不存在时在开标签尾插入） */
    const writeAttr = (el: HtmlNode, name: string, newValue: string, what: string): void => {
      const span = findAttrSpan(clean, el, name)
      if (span) {
        const enc = encodeAttrValue(newValue, span.quote)
        if (clean.slice(span.valueStart, span.valueEnd) === enc) return
        edits.push({ start: span.valueStart, end: span.valueEnd, text: enc, desc: `${label(el)} ${name} → ${newValue}` })
        return
      }
      if (el.openEnd === undefined) throw new PatchBail('元素无开标签偏移')
      edits.push({ start: el.openEnd - 1, end: el.openEnd - 1, text: ` ${name}='${encodeAttrValue(newValue, "'")}'`, desc: `${label(el)} 插入 ${name} → ${newValue}` })
      void what
    }
    const innerTextSpan = (el: HtmlNode): { start: number; end: number } => {
      if (el.openEnd === undefined || el.closeStart === undefined) throw new PatchBail('元素无内联文本区')
      if (el.children.some((c) => c.tag !== '#text')) throw new PatchBail('元素为混合内容')
      return { start: el.openEnd, end: el.closeStart }
    }

    /** 单组件差分 → 源编辑 */
    const resolveCompDiff = (base: string, oldP: Record<string, unknown>, newP: Record<string, unknown>, el: HtmlNode, isRoot: boolean, nodeName: string): void => {
      const paths = leafDiffs(oldP, newP)
      if (paths.length === 0) return

      if (DATA_COMP_FAMILY.has(base)) {
        const span = findAttrSpan(clean, el, 'data-props')
        const merged = span ? mergeDataProps(clean.slice(span.valueStart, span.valueEnd), newP) : JSON.stringify(newP)
        if (merged === null) throw new PatchBail(`${label(el)} data-props JSON 解析失败`)
        writeAttr(el, 'data-props', merged, 'data-props')
        descs.push(`${label(el)} data-props 更新（${paths.join(', ')}）`)
        return
      }

      switch (base) {
        case 'UITransformComponent': {
          if (isRoot) {
            for (const p of paths) {
              if (p === 'worldWidth' || p === 'worldHeight') continue
              if (p === 'anchor') {
                const a = newP.anchor
                if (a === null || a === undefined || a === '') throw new PatchBail('根 anchor 置空需删除属性，不支持')
                writeAttr(wEl, 'anchor', String(a), '根 anchor')
                continue
              }
              if (p === 'anchorOffset') {
                const off = newP.anchorOffset as number[]
                writeAttr(wEl, 'offset', `${off[0]},${off[1]}`, '根 offset')
                continue
              }
              throw new PatchBail(`根 tf.${p} 差分不支持`)
            }
            const w = num(newP.worldWidth)
            const h = num(newP.worldHeight)
            if (w !== undefined && h !== undefined) writeAttr(wEl, 'canvas', `${w}x${h}`, `根 canvas → ${w}x${h}`)
            return
          }
          // 非根：只支持 position/worldWidth/worldHeight（其余键必须无差分）
          for (const p of paths) {
            if (!['position', 'worldWidth', 'worldHeight'].includes(p)) {
              throw new PatchBail(`tf.${p} 差分不支持`)
            }
          }
          const posDecl = findDecl(styleMap, el, 'position')
          if (!posDecl || !/^(absolute|fixed)$/.test(posDecl.value.trim())) {
            throw new PatchBail(`${label(el)} 非绝对定位，position 增量不支持`)
          }
          const arr = (n: Record<string, unknown>): number[] => (Array.isArray(n.position) ? n.position as number[] : [0, 0, 0])
          const oldPos = arr(oldP)
          const newPos = arr(newP)
          const num2 = (v: unknown): number => (typeof v === 'number' ? v : 0)
          const dW = num2(newP.worldWidth) - num2(oldP.worldWidth)
          const dH = num2(newP.worldHeight) - num2(oldP.worldHeight)
          if (oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1]) {
            // 锚定元素（编译器对绝对定位元素一律发射 anchor）的 position 恒为 [0,0,0]、
            // 摆放编码在 anchor+anchorOffset——position 无法被重编译复现，回退整篇反编译
            if (oldP.anchor) throw new PatchBail('锚定元素 position 为编译派生值（锚点系统驱动）')
            if (!posDecl) throw new PatchBail(`${label(el)} 缺少 position 声明`)
            deltaLenDecl(el, 'left', newPos[0] - oldPos[0])
            deltaLenDecl(el, 'top', -(newPos[1] - oldPos[1]))
          }
          if (dW !== 0 || dH !== 0) {
            // 尺寸：worldWidth/Height ← width/height 声明（盒模型边距不变时线性）
            deltaLenDecl(el, 'width', dW)
            deltaLenDecl(el, 'height', dH)
            if (oldP.anchor) relaxAnchorNames.add(nodeName)
          }
          if (dW !== 0 || dH !== 0 || oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1]) {
            descs.push(`${label(el)} 位姿/尺寸增量（Δx${round4(newPos[0] - oldPos[0])}, Δy${round4(newPos[1] - oldPos[1])}, Δw${dW}, Δh${dH}）`)
          }
          return
        }
        case 'CanvasUIComponent': {
          // width/height 与元素盒镜像（tf 的 width/height 声明补丁已覆盖），跳过
          const real = paths.filter((p) => p !== 'width' && p !== 'height')
          for (const p of real) {
            if (isRoot && p === 'hitTest') {
              writeDecl(el, 'hit-test', String(newP.hitTest), '根 hit-test')
              continue
            }
            if (p === 'zOrder') {
              writeDecl(el, 'z-index', String(newP.zOrder), 'z-index')
              continue
            }
            if (p === 'hitTest') {
              writeDecl(el, 'hit-test', String(newP.hitTest), 'hit-test')
              continue
            }
            throw new PatchBail(`canvas.${p} 差分不支持`)
          }
          descs.push(`${label(el)} canvas ${real.join(', ')}`)
          return
        }
        case 'UITextComponent': {
          for (const p of paths) {
            switch (p) {
              case 'text': {
                const span = innerTextSpan(el)
                const text = String(newP.text ?? '')
                edits.push({ start: span.start, end: span.end, text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), desc: `${label(el)} 文本 → "${text}"` })
                break
              }
              case 'fontSize': writeDecl(el, 'font-size', `${newP.fontSize}px`, 'font-size'); break
              case 'color': writeDecl(el, 'color', String(newP.color), 'color'); break
              case 'textAlign': writeDecl(el, 'text-align', String(newP.textAlign), 'text-align'); break
              case 'fontWeight': writeDecl(el, 'font-weight', String(newP.fontWeight), 'font-weight'); break
              case 'letterSpacing': writeDecl(el, 'letter-spacing', `${newP.letterSpacing}px`, 'letter-spacing'); break
              default: throw new PatchBail(`text.${p} 差分不支持`)
            }
          }
          descs.push(`${label(el)} 文本样式 ${paths.join(', ')}`)
          return
        }
        case 'UIImageComponent': {
          for (const p of paths) {
            switch (p) {
              case 'color': {
                const c = newP.color
                if (c === null || c === undefined) throw new PatchBail('image.color 置空不支持')
                writeDecl(el, 'background-color', String(c), 'background-color')
                break
              }
              case 'radius': writeDecl(el, 'border-radius', `${newP.radius}px`, 'border-radius'); break
              case 'opacity': writeDecl(el, 'opacity', String(newP.opacity), 'opacity'); break
              case 'src': {
                const src = newP.src
                writeDecl(el, 'background-image', src === 'none' || src === undefined || src === null ? 'none' : `url(${src})`, 'background-image')
                break
              }
              default: throw new PatchBail(`image.${p} 差分不支持`)
            }
          }
          descs.push(`${label(el)} 图像 ${paths.join(', ')}`)
          return
        }
        case 'UIScriptComponent': {
          for (const p of paths) {
            if (p === 'script') {
              writeAttr(el, 'data-script', String(newP.script), 'data-script')
            } else if (p.startsWith('args')) {
              const args = newP.args ?? {}
              writeAttr(el, 'data-args', JSON.stringify(args), 'data-args')
            } else throw new PatchBail(`script.${p} 差分不支持`)
          }
          descs.push(`${label(el)} 脚本属性 ${paths.join(', ')}`)
          return
        }
        default:
          throw new PatchBail(`组件 ${base} 差分不支持`)
      }
    }

    /** 配对一个文档节点（索引即身份）；名字不同 = 改名 → 结构改动，回退
     *  （class 兼作 CSS 选择器与脚本查节点钩子，改名需连规则/引用一并改，非属性值编辑） */
    const diffNode = (oldN: DocNode, newN: DocNode, el: HtmlNode, isRoot: boolean): void => {
      const oldName = String(oldN.name ?? '')
      const newName = String(newN.name ?? '')
      if (oldName !== newName) {
        throw new PatchBail(`改名 ${oldName} → ${newName} 属结构改动`)
      }
      // 组件集合必须一致（人工编辑不增删组件）
      const oldComps = compsOf(oldN)
      const newComps = compsOf(newN)
      if (oldComps.length !== newComps.length) throw new PatchBail(`${newName} 组件数量变化`)
      for (let i = 0; i < newComps.length; i++) {
        const oc = oldComps[i]
        const nc = newComps[i]
        if (oc.baseClass !== nc.baseClass) throw new PatchBail(`${newName} 组件 ${oc.baseClass} → ${nc.baseClass}`)
        if (!MAPPED_COMPS.has(nc.baseClass) && !docEquals(oc.properties, nc.properties)) {
          throw new PatchBail(`组件 ${nc.baseClass} 差分不支持`)
        }
        resolveCompDiff(nc.baseClass, oc.properties ?? {}, nc.properties ?? {}, el, isRoot, newName)
      }
      // 子树：长度必须一致（结构变化回退）；合成节点（无对应元素）必须无差分
      const oc = childrenOf(oldN)
      const nc = childrenOf(newN)
      if (oc.length !== nc.length) throw new PatchBail(`${newName} 子节点数量变化`)
      for (let i = 0; i < nc.length; i++) {
        const childName = String(nc[i].name ?? '')
        const childEl = elementByName.get(childName) ?? elementByName.get(String(oc[i].name ?? ''))
        if (!childEl) {
          if (!docEquals(oc[i], nc[i])) throw new PatchBail(`合成节点 ${childName} 存在差分`)
          continue
        }
        diffNode(oc[i], nc[i], childEl, false)
      }
    }

    diffNode(oldDoc, newDoc, wEl, true)

    if (edits.length === 0) {
      return { ok: true, html: clean, edits: [], reason: '无差分' }
    }

    // 应用编辑（按 start 降序拼接，区间重叠直接判失败交回退）
    const sorted = [...edits].sort((a, b) => b.start - a.start)
    let out = clean
    let lastStart = Number.POSITIVE_INFINITY
    for (const e of sorted) {
      if (e.end > lastStart) return fail('编辑区间重叠')
      out = out.slice(0, e.start) + e.text + out.slice(e.end)
      lastStart = e.start
    }

    // 验证：补丁结果重编译必须与 newDoc 语义一致（含结构、属性、几何）。
    // relaxAnchorNames 中的节点：剥离 anchor/anchorOffset，且其「合成子树」（边框/标记
    // 等编译器派生节点，无对应源元素）两侧同时剔除后再比——尺寸变化会连带重算它们。
    const re = compileWidgetHtml(out)
    if (!re.ok || !re.doc) return fail('补丁后重编译失败')
    const stripForVerify = (n: DocNode): DocNode => {
      const name = String(n.name ?? '')
      const volatile = relaxAnchorNames.has(name)
      const clone: DocNode = { ...n }
      if (volatile) {
        clone.components = compsOf(n).map((c) => {
          if (c.baseClass === 'UITransformComponent') {
            const p = { ...c.properties }
            delete p.anchor
            delete p.anchorOffset
            return { ...c, properties: p }
          }
          if (c.baseClass === 'CanvasUIComponent' || c.baseClass === 'UIImageComponent') {
            // 画布/背景板宽高镜像元素盒（随尺寸增量重算）
            const p = { ...c.properties }
            delete p.width
            delete p.height
            return { ...c, properties: p }
          }
          return c
        })
      }
      if (n.children) {
        clone.children = childrenOf(n)
          .filter((c) => !(volatile && !elementByName.has(String(c.name ?? ''))))
          .map(stripForVerify)
      }
      return clone
    }
    const mismatch = firstMismatch(stripForVerify(re.doc as DocNode), stripForVerify(newDoc))
    if (mismatch !== null) return fail(`补丁后重编译与目标不一致 @ ${mismatch}`)
    return { ok: true, html: out, edits: descs }
  } catch (e) {
    if (e instanceof PatchBail) return { ok: false, html: source, edits: [], reason: e.message }
    return { ok: false, html: source, edits: [], reason: (e as Error).message }
  }
}
