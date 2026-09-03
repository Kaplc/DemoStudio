/**
 * ui-cascade-debug 主逻辑：级联复算 + 指定元素 computed style 打印
 */
import fs from 'node:fs'
import path from 'node:path'
import { tokenizeHtml } from '../src/editor/asset/uiCompiler/miniParser'
import { tokenizeStylesheet } from '../src/editor/asset/uiCompiler/css/tokenize'
import { buildStyleTree, computeStyles } from '../src/editor/asset/uiCompiler/css/cascade'
import { UA_STYLESHEET } from '../src/editor/asset/uiCompiler/css/ua'
import type { HtmlNode } from '../src/editor/asset/uiCompiler/miniParser'
import type { StyleElement } from '../src/editor/asset/uiCompiler/css/cascade'

const inputArg = process.argv[2]
const classArg = process.argv[3]
const inputPath = path.resolve(process.cwd(), inputArg)
const source = fs.readFileSync(inputPath, 'utf-8')

const { root: rawRoot } = tokenizeHtml(source)
// 摘除 style（与 compile.unwrapDocument 等效的简化版：根层收集）
const inlineStyles: string[] = []
const strip = (n: HtmlNode): HtmlNode => {
  const children: HtmlNode[] = []
  for (const c of n.children) {
    if (c.tag === 'style') { inlineStyles.push(c.raw ?? ''); continue }
    children.push(strip(c))
  }
  return { ...n, children }
}
let root = rawRoot
if (root.tag === 'html') {
  const body = root.children.find((c) => c.tag === 'body')
  const headStyles = root.children.filter((c) => c.tag === 'style')
  for (const s of headStyles) inlineStyles.push(s.raw ?? '')
  root = strip({ ...body!, attrs: { ...root.attrs, ...body!.attrs } })
} else {
  root = strip(root)
}

const rules = tokenizeStylesheet(UA_STYLESHEET, { origin: 0 }).rules
for (const css of inlineStyles) {
  rules.push(...tokenizeStylesheet(css, { origin: 1 }).rules)
}
const styleRoot = buildStyleTree(root, null, () => new Map())
computeStyles(styleRoot, rules)

const find = (el: StyleElement): StyleElement | null => {
  if (el.classes.includes(classArg)) return el
  for (const c of el.children) {
    const hit = find(c)
    if (hit) return hit
  }
  return null
}
const el = find(styleRoot)
if (!el) { console.error(`未找到 .${classArg}`); process.exit(1) }
console.log(`.${classArg} computed style:`)
for (const [k, v] of el.computed) console.log(`  ${k}: ${v}`)
console.log(`父链: ${(() => {
  const chain: string[] = []
  let p = el.parent
  while (p) { chain.push(`${p.tag}.${p.classes.join('.')}`); p = p.parent }
  return chain.join(' <- ') || '(root)'
})()}`)

// ─── buildBox 子项收集复算：打印 target 类盒的 items 分类 ───
import { solveLayout } from '../src/editor/asset/uiCompiler/layout'
{
  const isBlockish = (display: string): boolean => {
    switch (display) {
      case 'inline-block': case 'inline-flex': case 'inline-grid': case 'inline':
      case 'table-cell': case 'contents':
        return false
      default:
        return true
    }
  }
  const items: string[] = []
  for (const c of el.children) {
    if (c.tag === '#text') {
      const collapsed = (c.text ?? '').replace(/\s+/g, ' ')
      items.push(`TEXT[${JSON.stringify(collapsed)}]`)
      continue
    }
    const disp = c.computed.get('display') ?? '(default)'
    const pos = c.computed.get('position') ?? '-'
    items.push(`<${c.tag}.${c.classes.join('.')} display=${disp} pos=${pos} blockish=${isBlockish(disp)}>`)
  }
  console.log(`.${classArg} 的 buildBox items（allBlock 判定 = ${items.every((s) => s.startsWith('<'))}）:`)
  for (const s of items) console.log(`  ${s}`)
}
const rootBox = solveLayout(styleRoot, {
  canvasWidth: 1920,
  canvasHeight: 1080,
  rootFontSize: 16,
  warnings: [],
})
const findBox = (b: any): any => {
  if (b.el?.classes?.includes(classArg)) return b
  for (const c of b.children ?? []) {
    const hit = findBox(c)
    if (hit) return hit
  }
  return null
}
const box = findBox(rootBox)
if (box) {
  console.log(`.${classArg} 求解盒: x=${box.x} y=${box.y} w=${box.w} h=${box.h} (pl=${box.pl} pr=${box.pr} bl=${box.bl} br=${box.br})`)
} else {
  console.log(`.${classArg} 未找到求解盒`)
}
// 打印 root→classArg 链上每级盒子
const chain: any[] = []
const findPath = (b: any, acc: any[]): boolean => {
  const next = [...acc, b]
  if (b.el?.classes?.includes(classArg)) { chain.push(...next); return true }
  for (const c of b.children ?? []) if (findPath(c, next)) return true
  return false
}
findPath(rootBox, [])
console.log('盒子链:')
for (const b of chain) {
  console.log(`  ${b.el?.tag}.${(b.el?.classes ?? []).join('.')} display=${b.display} inlineFlow=${b.inlineFlow} pos=${b.el?.computed?.get('position') ?? '-'} x=${b.x} y=${b.y} w=${b.w} h=${b.h}`)
  if (chain.indexOf(b) < chain.length - 1) {
    for (const c of b.children ?? []) {
      console.log(`    子: ${c.el?.tag}.${(c.el?.classes ?? []).join('.')} display=${c.display} pos=${c.el?.computed?.get('position') ?? '-'} x=${c.x} y=${c.y} w=${c.w} h=${c.h}`)
    }
  }
}
