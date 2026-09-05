/**
 * decompile — ui-decompiler：xxx.widget.json → xxx.widget.html（方案 §6 反编译回写）
 *
 * 面对的是本编译器自己生成的 json（结构/组件顺序/命名均为编译器规范形），
 * 输出规范形 HTML：全部节点以"绝对定位 + class 样式"表达（编译产物已是
 * 静态求解后的具体矩形，反编译直接回读像素位置），保证 round-trip 语义等效：
 * html → json → html' → json'' 与 json 布局/视觉/交互一致。
 *
 * 防御（TC-C3）：非编译器产物（无 sourceHash）→ 结果带 warning，仍尽力转换；
 * 映射不到的组件/属性走 data-comp/data-props 逃逸通道，不丢信息（TC-C4）。
 */
import type { CompileContext } from './compileTypes'
import { FULLSCREEN_CANVAS_WIDTH, FULLSCREEN_CANVAS_HEIGHT } from './widgetMapping'
import { REGION_FAMILY_COMPS, formatRegionContent } from './propertiesRegion'

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

/** 数值格式化：整数不带小数点，最多 4 位小数（对齐编译端 round4 落盘网格，逐位无损往返） */
function fmtNum(v: number): string {
  return String(Math.round(v * 10000) / 10000)
}

/** 组件查找 */
function compOf(node: JsonNode, baseClass: string): JsonComp | undefined {
  return node.components?.find((c) => c.baseClass === baseClass)
}

/** 通用组件（渲染时跳过） */
const COMMON_COMPS = new Set(['UITransformComponent', 'CanvasUIComponent'])
/** 原生标签已映射的组件（反编译还原为标签/属性，不再走 data-comp 逃逸） */
const NATIVE_MAPPED_COMPS = new Set([
  'UIImageComponent', 'UITextComponent', 'UIButtonComponent', 'UILayoutComponent',
  'UITextInputComponent', 'UIProgressBarComponent', 'UIScrollListComponent',
  'UIScrollContainerComponent', 'UIMaskComponent',
  'UITooltipComponent', 'UIScriptComponent',
])
/** 未映射组件逃逸白名单（与编译器 KNOWN_UI_COMPONENTS 一致 + 其它引擎组件放行） */

/** CSS 规范形声明表（class → decls） */
interface OutRule {
  selector: string
  decls: string[]
}
/** 交互态规则（:hover 等） */
interface OutStateRule {
  selector: string
  pseudo: string
  decls: string[]
}

interface GradSpec {
  angle: number
  stops: Array<{ color: string; offset: number }>
}

export function decompileWidgetJson(doc: unknown): DecompileResult {
  const warnings: string[] = []

  try {
    const root = JSON.parse(JSON.stringify(doc)) as JsonNode
    // 深拷贝输入：反编译必须无副作用（_ScrollContent 折叠会重定基子项坐标，
    // 原地改写会污染调用方持有的文档——round-trip 差异的隐形来源）
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return { ok: false, warnings: ['文档不是对象'], html: undefined }
    }
    if (!('sourceHash' in root)) {
      warnings.push('该 widget.json 无 sourceHash（非编译器产物或旧资产）：尽力转换，映射不到的组件走 data-comp 逃逸')
    }

    // 前置摘出：region 承载组件（UIWorldAnchorComponent）从全部节点摘出 →
    // <properties> 参数区（按节点名键控）；其余组件沿用既有通道（data-comp/data-props 等）。
    // 键用摘出时的原始节点名（编译产物 name 全局唯一；重名防御改写的手工资产会告警，
    // 其 region 键可能失配——编译端按"引用不存在节点"硬报错，不静默丢参数）
    const region: Record<string, Record<string, Record<string, unknown>>> = {}
    const pullRegionComps = (n: JsonNode): void => {
      const comps = n.components ?? []
      for (const baseClass of REGION_FAMILY_COMPS) {
        const idx = comps.findIndex((c) => c.baseClass === baseClass)
        if (idx >= 0) {
          const name = String(n.name ?? 'Node')
          region[name] = { ...(region[name] ?? {}), [baseClass]: { ...(comps[idx].properties ?? {}) } }
          comps.splice(idx, 1)
        }
      }
      for (const c of n.children ?? []) pullRegionComps(c)
    }
    pullRegionComps(root)

    const rootTf = compOf(root, 'UITransformComponent')?.properties ?? {}
    const canvasComp = root.components?.find((c) => c.baseClass === 'CanvasUIComponent' && !(c.properties as { markerOnly?: boolean } | undefined)?.markerOnly)
    const canvasProps = (canvasComp?.properties ?? {}) as Record<string, number>
    const cw = Number(canvasProps.width ?? FULLSCREEN_CANVAS_WIDTH)
    const ch = Number(canvasProps.height ?? FULLSCREEN_CANVAS_HEIGHT)
    // px 一元化：json 几何即画布 px，直读直写（无任何换算；D4）
    const ctx: CompileContext = { canvasWidth: cw, canvasHeight: ch }

    const name = String(root.name ?? 'Widget')
    const rootAttrs = [`name="${escapeAttr(name)}"`, `canvas="${cw}x${ch}"`]
    if (rootTf.anchor) {
      rootAttrs.push(`anchor="${String(rootTf.anchor)}"`)
      const off = rootTf.anchorOffset as [number, number] | undefined
      if (off && (off[0] !== 0 || off[1] !== 0)) rootAttrs.push(`offset="${fmtNum(off[0])},${fmtNum(off[1])}"`)
    }
    // 根 Actor 默认隐藏 → <widget active="false">（编译端等价还原 root.active=false）
    if (root.active === false) rootAttrs.push('active="false"')
    // 根行为脚本 → <widget data-script="...">（编译端 emitDataScript 挂回根节点）
    const rootScript = compOf(root, 'UIScriptComponent')
    if (rootScript) {
      const sp = (rootScript.properties ?? {}) as Record<string, unknown>
      if (sp.script) {
        rootAttrs.push(`data-script="${escapeAttr(String(sp.script))}"`)
        if (sp.args && Object.keys(sp.args as object).length > 0) {
          rootAttrs.push(`data-args='${escapeAttr(JSON.stringify(sp.args))}'`)
        }
      }
    }

    const rules: OutRule[] = []
    const stateRules: OutStateRule[] = []
    // 根背景（编译端 RootBackground）→ widget 根 class 规则回写
    const rootBg = root.components?.find((c) => c.baseClass === 'UIImageComponent')
    if (rootBg) {
      const p = (rootBg.properties ?? {}) as Record<string, unknown>
      const decls: string[] = []
      if (p.src) decls.push(`background-image: url(${String(p.src)})`)
      else if (p.gradient) {
        const g = p.gradient as GradSpec
        const stops = g.stops.map((st) => `${st.color} ${fmtNum(st.offset * 100)}%`).join(', ')
        decls.push(`background-image: linear-gradient(${fmtNum(g.angle)}deg, ${stops})`)
      } else if (p.color) decls.push(`background-color: ${String(p.color)}`)
      if (p.radius) decls.push(`border-radius: ${fmtNum(Number(p.radius))}px`)
      if (p.opacity !== undefined && Number(p.opacity) !== 1) decls.push(`opacity: ${fmtNum(Number(p.opacity))}`)
      if (decls.length > 0) {
        rules.push({ selector: '.RootCanvas', decls })
        rootAttrs.push('class="RootCanvas"')
      }
    }
    const usedNames = new Set<string>()
    // 其余根组件 → data-comp/data-props 逃逸回写 <widget> 属性（TC-C4 不丢信息；
    // 编译端 <widget data-comp> 等价还原为根 Actor 组件）
    const knownRootComps = new Set(['UITransformComponent', 'CanvasUIComponent', 'UIScriptComponent'])
    for (const c of root.components ?? []) {
      if (knownRootComps.has(c.baseClass) || c === rootBg) continue
      const p = (c.properties ?? {}) as Record<string, unknown>
      rootAttrs.push(`data-comp="${escapeAttr(String(c.baseClass))}"`)
      if (Object.keys(p).length > 0) rootAttrs.push(`data-props='${escapeAttr(JSON.stringify(p))}'`)
    }
    const bodyLines: string[] = []
    // 父盒（画布 px）：cx/cy=边盒中心，x/y=边盒左上，w/h=边盒尺寸，inX/inY=内容内缩（padding+border）
    const parentBox0 = { cx: cw / 2, cy: ch / 2, x: 0, y: 0, w: cw, h: ch, inX: 0, inY: 0 }
    for (const child of root.children ?? []) {
      const line = emitNode(child, rules, stateRules, warnings, ctx, usedNames, 2, parentBox0, false)
      if (line) bodyLines.push(line)
    }

    const out: string[] = []
    out.push(`<widget ${rootAttrs.join(' ')}>`)
    // region 非空 → <widget> 开标签后输出规范格式 <properties> 块（2 空格缩进）
    if (Object.keys(region).length > 0) {
      out.push('  <properties>')
      for (const l of formatRegionContent(region).split('\n')) out.push(l)
      out.push('  </properties>')
    }
    out.push('  <style>')
    for (const r of rules) out.push(`    ${r.selector} { ${r.decls.join('; ')}; }`)
    for (const r of stateRules) out.push(`    ${r.selector}:${r.pseudo} { ${r.decls.join('; ')}; }`)
    out.push('  </style>')
    for (const b of bodyLines) out.push(b)
    out.push('</widget>')
    return { ok: true, warnings, html: out.join('\n') + '\n' }
  } catch (e) {
    warnings.push(`反编译异常: ${(e as Error).message}`)
    return { ok: false, warnings, html: undefined }
  }

  /**
   * 堆叠流还原门：容器子项几何与块级纵排 / 净 flex 横排完全一致时返回 'column'/'row'，
   * 否则 null（保持绝对定位）。几何口径：子项内容盒原点（边盒左上 + 自身 sidecar 内缩），
   * 首项贴容器内容原点，之后逐项紧贴前一项边盒（等价于 margin 全 0）。
   */
  function stackGate(
    node: JsonNode,
    ctx: CompileContext,
    parentBox: { cx: number; cy: number; x: number; y: number; w: number; h: number; inX: number; inY: number },
  ): 'column' | 'row' | null {
    const tol = 0.11 // px（世界 2 位小数量化噪声上限）
    const kids = (node.children ?? []).filter((c) => c.active !== false)
    if (kids.length === 0) return null
    const rects: Array<{ cx0: number; cy0: number; x: number; y: number; w: number; h: number }> = []
    for (const c of kids) {
      const tf = (compOf(c, 'UITransformComponent')?.properties ?? {}) as Record<string, unknown>
      const wwC = Number(tf.worldWidth ?? -1)
      const whC = Number(tf.worldHeight ?? -1)
      if (wwC <= 0 || whC <= 0) return null
      if (tf.anchor) return null // 锚点子项 = 显式定位，不入流
      const rot = tf.rotation as [number, number, number] | undefined
      if (rot && (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0)) return null
      const scl = tf.scale as [number, number, number] | undefined
      if (scl && (scl[0] !== 1 || scl[1] !== 1)) return null
      const lp = tf.position as [number, number, number] | undefined
      if (!lp) return null
      // 子项自身内容内缩（sidecar）
      const slc = (c as { sourceLayout?: { padding?: number[]; border?: number[]; flexShrink?: number } }).sourceLayout
      const inXC = (slc?.padding?.[3] ?? 0) + (slc?.border?.[3] ?? 0)
      const inYC = (slc?.padding?.[0] ?? 0) + (slc?.border?.[0] ?? 0)
      // 画布边盒左上（父边盒中心 + 本地偏移直读，px 世界无换算）
      const wpx = wwC
      const hpx = whC
      const bx = parentBox.cx + lp[0] - wpx / 2
      const by = parentBox.cy - lp[1] - hpx / 2
      rects.push({ cx0: bx + inXC, cy0: by + inYC, x: bx, y: by, w: wpx, h: hpx })
    }
    const contentX = parentBox.x + parentBox.inX
    const contentY = parentBox.y + parentBox.inY
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= tol
    // 纵排：同 x、自上而下紧贴
    let col = near(rects[0].cx0, contentX) && near(rects[0].cy0, contentY)
    for (let i = 1; i < rects.length && col; i++) {
      col = near(rects[i].cx0, contentX) && near(rects[i].cy0, rects[i - 1].y + rects[i - 1].h)
    }
    if (col) return 'column'
    // 横排：同 y、自左向右紧贴
    let row = near(rects[0].cx0, contentX) && near(rects[0].cy0, contentY)
    for (let i = 1; i < rects.length && row; i++) {
      row = near(rects[i].cy0, contentY) && near(rects[i].cx0, rects[i - 1].x + rects[i - 1].w)
    }
    if (row) return 'row'
    return null
  }

  /** 发射一个节点（递归）；返回该行的 HTML 文本 */
  function emitNode(
    node: JsonNode,
    rules: OutRule[],
    stateRules: OutStateRule[],
    warnings: string[],
    ctx: CompileContext,
    usedNames: Set<string>,
    depth: number,
    parentBox: { cx: number; cy: number; x: number; y: number; w: number; h: number; inX: number; inY: number },
    parentFlow: boolean,
  ): string | null {
    if (!node || typeof node !== 'object') return null
    let name0 = String(node.name ?? 'Node')
    // 同名防御（编译器保证唯一；手工资产可能撞名）
    if (usedNames.has(name0)) {
      let i = 2
      while (usedNames.has(`${name0}_${i}`)) i++
      name0 = `${name0}_${i}`
      warnings.push(`节点重名已改写: ${node.name} → ${name0}`)
    }
    usedNames.add(name0)
    const cls = sanitizeClass(name0)
    const tf = (compOf(node, 'UITransformComponent')?.properties ?? {}) as Record<string, unknown>
    const canvasMarker = compOf(node, 'CanvasUIComponent')
    const decls: string[] = []
    const attrs: string[] = [`class="${escapeAttr(cls)}"`]

    // ─── 尺寸/定位：沿父链累计出画布绝对中心（编译产物的本地偏移/锚点均相对父） ───
    const ww = Number(tf.worldWidth ?? 0)
    const wh = Number(tf.worldHeight ?? 0)
    const anchor = tf.anchor as string | undefined
    // stretch 全锚 → width/height:100%（原生全屏惯用法，与编译端"两轴 100% → stretch"
    // 映射互为不动点：html(100%) → json(stretch) → html(100%)）；若回写显式 px，
    // 编辑器保存后再编译会退化为 center + 快照尺寸（视口重排盲区）
    if (anchor === 'stretch') {
      decls.push('width: 100%')
      decls.push('height: 100%')
    } else {
      if (ww > 0) decls.push(`width: ${fmtNum(ww)}px`)
      if (wh > 0) decls.push(`height: ${fmtNum(wh)}px`)
    }
    const offset = (tf.anchorOffset as [number, number] | undefined) ?? [0, 0]
    const localPos = tf.position as [number, number, number] | undefined
    // ─── sourceLayout 侧车：盒模型重建（引擎/编译器约定 uitransform=边盒）───
    const sl = (node as { sourceLayout?: { padding?: number[]; border?: number[]; flexShrink?: number } }).sourceLayout
    const slPad = sl?.padding
    const slBord = sl?.border
    const hasPad = !!slPad && slPad.some((v) => v > 0.005)
    const hasBord = !!slBord && slBord.some((v) => v > 0.005)
    if (hasPad || hasBord) {
      decls.push('box-sizing: border-box')
      if (hasPad) decls.push(`padding: ${slPad!.map((v) => fmtNum(v)).join('px ')}px`)
    }
    // flex 子项 shrink 语义还原（编译端 sourceLayout.flexShrink 侧车，根因五）
    if (Number(sl?.flexShrink ?? 1) === 0) decls.push('flex-shrink: 0')

    // 绝对中心（画布 px）：锚点语义 = 父边盒中心 + applyAnchor 公式（基准=父尺寸，
    // 与运行时 uitransform 容器一致）；流内 = 父中心 + 本地偏移。
    let centerX = parentBox.cx
    let centerY = parentBox.cy
    if (anchor && anchor !== 'stretch') {
      const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
      const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
      centerX += (fx * (parentBox.w - ww)) / 2 + (offset[0] ?? 0)
      // world y 向上、canvas y 向下：整体取负（含 offset）
      centerY -= (fy * (parentBox.h - wh)) / 2 + (offset[1] ?? 0)
    } else if (localPos) {
      centerX += localPos[0]
      centerY -= localPos[1]
    }

    // ─── 功能组件前置探测：UILayout → display:flex 结构还原 ───
    // 空容器（运行时动态填充列表）不走 flex 还原：编译端对空容器无法补发 UILayout，
    // 改走 data-comp 精确保留布局参数，保证 反编译→重编译 往返不丢 UILayoutComponent
    const funcComps0 = (node.components ?? []).filter((c) => !COMMON_COMPS.has(c.baseClass))
    const layoutComp = funcComps0.find((c) => c.baseClass === 'UILayoutComponent')
    let flowChildren = false
    if (layoutComp && (node.children ?? []).length > 0) {
      const p = (layoutComp.properties ?? {}) as Record<string, unknown>
      const isColumn = String(p.mode ?? 'horizontal') === 'vertical'
      decls.push('display: flex')
      if (isColumn) decls.push('flex-direction: column')
      const sx = Number(p.spacingX ?? 0)
      const sy = Number(p.spacingY ?? 0)
      if (sx > 0.005 || sy > 0.005) {
        if (Math.abs(sx - sy) < 0.005) decls.push(`gap: ${fmtNum(sx)}px`)
        else decls.push(`gap: ${fmtNum(sy)}px ${fmtNum(sx)}px`)
      }
      // 引擎缺省 justify/align=center（v1 资产可能缺省）→ CSS 侧显式写全
      const j = String(p.justify ?? 'center')
      const a = String(p.align ?? 'center')
      decls.push(`justify-content: ${j === 'start' ? 'flex-start' : j === 'end' ? 'flex-end' : j}`)
      decls.push(`align-items: ${a === 'start' ? 'flex-start' : a === 'end' ? 'flex-end' : a}`)
      flowChildren = true
    } else if (layoutComp) {
      // 空容器 + UILayout：data-comp 逃逸精确保留（编译端 emitDataComp 并入）
      const p = (layoutComp.properties ?? {}) as Record<string, unknown>
      attrs.push(`data-comp="UILayout" data-props='${escapeAttr(JSON.stringify(p))}'`)
    }

    // left/top 相对父内容盒原点（编译端绝对定位包含块 = 父内容盒；inX/inY = 父 padding+border）
    const bbWpx0 = ww
    const bbHpx0 = wh
    if (anchor === 'stretch') {
      // stretch 回写定位：left/top 0%（声明贴父内容盒原点；编译端两轴 100% 分支
      // 不推导锚点，此声明仅表达全屏语义，与运行时填满父容器的行为一致）
      decls.push('position: absolute')
      decls.push('left: 0%')
      decls.push('top: 0%')
    } else if (!parentFlow && (ww > 0 || wh > 0 || localPos || anchor)) {
      // CSS left 语义（与 layoutAbsolute 一致）= 子项边盒缘相对父内容原点
      // （编译端再自行加 ml+pl+bl 得内容原点；margin 不落盘恒 0，无需扣除）
      decls.push('position: absolute')
      decls.push(`left: ${fmtNum(centerX - bbWpx0 / 2 - parentBox.x - parentBox.inX)}px`)
      decls.push(`top: ${fmtNum(centerY - bbHpx0 / 2 - parentBox.y - parentBox.inY)}px`)
    }

    // ─── 无 UILayout 的容器：纵/横堆叠流还原门 ───
    // 全部子项几何与"块级纵排 / 净 flex 横排"重排结果一致（无锚点/变换、首项贴内容
    // 原点、逐项紧贴前一项边盒 = margin 全 0）才还原为流内子项，否则保持绝对定位。
    let stackRow = false
    if (!layoutComp && (node.children ?? []).length > 0) {
      const gate = stackGate(node, ctx, parentBox)
      if (gate) {
        flowChildren = true
        stackRow = gate === 'row'
        if (stackRow) decls.push('display: flex') // 纵排块级流天然堆叠，无需声明
      }
    }
    const rotation = tf.rotation as [number, number, number] | undefined
    if (rotation && rotation[2] !== 0) {
      decls.push(`transform: rotate(${fmtNum((rotation[2] * 180) / Math.PI)}deg)`)
    }
    const scale = tf.scale as [number, number, number] | undefined
    if (scale && (scale[0] !== 1 || scale[1] !== 1)) {
      decls.push(`transform: scale(${fmtNum(scale[0])}, ${fmtNum(scale[1])})`)
    }

    // ─── 层级/交互 ───
    const markerProps = (canvasMarker?.properties ?? {}) as Record<string, unknown>
    const zOrder = Number(markerProps.zOrder ?? 0)
    if (zOrder !== 0) decls.push(`z-index: ${zOrder}`)
    const hitTest = markerProps.hitTest as string | undefined
    if (hitTest === 'hitTestInvisible') decls.push('pointer-events: none')
    else if (hitTest === 'block' || hitTest === 'visible') decls.push(`hit-test: ${hitTest}`)
    if (node.active === false) decls.push('visibility: hidden')

    // ─── 功能组件 → 标签/属性/样式 ───
    const funcComps = (node.components ?? []).filter((c) => !COMMON_COMPS.has(c.baseClass))
    const img = funcComps.find((c) => c.baseClass === 'UIImageComponent')
    const text = funcComps.find((c) => c.baseClass === 'UITextComponent')
    const btn = funcComps.find((c) => c.baseClass === 'UIButtonComponent')
    const input = funcComps.find((c) => c.baseClass === 'UITextInputComponent')
    const progress = funcComps.find((c) => c.baseClass === 'UIProgressBarComponent')
    const scroll = funcComps.find((c) => c.baseClass === 'UIScrollListComponent')
    const scrollContainer = funcComps.find((c) => c.baseClass === 'UIScrollContainerComponent')
    const mask = funcComps.find((c) => c.baseClass === 'UIMaskComponent')
    const tooltip = funcComps.find((c) => c.baseClass === 'UITooltipComponent')
    const script = funcComps.find((c) => c.baseClass === 'UIScriptComponent')

    let tag = 'div'
    let textContent = ''

    if (img) {
      const p = (img.properties ?? {}) as Record<string, unknown>
      const hasChildren = (node.children ?? []).length > 0
      if (p.src && !hasChildren && !text) {
        tag = 'img'
        attrs.push(`src="${escapeAttr(String(p.src))}"`)
      } else if (p.src) {
        decls.push(`background-image: url(${String(p.src)})`)
      } else if (p.gradient) {
        const g = p.gradient as GradSpec
        const stops = g.stops.map((s) => `${s.color} ${fmtNum(s.offset * 100)}%`).join(', ')
        decls.push(`background-image: linear-gradient(${fmtNum(g.angle)}deg, ${stops})`)
      } else if (p.color) {
        decls.push(`background-color: ${String(p.color)}`)
      }
      if (p.radius) decls.push(`border-radius: ${fmtNum(Number(p.radius))}px`)
      if (p.opacity !== undefined && Number(p.opacity) !== 1) decls.push(`opacity: ${fmtNum(Number(p.opacity))}`)
      if (p.zOrder !== undefined && Number(p.zOrder) !== 0 && zOrder === 0) decls.push(`z-index: ${Number(p.zOrder)}`)
      // hitTest 不从功能块反解：命中测试唯一归属 Canvas marker 块（上方 markerProps 通道）
    }

    if (btn) {
      tag = 'button'
      // 交互态 stateColors → 源格式 :hover/:active/:disabled 规则（引擎原生驱动，无需脚本）
      const sc = ((btn.properties ?? {}) as Record<string, unknown>).stateColors as
        | Record<string, Record<string, unknown>>
        | undefined
      if (sc && typeof sc === 'object') {
        for (const [stateKey, pseudo] of [['hover', 'hover'], ['pressed', 'active'], ['disabled', 'disabled']] as Array<[string, string]>) {
          const st = sc[stateKey]
          if (!st || typeof st !== 'object') continue
          const sdecls: string[] = []
          if (st.color) sdecls.push(`color: ${String(st.color)}`)
          if (st.opacity !== undefined) sdecls.push(`opacity: ${fmtNum(Number(st.opacity))}`)
          if (sdecls.length > 0) stateRules.push({ selector: `.${cls}`, pseudo, decls: sdecls })
        }
      }
    }

    if (input) {
      tag = 'input'
      const p = (input.properties ?? {}) as Record<string, unknown>
      if (p.placeholder) attrs.push(`placeholder="${escapeAttr(String(p.placeholder))}"`)
      if (p.value) attrs.push(`value="${escapeAttr(String(p.value))}"`)
      applyTextDeclsWith(p, decls, ctx)
    }

    if (progress) {
      tag = 'progress'
      const p = (progress.properties ?? {}) as Record<string, unknown>
      if (p.value !== undefined) attrs.push(`value="${escapeAttr(String(p.value))}"`)
      if (p.max !== undefined) attrs.push(`max="${escapeAttr(String(p.max))}"`)
      const extras: Record<string, unknown> = { ...p }
      delete extras.value
      delete extras.max
      if (Object.keys(extras).length > 0) {
        attrs.push(`data-comp="UIProgress" data-props='${escapeAttr(JSON.stringify(extras))}'`)
      }
    }

    if (scroll) {
      const p = (scroll.properties ?? {}) as Record<string, unknown>
      decls.push(p.direction === 'horizontal' ? 'overflow-x: auto' : 'overflow-y: auto')
      const extras: Record<string, unknown> = { ...p }
      delete extras.direction
      if (Object.keys(extras).length > 0) {
        attrs.push(`data-comp="UIScrollList" data-props='${escapeAttr(JSON.stringify(extras))}'`)
      }
    }

    if (scrollContainer) {
      // 通用滚动容器：溢出声明在此；_ScrollContent 内容层折叠在子节点区（需 emittedChildren）
      const p = (scrollContainer.properties ?? {}) as Record<string, unknown>
      decls.push(p.direction === 'horizontal' ? 'overflow-x: auto' : 'overflow-y: auto')
    }

    if (mask) {
      // 裁剪遮罩：有滚动声明时裁剪语义已蕴含，仅补 overflow:hidden（纯裁剪）；
      // radius 与视觉圆角（UIImage.radius px）不一致时补 border-radius（重编译重建 UIMask）
      const hasScrollDecl = Boolean(scroll || scrollContainer)
      if (!hasScrollDecl) decls.push('overflow: hidden')
      const mr = Number((mask.properties ?? {}).radius ?? 0)
      const maskRadiusPx = mr
      const visualRadiusPx = Number((img?.properties ?? {}).radius ?? 0)
      if (mr > 0.005 && Math.abs(maskRadiusPx - visualRadiusPx) > 0.5) {
        decls.push(`border-radius: ${fmtNum(maskRadiusPx)}px`)
      }
    }

    if (tooltip) {
      const p = (tooltip.properties ?? {}) as Record<string, unknown>
      attrs.push(`title="${escapeAttr(String(p.text ?? ''))}"`)
      const extras: Record<string, unknown> = { ...p }
      delete extras.text
      if (Object.keys(extras).length > 0) {
        attrs.push(`data-comp="UITooltip" data-props='${escapeAttr(JSON.stringify(extras))}'`)
      }
    }

    if (script) {
      const p = (script.properties ?? {}) as Record<string, unknown>
      if (p.script) attrs.push(`data-script="${escapeAttr(String(p.script))}"`)
      const plainArgs = { ...(p.args as Record<string, unknown> | undefined) }
      // 交互态 args → 源格式 :hover/:active/:disabled 规则
      const stateMap: Array<[string, string]> = [
        ['hover', 'hover'], ['pressed', 'active'], ['disabled', 'disabled'],
      ]
      for (const [argKey, pseudo] of stateMap) {
        const st = plainArgs[argKey] as Record<string, unknown> | undefined
        if (st && typeof st === 'object') {
          const sdecls: string[] = []
          if (st.color) sdecls.push(`color: ${String(st.color)}`)
          if (st.opacity !== undefined) sdecls.push(`opacity: ${fmtNum(Number(st.opacity))}`)
          if (sdecls.length > 0) stateRules.push({ selector: `.${cls}`, pseudo, decls: sdecls })
          delete plainArgs[argKey]
        }
      }
      if (Object.keys(plainArgs).length > 0) {
        attrs.push(`data-args='${escapeAttr(JSON.stringify(plainArgs))}'`)
      }
    }

    if (text && tag !== 'input') {
      const p = (text.properties ?? {}) as Record<string, unknown>
      textContent = String(p.text ?? '')
      if (tag !== 'button') tag = 'text'
      applyTextDeclsWith(p, decls, ctx)
      // anchorX 非默认值 → UIText 逃逸属性回写（编译端并入既有 UITextComponent）
      if (p.anchorX && p.anchorX !== 'center') {
        attrs.push(`data-comp="UIText" data-props='${escapeAttr(JSON.stringify({ anchorX: p.anchorX }))}'`)
      }
    }

    // 未映射组件 → data-comp 逃逸
    for (const c of funcComps) {
      if (NATIVE_MAPPED_COMPS.has(c.baseClass)) continue
      const short = c.baseClass.replace(/Component$/, '')
      attrs.push(`data-comp="${escapeAttr(short)}" data-props='${escapeAttr(JSON.stringify(c.properties ?? {}))}'`)
      warnings.push(`节点 "${name0}" 组件 ${c.baseClass} 无源格式映射：以 data-comp 逃逸承载`)
    }

    if (decls.length > 0) rules.push({ selector: `.${cls}`, decls })

    // ─── 子节点 ───
    const childLines: string[] = []
    const bbWpxC = ww
    const bbHpxC = wh
    const childBox = {
      cx: centerX, cy: centerY,
      x: centerX - bbWpxC / 2,
      y: centerY - bbHpxC / 2,
      w: bbWpxC, h: bbHpxC,
      // 自身内容内缩（子项 left/top 基准 = 本节点内容盒原点）
      inX: (hasPad ? slPad![3] : 0) + (hasBord ? slBord![3] : 0),
      inY: (hasPad ? slPad![0] : 0) + (hasBord ? slBord![0] : 0),
    }

    // 边框条子 Actor（编译端 border 的产物形）折回 border CSS：
    // 命名 <父名>Border<Side> + UIImage 纯色。全部有边框的侧都找到条才折回，否则保留子节点。
    const emittedChildren: JsonNode[] = [...(node.children ?? [])]
    // 滚动内容层折叠（编译端 overflow auto/scroll 的产物形）：单一 <名>_ScrollContent
    // 子 Actor → 子项提升到本节点（配合 overflow 声明重编译还原）。
    // 子项 position 是相对 wrapper 中心的本地坐标，提升后父中心变为容器中心，
    // 必须按 wrapper 自身偏移重定基（矢量相加），否则整组内容平移（round-trip 损坏）
    if (scrollContainer) {
      const wi = emittedChildren.findIndex((c) => String(c.name ?? '').includes('_ScrollContent'))
      if (wi >= 0) {
        const wrapper = emittedChildren[wi]
        const wtf = (compOf(wrapper, 'UITransformComponent')?.properties ?? {}) as Record<string, unknown>
        const wp = (wtf.position as [number, number, number] | undefined) ?? [0, 0, 0]
        const inner = wrapper.children ?? []
        for (const c of inner) {
          const ctf = (compOf(c, 'UITransformComponent')?.properties ?? {}) as Record<string, unknown>
          if (!ctf.anchor && Array.isArray(ctf.position)) {
            ctf.position = [
              Number(ctf.position[0] ?? 0) + Number(wp[0] ?? 0),
              Number(ctf.position[1] ?? 0) + Number(wp[1] ?? 0),
              Number(ctf.position[2] ?? 0),
            ]
          } else {
            warnings.push(`节点 "${name0}" 的 _ScrollContent 子项 "${c.name}" 带锚点：折叠提升未做坐标重定基`)
          }
        }
        emittedChildren.splice(wi, 1, ...inner)
      } else {
        warnings.push(`节点 "${name0}" 有 UIScrollContainerComponent 但未找到 _ScrollContent 内容层子节点`)
      }
    }
    if (hasBord) {
      const sideNames = ['Top', 'Right', 'Bottom', 'Left']
      const folded: string[] = []
      const rest: JsonNode[] = []
      for (const c of emittedChildren) {
        const m = /^([\s\S]+)Border(Top|Right|Bottom|Left)$/.exec(String(c.name ?? ''))
        if (m && m[1] === name0 && compOf(c, 'UIImageComponent')?.properties?.color !== undefined) {
          folded.push(m[2])
          continue
        }
        rest.push(c)
      }
      const need = sideNames.filter((_, i) => Number(slBord![i]) > 0.005)
      if (need.length > 0 && need.every((s) => folded.includes(s))) {
        for (let i = 0; i < 4; i++) {
          if (Number(slBord![i]) <= 0.005) continue
          const strip = emittedChildren.find((c) => String(c.name ?? '') === `${name0}Border${sideNames[i]}`)
          const color = String(compOf(strip!, 'UIImageComponent')?.properties?.color ?? '#000000')
          decls.push(`border-${sideNames[i].toLowerCase()}: ${fmtNum(Number(slBord![i]))}px solid ${color}`)
        }
        emittedChildren.splice(0, emittedChildren.length, ...rest)
      }
    }

    for (const c of emittedChildren) {
      const emitted = emitNode(c, rules, stateRules, warnings, ctx, usedNames, depth + 1, childBox, flowChildren)
      if (emitted) childLines.push(emitted)
    }

    const pad = '  '.repeat(depth)
    if (tag === 'img' || tag === 'input') {
      return `${pad}<${tag} ${attrs.join(' ')} />`
    }
    const openTag = [`<${tag}`, ...attrs].join(' ')
    if (childLines.length === 0 && !textContent) {
      return `${pad}${openTag}></${tag}>`
    }
    if (childLines.length === 0) {
      return `${pad}${openTag}>${escapeText(textContent)}</${tag}>`
    }
    const inner = [textContent ? escapeText(textContent) : '', ...childLines].filter(Boolean).join(`\n${pad}`)
    return `${pad}${openTag}>\n${inner}\n${pad}</${tag}>`
  }

  /** UIText/UITextInput properties → CSS 声明 */
  function applyTextDeclsWith(p: Record<string, unknown>, decls: string[], ctx: CompileContext): void {
    if (p.fontSize !== undefined) decls.push(`font-size: ${Math.round(Number(p.fontSize))}px`)
    if (p.color) decls.push(`color: ${String(p.color)}`)
    if (p.align) decls.push(`text-align: ${String(p.align)}`)
    if (p.bold) decls.push('font-weight: bold')
    if (p.italic) decls.push('font-style: italic')
    if (p.lineHeight !== undefined && Number(p.lineHeight) !== 1.4) decls.push(`line-height: ${fmtNum(Number(p.lineHeight))}`)
    if (p.letterSpacing) decls.push(`letter-spacing: ${Math.round(Number(p.letterSpacing))}px`)
    if (p.fontFamily) decls.push(`font-family: ${String(p.fontFamily)}`)
    if (p.shadowColor) {
      const ox = Number(p.shadowOffsetX ?? 1)
      const oy = Number(p.shadowOffsetY ?? 2)
      const blur = Number(p.shadowBlur ?? 4)
      decls.push(`text-shadow: ${Math.round(ox)}px ${Math.round(oy)}px ${Math.round(blur)}px ${String(p.shadowColor)}`)
    }
    else if (p.shadowBlur !== undefined && Number(p.shadowBlur) !== 4 && !p.shadowColor) {
      // 旧专有通道兜底
      decls.push(`text-shadow-blur: ${Math.round(Number(p.shadowBlur))}px`)
    }
    if (p.zOrder !== undefined && Number(p.zOrder) !== 0) decls.push(`z-index: ${Number(p.zOrder)}`)
    void ctx
  }

}

/** class 名净化（字母/数字/-/_ 之外替换为 _） */
function sanitizeClass(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_') || 'node'
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
