/**
 * compile — ui-compiler：xxx.widget.html → xxx.widget.json（方案 §6）
 *
 * 纯函数式：输入 HTML 源字符串 → 输出 widget.json 对象 + 错误列表（面向源文件行号）。
 * 越界写法（CSS 受控子集之外）编译期硬报错，绝不静默降级成坏布局。
 *
 * 映射规则见 widgetMapping.ts；产物经 assetLint 零错误门槛（lintAdapter/lintBridge）。
 * px↔米换算按根画布比例（见 widgetMapping 注释）。
 */
import type { CompileContext, HtmlNode } from './compileTypes'
import { tokenizeCss, tokenizeHtml, ParseError } from './miniParser'
import {
  JUSTIFY_MAP, ALIGN_MAP, TEXT_ALIGN_MAP,
  FULLSCREEN_WORLD_WIDTH, FULLSCREEN_CANVAS_WIDTH, FULLSCREEN_CANVAS_HEIGHT,
  round2, round4, pxToWorldX, pxToWorldY,
} from './widgetMapping'

/** 编译错误（面向源文件：行号指向 .widget.html） */
export interface CompileError {
  line: number
  message: string
}

/** 编译结果 */
export interface CompileResult {
  ok: boolean
  errors: CompileError[]
  /** 产物（成功时）；含顶层 sourceHash */
  doc?: Record<string, unknown>
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

/** 节点名（data-name > name > class 首词 > 标签_seq） */
function nodeNameOf(el: HtmlNode, styleCls: string | undefined): string {
  if (el.attrs['data-name']) return el.attrs['data-name']
  if (el.attrs['name']) return el.attrs['name']
  if (styleCls) return styleCls
  return `${el.tag.charAt(0).toUpperCase()}${el.tag.slice(1)}_${nextNodeId()}`
}

interface StyleInfo {
  /** 该节点自身声明（选择器精确命中 class 或 tag） */
  decls: Map<string, { value: string; line: number }>
  /** :hover 伪类声明（仅 button；颜色写进 UIScript.args 透传） */
  hoverDecls: Map<string, { value: string; line: number }>
}

/** 解析样式规则（单 class / 单元素 / .cls:hover；其余选择器硬报错） */
function collectClassStyles(cssRules: ReturnType<typeof tokenizeCss>): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>()
  for (const rule of cssRules) {
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
    throw new CompileFail(
      `不支持的选择器 "${sel}"（仅支持单 class（.cls）、单元素（div/img/button/text/input/textarea/progress）、.cls:hover；不支持嵌套/级联/多选择器）`,
      rule.line,
    )
  }
  return out
}

/** 取节点样式：优先 class，其次元素选择器 */
function styleOf(el: HtmlNode, styles: Map<string, StyleInfo>): StyleInfo {
  const cls = el.attrs['class']?.split(/\s+/)[0]
  if (cls && styles.has(cls)) return styles.get(cls)!
  if (styles.has(`@${el.tag}`)) return styles.get(`@${el.tag}`)!
  return { decls: new Map(), hoverDecls: new Map() }
}

/** 数值解析：px 结尾的长度 */
function parsePx(value: string, prop: string, line: number): number {
  const m = /^(-?[\d.]+)px$/.exec(value)
  if (!m) throw new CompileFail(`属性 "${prop}: ${value}" 仅支持 px 单位`, line)
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) throw new CompileFail(`属性 "${prop}: ${value}" 数值非法`, line)
  return v
}

/** 百分比解析：返回 0~100 数值 */
function parsePct(value: string, prop: string, line: number): number {
  const m = /^(-?[\d.]+)%$/.exec(value)
  if (!m) throw new CompileFail(`属性 "${prop}: ${value}" 仅支持 % 单位`, line)
  return parseFloat(m[1])
}

/** 位置解析：% 或 px（px 按轴换算成 %：left/baseline=画布宽，top=画布高，与 CSS 百分比语义一致） */
function parsePos(value: string, prop: string, line: number, ctx: CompileContext): number {
  if (value.endsWith('%')) return parsePct(value, prop, line)
  const base = prop === 'top' ? ctx.canvasHeight : ctx.canvasWidth
  return (parsePx(value, prop, line) / base) * 100
}

/** 颜色值校验（hex / rgb / rgba） */
const COLOR_RE = /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/

/** 枚举值映射查找（未知值报错） */
function mapEnum(map: Record<string, string>, value: string, prop: string, line: number): string {
  const v = map[value]
  if (v === undefined) {
    throw new CompileFail(`属性 "${prop}: ${value}" 不在支持范围 [${Object.keys(map).join(' / ')}]`, line)
  }
  return v
}

/** hit-test 值校验 */
function hitTestOf(value: string, line: number): string {
  if (value === 'visible' || value === 'block' || value === 'hitTestInvisible') return value
  throw new CompileFail(`hit-test 取值 "${value}" 不在 [visible / block / hitTestInvisible]`, line)
}

/** z-order 解析（整数） */
function parseZOrder(value: string, line: number): number {
  const v = parseInt(value, 10)
  if (!Number.isFinite(v) || String(v) !== value.trim()) {
    throw new CompileFail(`z-order 取值 "${value}" 必须是整数`, line)
  }
  return v
}

/** 编译入口 */
export function compileWidgetHtml(source: string): CompileResult {
  const errors: CompileError[] = []
  nodeIdSeq = 0
  try {
    const { root, styleCss } = tokenizeHtml(source)
    const cssRules = tokenizeCss(styleCss)
    const styles = collectClassStyles(cssRules)

    // ─── <widget> 根：name + canvas + world + anchor/offset ───
    const name = root.attrs['name'] ?? root.attrs['data-name']
    if (!name) throw new CompileFail('<widget> 缺少 name 属性', root.line)
    const canvasStr = root.attrs['canvas'] ?? `${FULLSCREEN_CANVAS_WIDTH}x${FULLSCREEN_CANVAS_HEIGHT}`
    const cm = /^(\d+)x(\d+)$/.exec(canvasStr)
    if (!cm) throw new CompileFail(`<widget> canvas 属性格式应为 "宽x高"（如 canvas="960x540"）`, root.line)
    const canvasWidth = parseInt(cm[1], 10)
    const canvasHeight = parseInt(cm[2], 10)
    // 根画布世界尺寸：world="WxH"（米）声明；缺省 = 全屏宽 4.8，高按画布比例
    let worldWidth = FULLSCREEN_WORLD_WIDTH
    let worldHeight = round2(FULLSCREEN_WORLD_WIDTH * (canvasHeight / canvasWidth))
    const worldStr = root.attrs['world']
    if (worldStr) {
      const wm = /^([\d.]+)x([\d.]+)$/.exec(worldStr)
      if (!wm) throw new CompileFail(`<widget> world 属性格式应为 "宽x高"（米，如 world="4.8x0.9"）`, root.line)
      worldWidth = round2(parseFloat(wm[1]))
      worldHeight = round2(parseFloat(wm[2]))
    }
    const ctx: CompileContext = { canvasWidth, canvasHeight, worldWidth, worldHeight }

    const rootAnchor = root.attrs['anchor']
    const rootOffset = root.attrs['offset'] // "0,0.55" 世界米

    // 产物骨架（与 BlueprintAsset 结构同构）
    const doc: Record<string, unknown> = {
      name,
      baseClass: 'Actor',
      sourceHash: fnv1a(source.replace(/^\uFEFF/, '')),
      components: [] as unknown[],
      children: [] as unknown[],
    }

    // 根组件：uitransform（世界尺寸 + 锚点）
    const rootTfProps: Record<string, unknown> = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      worldWidth,
      worldHeight,
    }
    if (rootAnchor) {
      rootTfProps.anchor = rootAnchor
      const off: [number, number] = [0, 0]
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

    // 根组件：canvasui（真画布）
    const canvasProps: Record<string, unknown> = {
      width: canvasWidth,
      height: canvasHeight,
      name: 'Canvas',
      zOrder: 0,
      active: true,
    }
    const rootStyle = styleOf(root, styles)
    const rootHit = rootStyle.decls.get('hit-test')
    if (rootHit) canvasProps.hitTest = hitTestOf(rootHit.value, rootHit.line)
    ;(doc.components as unknown[]).push({ baseClass: 'CanvasUIComponent', properties: canvasProps })

    // 根子元素（排除 <style>）
    const contentChildren = root.children.filter((c) => c.tag !== 'style')
    for (const c of contentChildren) {
      if (c.tag === '#text') {
        throw new CompileFail('<widget> 根下不允许直接文本节点（请包裹在 div/text 中）', c.line)
      }
    }

    for (const child of contentChildren) {
      compileNode(child, doc as unknown as { children: unknown[] }, styles, ctx)
    }

    return { ok: true, errors: [], doc }
  } catch (e) {
    if (e instanceof CompileFail || e instanceof ParseError) {
      errors.push({ line: (e as { line: number }).line, message: e.message })
    } else {
      errors.push({ line: 0, message: `编译异常: ${(e as Error).message}` })
    }
    return { ok: false, errors, doc: undefined }
  }
}

/**
 * 编译一个元素节点为 widget.json 子节点（递归）。
 * 元素 → Actor：div → 空 Actor（可挂 layout）、img → UIImage、button → UIButton、text → UIText。
 */
function compileNode(
  el: HtmlNode,
  parent: { children: unknown[] },
  styles: Map<string, StyleInfo>,
  ctx: CompileContext,
): void {
  const style = styleOf(el, styles)
  const styleCls = el.attrs['class']?.split(/\s+/)[0]
  const nodeName = nodeNameOf(el, styleCls)
  const node: Record<string, unknown> = {
    name: nodeName,
    baseClass: 'Actor',
    id: nextNodeId(),
    components: [] as unknown[],
    children: [] as unknown[],
  }

  // ─── 通用组件：uitransform ───
  const tfProps = buildTransformProps(el, style, ctx)
  ;(node.components as unknown[]).push({ baseClass: 'UITransformComponent', properties: tfProps })
  // ─── 通用组件：canvasui markerOnly（UI 标识）───
  const markerProps: Record<string, unknown> = { markerOnly: true, name: 'UIMarker', zOrder: 0 }
  const z = style.decls.get('z-order')
  if (z) markerProps.zOrder = parseZOrder(z.value, z.line)
  ;(node.components as unknown[]).push({ baseClass: 'CanvasUIComponent', properties: markerProps })

  // ─── 功能组件（按元素类型）───
  const display = style.decls.get('display')?.value
  const flexDirection = style.decls.get('flex-direction')?.value

  if (display === 'flex') {
    // flex 容器 → UILayoutComponent
    if (flexDirection && flexDirection !== 'row' && flexDirection !== 'column') {
      throw new CompileFail(
        `flex-direction: ${flexDirection} 不受支持（仅 row / column；wrap/reverse 不做）`,
        style.decls.get('flex-direction')!.line,
      )
    }
    const layoutProps: Record<string, unknown> = {
      mode: flexDirection === 'column' ? 'vertical' : 'horizontal',
      spacingX: 0,
      spacingY: 0,
      autoLayout: true,
    }
    const gap = style.decls.get('gap')
    if (gap) {
      const g = pxToWorldX(parsePx(gap.value, 'gap', gap.line), ctx)
      layoutProps.spacingX = g
      layoutProps.spacingY = g
    }
    const jc = style.decls.get('justify-content')
    if (jc) layoutProps.justify = mapEnum(JUSTIFY_MAP, jc.value, 'justify-content', jc.line)
    const ai = style.decls.get('align-items')
    if (ai) layoutProps.align = mapEnum(ALIGN_MAP, ai.value, 'align-items', ai.line)
    ;(node.components as unknown[]).push({ baseClass: 'UILayoutComponent', properties: layoutProps })
  } else if (flexDirection && !display) {
    throw new CompileFail('flex-direction 需要配合 display: flex 使用', style.decls.get('flex-direction')!.line)
  }

  // overflow: auto（任意元素）→ UIScrollListComponent（overflow-x: auto → horizontal）。
  // 在标签分支与 data-comp 之前执行：后者按 baseClass 合并，不重复挂载
  compileOverflow(el, style, node, ctx)

  // 按标签类型挂功能组件
  if (el.tag === 'img') {
    compileImage(el, style, node, ctx)
  } else if (el.tag === 'button') {
    compileButton(el, style, node, ctx)
  } else if (el.tag === 'text') {
    // text 元素自身承载 UITextComponent（无内容也挂，text='' 交脚本运行时驱动）
    const ownText = el.children.find((c) => c.tag === '#text')
    compileTextProps(el, style, ownText?.text ?? '', node, ctx)
  } else if (el.tag === 'input' || el.tag === 'textarea') {
    compileInput(el, style, node, ctx)
  } else if (el.tag === 'progress') {
    compileProgress(el, node)
  } else {
    // div：背景视觉声明（background/border-radius/opacity）→ UIImageComponent（反编译 div 降级的对称通道）
    const tfPropsBg = (node.components as Array<Record<string, unknown>>)[0].properties as Record<string, unknown>
    const bgProps = collectImageProps(el, style, tfPropsBg, ctx, nodeName)
    if (bgProps) {
      ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: bgProps })
    }
    // div：直接文本 → 子 text Actor（保持 div 纯容器语义）
    const textChild2 = el.children.find((c) => c.tag === '#text')
    if (textChild2) {
      compileChildText(el, style, textChild2.text, node, ctx)
    } else if (el.attrs['data-comp']) {
      compileDataComp(el, node)
    }
  }

  // data-script：UIScriptComponent（任意元素可挂）
  const script = el.attrs['data-script']
  if (script) {
    const scriptProps: Record<string, unknown> = { script }
    if (el.attrs['data-args']) {
      try {
        scriptProps.args = JSON.parse(el.attrs['data-args'])
      } catch {
        throw new CompileFail(`data-args 属性不是合法 JSON: "${el.attrs['data-args']}"`, el.line)
      }
    }
    ;(node.components as unknown[]).push({ baseClass: 'UIScriptComponent', properties: scriptProps })
  }

  // data-comp 逃逸通道（img/button 也允许；已被原生标签映射的组件不再逃逸重复挂载）
  const nativeMapped = new Set(
    ['UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent', 'UITooltipComponent'],
  )
  if (el.attrs['data-comp'] && el.tag !== 'div') {
    const compName = el.attrs['data-comp']
    const baseClass = compName.endsWith('Component') ? compName : `${compName}Component`
    if (!nativeMapped.has(baseClass)) compileDataComp(el, node)
  }

  // title 属性 → UITooltipComponent（任意元素可挂，与 data-script 同级通用）
  const title = el.attrs['title']
  if (title) {
    ;(node.components as unknown[]).push({
      baseClass: 'UITooltipComponent',
      properties: { text: title },
    })
  }

  // 递归子元素
  for (const c of el.children) {
    if (c.tag === '#text') continue // 文本已处理
    compileNode(c, node as unknown as { children: unknown[] }, styles, ctx)
  }

  parent.children.push(node)
}

/** 构建 uitransform 属性（width/height/position） */
function buildTransformProps(
  el: HtmlNode,
  style: StyleInfo,
  ctx: CompileContext,
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }
  const w = style.decls.get('width')
  const h = style.decls.get('height')
  if (w) props.worldWidth = pxToWorldX(parsePx(w.value, 'width', w.line), ctx)
  if (h) props.worldHeight = pxToWorldY(parsePx(h.value, 'height', h.line), ctx)

  // 定位：position:absolute + left/top → anchor + anchorOffset
  const position = style.decls.get('position')
  if (position && position.value !== 'absolute') {
    throw new CompileFail(`position: ${position.value} 不受支持（仅 absolute；流内布局交给父容器 flex）`, position.line)
  }
  const left = style.decls.get('left')
  const top = style.decls.get('top')
  if (position?.value === 'absolute' || left || top) {
    if (position && position.value !== 'absolute') {
      throw new CompileFail('left/top 定位必须配合 position: absolute', position?.line ?? el.line)
    }
    const lPct = left ? parsePos(left.value, 'left', left.line, ctx) : 50
    const tPct = top ? parsePos(top.value, 'top', top.line, ctx) : 50
    const anchor = anchorOf(lPct, tPct)
    props.anchor = anchor
    // 锚点语义（applyAnchor）：中心 = 因子×(父半尺寸 − 自半尺寸) + offset。
    // 期望中心（米）: x = (lPct−50)% × 画布世界宽；y = (50−tPct)% × 画布世界高
    const wW = (props.worldWidth as number) ?? 0
    const wH = (props.worldHeight as number) ?? 0
    const wantX = ((lPct - 50) / 100) * ctx.worldWidth
    const wantY = ((50 - tPct) / 100) * ctx.worldHeight
    const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
    const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
    const baseX = fx * (ctx.worldWidth / 2 - wW / 2)
    const baseY = fy * (ctx.worldHeight / 2 - wH / 2)
    props.anchorOffset = [round4(wantX - baseX), round4(wantY - baseY)]
  }
  return props
}

/** 百分比 → 九宫格锚点名 */
function anchorOf(lPct: number, tPct: number): string {
  const ax = lPct === 50 ? 'center' : lPct < 50 ? 'left' : 'right'
  const ay = tPct === 50 ? 'middle' : tPct < 50 ? 'top' : 'bottom'
  if (ax === 'center' && ay === 'middle') return 'center'
  return `${ay}-${ax}`
}

/**
 * 收集图像属性（img 元素 / div 背景面板 / button 背景 共用）。
 * div/button 无任何视觉声明（src/background/border-radius/opacity）时返回 null（不产出组件）；
 * img 作为 void 叶子元素始终产出（调用方用非空断言）。
 */
function collectImageProps(
  el: HtmlNode,
  style: StyleInfo,
  tfProps: Record<string, unknown>,
  ctx: CompileContext,
  nodeName: string,
): Record<string, unknown> | null {
  const props: Record<string, unknown> = {}
  const src = el.attrs['src'] ?? style.decls.get('background-image')?.value
  if (src) props.src = src
  const bg = style.decls.get('background')?.value ?? style.decls.get('background-color')?.value
  if (bg && !src) props.color = bg
  const radius = style.decls.get('border-radius')
  if (radius) props.radius = parsePx(radius.value, 'border-radius', radius.line) // 画布像素直通（绘制语义）
  const opacity = style.decls.get('opacity')
  if (opacity) {
    const v = parseFloat(opacity.value)
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new CompileFail(`opacity: ${opacity.value} 必须 ∈ [0,1]`, opacity.line)
    }
    props.opacity = v
  }
  const z = style.decls.get('z-order')
  if (z) props.zOrder = parseZOrder(z.value, z.line)
  const hit = style.decls.get('hit-test')
  if (hit) props.hitTest = hitTestOf(hit.value, hit.line)
  const hasVisual = Boolean(src || bg || radius || opacity)
  if (!hasVisual && el.tag !== 'img') return null
  // 像素分辨率 = 世界尺寸 × (画布px / 画布世界m)
  props.width = Math.max(8, Math.round(((tfProps.worldWidth as number) ?? 1) * (ctx.canvasWidth / ctx.worldWidth)))
  props.height = Math.max(8, Math.round(((tfProps.worldHeight as number) ?? 1) * (ctx.canvasHeight / ctx.worldHeight)))
  props.name = nodeName
  return props
}

/**
 * input/textarea → UITextInputComponent（引擎单行输入控件）。
 * textarea 在源格式中无独立语义（引擎无多行输入），仅作为 input 的别名接受。
 * 属性：placeholder / value（HTML 原生属性直通）+ 文本样式（font-size/color/z-order/hit-test）。
 */
function compileInput(
  el: HtmlNode,
  style: StyleInfo,
  node: Record<string, unknown>,
  ctx: CompileContext,
): void {
  const tfProps = (node.components as Array<Record<string, unknown>>)[0].properties as Record<string, unknown>
  const worldW = (tfProps.worldWidth as number) ?? 1
  const worldH = (tfProps.worldHeight as number) ?? 1
  const props: Record<string, unknown> = {}
  const placeholder = el.attrs['placeholder']
  if (placeholder) props.placeholder = placeholder
  const value = el.attrs['value']
  if (value) props.value = value
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
  props.width = Math.max(8, Math.round(worldW * (ctx.canvasWidth / ctx.worldWidth)))
  props.height = Math.max(8, Math.round(worldH * (ctx.canvasHeight / ctx.worldHeight)))
  ;(node.components as unknown[]).push({ baseClass: 'UITextInputComponent', properties: props })
}

/**
 * progress → UIProgressBarComponent。
 * 属性：value / max（HTML 原生属性，min 恒 0）；fill 子 Actor 由源内子元素承载。
 */
function compileProgress(el: HtmlNode, node: Record<string, unknown>): void {
  const props: Record<string, unknown> = {}
  const value = el.attrs['value']
  if (value) {
    const v = parseFloat(value)
    if (!Number.isFinite(v)) throw new CompileFail(`progress value "${value}" 必须是数字`, el.line)
    props.value = v
  }
  const max = el.attrs['max']
  if (max) {
    const v = parseFloat(max)
    if (!Number.isFinite(v) || v <= 0) throw new CompileFail(`progress max "${max}" 必须是正数`, el.line)
    props.max = v
  }
  ;(node.components as unknown[]).push({ baseClass: 'UIProgressBarComponent', properties: props })
}

/**
 * overflow: auto/scroll → UIScrollListComponent（overflow-x: auto → horizontal，其余 vertical）。
 * 不可滚动值（hidden/visible/clip）明确报错，不静默降级。
 */
function compileOverflow(
  el: HtmlNode,
  style: StyleInfo,
  node: Record<string, unknown>,
  _ctx: CompileContext,
): void {
  for (const prop of ['overflow', 'overflow-x', 'overflow-y']) {
    const d = style.decls.get(prop)
    if (!d) continue
    if (d.value !== 'auto' && d.value !== 'scroll') {
      throw new CompileFail(
        `${prop}: ${d.value} 不受支持（仅 auto / scroll 映射滚动列表；hidden/visible/clip 不做）`,
        d.line,
      )
    }
    if ((node.components as Array<{ baseClass: string }>).some((c) => c.baseClass === 'UIScrollListComponent')) continue
    const props: Record<string, unknown> = {
      direction: prop === 'overflow-x' ? 'horizontal' : 'vertical',
    }
    ;(node.components as unknown[]).push({ baseClass: 'UIScrollListComponent', properties: props })
  }
}

/** img → UIImageComponent（void 叶子元素，始终产出） */
function compileImage(
  el: HtmlNode,
  style: StyleInfo,
  node: Record<string, unknown>,
  ctx: CompileContext,
): void {
  const tfProps = (node.components as Array<Record<string, unknown>>)[0].properties as Record<string, unknown>
  const props = collectImageProps(el, style, tfProps, ctx, String(node.name))
  ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: props! })
}

/** button → UIButtonComponent + 可选 UIImage 背景 + 子文本 */
function compileButton(
  el: HtmlNode,
  style: StyleInfo,
  node: Record<string, unknown>,
  ctx: CompileContext,
): void {
  // 交互组件
  ;(node.components as unknown[]).push({ baseClass: 'UIButtonComponent', properties: {} })

  // 背景（background / background-image / border-radius / opacity → UIImageComponent；共用 collectImageProps）
  const tfProps = (node.components as Array<Record<string, unknown>>)[0].properties as Record<string, unknown>
  const bgProps = collectImageProps(el, style, tfProps, ctx, String(node.name))
  if (bgProps) {
    ;(node.components as unknown[]).push({ baseClass: 'UIImageComponent', properties: bgProps })
  }

  // :hover 状态色 → 引擎 UIButton 不代理颜色：hover 色写进 UIScriptComponent.args 透传（不丢信息）
  const hoverColor = style.hoverDecls.get('color')?.value
  if (hoverColor) {
    if (!COLOR_RE.test(hoverColor)) {
      throw new CompileFail(`:hover color "${hoverColor}" 不是合法颜色值`, style.hoverDecls.get('color')!.line)
    }
    const scriptComp = (node.components as Array<Record<string, unknown>>).find(
      (c) => c.baseClass === 'UIScriptComponent',
    ) as Record<string, unknown> | undefined
    if (scriptComp) {
      const sp = scriptComp.properties as Record<string, unknown>
      sp.args = { ...(sp.args as Record<string, unknown> | undefined), hoverColor }
    }
  }

  // 按钮文字 → 子 UIText Actor
  const textChild = el.children.find((c) => c.tag === '#text')
  if (textChild) {
    compileChildText(el, style, textChild.text, node, ctx)
  }
}

/** 文本样式收集（text 元素与子文本共用） */
function collectTextProps(
  style: StyleInfo,
  text: string,
  name: string,
  pxW: number,
  pxH: number,
): Record<string, unknown> {
  const props: Record<string, unknown> = { text }
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
    if (!m) throw new CompileFail(`line-height: ${lh.value} 仅支持无单位倍数（如 1.4）`, lh.line)
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
  props.width = pxW
  props.height = pxH
  return props
}

/** text 元素自身承载 UITextComponent（空文本也挂：text='' 交脚本运行时驱动） */
function compileTextProps(
  el: HtmlNode,
  style: StyleInfo,
  text: string,
  node: Record<string, unknown>,
  ctx: CompileContext,
): void {
  const tfProps = (node.components as Array<Record<string, unknown>>)[0].properties as Record<string, unknown>
  const worldW = (tfProps.worldWidth as number) ?? 1
  const worldH = (tfProps.worldHeight as number) ?? 1
  const pxW = Math.max(8, Math.round(worldW * (ctx.canvasWidth / ctx.worldWidth)))
  const pxH = Math.max(8, Math.round(worldH * (ctx.canvasHeight / ctx.worldHeight)))
  const props = collectTextProps(style, text, String(node.name), pxW, pxH)
  ;(node.components as unknown[]).push({ baseClass: 'UITextComponent', properties: props })
}

/** div/button 的直接文本 → 子 UIText Actor（父为纯容器/按钮语义） */
function compileChildText(
  el: HtmlNode,
  style: StyleInfo,
  text: string,
  node: Record<string, unknown>,
  ctx: CompileContext,
): void {
  const tfProps = (node.components as Array<Record<string, unknown>>)[0].properties as Record<string, unknown>
  const worldW = (tfProps.worldWidth as number) ?? 1
  const worldH = (tfProps.worldHeight as number) ?? 1
  const pxW = Math.max(8, Math.round(worldW * (ctx.canvasWidth / ctx.worldWidth)))
  const pxH = Math.max(8, Math.round(worldH * (ctx.canvasHeight / ctx.worldHeight)))
  // 子文本节点名与父节点去重（assetLint 同资产 name 唯一），首个重名加 Text 后缀
  const baseName = String(node.name)
  const used = new Set<string>([baseName])
  for (const c of (node.children ?? []) as Array<{ name?: string }>) if (c.name) used.add(c.name)
  let textName = baseName
  if (used.has(textName)) {
    let i = 1
    while (used.has(`${baseName}Text${i > 1 ? i : ''}`)) i++
    textName = `${baseName}Text${i > 1 ? i : ''}`
  }
  const props = collectTextProps(style, text, textName, pxW, pxH)

  // 文本子 Actor（尺寸继承父节点，锚点居中）
  const child: Record<string, unknown> = {
    name: textName,
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
          worldWidth: worldW,
          worldHeight: worldH,
        },
      },
      { baseClass: 'CanvasUIComponent', properties: { markerOnly: true, name: 'UIMarker', zOrder: 0 } },
      { baseClass: 'UITextComponent', properties: props },
    ],
    children: [],
  }
  ;(node.children as unknown[]).push(child)
}

/** data-comp 逃逸通道：data-comp="UIProgressBar" + data-props JSON → 组件透传。
 *  同 baseClass 组件已存在（如 overflow:auto 已建 UIScrollListComponent）时合并 properties，
 *  避免反编译 round-trip 时重复挂载。 */
function compileDataComp(el: HtmlNode, node: Record<string, unknown>): void {
  const compName = el.attrs['data-comp']!
  const baseClass = compName.endsWith('Component') ? compName : `${compName}Component`
  let props: Record<string, unknown> = {}
  if (el.attrs['data-props']) {
    try {
      props = JSON.parse(el.attrs['data-props'])
    } catch {
      throw new CompileFail(`data-props 不是合法 JSON: "${el.attrs['data-props']}"`, el.line)
    }
  }
  const comps = node.components as Array<{ baseClass: string; properties: Record<string, unknown> }>
  const existing = comps.find((c) => c.baseClass === baseClass)
  if (existing) {
    existing.properties = { ...existing.properties, ...props }
  } else {
    comps.push({ baseClass, properties: props })
  }
}

/** 导出解析器类型（编辑器命令复用） */
export { tokenizeCss, tokenizeHtml, ParseError }
export type { CssDecl, CssRule, HtmlNode } from './miniParser'
