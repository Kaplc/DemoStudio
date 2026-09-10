/**
 * warm-current HUD 改版 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 前置：dev server 已在 :5173 运行（npm run electron:dev 或 vite）
 * 流程：选 WarmCurrent 工程卡 → 打开工程 → ▶ 运行游戏（默认进主菜单）→
 *       点「Btn_new」进星图（__warmCurrent 桥在 switchToMapScene 才挂载，菜单阶段不存在）→
 *       等桥就绪 + 冻结仿真（防自然 defeat 弹 SettleModal/HexModal 全屏 Dim 拦截层干扰）→
 *       验证顶栏并入主 HUD / 底部科研入口开合链路 / research_panel 无入口按钮 / 二级按钮回调
 * 注意：ai.clickActor 已改射线语义（走 InputSys → PhySys 完整管线，与真实鼠标同路），
 *       ClickComponent.clickCooldown=500ms——back-to-back 连点会被冷却吞掉，
 *       所有相邻点击必须 ≥600ms 间隔分步 emit，不能塞进同一个 evaluate 原子执行。
 */
import { expect, test, type Page } from '@playwright/test'

/** ai.clickActor 回执（AIModule.emit 聚合结果取首个处理器返回） */
type ClickActorResult = { results?: Array<{ ok?: boolean, error?: string }> }

/** 等游戏运行起来（▶ 后 ai.getState.running=true，菜单/星图场景均适用） */
async function waitGameRunning(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.getState', {}).results?.[0]?.running === true
  }, { timeout: 60_000 })
}

/** 等星图场景桥就绪（window.__warmCurrent.ready()） */
async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

/** 在游戏世界 UI Actor 树中按 root.name 深度查找 */
const FIND_FN = `(a, name) => {
  if (a.root.name === name) return a
  for (const c of a.getChildren()) { const hit = window.__findRec(c, name); if (hit) return hit }
  return null
}`

async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { window.__findRec = ${FIND_FN}; const __f = ${fn}; return __f() })()`) as Promise<T>
}

/** ai.clickActor 显式自执行求值（page.evaluate(fn, arg) 序列化在当前工具链不稳，统一 JSON 内联） */
function emitClickActor(page: Page, arg: { name: string }): Promise<ClickActorResult> {
  return page.evaluate(`(async () => { return window.__ai.emit('ai.clickActor', ${JSON.stringify(arg)}) })()`) as Promise<ClickActorResult>
}

/** 发一次点击 → 等 600ms（吸收 500ms 点击冷却窗 + HUD 回调绑定窗口期）→ 再读游戏状态 */
async function emitAndRead<T>(page: Page, arg: { name: string }, read: string): Promise<T> {
  await emitClickActor(page, arg)
  await page.waitForTimeout(600)
  return page.evaluate(`(() => { const __f = ${read}; return __f() })()`) as Promise<T>
}

test.describe('warm-current HUD 改版（topbar 并入 + 底部科研入口）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // 选 WarmCurrent 工程卡（清单击避免误触父容器）
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    // 编辑器加载 → 点 ▶ 运行（触发整页重载进游戏，默认进主菜单）
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    await waitGameRunning(page)
    // 主菜单 UI 就绪后点「新的远征」（ai.clickActor 异步切场景；按钮未就绪时 ok=false，轮询重试）
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as ClickActorResult
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
    // 冻结仿真时间：暂停态 sim.runTick 不推进（GameMode.Tick 判 paused），防自然 defeat
    // 抢先弹出 SettleModal/HexModal 的全屏 Dim 拦截层干扰 UI 点击测试
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)
  })

  test('顶栏整条并入主 HUD（时间/储量/暂停/倍速/重开/储量详情，交点数迁入 RingPanel）', async ({ page }) => {
    const res = await evalInGame<Record<string, boolean>>(page, `() => {
      const mode = window.__warmCurrent.mode()
      let hud = null
      mode.world.ui._uiActors.forEach(v => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === 'WarmCurrentHud') hud = a })
      let ring = null
      mode.world.ui._uiActors.forEach(v => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === 'RingPanel') ring = a })
      const out = { hudFound: !!hud, ringFound: !!ring }
      for (const n of ['TimeText', 'ReserveText', 'Btn_pause', 'Btn_speed', 'Btn_restart', 'Btn_info']) out[n] = !!window.__findRec(hud, n)
      out.noNodesTextInHud = !window.__findRec(hud, 'NodesText')
      out.ringNodesBar = !!window.__findRec(ring, 'NodesBar')
      out.ringStateText = !!window.__findRec(ring, 'StateText')
      return out
    }`)
    expect(res.hudFound).toBe(true)
    for (const n of ['TimeText', 'ReserveText', 'Btn_pause', 'Btn_speed', 'Btn_restart', 'Btn_info']) {
      expect(res[n], `主 HUD 内应有 ${n}`).toBe(true)
    }
    expect(res.noNodesTextInHud, 'HUD 顶栏不应再有 NodesText（已迁入 RingPanel）').toBe(true)
    expect(res.ringFound, '聚能环面板 RingPanel 应已生成').toBe(true)
    expect(res.ringNodesBar, 'RingPanel 内应有交点进度条 NodesBar').toBe(true)
    expect(res.ringStateText, 'RingPanel 内应有状态徽标 StateText').toBe(true)
  })

  test('暂停/倍速按钮双态生效（暂停→继续、倍速 x1→x2）', async ({ page }) => {
    // beforeEach 已冻结仿真，先恢复运行，再按「运行态点暂停」的原意测按钮双态
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && m.paused) m.togglePause() })()`)
    // 分步点击：暂停（运行态 → paused）
    const paused = await emitAndRead<boolean>(page, { name: 'Btn_pause' }, `() => window.__warmCurrent.mode().paused`)
    expect(paused, '点 Btn_pause 后应暂停').toBe(true)
    // 再点继续（paused → 运行）
    const resumed = await emitAndRead<boolean>(page, { name: 'Btn_pause' }, `() => !window.__warmCurrent.mode().paused`)
    expect(resumed, '再点 Btn_pause 后应恢复运行').toBe(true)
    // 倍速 x1 → x2
    const speed = await emitAndRead<number>(page, { name: 'Btn_speed' }, `() => window.__warmCurrent.mode().timeScale`)
    expect(speed, '点 Btn_speed 后倍速应为 x2').toBe(2)
  })

  test('底部 bar 科研入口完整开合链路（入口开→关→重开→面板内关闭）', async ({ page }) => {
    const READ_VIS = `() => {
      const mode = window.__warmCurrent.mode()
      let rp = null
      mode.world.ui._uiActors.forEach(v => {
        const a = (v && v.actor) ? v.actor : v
        if (a.root && a.root.name === 'ResearchPanel') rp = a
      })
      if (!rp) return null
      const body = window.__findRec(rp, 'ResearchBody')
      return body ? body.root.visible : null
    }`
    const bodyVis = await evalInGame<boolean | null>(page, READ_VIS)
    expect(bodyVis, 'ResearchPanel/ResearchBody 应存在').not.toBeNull()
    expect(bodyVis, '默认收起').toBe(false)
    // 入口开（分步 emit，600ms 间隔吸收 500ms 冷却）
    await emitClickActor(page, { name: 'Btn_research' })
    await page.waitForTimeout(600)
    expect(await evalInGame<boolean | null>(page, READ_VIS), '入口第 1 点应展开').toBe(true)
    // 入口关
    await emitClickActor(page, { name: 'Btn_research' })
    await page.waitForTimeout(600)
    expect(await evalInGame<boolean | null>(page, READ_VIS), '入口第 2 点应收起').toBe(false)
    // 重开
    await emitClickActor(page, { name: 'Btn_research' })
    await page.waitForTimeout(600)
    expect(await evalInGame<boolean | null>(page, READ_VIS), '入口第 3 点应重开').toBe(true)
    // 面板内关闭
    await emitClickActor(page, { name: 'Btn_panel_close' })
    await page.waitForTimeout(600)
    expect(await evalInGame<boolean | null>(page, READ_VIS), '面板内 ✕ 关闭应收起').toBe(false)
  })

  test('research_panel 无入口按钮（入口已移至 HUD 底部 bar）且徽标在 HUD 内同步', async ({ page }) => {
    const res = await evalInGame<Record<string, unknown>>(page, `() => {
      const mode = window.__warmCurrent.mode()
      let hud = null
      let rp = null
      mode.world.ui._uiActors.forEach(v => {
        const a = (v && v.actor) ? v.actor : v
        const n = a.root ? a.root.name : ''
        if (n === 'WarmCurrentHud') hud = a
        if (n === 'ResearchPanel') rp = a
      })
      const badge = window.__findRec(hud, 'ResearchBadge')
      const badgeComp = badge ? badge.components.find(c => c.text !== undefined) : null
      return {
        panelHasEntry: !!window.__findRec(rp, 'Btn_research'),
        hudHasBottomBar: !!window.__findRec(hud, 'BottomBar'),
        badgeText: badgeComp ? badgeComp.text : null,
      }
    }`)
    expect(res.panelHasEntry).toBe(false)
    expect(res.hudHasBottomBar).toBe(true)
    expect(String(res.badgeText)).toMatch(/^均 \d+% · 船 \d+\/\d+$/)
  })

  test('超频/造船二级按钮回调生效（GameMode 侧状态变化）', async ({ page }) => {
    // 前置态：ring='running'（面板初始化显示条件）→ 分步点入口展开面板
    await page.evaluate(`(() => { window.__warmCurrent.mode().simState.state.ring = 'running' })()`)
    await emitClickActor(page, { name: 'Btn_research' })
    await page.waitForTimeout(600)
    // 超频引擎（面板展开后可见，射线命中）
    const ocOk = await emitAndRead<boolean>(page, { name: 'Btn_oc_engine' }, `() => window.__warmCurrent.mode().simState.state.overclocked.includes('engine')`)
    expect(ocOk, '点 Btn_oc_engine 后 engine 应进入超频列表').toBe(true)
    // 造船：先快照 earthH3，点 Btn_ship 入队 + 扣资源
    const h3Before = await page.evaluate(`(() => window.__warmCurrent.mode().simState.state.earthH3)()`) as number
    const queued = await emitAndRead<number>(page, { name: 'Btn_ship' }, `() => window.__warmCurrent.mode().simState.state.buildQueue.length`)
    expect(queued, '点 Btn_ship 后应入建造队列').toBeGreaterThan(0)
    const h3After = await page.evaluate(`(() => window.__warmCurrent.mode().simState.state.earthH3)()`) as number
    expect(h3Before - h3After, '造船应消耗 earthH3').toBeGreaterThan(0)
  })
})
