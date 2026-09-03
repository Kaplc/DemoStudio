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
import { compileWidgetHtml, decompileWidgetJson } from '../src/editor/asset/uiCompiler/index'

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
  const expectW = (600 - 16) / 3 / 1920 * 4.8
  if (Math.abs(cellW - expectW) < 0.01) ok('grid fr 列宽')
  else bad(`grid 列宽异常: ${cellW} 期望 ${expectW.toFixed(4)}`)
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
    const expectR = (16 / 1000) * 4.8
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
      const m = (px: number) => (px / 1000) * 4.8
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

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
