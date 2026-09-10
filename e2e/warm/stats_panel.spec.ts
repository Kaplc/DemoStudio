/**
 * warm-current 收支统计面板 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 回归背景（2026-09-08 踩坑）：stats_panel.widget 根节点曾带 active=false 种子 →
 * UIManager 走 bActive 失活，applyActiveTree 把整棵子树 visible 置 false；
 * StatsPanelScript.open() 只翻根节点 root.visible → 日志显示"打开"但子树全隐藏，
 * 肉眼面板打不开。修复后种子移除，显隐全走 root.visible（与 hex_modal/settle 同款）。
 *
 * 前置：dev server 已在 :5173 运行（npm run electron:dev 或 vite）
 * 流程：同 warm_hud.spec.ts —— 选 WarmCurrent 工程卡 → 打开工程 → ▶ → Btn_new 进星图 →
 *       等桥就绪 + 冻结仿真（防自然 defeat 弹窗拦截层干扰）→ 验证收支面板开合链路。
 */
import { expect, test, type Page } from '@playwright/test'

type ClickActorResult = { results?: Array<{ ok?: boolean, error?: string }> }

async function waitGameRunning(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.getState', {}).results?.[0]?.running === true
  }, { timeout: 60_000 })
}

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

const FIND_FN = `(a, name) => {
  if (a.root.name === name) return a
  for (const c of a.getChildren()) { const hit = window.__findRec(c, name); if (hit) return hit }
  return null
}`

async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { window.__findRec = ${FIND_FN}; const __f = ${fn}; return __f() })()`) as Promise<T>
}

function emitClickActor(page: Page, arg: { name: string }): Promise<ClickActorResult> {
  return page.evaluate(`(async () => { return window.__ai.emit('ai.clickActor', ${JSON.stringify(arg)}) })()`) as Promise<ClickActorResult>
}

/** 读 StatsPanel 根与 StatsCard 卡体的可见性（null = 面板未生成）。
 *  修复后口径：显隐由根 root.visible 独占控制（three 渲染沿父链剔除整树），
 *  卡体自身 visible 恒为 true——若任何 bActive 级联强制隐藏子树则 card 变 false，
 *  即回归种子失活坑的信号。 */
const READ_VIS = `() => {
  const mode = window.__warmCurrent.mode()
  let sp = null
  mode.world.ui._uiActors.forEach(v => {
    const a = (v && v.actor) ? v.actor : v
    if (a.root && a.root.name === 'StatsPanel') sp = a
  })
  if (!sp) return null
  const card = window.__findRec(sp, 'StatsCard')
  return { root: sp.root.visible, card: card ? card.root.visible : null }
}`

test.describe('warm-current 收支统计面板（种子失活坑回归）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    await waitGameRunning(page)
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as ClickActorResult
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
    // 冻结仿真：暂停态 sim.runTick 不推进，防自然 defeat 弹窗干扰
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)
  })

  test('根因防御 + 默认收起 → 入口打开整树可见 → 入口收起 → 面板内 ✕ 再收起', async ({ page }) => {
    // ── 根因防御：面板已生成且根节点 bActive=true（不再走引擎级失活）──
    const probe = await evalInGame<{ found: boolean, bActive: boolean | null }>(page, `() => {
      const mode = window.__warmCurrent.mode()
      let sp = null
      mode.world.ui._uiActors.forEach(v => {
        const a = (v && v.actor) ? v.actor : v
        if (a.root && a.root.name === 'StatsPanel') sp = a
      })
      return { found: !!sp, bActive: sp ? sp.bActive : null }
    }`)
    expect(probe.found, 'StatsPanel 应已生成').toBe(true)
    expect(probe.bActive, '根节点 bActive 应为 true（不再走引擎级失活）').toBe(true)

    // ── 开合链路 ──
    // 默认收起：根不可见；卡体标记恒 true（未被 bActive 级联强制隐藏——修复点）
    const init = await evalInGame<{ root: boolean, card: boolean | null } | null>(page, READ_VIS)
    expect(init, 'StatsPanel/StatsCard 应存在').not.toBeNull()
    expect(init!.root, '默认根收起').toBe(false)
    expect(init!.card, '卡体未被强制隐藏（无种子失活级联）').toBe(true)

    // 入口第 1 点：根可见 → 整树渲染（修复点——修复前卡体被级联隐藏恒 false）
    await emitClickActor(page, { name: 'Btn_stats' })
    await page.waitForTimeout(600)
    const opened = await evalInGame<{ root: boolean, card: boolean | null } | null>(page, READ_VIS)
    expect(opened!.root, '入口打开后根可见').toBe(true)
    expect(opened!.card, '入口打开后卡体仍未被强制隐藏（修复点）').toBe(true)

    // 入口第 2 点：收起
    await emitClickActor(page, { name: 'Btn_stats' })
    await page.waitForTimeout(600)
    const closed = await evalInGame<{ root: boolean, card: boolean | null } | null>(page, READ_VIS)
    expect(closed!.root, '入口再点应收起').toBe(false)
    expect(closed!.card, '收起后卡体标记不受影响').toBe(true)

    // 重开 + 面板内 ✕ 关闭
    await emitClickActor(page, { name: 'Btn_stats' })
    await page.waitForTimeout(600)
    expect((await evalInGame<{ root: boolean, card: boolean | null } | null>(page, READ_VIS))!.root, '重开应可见').toBe(true)
    await emitClickActor(page, { name: 'Btn_close' })
    await page.waitForTimeout(600)
    expect((await evalInGame<{ root: boolean, card: boolean | null } | null>(page, READ_VIS))!.root, '面板内 ✕ 应回到收起').toBe(false)
  })
})
