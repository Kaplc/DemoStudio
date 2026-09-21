/**
 * warm-current 全息底栏分类改版 e2e（2026-09-18：资源/地表建筑/轨道建筑）
 *
 * 用户需求：
 *  1. 打开全息模式后，左侧进入入口（星球信息面板）隐藏，退出恢复
 *  2. 底部工具条改 4 固定按钮（⚡ 环节点 + 资源/地表建筑/轨道建筑），原业务入口
 *     （建造/运输/航线/科研/聚能环/火箭设计）从全息底栏下架（主 HUD 保留）
 *  3. 全息面板内容跟随底部分类切换（资源=矿点+矿建 / 地表建筑=工具行 /
 *     轨道建筑=orbit_build 行嵌入 / 环节点=节点视图）
 *
 * 验证口径：vm 数据（holoInfo）+ UI Actor bActive（VisBinder 显隐权威）+ getHUD 文本（标题随分类）。
 */
import { expect, test, type Page } from '@playwright/test'

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

async function bootToMap(page: Page): Promise<void> {
  await page.goto('/')
  const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
  await card.click()
  await page.getByRole('button', { name: '打开工程' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
  await page.locator('button', { hasText: '▶' }).first().click()
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
    if (!ai) return false
    const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean, error?: string }> }
    const first = r?.results?.[0]
    return !!first?.ok || first?.error !== '游戏未运行'
  }, { timeout: 60_000, polling: 500 })
  await waitGameReady(page)
}

/** 在游戏世界 UI Actor 树中按 root.name 深度查找（hud.spec 同款） */
const FIND_FN = `(a, name) => {
  if (a.root.name === name) return a
  for (const c of a.getChildren()) { const hit = window.__findRec(c, name); if (hit) return hit }
  return null
}`

async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { window.__findRec = ${FIND_FN}; const __f = ${fn}; return __f() })()`) as Promise<T>
}

/** ai.clickActor 显式自执行求值 + 700ms 等待（吸收 500ms 点击冷却 + 8Hz HUD 差分窗） */
async function clickActor(page: Page, name: string): Promise<void> {
  await page.evaluate(`(async () => { return window.__ai.emit('ai.clickActor', { name: ${JSON.stringify(name)} }) })()`)
  await page.waitForTimeout(700)
}

/** getHUD 树内按 面板根名 → 子节点名 取文字内容（null = 面板/节点不存在） */
async function hudText(page: Page, panelName: string, nodeName: string): Promise<string | null> {
  return page.evaluate(`(() => {
    const r = window.__ai.emit('ai.getHUD', {})
    const roots = (r && r.results && r.results[0] && r.results[0].hud) || []
    const find = (n, target) => {
      if (!n) return null
      if (n.name === target) return n
      for (const c of (n.children ?? [])) { const f = find(c, target); if (f) return f }
      return null
    }
    for (const root of roots) {
      const panel = find(root, ${JSON.stringify(panelName)})
      if (panel) { const t = find(panel, ${JSON.stringify(nodeName)}); if (t) return t.text ?? '' }
    }
    return null
  })()`) as Promise<string | null>
}

/** 面板根 Actor 查找 + 关键节点 bActive 快照（VisBinder 显隐权威 = bActive） */
const VIS_SNAPSHOT_FN = `() => {
  const mode = window.__warmCurrent.mode()
  const getPanel = (name) => {
    let hit = null
    mode.world.ui._uiActors.forEach((v) => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === name) hit = a })
    return hit
  }
  const info = getPanel('PlanetInfoPanel')
  const holoHud = getPanel('HoloHud')
  const holoPanel = getPanel('HologramPanel')
  const mainHud = getPanel('WarmCurrentHud')
  const act = (root, name) => { const n = root ? window.__findRec(root, name) : null; return n ? n.bActive : null }
  return {
    infoBody: act(info, 'InfoBody'),
    holoBar: act(holoHud, 'HoloBar'),
    ringTool: act(holoHud, 'HoloBtn_ring_tool'),
    tabRes: act(holoHud, 'HoloBtn_tab_resources'),
    tabSurface: act(holoHud, 'HoloBtn_tab_surface'),
    tabOrbit: act(holoHud, 'HoloBtn_tab_orbit'),
    holoBtnBuild: !!window.__findRec(holoHud, 'HoloBtn_build'),
    holoBtnRoutes: !!window.__findRec(holoHud, 'HoloBtn_routes'),
    holoBtnDesign: !!window.__findRec(holoHud, 'HoloBtn_design'),
    mainHudBtnBuild: !!window.__findRec(mainHud, 'Btn_build'),
    mainHudBtnRoutes: !!window.__findRec(mainHud, 'Btn_routes'),
    deposit0: act(holoPanel, 'DepositRow_0'),
    ringRow: act(holoPanel, 'Btn_tool_ring'),
    tool0: act(holoPanel, 'ToolRow_0'),
    orbitIntro: act(holoPanel, 'OrbitIntro'),
    orbit0: act(holoPanel, 'OrbitRow_0'),
    build0: act(holoPanel, 'BuildRow_0'),
  }
}`

test.describe('warm-current 全息底栏分类改版（资源/地表建筑/轨道建筑）', () => {
  test('入口面板隐藏恢复 + 底栏 4 按钮 + 分类内容切换全链路', async ({ page }) => {
    test.setTimeout(240_000)
    await bootToMap(page)
    // 冻结仿真（防自然 defeat 弹卡干扰 UI；UI 差分同步不受暂停影响）
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)

    // ── 1. 开星球信息面板（全息入口）→ 面板显形 ──
    await page.evaluate(`(() => { window.__warmCurrent.openPlanetInfo('earth') })()`)
    await page.waitForTimeout(400)
    const before = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(before.infoBody, '点星球后入口面板应显形').toBe(true)

    // ── 2. 开全息地球 → 入口面板隐藏 + 底栏 4 按钮显形 + 业务按钮已下架 ──
    await page.evaluate(`(() => { window.__warmCurrent.openHologram('earth') })()`)
    await page.waitForTimeout(500)
    const vm1 = await page.evaluate(`(() => {
      const info = window.__warmCurrent.holoInfo()
      return { tab: info?.earth?.tab, orbitRows: info?.earth?.orbitRows?.length, intro: info?.earth?.orbitIntro }
    })()`) as Record<string, any>
    expect(vm1.tab).toBe('resources')
    expect(vm1.orbitRows).toBe(2) // orbit_build 表：dock + station
    expect(String(vm1.intro)).toContain('造船')

    const inHolo = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(inHolo.infoBody, '全息开启后左侧入口面板应隐藏（2026-09-18 用户定案）').toBe(false)
    expect(inHolo.holoBar, '全息底栏应显形').toBe(true)
    expect(inHolo.ringTool, '⚡ 环节点按钮应显形').toBe(true)
    for (const k of ['tabRes', 'tabSurface', 'tabOrbit']) {
      expect(inHolo[k], `分类按钮 ${k} 应显形`).toBe(true)
    }
    for (const k of ['holoBtnBuild', 'holoBtnRoutes', 'holoBtnDesign']) {
      expect(inHolo[k], `全息底栏业务按钮 ${k} 应已下架`).toBe(false)
    }
    expect(inHolo.mainHudBtnBuild, '主 HUD 建造入口应保留').toBe(true)
    expect(inHolo.mainHudBtnRoutes, '主 HUD 航线入口应保留').toBe(true)
    expect(await hudText(page, 'HologramPanel', 'TitleText')).toBe('全息地球 · 资源')
    // 资源分类默认内容：地球矿点行 + 矿建建造区
    expect(inHolo.deposit0, '资源分类应显示矿点行').toBe(true)
    expect(inHolo.build0, '资源分类应显示矿建行').toBe(true)

    // ── 3. 轨道建筑分类：orbit_build 行嵌入 + 其他组隐藏 ──
    await clickActor(page, 'HoloBtn_tab_orbit')
    let vm = await page.evaluate(`(() => window.__warmCurrent.holoInfo()?.earth?.tab)()`)
    expect(vm).toBe('orbit')
    let snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.orbit0, '轨道分类应显示轨道建筑行').toBe(true)
    expect(snap.orbitIntro, '轨道分类应显示船坞引导行').toBe(true)
    expect(snap.deposit0, '轨道分类矿点行应隐藏').toBe(false)
    expect(snap.tool0, '轨道分类地表建筑工具行应隐藏').toBe(false)
    expect(await hudText(page, 'HologramPanel', 'TitleText')).toBe('全息地球 · 轨道建造')

    // ── 4. 地表建筑分类：工具行显形 ──
    await clickActor(page, 'HoloBtn_tab_surface')
    vm = await page.evaluate(`(() => window.__warmCurrent.holoInfo()?.earth?.tab)()`)
    expect(vm).toBe('surface')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.tool0, '地表建筑分类应显示工具行').toBe(true)
    expect(snap.orbit0, '地表建筑分类轨道行应隐藏').toBe(false)
    expect(await hudText(page, 'HologramPanel', 'TitleText')).toBe('全息地球 · 地表建造')

    // ── 5. 资源分类：切回矿点视图 ──
    await clickActor(page, 'HoloBtn_tab_resources')
    vm = await page.evaluate(`(() => window.__warmCurrent.holoInfo()?.earth?.tab)()`)
    expect(vm).toBe('resources')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.deposit0).toBe(true)
    expect(snap.tool0).toBe(false)
    expect(await hudText(page, 'HologramPanel', 'TitleText')).toBe('全息地球 · 资源')

    // ── 6. ⚡ 环节点：切换落位工具 + 面板环节点视图；再点取消工具 ──
    await clickActor(page, 'HoloBtn_ring_tool')
    let earth = await page.evaluate(`(() => {
      const e = window.__warmCurrent.holoInfo()?.earth
      return { tab: e?.tab, ringSelected: e?.tools?.[0]?.selected }
    })()`) as Record<string, any>
    expect(earth.tab).toBe('ring')
    expect(earth.ringSelected, '点环节点按钮应激活落位工具').toBe(true)
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.ringRow, '环节点视图应显示节点统计行').toBe(true)

    await clickActor(page, 'HoloBtn_ring_tool')
    earth = await page.evaluate(`(() => {
      const e = window.__warmCurrent.holoInfo()?.earth
      return { tab: e?.tab, ringSelected: e?.tools?.[0]?.selected }
    })()`) as Record<string, any>
    expect(earth.ringSelected, '再点环节点按钮应取消落位工具').toBe(false)
    expect(earth.tab, '取消工具后仍停留环节点视图').toBe('ring')

    // ── 7. 退出全息 → 入口面板恢复 + 底栏收起 ──
    await page.evaluate(`(() => { window.__warmCurrent.closeHologram() })()`)
    await page.waitForTimeout(400)
    const after = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(after.infoBody, '退出全息后入口面板应恢复显形').toBe(true)
    expect(after.holoBar, '退出全息后底栏应收起').toBe(false)
  })

  test('矿点勘探态（月球）不受改版影响：分类工具条隐藏 + 矿点全显', async ({ page }) => {
    test.setTimeout(180_000)
    await bootToMap(page)
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)

    await page.evaluate(`(() => { window.__warmCurrent.openPlanetInfo('moon') })()`)
    await page.evaluate(`(() => { window.__warmCurrent.openHologram('moon') })()`)
    await page.waitForTimeout(500)

    const snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.infoBody, '勘探态同样隐藏入口面板').toBe(false)
    expect(snap.holoBar, '勘探态底栏显形').toBe(true)
    expect(snap.tabRes, '勘探态分类工具条应整组隐藏').toBe(false)
    expect(snap.ringTool, '勘探态环节点按钮应隐藏').toBe(false)
    expect(snap.deposit0, '勘探态矿点行保持全显').toBe(true)
    expect(await hudText(page, 'HologramPanel', 'TitleText')).toBe('全息勘探 · 月球')

    await page.evaluate(`(() => { window.__warmCurrent.closeHologram() })()`)
    await page.waitForTimeout(400)
    const after = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(after.infoBody, '退出勘探后入口面板恢复').toBe(true)
  })
})
