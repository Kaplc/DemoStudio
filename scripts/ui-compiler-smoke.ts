/**
 * ui-compiler 冒烟回归（TS）— 由 scripts/ui-compiler-smoke.mjs 打包执行
 *
 * 覆盖：
 *  1. 旧资产回归：src/projects 各工程 asset/blueprints/ui 下全部 .widget.html 编译成功
 *  2. 完整映射综合用例：块级流/内联混排/flex(wrap+grow)/grid/表格/列表标记/
 *     @media/渐变/transform/绝对定位/命名色/calc/var/实体/inline style
 *  3. 越界硬报错：未知标签/未知 CSS 属性/内嵌 script/兄弟选择器
 *     （overflow:hidden 已合法化 → UIMaskComponent 裁剪遮罩，见 §6）
 *  4. round-trip：html → json → html' → json'' 布局与组件全等效（0.05px 容差）
 *  6. UIMask 裁剪 / ScrollContainer 滚动内容层 / 往返
 */
import fs from 'node:fs'
import path from 'node:path'
import { compileWidgetHtml, decompileWidgetJson, patchWidgetHtmlInPlace } from '../src/editor/asset/uiCompiler/index'

let failures = 0
const ok = (msg: string): void => console.log(`✅ ${msg}`)
const bad = (msg: string): void => { failures++; console.log(`❌ ${msg}`) }

// ─── 1. 旧资产回归 ───
const uiDirs = new Set<string>()
for (const p of ['src/projects/fish/asset/blueprints/ui']) {
  if (fs.existsSync(p)) uiDirs.add(p)
}
for (const dir of uiDirs) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.widget.html'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf-8')
    const r = compileWidgetHtml(src, {
      resolveInclude: (h) => fs.readFileSync(path.join(dir, h), 'utf-8'),
    })
    if (r.ok) ok(`旧资产 ${f}（${r.warnings.length} 警告）`)
    else {
      bad(`旧资产 ${f}`)
      for (const e of r.errors) console.log(`   行 ${e.line}: ${e.message}`)
    }
  }
}

// ─── 2. 完整映射综合用例 ───
const fullSrc = `<!DOCTYPE html>
<html name="FullSmoke" canvas="1920x1080">
<head><title>完整映射自测</title>
<style>
  :root { font-size: 20px; }
  body { background-color: #1a1a2e; padding: 20px; }
  .panel { background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 12px; padding: 16px 24px; box-sizing: border-box; }
  h1 { color: gold; text-shadow: 2px 4px 6px rgba(0,0,0,0.5); }
  .row { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { flex: 1 1 200px; height: 40px; background-color: rgba(255,255,255,0.15); border: 2px solid silver; }
  .btn2 { width: 200px; height: 60px; background-color: #333; color: white; }
  .btn2:hover { color: #ffd700; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 600px; }
  .cell { height: 60px; background-color: teal; }
  .cell:first-child { background-color: coral; }
  td { border: 1px solid gray; padding: 4px 8px; }
  #hero { position: absolute; right: 100px; bottom: 80px; width: 200px; height: 100px; background-color: rebeccapurple; transform: rotate(15deg); }
  @media (min-width: 1000px) { .desktop-only { display: block; width: 300px; height: 30px; background-color: darkgreen; } }
  @media (max-width: 500px) { .desktop-only { display: none; } }
</style></head>
<body>
  <h1>标题 &amp; 实体 &lt;测试&gt;</h1>
  <div class="panel" style="margin-bottom: 12px; --tint: #eaffff; color: var(--tint);">内联样式 + var() + <span style="font-size: 28px">大字</span></div>
  <div class="row"><div class="chip">弹性 1</div><div class="chip">弹性 2</div><div class="chip">弹性 3</div></div>
  <div class="grid"><div class="cell">1</div><div class="cell">2</div><div class="cell">3</div><div class="cell">4</div><div class="cell">5</div><div class="cell">6</div></div>
  <table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>
  <ul style="width: 300px"><li>列表项一</li><li style="list-style-type: none">无标记项</li></ul>
  <div class="desktop-only">仅桌面显示</div>
  <button class="btn2" id="hero" data-script="gameplay/BaseHud">开始</button>
  <img src="asset/texture/ui/icon.png" style="width: 64px; height: 64px" />
  <progress value="30" max="100" style="width: 200px; height: 16px"></progress>
  <input type="text" placeholder="输入…" style="width: 240px; height: 40px; font-size: 18px" />
</body></html>`

const rf = compileWidgetHtml(fullSrc)
if (!rf.ok) {
  bad('完整映射综合用例')
  for (const e of rf.errors) console.log(`   行 ${e.line}: ${e.message}`)
} else {
  ok(`完整映射综合用例（${rf.warnings.length} 警告）`)
  const doc = rf.doc as { children: Array<any> }
  const find = (nodes: any[], name: string): any => {
    for (const n of nodes) {
      if (n.name === name) return n
      const s = find(n.children ?? [], name)
      if (s) return s
    }
    return null
  }
  // 抽查：渐变 / 旋转 / 交互态 / grid 列宽
  const panel = find(doc.children, 'panel')
  const grad = panel?.components.find((c) => c.baseClass === 'UIImageComponent')?.properties.gradient
  if (grad?.angle === 135 && grad?.stops?.length === 2) ok('linear-gradient 解析与发射')
  else bad(`渐变异常: ${JSON.stringify(grad)}`)
  const hero = find(doc.children, 'hero')
  const rot = hero?.components[0].properties.rotation as number[] | undefined
  if (rot && Math.abs(rot[2] - Math.PI / 12) < 1e-3) ok('transform: rotate(15deg) → 弧度')
  else bad(`旋转异常: ${JSON.stringify(rot)}`)
  const grid = find(doc.children, 'grid')
  const cellW = grid?.children?.[0]?.components[0].properties.worldWidth as number
  const expectW = (600 - 16) / 3 // px 世界：json 几何 = 设计 px（一元化）
  if (Math.abs(cellW - expectW) < 0.01) ok('grid fr 列宽')
  else bad(`grid 列宽异常: ${cellW} 期望 ${expectW.toFixed(4)}`)
  // 交互态：:hover → UIButtonComponent.stateColors（引擎原生驱动），不再搭便车 UIScript.args
  const heroBtn = hero?.components.find((c: any) => c.baseClass === 'UIButtonComponent')
  const sc = heroBtn?.properties?.stateColors
  if (sc?.hover?.color === '#ffd700') ok(':hover → UIButtonComponent.stateColors 原生透传')
  else bad(`交互态异常: ${JSON.stringify(sc)}`)
  const heroScript = hero?.components.find((c: any) => c.baseClass === 'UIScriptComponent')
  if (heroScript && !(heroScript.properties.args as Record<string, unknown> | undefined)?.hover) {
    ok('交互态不再并入 UIScript.args')
  } else if (heroScript) {
    bad(`UIScript.args 残留交互态: ${JSON.stringify(heroScript.properties.args)}`)
  }
}

// ─── 3. 越界硬报错 ───
const expectFail = (label: string, src: string): void => {
  const r = compileWidgetHtml(src)
  if (!r.ok) ok(`${label}拦截: ${r.errors[0].message.slice(0, 40)}…`)
  else bad(`${label}未被拦截！`)
}
expectFail('未知 CSS 属性', '<widget name="x"><style>.x{color:red;foo-bar:8px}</style><div class="x">x</div></widget>')
expectFail('内嵌 script', '<widget name="x"><script>evil()</script></widget>')
expectFail('未知标签', '<widget name="x"><marquee>x</marquee></widget>')
expectFail('兄弟选择器', '<widget name="x"><style>a ~ b { color: red }</style><div><a>x</a><b>y</b></div></widget>')
expectFail('select 不支持', '<widget name="x"><select><option>1</option></select></widget>')
expectFail('@keyframes', '<widget name="x"><style>@keyframes spin { from { opacity: 0 } }</style><div>x</div></widget>')
expectFail('事件属性', '<widget name="x"><div onclick="go()">x</div></widget>')

// ─── 4. round-trip ───
{
  const r1 = compileWidgetHtml(fullSrc)
  const d1 = r1.ok ? decompileWidgetJson(r1.doc!) : null
  const r2 = d1?.html ? compileWidgetHtml(d1.html) : null
  if (!r1.ok || !d1?.ok || !r2?.ok) {
    bad('round-trip 管线失败')
  } else {
    // 结构化比较：节点名+画布绝对矩形（±0.05px）+ 组件属性（键排序）
    const sortify = (v: any): any => Array.isArray(v) ? v.map(sortify)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortify(v[k])]))
        : v
    interface JN { name?: string; components?: any[]; children?: JN[] }
    const cw = 1920, ch = 1080
    const collect = (root: JN): Map<string, string> => {
      const out = new Map<string, string>()
      let rww = 4.8, rwh = 2.7
      const t0 = root.components?.find((c) => c.baseClass === 'UITransformComponent')?.properties as any
      if (t0?.worldWidth) rww = t0.worldWidth
      if (t0?.worldHeight) rwh = t0.worldHeight
      const wpx = (m: number) => (m / rww) * cw
      const hpx = (m: number) => (m / rwh) * ch
      const walk = (n: JN, pc: { x: number; y: number }, pd: { pw: number; ph: number }): void => {
        const tf = (n.components?.find((c) => c.baseClass === 'UITransformComponent')?.properties ?? {}) as any
        const ww = Number(tf.worldWidth ?? 0), wh = Number(tf.worldHeight ?? 0)
        let cx = pc.x, cy = pc.y
        const anchor = tf.anchor as string | undefined
        const off = (tf.anchorOffset as [number, number] | undefined) ?? [0, 0]
        const lp = tf.position as [number, number, number] | undefined
        if (anchor && anchor !== 'stretch') {
          const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
          const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
          cx += (fx * (pd.pw - wpx(ww))) / 2 + wpx(off[0])
          cy -= (fy * (pd.ph - hpx(wh))) / 2 + hpx(off[1])
        } else if (lp) {
          cx += wpx(lp[0]); cy += hpx(-lp[1])
        }
        const comps = (n.components ?? []).filter((c) => !['UITransformComponent', 'CanvasUIComponent'].includes(c.baseClass))
          .map((c) => c.baseClass.replace(/Component$/, '') + ':' + JSON.stringify(sortify(c.properties ?? {})))
          .sort()
        out.set(n.name ?? '?', `${[cx - wpx(ww) / 2, cy - hpx(wh) / 2, wpx(ww), hpx(wh)].map((v) => Math.round(v * 10) / 10).join(',')}|${comps.join(' ')}`)
        for (const c of n.children ?? []) walk(c, { x: cx, y: cy }, { pw: wpx(ww), ph: hpx(wh) })
      }
      walk(root, { x: cw / 2, y: ch / 2 }, { pw: cw, ph: ch })
      return out
    }
    const f1 = collect(r1.doc as JN)
    const f2 = collect(r2.doc as JN)
    let d = 0
    for (const [k, v] of f1) {
      if (f2.get(k) !== v) { d++; if (d <= 5) console.log(`   ⚠ ${k}\n     一次: ${v}\n     二次: ${f2.get(k)}`) }
    }
    for (const k of f2.keys()) if (!f1.has(k)) { d++; console.log(`   多余: ${k}`) }
    if (d === 0) ok(`round-trip 全等效（${f1.size} 节点）`)
    else bad(`round-trip ${d} 处差异（共 ${f1.size} 节点）`)
  }
}

// ─── 5. 结构还原与 UILayout 补发（round-trip 损耗修复验证）───
{
  // 5a. 运行时可复现 flex → UILayoutComponent 补发（v1 动态子项重排能力保留）
  const rf = compileWidgetHtml(`<widget name="F" canvas="1000x500">
<style>.bar { display: flex; flex-direction: row; gap: 20px; justify-content: center; align-items: center; width: 800px; height: 100px; }
.it { width: 200px; height: 60px; background-color: teal; }</style>
<div class="bar"><div class="it">1</div><div class="it">2</div><div class="it">3</div></div>
</widget>`)
  if (!rf.ok) { bad('flex UILayout 用例编译'); }
  else {
    const bar = (rf.doc as any).children[0]
    const ul = bar.components.find((c: any) => c.baseClass === 'UILayoutComponent')
    if (ul && ul.properties.mode === 'horizontal' && ul.properties.spacingX > 0
      && ul.properties.justify === 'center' && ul.properties.align === 'center') ok('flex → UILayoutComponent 补发（引擎枚举映射）')
    else bad(`UILayout 补发异常: ${JSON.stringify(ul?.properties)}`)
    const d = decompileWidgetJson(rf.doc!)
    if (d.ok && /display: flex/.test(d.html!) && /gap: 20px/.test(d.html!) && !/data-comp="UILayout"/.test(d.html!)) {
      const r2 = compileWidgetHtml(d.html!)
      const ul2 = r2.ok ? (r2.doc as any).children[0].components.find((c: any) => c.baseClass === 'UILayoutComponent') : null
      if (r2.ok && ul2 && ul2.properties.mode === 'horizontal' && Math.abs(ul2.properties.spacingX - ul.properties.spacingX) < 1e-6) {
        ok('flex 结构还原（display:flex 往返稳定）')
      } else bad('flex 还原二次编译 UILayout 不一致')
    } else bad('flex 未还原为 display:flex 或走了逃逸通道')
  }

  // 5b. padding/border 侧车 → 作者层 CSS 完整还原
  const rp = compileWidgetHtml(`<widget name="P" canvas="1000x500">
<style>.box { padding: 20px 30px; background-color: #333; border: 2px solid gold; }
.t { width: 200px; height: 40px; }</style>
<div class="box"><text class="t">子项</text></div>
</widget>`)
  if (!rp.ok) { bad('padding 用例编译'); }
  else {
    const boxNode = (rp.doc as any).children[0]
    const sl = boxNode.sourceLayout
    if (sl && JSON.stringify(sl.padding) === '[20,30,20,30]' && JSON.stringify(sl.border) === '[2,2,2,2]') {
      ok('sourceLayout 侧车写入（padding/border px）')
    } else bad(`侧车异常: ${JSON.stringify(sl)}`)
    const strips = (boxNode.children as any[]).filter((c) => /Border(Top|Right|Bottom|Left)$/.test(c.name))
    if (strips.length === 4) ok('边框条子 Actor 生成')
    else bad(`边框条数量异常: ${strips.length}`)
    const d = decompileWidgetJson(rp.doc!)
    if (d.ok && /box-sizing: border-box/.test(d.html!) && /padding: 20px 30px 20px 30px/.test(d.html!)
      && /border-top: 2px solid #ffd700/.test(d.html!) && !/boxBorderTop/.test(d.html!)) {
      const r2 = compileWidgetHtml(d.html!)
      const sl2 = r2.ok ? (r2.doc as any).children[0].sourceLayout : null
      const strips2 = r2.ok ? (r2.doc as any).children[0].children.filter((c: any) => /BorderTop$/.test(c.name)).length : 0
      if (r2.ok && JSON.stringify(sl2?.border) === '[2,2,2,2]' && strips2 === 1) {
        ok('padding/border 作者层还原（CSS 往返稳定）')
      } else bad(`border 往返不稳定: sl2=${JSON.stringify(sl2)} strips2=${strips2}`)
    } else bad('padding/border 未还原为 CSS 或边框条未折回')
  }

  // 5c. v1 形态旧 json（UILayout + 子项 position 占位）→ flex 还原 → 重编译 UILayout 复原
  const v1 = {
    name: 'V1', baseClass: 'Actor', sourceHash: 'x',
    components: [
      { baseClass: 'UITransformComponent', properties: { position: [0, 0, 0], worldWidth: 4.8, worldHeight: 2.7 } },
      { baseClass: 'CanvasUIComponent', properties: { width: 1920, height: 1080, name: 'Canvas', zOrder: 0, active: true } },
    ],
    children: [{
      name: 'HBox', baseClass: 'Actor', id: 1,
      components: [
        { baseClass: 'UITransformComponent', properties: { position: [0, 0.5, 0], worldWidth: 3, worldHeight: 0.6 } },
        { baseClass: 'UILayoutComponent', properties: { mode: 'horizontal', spacingX: 0.05, spacingY: 0.05, autoLayout: true } },
      ],
      children: [1, 2].map((i) => ({
        name: `Box${i}`, baseClass: 'Actor', id: i,
        components: [{ baseClass: 'UITransformComponent', properties: { position: [0, 0, 0], worldWidth: 0.5, worldHeight: 0.3 } }],
        children: [],
      })),
    }],
  }
  const dv = decompileWidgetJson(v1)
  if (!dv.ok) bad('v1 json 反编译失败')
  else {
    const rv = compileWidgetHtml(dv.html!)
    if (!rv.ok) { bad(`v1 还原二次编译失败: ${rv.errors.map((e) => e.message).join('; ')}`) }
    else {
      const hbox = (rv.doc as any).children[0]
      const ul = hbox.components.find((c: any) => c.baseClass === 'UILayoutComponent')
      // 引擎公式复现：等宽 0.5m 项、gap 0.05m、justify center → 子项 x=±0.275m
      const xs = (hbox.children as any[]).map((c) => c.components[0].properties.position[0])
      const okPos = xs.length === 2 && Math.abs(Math.abs(xs[1]) - Math.abs(xs[0])) < 1e-6
        && Math.abs(Math.abs(xs[0]) - 0.275) < 0.01
      if (ul && ul.properties.mode === 'horizontal' && okPos) {
        ok('v1 旧 json → flex 还原 → UILayout/公式位置复原')
      } else bad(`v1 还原异常: ul=${JSON.stringify(ul?.properties)} xs=${JSON.stringify(xs)} expect±0.275`)
    }
  }
}

// ─── 6. UIMask 裁剪 / ScrollContainer 滚动内容层（overflow 合法化后语义）───
{
  // 6a. overflow:hidden → UIMaskComponent（radius 取 border-radius，px→米）
  const rm = compileWidgetHtml(`<widget name="M" canvas="1000x500">
<style>.clip { width: 300px; height: 200px; overflow: hidden; border-radius: 16px; background-color: #333; }
.c { width: 500px; height: 300px; background-color: teal; }</style>
<div class="clip"><div class="c"></div></div>
</widget>`)
  if (!rm.ok) bad(`overflow:hidden 用例编译失败: ${rm.errors.map((e) => e.message).join('; ')}`)
  else {
    const clip = (rm.doc as any).children[0]
    const mask = clip.components.find((c: any) => c.baseClass === 'UIMaskComponent')
    const expectR = 16 // px 世界：radius = border-radius 设计 px
    if (mask && Math.abs(mask.properties.radius - expectR) < 1e-4) ok('overflow:hidden → UIMaskComponent（radius=border-radius）')
    else bad(`UIMask 异常: ${JSON.stringify(mask?.properties)}`)
    const d = decompileWidgetJson(rm.doc!)
    if (d.ok && /overflow: hidden/.test(d.html!) && /border-radius: 16px/.test(d.html!)) ok('UIMask 作者层还原（overflow:hidden 往返）')
    else bad(`UIMask 还原异常: ${d.html?.slice(0, 200)}`)
  }

  // 6b. overflow-y:auto → UIScrollContainer + _ScrollContent 内容层 + 子项平移
  const rs = compileWidgetHtml(`<widget name="S" canvas="1000x500">
<style>.list { width: 300px; height: 200px; overflow-y: auto; background-color: #222; }
.row { width: 280px; height: 60px; background-color: teal; }</style>
<div class="list"><div class="row">1</div><div class="row">2</div><div class="row">3</div><div class="row">4</div></div>
</widget>`)
  if (!rs.ok) bad(`overflow:auto 用例编译失败: ${rs.errors.map((e) => e.message).join('; ')}`)
  else {
    const list = (rs.doc as any).children[0]
    const sc = list.components.find((c: any) => c.baseClass === 'UIScrollContainerComponent')
    const mask = list.components.find((c: any) => c.baseClass === 'UIMaskComponent')
    const layout = list.components.find((c: any) => c.baseClass === 'UILayoutComponent')
    const wrapper = (list.children as any[]).find((c) => String(c.name).includes('_ScrollContent'))
    if (!sc || sc.properties.direction !== 'vertical') bad(`ScrollContainer 异常: ${JSON.stringify(sc?.properties)}`)
    else if (!mask) bad('ScrollContainer 缺 UIMask')
    else if (layout) bad('滚动容器不应补发 UILayout')
    else if (!wrapper) bad('缺 _ScrollContent 内容层')
    else {
      // 内容包围盒：4 行 60px（无 margin 紧贴）→ 280x240px？行宽 280、内容盒高 200 内 4×60=240 溢出
      const wW = wrapper.components[0].properties.worldWidth as number
      const wH = wrapper.components[0].properties.worldHeight as number
      const m = (px: number) => px // px 世界：json 几何 = 设计 px
      if (Math.abs(wW - m(280)) < 1e-3 && Math.abs(wH - m(240)) < 1e-3) ok('overflow:auto → ScrollContainer + 内容层（包围盒 280x240px）')
      else bad(`内容层尺寸异常: ${wW.toFixed(3)}x${wH.toFixed(3)} 期望 ${m(280).toFixed(3)}x${m(240).toFixed(3)}`)
      // 容器自身高度必须保持显式 200px（视口语义，bug#7：曾被内容撑大到 240px → maxScroll 恒 0）
      const viewH = (list as any).components[0].properties.worldHeight as number
      if (Math.abs(viewH - m(200)) < 1e-3) ok('overflow 容器显式高度不被内容撑大（视口 200px）')
      else bad(`容器高度异常: ${viewH.toFixed(3)} 期望 ${m(200).toFixed(3)}`)
      // 子项相对 wrapper 无锚点居中：首行中心在 wrapper 中心上方 90px（世界 y=+90px）
      const first = (wrapper.children as any[])[0]
      const pos = first.components[0].properties.position as number[]
      if (Math.abs(pos[0]) < 1e-6 && Math.abs(pos[1] - m(90)) < 1e-3) ok('滚动内容层子项坐标平移（相对 wrapper）')
      else bad(`子项平移异常: ${JSON.stringify(pos)} 期望 y=${m(90).toFixed(3)}`)
      // 6c. 往返：折叠 wrapper → overflow 声明 → 重编译组件一致
      const d = decompileWidgetJson(rs.doc!)
      if (!d.ok) bad('scroll 往返反编译失败')
      else if (!/_ScrollContent/.test(d.html!) && /overflow-y: auto/.test(d.html!)) {
        const r2 = compileWidgetHtml(d.html!)
        const list2 = r2.ok ? (r2.doc as any).children[0] : null
        const sc2 = list2?.components.find((c: any) => c.baseClass === 'UIScrollContainerComponent')
        const w2 = (list2?.children as any[]).find((c) => String(c.name).includes('_ScrollContent'))
        if (r2.ok && sc2 && sc2.properties.direction === 'vertical' && w2) ok('ScrollContainer 往返稳定（wrapper 折叠→还原）')
        else bad(`ScrollContainer 往返不一致: sc2=${JSON.stringify(sc2?.properties)} w2=${Boolean(w2)}`)
      } else bad('scroll 反编译未折叠 wrapper 或未还原 overflow 声明')
    }
  }
}

// ─── 7. 存量资产 round-trip 全量（TC-U13 批量化：编译→反编译→再编译几何保真）───
// 判据 = 画布绝对矩形逐位相等（1e-6 容差吸收浮点解析噪声）：反编译会把流内/居中
// 元素规范化为绝对定位表示（字段级编码变化但矩形等价），字段级逐位保真由
// tests/uiUnitUnification.test.ts TC-U13 的纯 absolute 样例（RT_WIDGET）承担
{
  for (const dir of uiDirs) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.widget.html'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8')
      const r1 = compileWidgetHtml(src, { resolveInclude: (h) => fs.readFileSync(path.join(dir, h), 'utf-8') })
      const d = r1.ok ? decompileWidgetJson(r1.doc!) : null
      const r2 = d?.html ? compileWidgetHtml(d.html, { resolveInclude: (h) => fs.readFileSync(path.join(dir, h), 'utf-8') }) : null
      if (!r1.ok || !d?.ok || !r2?.ok) {
        bad(`round-trip 管线失败: ${f}`)
        continue
      }
      interface JN { name?: string; components?: any[]; children?: JN[] }
      const tfp = (n: JN) => (n.components ?? []).find((c: any) => c.baseClass === 'UITransformComponent')?.properties ?? {}
      const collect = (root: JN): Map<string, [number, number, number, number]> => {
        const out = new Map<string, [number, number, number, number]>()
        const cw = 1920
        const ch = 1080
        const walk = (n: JN, pc: { x: number; y: number }, pd: { pw: number; ph: number }, p: string): void => {
          const t = tfp(n)
          const ww = Number(t.worldWidth ?? 0)
          const wh = Number(t.worldHeight ?? 0)
          let cx = pc.x
          let cy = pc.y
          const anchor = t.anchor as string | undefined
          const off = (t.anchorOffset as [number, number] | undefined) ?? [0, 0]
          const lp = t.position as [number, number, number] | undefined
          if (anchor && anchor !== 'stretch') {
            const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
            const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
            cx += (fx * (pd.pw - ww)) / 2 + off[0]
            cy -= (fy * (pd.ph - wh)) / 2 + off[1]
          } else if (lp) {
            cx += lp[0]
            cy += -lp[1]
          }
          out.set(p, [cx - ww / 2, cy - wh / 2, ww, wh])
          for (const c of n.children ?? []) walk(c, { x: cx, y: cy }, { pw: ww, ph: wh }, `${p}/${c.name}`)
        }
        walk(root, { x: cw / 2, y: ch / 2 }, { pw: cw, ph: ch }, 'root')
        return out
      }
      const r1m = collect(r1.doc as JN)
      const r2m = collect(r2.doc as JN)
      let diffs = 0
      for (const [p, a] of r1m) {
        const b = r2m.get(p)
        if (!b) { diffs++; console.log(`   ⚠ ${f} ${p}: 二次编译缺节点`); continue }
        const dd = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]))
        if (dd > 1e-6) {
          diffs++
          if (diffs <= 5) console.log(`   ⚠ ${f} ${p}: (${a.map((v) => Math.round(v * 100) / 100).join(',')}) → (${b.map((v) => Math.round(v * 100) / 100).join(',')})`)
        }
      }
      for (const p of r2m.keys()) {
        if (!r1m.has(p)) { diffs++; console.log(`   ⚠ ${f} ${p}: 二次编译多节点`) }
      }
      if (diffs === 0) ok(`round-trip 几何保真: ${f}（${r1m.size} 节点矩形逐位相等）`)
      else bad(`round-trip ${diffs} 处矩形差异: ${f}`)
    }
  }
}

// ─── 8. width/height:100% → stretch 锚映射（P2 目标口径，已启用）───
{
  // P2：两轴 100% → anchor=stretch + 固定父尺寸世界值（运行时 applyAnchor
  // 填满父容器）；round-trip 回写 width/height:100%（不动点，编辑器保存
  // 不退化为 center + 快照尺寸）
  const src = `<widget name="St" canvas="1920x1080">
<style>.full { width: 100%; height: 100%; position: absolute; left: 0px; top: 0px; background-color: #333333; }
.half { width: 100px; height: 100px; position: absolute; left: 500px; top: 300px; background-color: teal; }</style>
<div class="full"><div class="half"></div></div>
</widget>`
  const r = compileWidgetHtml(src)
  if (!r.ok) {
    bad(`100% 用例编译失败: ${r.errors.map((e) => e.message).join('; ')}`)
  } else {
    const full = (r.doc as any).children[0]
    const tf = full.components[0].properties
    if (tf.anchor === 'stretch' && Math.abs(tf.worldWidth - 1920) < 1e-6) {
      ok('两轴 100% → anchor=stretch + 父尺寸世界值')
    } else {
      bad(`stretch 映射异常: anchor=${tf.anchor} ww=${tf.worldWidth}`)
    }
    // round-trip：html(100%) → json(stretch) → html(100%) 不动点
    const d = decompileWidgetJson(r.doc!)
    if (d.ok && /width:\s*100%/.test(d.html!) && /height:\s*100%/.test(d.html!)
      && !/width:\s*1920px/.test(d.html!)) {
      const r2 = compileWidgetHtml(d.html!)
      const tf2 = r2.ok ? (r2.doc as any).children[0].components[0].properties : null
      if (r2.ok && tf2?.anchor === 'stretch' && Math.abs(tf2.worldWidth - 1920) < 1e-6) {
        ok('stretch round-trip 不动点（100% → stretch → 100%）')
      } else bad(`stretch 二次编译丢失: ${tf2 ? `anchor=${tf2.anchor}` : '编译失败'}`)
    } else bad(`stretch 反编译未回写 100%: ok=${d.ok} html=${d.html?.slice(0, 120)}`)
  }

  // 边界锁定：单轴 100%（height 缺省）不映射 stretch（行为不变）
  const r1 = compileWidgetHtml(`<widget name="St1" canvas="1920x1080">
<style>.wonly { width: 100%; position: absolute; left: 0px; top: 0px; background-color: #444444; }</style>
<div class="wonly"></div>
</widget>`)
  if (!r1.ok) bad('单轴 100% 用例编译失败')
  else {
    const t = (r1.doc as any).children[0].components[0].properties
    if (t.anchor !== 'stretch') ok('边界：单轴 100% 不映射 stretch')
    else bad(`单轴 100% 误映射 stretch: anchor=${t.anchor}`)
  }
}

// ─── 9. <properties> 参数区（doc-dev/ui-html-source-format/properties-region.md G 组）───
{
  const findComp = (doc: any, baseClass: string): any =>
    (doc.components ?? []).find((c: any) => c.baseClass === baseClass)
  const failMsg = (r: any): string => r.errors.map((e: any) => `行${e.line}:${e.message}`).join('; ')

  // G1 根节点组件挂载（region 声明根锚点，无 data-comp）
  const g1src = `<widget name="R" canvas="520x300">
  <properties>
    {
      "R": { "UIWorldAnchorComponent": { "mode": "world", "pxPerMeter": 300, "pixelDensity": 2, "faceCamera": true, "alwaysOnTop": true } }
    }
  </properties>
  <style>.a { width: 100px; height: 80px; }</style>
  <div class="a"></div>
</widget>`
  const g1 = compileWidgetHtml(g1src)
  if (!g1.ok) bad(`G1 编译失败: ${failMsg(g1)}`)
  else {
    const p = findComp(g1.doc, 'UIWorldAnchorComponent')?.properties ?? {}
    if (p.mode === 'world' && p.pxPerMeter === 300 && p.pixelDensity === 2 && p.faceCamera === true && p.alwaysOnTop === true) {
      ok('G1 根节点锚点经 region 挂载（属性逐键一致）')
    } else bad(`G1 锚点异常: ${JSON.stringify(p)}`)
  }

  // G2 子节点组件挂载
  const g2 = compileWidgetHtml(`<widget name="W" canvas="400x300">
  <properties>
    { "Btn": { "UIScriptComponent": { "args": { "hover": { "color": "#66bb6a" } } } } }
  </properties>
  <style>.b { width: 100px; height: 40px; }</style>
  <button class="b" data-name="Btn">ok</button>
</widget>`)
  if (!g2.ok) bad(`G2 编译失败: ${failMsg(g2)}`)
  else {
    const btn = (g2.doc as any).children.find((c: any) => c.name === 'Btn')
    const args = btn?.components?.find((c: any) => c.baseClass === 'UIScriptComponent')?.properties?.args
    if (JSON.stringify(args) === '{"hover":{"color":"#66bb6a"}}') ok('G2 子节点组件经 region 挂载')
    else bad(`G2 子节点挂载异常: ${JSON.stringify(args)}`)
  }

  // G3 与原生组件键级合并（data-script 提供 script，region 提供 args）
  const g3 = compileWidgetHtml(`<widget name="M" canvas="400x300" data-script="gameplay/X">
  <properties>
    { "M": { "UIScriptComponent": { "args": { "a": 1 } } } }
  </properties>
  <style>.b { width: 10px; height: 10px; }</style><div class="b"></div>
</widget>`)
  if (!g3.ok) bad(`G3 编译失败: ${failMsg(g3)}`)
  else {
    const scripts = (g3.doc as any).components.filter((c: any) => c.baseClass === 'UIScriptComponent')
    const p = scripts[0]?.properties ?? {}
    if (scripts.length === 1 && p.script === 'gameplay/X' && JSON.stringify(p.args) === '{"a":1}') {
      ok('G3 region 与 data-script 键级合并（单组件）')
    } else bad(`G3 合并异常: n=${scripts.length} ${JSON.stringify(p)}`)
  }

  // G4 region 覆盖 legacy 双声明
  const g4 = compileWidgetHtml(`<widget name="L" canvas="400x300" data-comp="UIWorldAnchorComponent" data-props='{"mode":"world","pxPerMeter":100}'>
  <properties>
    { "L": { "UIWorldAnchorComponent": { "pxPerMeter": 250 } } }
  </properties>
  <style>.b { width: 10px; height: 10px; }</style><div class="b"></div>
</widget>`)
  if (!g4.ok) bad(`G4 编译失败: ${failMsg(g4)}`)
  else {
    const anchors = (g4.doc as any).components.filter((c: any) => c.baseClass === 'UIWorldAnchorComponent')
    const p = anchors[0]?.properties ?? {}
    if (anchors.length === 1 && p.pxPerMeter === 250 && p.mode === 'world') ok('G4 region 覆盖 legacy data-comp（键级）')
    else bad(`G4 覆盖异常: n=${anchors.length} ${JSON.stringify(p)}`)
  }

  // G5 空/缺失 region 等价
  const g5a = compileWidgetHtml('<widget name="E" canvas="100x100"><properties></properties><style>.b{width:10px;height:10px}</style><div class="b"></div></widget>')
  const g5b = compileWidgetHtml('<widget name="E" canvas="100x100"><properties>\n  {}\n</properties><style>.b{width:10px;height:10px}</style><div class="b"></div></widget>')
  const g5c = compileWidgetHtml('<widget name="E" canvas="100x100"><style>.b{width:10px;height:10px}</style><div class="b"></div></widget>')
  if (g5a.ok && g5b.ok && g5c.ok
    && !(g5a.doc as any).components.some((c: any) => c.baseClass === 'UIWorldAnchorComponent')) {
    ok('G5 空属性区/空对象/无参数区 三者等价')
  } else bad(`G5 空参数区异常: ${[g5a, g5b, g5c].map((r) => r.ok).join(',')} ${!g5a.ok ? failMsg(g5a) : ''}`)

  // G6 sourceHash 随 region 变化
  const g6a = compileWidgetHtml(g1src)
  const g6b = compileWidgetHtml(g1src.replace('"pxPerMeter": 300', '"pxPerMeter": 301'))
  if (g6a.ok && g6b.ok && (g6a.doc as any).sourceHash !== (g6b.doc as any).sourceHash) ok('G6 sourceHash 随 region 值变化')
  else bad('G6 sourceHash 未随 region 变化')

  // G7 坏 JSON（带行号）
  const g7 = compileWidgetHtml(`<widget name="B" canvas="100x100">
  <properties>
    { "B": { "UIWorldAnchorComponent": { "pxPerMeter": } } }
  </properties>
  <style>.b{width:10px;height:10px}</style><div class="b"></div></widget>`)
  if (!g7.ok && g7.errors[0].line === 2 && /JSON/.test(g7.errors[0].message)) ok(`G7 坏 JSON 拦截（行 ${g7.errors[0].line}）`)
  else bad(`G7 坏 JSON 未拦截或行号错误: ${g7.ok ? '编译通过' : failMsg(g7)}`)

  // G8 未知节点名
  const g8 = compileWidgetHtml(`<widget name="U" canvas="100x100">
  <properties>{ "Ghost": { "UIWorldAnchorComponent": { "pxPerMeter": 1 } } }</properties>
  <style>.b{width:10px;height:10px}</style><div class="b"></div></widget>`)
  if (!g8.ok && /Ghost/.test(g8.errors[0].message)) ok('G8 未知节点名拦截')
  else bad(`G8 未知节点未拦截: ${g8.ok ? '编译通过' : failMsg(g8)}`)

  // G9 视觉组件禁声明
  const g9 = compileWidgetHtml(`<widget name="V" canvas="100x100">
  <properties>{ "V": { "UITextComponent": { "text": "x" } } }</properties>
  <style>.b{width:10px;height:10px}</style><div class="b"></div></widget>`)
  if (!g9.ok && /视觉组件/.test(g9.errors[0].message)) ok('G9 视觉组件禁声明拦截')
  else bad(`G9 视觉组件未拦截: ${g9.ok ? '编译通过' : failMsg(g9)}`)

  // G10 嵌套 properties 不识别（按未知标签拒绝）
  const g10 = compileWidgetHtml(`<widget name="N" canvas="100x100">
  <style>.b{width:10px;height:10px}</style>
  <div class="b"><properties>{}</properties></div></widget>`)
  if (!g10.ok) ok('G10 嵌套参数区拒绝（非 widget 直接子级）')
  else bad('G10 嵌套参数区未被拦截')

  // G11 锚点参数改写 region（补丁路径；其余内容逐字节不变）
  const g11doc = JSON.parse(JSON.stringify(g1.doc)) as any
  g11doc.components.find((c: any) => c.baseClass === 'UIWorldAnchorComponent').properties.pxPerMeter = 150
  const g11 = patchWidgetHtmlInPlace(g1src, g11doc)
  const stripRegion = (s: string): string => s.replace(/<properties>[\s\S]*?<\/properties>/, '<properties/>')
  if (g11.ok && g11.edits.length === 1 && /"pxPerMeter": 150/.test(g11.html)
    && stripRegion(g11.html) === stripRegion(g1src)) {
    ok('G11 pxPerMeter 经 region 键重写（参数区外逐字节不变）')
  } else bad(`G11 补丁异常: ok=${g11.ok} edits=${g11.edits.length} reason=${g11.reason}`)

  // G12 legacy data-props 锚点 → 自动创建 region（region 赢，data-props 残留被覆盖）
  const g12src = `<widget name="L" canvas="400x300" data-comp="UIWorldAnchorComponent" data-props='{"mode":"world","pxPerMeter":100,"faceCamera":true}'>
  <style>.b { width: 10px; height: 10px; }</style><div class="b"></div>
</widget>`
  const g12c = compileWidgetHtml(g12src)
  const g12doc = JSON.parse(JSON.stringify(g12c.doc)) as any
  g12doc.components.find((c: any) => c.baseClass === 'UIWorldAnchorComponent').properties.pxPerMeter = 200
  const g12 = patchWidgetHtmlInPlace(g12src, g12doc)
  if (g12.ok && /<properties>/.test(g12.html) && /"pxPerMeter": 200/.test(g12.html)
    && /data-props=/.test(g12.html)) {
    const re12 = compileWidgetHtml(g12.html)
    const p12 = re12.ok ? findComp(re12.doc, 'UIWorldAnchorComponent')?.properties : null
    if (p12?.pxPerMeter === 200 && p12.mode === 'world' && p12.faceCamera === true) {
      ok('G12 legacy 资产自动创建 region（重编译 region 赢）')
    } else bad(`G12 重编译异常: ${JSON.stringify(p12)}`)
  } else bad(`G12 补丁异常: ok=${g12.ok} reason=${g12.reason}`)

  // G13 多键同改单次重写
  const g13doc = JSON.parse(JSON.stringify(g1.doc)) as any
  const g13anchor = g13doc.components.find((c: any) => c.baseClass === 'UIWorldAnchorComponent').properties
  g13anchor.pxPerMeter = 99
  g13anchor.faceCamera = false
  const g13 = patchWidgetHtmlInPlace(g1src, g13doc)
  if (g13.ok && g13.edits.length === 1 && /"pxPerMeter": 99/.test(g13.html) && /"faceCamera": false/.test(g13.html)) {
    ok('G13 多键同改单次规范化重写')
  } else bad(`G13 补丁异常: ok=${g13.ok} edits=${g13.edits.length} reason=${g13.reason}`)

  // G14 视觉属性回归：fontSize 补丁走 CSS span，region 零改动
  const g14src = `<widget name="T" canvas="400x300">
  <properties>
    { "T": { "UIWorldAnchorComponent": { "mode": "world", "pxPerMeter": 100 } } }
  </properties>
  <style>.Label { width: 100px; height: 40px; font-size: 20px; color: #ffffff; }</style>
  <text class="Label">hi</text>
</widget>`
  const g14new = compileWidgetHtml(g14src.replace('font-size: 20px', 'font-size: 30px'))
  const g14 = patchWidgetHtmlInPlace(g14src, g14new.doc as any)
  const regionOf = (s: string): string => /<properties>[\s\S]*?<\/properties>/.exec(s)?.[0] ?? ''
  if (g14.ok && /font-size: 30px/.test(g14.html) && regionOf(g14.html) === regionOf(g14src)) {
    ok('G14 视觉属性补丁与参数区互不干扰')
  } else bad(`G14 补丁异常: ok=${g14.ok} reason=${g14.reason}`)

  // G15 UILayout 调参仍走元素 data-props 属性路径（不迁 region；单子项容器 spacing
  // 变化无几何影响，避免与"子项位置为求解器派生值"的既有设计内回退纠缠）
  const g15src = `<widget name="F" canvas="400x300">
  <properties>
    { "F": { "UIWorldAnchorComponent": { "mode": "world", "pxPerMeter": 100 } } }
  </properties>
  <style>.row { width: 300px; height: 100px; display: flex; justify-content: center; align-items: center; gap: 20px; }
  .kid { width: 50px; height: 50px; }</style>
  <div class="row"><div class="kid"></div></div>
</widget>`
  const g15old = compileWidgetHtml(g15src)
  const g15doc = structuredClone(g15old.doc) as any
  g15doc.children[0].components.find((c: any) => c.baseClass === 'UILayoutComponent').properties.spacingX = 30
  const g15 = patchWidgetHtmlInPlace(g15src, g15doc)
  if (g15.ok && /data-comp='UILayoutComponent'/.test(g15.html) && /"spacingX":30/.test(g15.html)
    && regionOf(g15.html) === regionOf(g15src)) {
    ok('G15 UILayout 调参走 data-props 属性路径（region 不动）')
  } else bad(`G15 补丁异常: ok=${g15.ok} reason=${g15.reason}`)

  // G16 根锚点反编译输出 region（无 data-comp 残留）
  const g16 = decompileWidgetJson(g1.doc!)
  if (g16.ok && /<properties>/.test(g16.html!) && /"R"/.test(g16.html!)
    && /"pxPerMeter": 300/.test(g16.html!) && !/UIWorldAnchor/.test((g16.html!.match(/<widget [^>]+>/) ?? [''])[0])) {
    ok('G16 根锚点反编译 → 规范 region 块（开标签无锚点残留）')
  } else bad(`G16 反编译异常: ok=${g16.ok} ${g16.html?.slice(0, 160)}`)

  // G17 子节点锚点反编译 → region 按节点名键控
  const j17 = {
    name: 'W', baseClass: 'Actor', sourceHash: 'x',
    components: [
      { baseClass: 'UITransformComponent', properties: { position: [0, 0, 0], worldWidth: 400, worldHeight: 300 } },
      { baseClass: 'CanvasUIComponent', properties: { width: 400, height: 300, name: 'Canvas', zOrder: 0, active: true } },
    ],
    children: [{
      name: 'Bubble', baseClass: 'Actor', id: 1,
      components: [
        { baseClass: 'UITransformComponent', properties: { position: [0, 0, 0], worldWidth: 100, worldHeight: 100 } },
        { baseClass: 'CanvasUIComponent', properties: { markerOnly: true, name: 'UIMarker', zOrder: 0 } },
        { baseClass: 'UIWorldAnchorComponent', properties: { mode: 'world', pxPerMeter: 350 } },
      ],
      children: [],
    }],
  }
  const g17 = decompileWidgetJson(j17)
  const g17r = g17.ok ? compileWidgetHtml(g17.html!) : null
  const bubble17 = g17r?.ok ? (g17r.doc as any).children.find((c: any) => c.name === 'Bubble') : null
  const p17 = bubble17?.components?.find((c: any) => c.baseClass === 'UIWorldAnchorComponent')?.properties
  if (g17.ok && g17r?.ok && p17?.pxPerMeter === 350 && p17.mode === 'world') {
    ok('G17 子节点锚点经 region 往返还原')
  } else bad(`G17 往返异常: ok=${g17.ok}/${g17r?.ok} p17=${JSON.stringify(p17)} ${g17r && !g17r.ok ? failMsg(g17r) : ''}`)

  // G18 3 资产反编译往返：几何逐位等价 + 非 UITransform 组件逐键等价（含 region 锚点）。
  // UITransform 不逐键比：反编译按规范把流内 position 重编码为 anchor+anchorOffset
  //（矩形等价，既有 §7 已覆盖），字段级编码差异是设计内行为
  {
    interface JN { name?: string; components?: any[]; children?: JN[] }
    const sortify = (v: any): any => Array.isArray(v) ? v.map(sortify)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortify(v[k])]))
        : v
    const collect18 = (root: JN): Map<string, string> => {
      const out = new Map<string, string>()
      const rootCanvas = (root.components ?? []).find((c: any) => c.baseClass === 'CanvasUIComponent')
      const cw = Number((rootCanvas?.properties as any)?.width ?? 1920)
      const ch = Number((rootCanvas?.properties as any)?.height ?? 1080)
      const walk = (n: JN, pc: { x: number; y: number }, pd: { pw: number; ph: number }, p: string): void => {
        const tf = (n.components ?? []).find((c: any) => c.baseClass === 'UITransformComponent')?.properties ?? {}
        const ww = Number(tf.worldWidth ?? 0)
        const wh = Number(tf.worldHeight ?? 0)
        let cx = pc.x
        let cy = pc.y
        const anchor = tf.anchor as string | undefined
        const off = (tf.anchorOffset as [number, number] | undefined) ?? [0, 0]
        const lp = tf.position as [number, number, number] | undefined
        if (anchor && anchor !== 'stretch') {
          const fx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0
          const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? -1 : 0
          cx += (fx * (pd.pw - ww)) / 2 + off[0]
          cy -= (fy * (pd.ph - wh)) / 2 + off[1]
        } else if (lp) {
          cx += lp[0]
          cy += -lp[1]
        }
        const rect = [cx - ww / 2, cy - wh / 2, ww, wh].map((v) => Math.round(v * 1e9) / 1e9).join(',')
        const comps = (n.components ?? []).filter((c: any) => c.baseClass !== 'UITransformComponent')
          .map((c: any) => c.baseClass + ':' + JSON.stringify(sortify(c.properties ?? {})))
          .sort()
        out.set(p, `${rect}|${comps.join(' ')}`)
        for (const c of n.children ?? []) walk(c, { x: cx, y: cy }, { pw: ww, ph: wh }, `${p}/${c.name}`)
      }
      walk(root, { x: cw / 2, y: ch / 2 }, { pw: cw, ph: ch }, 'root')
      return out
    }
    const dir = 'src/projects/fish/asset/blueprints/ui'
    for (const f of ['building_info', 'building_collect', 'base_hologram']) {
      const src = fs.readFileSync(path.join(dir, `${f}.widget.html`), 'utf-8')
      const r1 = compileWidgetHtml(src)
      const d = r1.ok ? decompileWidgetJson(r1.doc!) : null
      const r2 = d?.html ? compileWidgetHtml(d.html) : null
      if (!r1.ok || !d?.ok || !r2?.ok) {
        bad(`G18 管线失败: ${f} ${!r1.ok ? failMsg(r1) : ''} ${r2 && !r2.ok ? failMsg(r2) : ''}`)
        continue
      }
      const m1 = collect18(r1.doc as JN)
      const m2 = collect18(r2.doc as JN)
      let diffs = 0
      for (const [k, v] of m1) {
        if (m2.get(k) !== v) { diffs++; if (diffs <= 3) console.log(`   ⚠ ${f} ${k}\n     一次: ${v}\n     二次: ${m2.get(k)}`) }
      }
      for (const k of m2.keys()) if (!m1.has(k)) { diffs++; console.log(`   ⚠ ${f} 多余: ${k}`) }
      if (diffs === 0) ok(`G18 往返语义等价（矩形逐位 + 组件逐键）: ${f}`)
      else bad(`G18 ${f} ${diffs} 处差异`)
    }
  }
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
