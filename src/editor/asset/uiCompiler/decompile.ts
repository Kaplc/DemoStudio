/**
 * decompile — ui-decompiler：xxx.widget.json → xxx.widget.html（方案 §6 反编译回写）
 *
 * 面对的是本编译器自己生成的 json（结构/组件顺序/命名均为编译器规范形），
 * 逆向映射表与 §5 完全对称，输出固定规范形（缩进/属性顺序），
 * round-trip 稳定：html → json → html' 与 html 语义等效。
 *
 * 防御（TC-C3）：非编译器产物（无 sourceHash）→ 结果带 warning，仍尽力转换；
 * 映射不到的组件/属性走 data-comp/data-props 逃逸通道，不丢信息（TC-C4）。
 */
import type { CompileContext } from './compileTypes'
import { FULLSCREEN_CANVAS_WIDTH, FULLSCREEN_CANVAS_HEIGHT, round2, round4, worldToPxX, worldToPxY } from './widgetMapping'

/** 反编译结果 */
export interface DecompileResult {
  ok: boolean
  /** 警告（如非编译器规范形、映射不到的属性） */
  warnings: string[]
  /** 产物 HTML（规范形） */
  html?: string
}

/** widget.json 节点结构（BlueprintAsset 子集） */
export interface JsonComp {
  baseClass: string
  properties?: Record<string, unknown>
}
export interface JsonNode {
  name?: string
  baseClass?: string
  components?: JsonComp[]
  children?: JsonNode[]
  active?: boolean
}

/** 数值格式化：整数不带小数点，最多 2 位小数 */
function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/** px 格式化（x 轴） */
function pxOfX(world: number, ctx: CompileContext): string {
  return `${fmtNum(worldToPxX(world, ctx))}px`
}
/** px 格式化（y 轴） */
function pxOfY(world: number, ctx: CompileContext): string {
  return `${fmtNum(worldToPxY(world, ctx))}px`
}

/** 组件查找 */
function compOf(node: JsonNode, baseClass: string): JsonComp | undefined {
  return node.components?.find((c) => c.baseClass === baseClass)
}

/** 通用组件（渲染时跳过） */
const COMMON_COMPS = new Set(['UITransformComponent', 'CanvasUIComponent'])
/** 逃逸承载组件（无源格式映射） */
const ESCAPE_COMPS = new Set(['UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent', 'UITooltipComponent'])
/** 原生标签已映射的组件（反编译还原为标签/属性，不再走 data-comp 逃逸） */
const NATIVE_MAPPED_COMPS = new Set([
  'UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent', 'UITooltipComponent',
])

/** 反编译入口 */
export function decompileWidgetJson(doc: unknown): DecompileResult {
  const warnings: string[] = []
  try {
    const root = doc as JsonNode
    if (!root || typeof root !== 'object') {
      return { ok: false, warnings: ['文档不是对象'], html: undefined }
    }

    // 防御：非编译器产物（无 sourceHash）→ 警告
    if (!('sourceHash' in root)) {
      warnings.push('该 widget.json 无 sourceHash（非编译器产物或旧资产）：尽力按规范形反编译，映射不到的组件走 data-comp 逃逸，不丢信息')
    }

    // ─── 根：canvas 尺寸 + world 尺寸 + name + anchor ───
    const rootTf = (compOf(root, 'UITransformComponent')?.properties ?? {}) as Record<string, unknown>
    const rootCanvas = root.components?.find((c) => c.baseClass === 'CanvasUIComponent' && !c.properties?.markerOnly)
    const canvasProps = (rootCanvas?.properties ?? {}) as Record<string, number>
    const cw = Number(canvasProps.width ?? FULLSCREEN_CANVAS_WIDTH)
    const ch = Number(canvasProps.height ?? FULLSCREEN_CANVAS_HEIGHT)
    const wW = Number(rootTf.worldWidth ?? 4.8)
    const wH = Number(rootTf.worldHeight ?? round2(4.8 * (ch / cw)))
    const name = String(root.name ?? 'Widget')
    const ctx: CompileContext = { canvasWidth: cw, canvasHeight: ch, worldWidth: wW, worldHeight: wH }

    const rootAttrs: string[] = [
      `name="${name}"`,
      `canvas="${cw}x${ch}"`,
      `world="${fmtNum(wW)}x${fmtNum(wH)}"`,
    ]
    const rootAnchor = rootTf.anchor as string | undefined
    if (rootAnchor) {
      rootAttrs.push(`anchor="${rootAnchor}"`)
      const off = rootTf.anchorOffset as [number, number] | undefined
      if (off && (off[0] !== 0 || off[1] !== 0)) {
        rootAttrs.push(`offset="${round4(off[0])},${round4(off[1])}"`)
      }
    }

    // ─── 收集样式规则（class → 声明）+ 主体节点 ───
    const rules: Array<{ selector: string; decls: string[] }> = []
    const bodyNodes: Array<{ line: string; depth: number }> = []
    for (const child of root.children ?? []) {
      const emitted = emitNode(child, rules, warnings, ctx, 1)
      if (emitted) bodyNodes.push(emitted)
    }

    // ─── 规范形输出 ───
    const lines: string[] = []
    lines.push(`<widget ${rootAttrs.join(' ')}>`)
    lines.push('  <style>')
    for (const r of rules) lines.push(`    ${r.selector} { ${r.decls.join('; ')}; }`)
    lines.push('  </style>')
    for (const b of bodyNodes) lines.push(b.line)
    lines.push('</widget>')
    return { ok: true, warnings, html: lines.join('\n') + '\n' }
  } catch (e) {
    warnings.push(`反编译异常: ${(e as Error).message}`)
    return { ok: false, warnings, html: undefined }
  }
}

/**
 * 输出一个节点为 HTML 行（规范形缩进），同时向 rules 累积该节点 class 的样式。
 * 命名规范：节点名即 class 名（编译端 nodeNameOf 优先取 class，round-trip 一致）。
 */
/** 输出一个节点为 HTML 片段（带深度缩进），同时向 rules 累积该节点 class 的样式。 */
function emitNode(
  node: JsonNode,
  rules: Array<{ selector: string; decls: string[] }>,
  warnings: string[],
  ctx: CompileContext,
  depth: number,
): { line: string; depth: number } | null {
  const name = String(node.name ?? 'Node')
  const cls = name
  const tf = (compOf(node, 'UITransformComponent')?.properties ?? {}) as Record<string, unknown>
  const canvasComp = compOf(node, 'CanvasUIComponent')
  const decls: string[] = []
  const attrs: string[] = [`class="${cls}"`]

  // ─── 尺寸 ───
  const ww = Number(tf.worldWidth ?? 0)
  const wh = Number(tf.worldHeight ?? 0)
  if (ww > 0) decls.push(`width: ${pxOfX(ww, ctx)}`)
  if (wh > 0) decls.push(`height: ${pxOfY(wh, ctx)}`)

  // ─── 定位（锚点 → position:absolute + left/top %）───
  const anchor = tf.anchor as string | undefined
  const offset = (tf.anchorOffset as [number, number] | undefined) ?? [0, 0]
  const pos = anchorToPos(anchor, offset, tf, ctx)
  if (pos) {
    decls.push('position: absolute')
    decls.push(`left: ${pos.left}`)
    decls.push(`top: ${pos.top}`)
  }

  // ─── canvasui 专有：z-order / hit-test ───
  const zOrder = Number(canvasComp?.properties?.zOrder ?? 0)
  if (zOrder !== 0) decls.push(`z-order: ${zOrder}`)
  const hitTest = canvasComp?.properties?.hitTest as string | undefined
  if (hitTest && hitTest !== 'visible') decls.push(`hit-test: ${hitTest}`)
  if (node.active === false) warnings.push(`节点 "${name}" 为 active=false（源格式暂不表达失活，信息保留在 json）`)

  // ─── 功能组件 ───
  const funcComps = (node.components ?? []).filter((c) => !COMMON_COMPS.has(c.baseClass))
  let tag = 'div'
  let text = ''
  const dataAttrs: string[] = []

  const layoutComp = funcComps.find((c) => c.baseClass === 'UILayoutComponent')
  if (layoutComp) {
    const p = (layoutComp.properties ?? {}) as Record<string, unknown>
    decls.push('display: flex')
    decls.push(`flex-direction: ${p.mode === 'vertical' ? 'column' : 'row'}`)
    const sx = Number(p.spacingX ?? 0)
    const sy = Number(p.spacingY ?? 0)
    if (sx > 0 || sy > 0) decls.push(`gap: ${pxOfX(Math.max(sx, sy), ctx)}`)
    if (p.justify && p.justify !== 'center') decls.push(`justify-content: ${String(p.justify)}`)
    if (p.align && p.align !== 'center') decls.push(`align-items: ${String(p.align)}`)
  }

  const scriptComp = funcComps.find((c) => c.baseClass === 'UIScriptComponent')
  if (scriptComp) {
    const p = (scriptComp.properties ?? {}) as Record<string, unknown>
    if (p.script) dataAttrs.push(`data-script="${String(p.script)}"`)
    if (p.args) dataAttrs.push(`data-args='${JSON.stringify(p.args)}'`)
  }

  const imgComp = funcComps.find((c) => c.baseClass === 'UIImageComponent')
  const textComp = funcComps.find((c) => c.baseClass === 'UITextComponent')
  const btnComp = funcComps.find((c) => c.baseClass === 'UIButtonComponent')

  if (imgComp) {
    tag = 'img'
    const p = (imgComp.properties ?? {}) as Record<string, unknown>
    if (p.src) attrs.push(`src="${String(p.src)}"`)
    else if (p.color) decls.push(`background-color: ${String(p.color)}`)
    if (p.radius) decls.push(`border-radius: ${Math.round(Number(p.radius))}px`) // 画布像素直通（与编译端对称）
    if (p.opacity !== undefined && Number(p.opacity) !== 1) decls.push(`opacity: ${fmtNum(Number(p.opacity))}`)
    if (p.zOrder !== undefined && Number(p.zOrder) !== 0) decls.push(`z-order: ${Number(p.zOrder)}`)
    if (p.hitTest && p.hitTest !== 'visible') decls.push(`hit-test: ${String(p.hitTest)}`)
    // img（void 元素）不允许有子节点：有子节点的 image 节点降级为 div 承载
    if ((node.children ?? []).length > 0 || textComp) tag = 'div'
  }

  if (btnComp) {
    tag = 'button'
    const p = (btnComp.properties ?? {}) as Record<string, unknown>
    if (p.pressScale !== undefined && Number(p.pressScale) !== 0.92) {
      dataAttrs.push(`data-comp="UIButton" data-props='${JSON.stringify({ pressScale: p.pressScale })}'`)
      warnings.push(`节点 "${name}" UIButton pressScale=${String(p.pressScale)} 非默认值：以 data-comp 逃逸保留`)
    }
  }

  // ─── 原生标签还原：input/textarea/progress / overflow:auto / title ───
  const inputComp = funcComps.find((c) => c.baseClass === 'UITextInputComponent')
  const progressComp = funcComps.find((c) => c.baseClass === 'UIProgressBarComponent')
  const scrollComp = funcComps.find((c) => c.baseClass === 'UIScrollListComponent')
  const tooltipComp = funcComps.find((c) => c.baseClass === 'UITooltipComponent')

  if (inputComp) {
    tag = 'input'
    const p = (inputComp.properties ?? {}) as Record<string, unknown>
    if (p.placeholder) attrs.push(`placeholder="${String(p.placeholder)}"`)
    if (p.value) attrs.push(`value="${String(p.value)}"`)
    if (p.fontSize !== undefined) decls.push(`font-size: ${Math.round(Number(p.fontSize))}px`)
    if (p.color) decls.push(`color: ${String(p.color)}`)
    if (p.zOrder !== undefined && Number(p.zOrder) !== 0 && zOrder === 0) decls.push(`z-order: ${Number(p.zOrder)}`)
    if (p.hitTest && p.hitTest !== 'visible' && !hitTest) decls.push(`hit-test: ${String(p.hitTest)}`)
    // 引擎无多行输入：textarea 语义不保留（round-trip 统一为 input）
  }

  if (progressComp) {
    tag = 'progress'
    const p = (progressComp.properties ?? {}) as Record<string, unknown>
    if (p.value !== undefined) attrs.push(`value="${String(p.value)}"`)
    if (p.max !== undefined) attrs.push(`max="${String(p.max)}"`)
    // min/fillActorName/direction 非默认值时以 data-comp 逃逸保留（引擎扩展语义）
    const extras: Record<string, unknown> = {}
    if (p.min !== undefined && Number(p.min) !== 0) extras.min = p.min
    if (p.fillActorName !== undefined && p.fillActorName !== 'Fill') extras.fillActorName = p.fillActorName
    if (p.direction !== undefined && p.direction !== 'left-to-right') extras.direction = p.direction
    if (Object.keys(extras).length > 0) {
      dataAttrs.push(`data-comp="UIProgress" data-props='${JSON.stringify(extras)}'`)
    }
  }

  if (scrollComp) {
    const p = (scrollComp.properties ?? {}) as Record<string, unknown>
    decls.push(p.direction === 'horizontal' ? 'overflow-x: auto' : 'overflow: auto')
    // itemWidget/spacing/visibleCount 等引擎扩展属性以 data-comp 逃逸保留（保留 direction 之外的）
    const extras: Record<string, unknown> = { ...p }
    delete extras.direction
    if (Object.keys(extras).length > 0) {
      dataAttrs.push(`data-comp="UIScrollList" data-props='${JSON.stringify(extras)}'`)
    }
  }

  if (tooltipComp) {
    const p = (tooltipComp.properties ?? {}) as Record<string, unknown>
    attrs.push(`title="${String(p.text ?? '')}"`)
    // delay/direction/widgetPath 非默认值时以 data-comp 逃逸保留
    const extras: Record<string, unknown> = {}
    if (p.delay !== undefined && Number(p.delay) !== 0.3) extras.delay = p.delay
    if (p.direction !== undefined && p.direction !== 'top') extras.direction = p.direction
    if (p.widgetPath !== undefined) extras.widgetPath = p.widgetPath
    if (Object.keys(extras).length > 0) {
      dataAttrs.push(`data-comp="UITooltip" data-props='${JSON.stringify(extras)}'`)
    }
  }

  // 其余逃逸组件（input/progress/scroll/tooltip 已原生还原，不再逃逸）
  for (const c of funcComps) {
    if (!ESCAPE_COMPS.has(c.baseClass)) continue
    if (NATIVE_MAPPED_COMPS.has(c.baseClass)) continue
    const short = c.baseClass.replace(/Component$/, '')
    dataAttrs.push(`data-comp="${short}" data-props='${JSON.stringify(c.properties ?? {})}'`)
    warnings.push(`节点 "${name}" 组件 ${c.baseClass} 无源格式映射：以 data-comp 逃逸承载`)
  }

  // 文本组件 → 元素文本内容 + 文本样式
  if (textComp) {
    const p = (textComp.properties ?? {}) as Record<string, unknown>
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
    // 文本节点（markerOnly 无渲染）：反编译为 <text> 元素
    tag = 'text'
  }

  // 注入样式规则（class 选择器）
  if (decls.length > 0) rules.push({ selector: `.${cls}`, decls })
  for (const d of dataAttrs) attrs.push(d)

  // ─── 子节点 ───
  const childLines: string[] = []
  for (const c of node.children ?? []) {
    const emitted = emitNode(c, rules, warnings, ctx, depth + 1)
    if (emitted) childLines.push(emitted.line)
  }

  const pad = '  '.repeat(depth)
  const openTag = [`<${tag}`, ...attrs].join(' ')
  if (tag === 'img' || tag === 'input') {
    return { line: `${pad}<${tag} ${attrs.join(' ')} />`, depth }
  }
  if (childLines.length === 0 && !text) {
    return { line: `${pad}${openTag}></${tag}>`, depth }
  }
  if (childLines.length === 0) {
    return { line: `${pad}${openTag}>${text}</${tag}>`, depth }
  }
  const inner = [text, ...childLines].filter(Boolean).join(`\n${pad}`)
  return { line: `${pad}${openTag}>\n${inner}\n${pad}</${tag}>`, depth }

  /** 锚点 + offset → position:absolute left/top %（与编译端公式互逆） */
  function anchorToPos(
    a: string | undefined,
    off: [number, number],
    tf: Record<string, unknown>,
    ctx: CompileContext,
  ): { left: string; top: string } | null {
    if (!a) return null
    let lPct = 50
    let tPct = 50
    if (a.includes('left')) lPct = 0
    else if (a.includes('right')) lPct = 100
    if (a.startsWith('top')) tPct = 0
    else if (a.startsWith('bottom')) tPct = 100
    // 反解编译端：wantX = baseX + offX → lp = 50 + wantX/worldWidth×100
    const wW = Number(tf.worldWidth ?? 0)
    const wH = Number(tf.worldHeight ?? 0)
    const fx = a.includes('left') ? -1 : a.includes('right') ? 1 : 0
    const fy = a.startsWith('top') ? 1 : a.startsWith('bottom') ? -1 : 0
    const wantXm = fx * (ctx.worldWidth / 2 - wW / 2) + (off?.[0] ?? 0)
    const wantYm = fy * (ctx.worldHeight / 2 - wH / 2) + (off?.[1] ?? 0)
    const lp = 50 + (wantXm / ctx.worldWidth) * 100
    const tp = 50 - (wantYm / ctx.worldHeight) * 100
    const fmt = (v: number) => `${Math.round(v * 100) / 100}%`
    return { left: fmt(lp), top: fmt(tp) }
  }
}
