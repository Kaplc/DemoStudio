/**
 * ui-rt-debug 主逻辑：编译→反编译→再编译，按名字配对输出两轮几何 + 差异定位
 */
import fs from 'node:fs'
import path from 'node:path'
import { compileWidgetHtml, decompileWidgetJson } from '../src/editor/asset/uiCompiler/index'

const inputArg = process.argv[2]
const filter = process.argv[3] ?? ''
const inputPath = path.resolve(process.cwd(), inputArg)
const source = fs.readFileSync(inputPath, 'utf-8')
const opts = { resolveInclude: (h: string) => fs.readFileSync(path.resolve(path.dirname(inputPath), h), 'utf-8') }

const r1 = compileWidgetHtml(source, opts)
if (!r1.ok) { console.error('一次编译失败'); process.exit(3) }
const d = decompileWidgetJson(r1.doc!)
if (!d.ok) { console.error('反编译失败'); process.exit(3) }
const r2 = compileWidgetHtml(d.html!, opts)
if (!r2.ok) { console.error('二次编译失败:', r2.errors.map((e) => e.message).join('; ')); process.exit(3) }

interface JN { name?: string; components?: any[]; children?: JN[] }
const tf = (n: JN) => (n.components ?? []).find((c) => c.baseClass === 'UITransformComponent')?.properties ?? {}
const layout = (n: JN) => (n.components ?? []).find((c) => c.baseClass === 'UILayoutComponent')?.properties
const geo = (n: JN) => {
  const p = tf(n)
  return { w: p.worldWidth, h: p.worldHeight, a: p.anchor, off: JSON.stringify(p.anchorOffset), pos: JSON.stringify(p.position), ul: layout(n) ? `UL(${JSON.stringify(layout(n))})` : '' }
}

const walk = (a: JN, b: JN, pathStr: string): void => {
  const ga = geo(a)
  const gb = geo(b)
  const same = ga.w === gb.w && ga.h === gb.h && ga.a === gb.a && ga.off === gb.off && ga.pos === gb.pos
  const name = a.name ?? '?'
  if (!same || (filter && name.includes(filter))) {
    const tag = same ? 'SAME' : 'DIFF'
    console.log(`[${tag}] ${pathStr} ${name}`)
    console.log(`    一次: w=${ga.w} h=${ga.h} a=${ga.a} off=${ga.off} pos=${ga.pos} ${ga.ul}`)
    console.log(`    二次: w=${gb.w} h=${gb.h} a=${gb.a} off=${gb.off} pos=${gb.pos} ${gb.ul}`)
  }
  const ac = a.children ?? []
  const bc = b.children ?? []
  // 按名字配对（顺序可能变化）
  const bByName = new Map(bc.map((c) => [c.name ?? `#${bc.indexOf(c)}`, c]))
  for (const c of ac) {
    const match = bByName.get(c.name ?? `#${ac.indexOf(c)}`)
    if (!match) { console.log(`[MISSING] ${pathStr}/${c.name} 二次编译无同名节点`) ; continue }
    walk(c, match, `${pathStr}/${c.name}`)
  }
  for (const c of bc) {
    if (!ac.some((x) => x.name === c.name)) console.log(`[EXTRA] ${pathStr}/${c.name} 二次编译多出`)
  }
}
walk(r1.doc as JN, r2.doc as JN, 'root')

// ─── 解析画布绝对矩形（画布 y 向下，烟测 §4 同款公式，逐位不取整）───
function collectRects(root: JN): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>()
  const cw = 1920
  const ch = 1080
  const walk2 = (n: JN, pc: { x: number; y: number }, pd: { pw: number; ph: number }, path: string): void => {
    const p = tf(n)
    const ww = Number(p.worldWidth ?? 0)
    const wh = Number(p.worldHeight ?? 0)
    let cx = pc.x
    let cy = pc.y
    const anchor = p.anchor as string | undefined
    const off = (p.anchorOffset as [number, number] | undefined) ?? [0, 0]
    const lp = p.position as [number, number, number] | undefined
    if (anchor && anchor !== 'stretch') {
      const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
      const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
      cx += (fx * (pd.pw - ww)) / 2 + off[0]
      cy -= (fy * (pd.ph - wh)) / 2 + off[1]
    } else if (lp) {
      cx += lp[0]
      cy += -lp[1]
    }
    out.set(path, { x: cx - ww / 2, y: cy - wh / 2, w: ww, h: wh })
    for (const c of n.children ?? []) walk2(c, { x: cx, y: cy }, { pw: ww, ph: wh }, `${path}/${c.name}`)
  }
  walk2(root, { x: cw / 2, y: ch / 2 }, { pw: cw, ph: ch }, 'root')
  return out
}
const rects1 = collectRects(r1.doc as JN)
const rects2 = collectRects(r2.doc as JN)
let rectDiffs = 0
for (const [p, r1r] of rects1) {
  const r2r = rects2.get(p)
  if (!r2r) { console.log(`[RECT-MISSING] ${p}`); rectDiffs++; continue }
  const d = Math.max(Math.abs(r1r.x - r2r.x), Math.abs(r1r.y - r2r.y), Math.abs(r1r.w - r2r.w), Math.abs(r1r.h - r2r.h))
  if (d > 1e-9) {
    rectDiffs++
    if (rectDiffs <= 20) console.log(`[RECT-DIFF ${d}] ${p}: 一次(${r1r.x},${r1r.y},${r1r.w},${r1r.h}) 二次(${r2r.x},${r2r.y},${r2r.w},${r2r.h})`)
  }
}
console.log(`\n矩形差异数: ${rectDiffs} / ${rects1.size}`)

// 输出反编译 html 供检查
const dbg = inputPath.replace(/\.widget\.html$/i, '.rt-debug.html')
fs.writeFileSync(dbg, d.html!, 'utf-8')
console.log(`\n反编译产物已写: ${dbg}`)
