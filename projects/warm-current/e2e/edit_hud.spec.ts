/**
 * warm-current 编辑台专用底部 HUD e2e（2026-09-30）
 *
 * 用户需求：进入编辑状态（轨道蓝图台）后底部 HUD 隐藏，新建编辑模式专用底部 HUD。
 *
 * 覆盖（真实 UI 点击链路 ai.clickActor + bActive 显隐快照 + getHUD 文本）：
 *   1. 常规态：主 HUD BottomBar 显形、编辑台 EditBar 收起
 *   2. 点「编辑」进台：BottomBar 隐藏 / EditBar 显形；预选中转站放置（buildActive=relay）→
 *      取消放置显形、状态行 = 放置引导、建造面板预开
 *   3. 取消放置：buildActive 清空 → 取消放置隐藏、状态行回蓝图台通用提示
 *   4. 建造选型开合：点按钮收起/再开建造面板；展开态标签 ● 前缀
 *   5. ✕ 退出：回常规态（EditBar 收起 / BottomBar 恢复 / 建造面板收起 / 放置态清空）
 *   6. 边界：全息态 BottomBar 隐藏时编辑台底栏也不显形（routeEditMode=false 权威）
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

/** 关键节点 bActive 快照（VisBinder 显隐权威 = bActive）+ vm 权威字段 */
const VIS_SNAPSHOT_FN = `() => {
  const b = window.__warmCurrent
  const mode = b.mode()
  const getPanel = (name) => {
    let hit = null
    mode.world.ui._uiActors.forEach((v) => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === name) hit = a })
    return hit
  }
  const hud = getPanel('WarmCurrentHud')
  const editHud = getPanel('EditHud')
  const buildPanel = getPanel('BuildPanel')
  const act = (root, name) => { const n = root ? window.__findRec(root, name) : null; return n ? n.bActive : null }
  const vm = b.vm()
  return {
    bottomBar: act(hud, 'BottomBar'),
    editBar: act(editHud, 'EditBar'),
    editCancel: act(editHud, 'EditBtn_cancel'),
    editBuildBtn: act(editHud, 'EditBtn_build'),
    buildBody: act(buildPanel, 'BuildBody'),
    routeEditMode: vm?.routeEditMode ?? null,
    buildActive: vm?.buildActive ?? null,
    blueprintHint: vm?.blueprintHint ?? '',
  }
}`

test.describe('warm-current 编辑台专用底部 HUD（编辑态隐藏主底栏换专用底栏）', () => {
  test('进入 → 放置态 → 取消 → 建造选型开合 → 退出恢复 全链路', async ({ page }) => {
    test.setTimeout(240_000)
    await bootToMap(page)
    // 冻结仿真（防 HexModal 弹卡干扰 UI；UI 差分同步不受暂停影响）
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)

    // ── 1. 常规态：主底栏显形，编辑台底栏收起 ──
    let snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.bottomBar, '常规态主 HUD 底栏应显形').toBe(true)
    expect(snap.editBar, '常规态编辑台底栏应收起').toBe(false)
    expect(snap.routeEditMode).toBe(false)
    expect(snap.buildActive).toBeNull()

    // ── 2. 点「编辑」进台：底栏切换 + 预选中转站放置 + 建造面板预开 ──
    await clickActor(page, 'Btn_edit')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.routeEditMode, '应进入轨道蓝图台').toBe(true)
    expect(snap.buildActive, '进台应预选中转站放置').toBe('relay')
    expect(snap.bottomBar, '编辑态主 HUD 底栏应隐藏（2026-09-30 用户需求）').toBe(false)
    expect(snap.editBar, '编辑台专用底栏应显形').toBe(true)
    expect(snap.editBuildBtn, '建造选型按钮应显形').toBe(true)
    expect(snap.editCancel, '放置中取消放置按钮应显形').toBe(true)
    expect(snap.buildBody, '进台预开建造面板（放置选型）').toBe(true)
    expect(await hudText(page, 'EditHud', 'EditTitle')).toBe('轨道蓝图台')
    const placing = await hudText(page, 'EditHud', 'EditStatus')
    expect(placing, '放置态状态行应含选型引导').toContain('放置：中转站')

    // ── 3. 取消放置：回蓝图台通用提示，取消按钮隐藏 ──
    await clickActor(page, 'EditBtn_cancel')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.buildActive, '取消放置后选型应清空').toBeNull()
    expect(snap.routeEditMode, '取消放置应留在蓝图台').toBe(true)
    expect(snap.editBar, '取消放置后编辑台底栏保持显形').toBe(true)
    expect(snap.editCancel, '非放置态取消按钮应隐藏').toBe(false)
    const idle = await hudText(page, 'EditHud', 'EditStatus')
    expect(idle, '非放置态状态行应回蓝图台通用提示').toContain('编辑台')

    // ── 4. 建造选型开合：收起 → 标签素文案；再开 → BuildBody 显形 + ● 前缀 ──
    await clickActor(page, 'EditBtn_build')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.buildBody, '点建造选型应收起建造面板').toBe(false)
    expect(await hudText(page, 'EditHud', 'EditBuildLabel'), '面板收起时标签为素文案').toBe('建造选型')

    await clickActor(page, 'EditBtn_build')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.buildBody, '再点建造选型应展开建造面板').toBe(true)
    expect(await hudText(page, 'EditHud', 'EditBuildLabel'), '面板展开时标签加 ● 前缀').toBe('● 建造选型')

    // ── 5. ✕ 退出：回常规态全量恢复 ──
    await clickActor(page, 'EditBtn_exit')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.routeEditMode, '退出后应离开蓝图台').toBe(false)
    expect(snap.editBar, '退出后编辑台底栏应收起').toBe(false)
    expect(snap.bottomBar, '退出后主 HUD 底栏应恢复显形').toBe(true)
    expect(snap.buildBody, '退出应顺带收起建造面板').toBe(false)
    expect(snap.buildActive, '退出应取消放置态').toBeNull()

    // ── 6. 再进台（出口入口双向回归）：底栏再次切换 ──
    await clickActor(page, 'Btn_edit')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.routeEditMode).toBe(true)
    expect(snap.editBar, '再进台编辑台底栏应再次显形').toBe(true)
    expect(snap.bottomBar, '再进台主底栏应再次隐藏').toBe(false)
    await clickActor(page, 'EditBtn_exit')
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.routeEditMode).toBe(false)
    expect(snap.bottomBar, '二轮退出主底栏恢复').toBe(true)
  })

  test('边界：全息态主底栏隐藏时编辑台底栏不显形', async ({ page }) => {
    test.setTimeout(180_000)
    await bootToMap(page)
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)

    // 全息态：BottomBar 由 hologram 隐藏；routeEditMode=false → EditBar 保持收起
    await page.evaluate(`(() => { window.__warmCurrent.openPlanetInfo('earth') })()`)
    await page.evaluate(`(() => { window.__warmCurrent.openHologram('earth') })()`)
    await page.waitForTimeout(500)
    let snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.routeEditMode, '全息态不应在编辑台').toBe(false)
    expect(snap.bottomBar, '全息态主底栏隐藏（既有口径）').toBe(false)
    expect(snap.editBar, '全息态编辑台底栏不应显形').toBe(false)

    // 退全息：主底栏恢复，编辑台底栏仍收起
    await page.evaluate(`(() => { window.__warmCurrent.closeHologram() })()`)
    await page.waitForTimeout(400)
    snap = await evalInGame<Record<string, unknown>>(page, VIS_SNAPSHOT_FN)
    expect(snap.bottomBar, '退全息后主底栏恢复').toBe(true)
    expect(snap.editBar, '退全息后编辑台底栏仍收起').toBe(false)
  })
})
