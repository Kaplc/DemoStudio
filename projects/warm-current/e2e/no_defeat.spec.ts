/**
 * warm-current 环熄灭失败线下线回归（2026-09-30）
 *
 * 失败链移除后的不变量：
 *  - 储量耗尽（断环）→ 堆心温度缓降归零 —— 全程 outcome 保持 'playing'，
 *    SettleModal 保持隐藏（胜利结算专用，败局分支/重试本幕按钮已下架）；
 *  - 断环燃料门保留：ring='decaying'、总需求为 0（停烧停建停计费）；
 *  - 补燃料回温链保留：coreWarmSeconds 内堆心回满温、环恢复运转。
 *
 * 驱动面：window.__warmCurrent 调试桥（stepTicks 固定步推进，1 tick = 1/60s）。
 * 注意：不 pause 游戏——stepTicks 走 GameMode.Tick，暂停即冻结；开局研究线 0 点、
 * 耀斑 nextIn=∞，自然弹卡/耀斑干扰不会发生。
 */
import { expect, test, type Page } from '@playwright/test'

/** 等游戏运行起来（▶ 后 ai.getState.running=true） */
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

test.describe('warm-current 环熄灭失败线下线（堆心归零不判负）', () => {
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
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
    // 不冻结仿真：stepTicks 需要游戏在跑（GameMode.Tick 驱动）
  })

  test('储量耗尽堆心归零：outcome 保持 playing、SettleModal 隐藏、燃料门与回温链仍在', async ({ page }) => {
    // ── 段 1：烧空储量 → 断环降温 33s（coreCoolSeconds=30 无蓄热井）→ 堆心归零 ──
    const cooled = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.mode().simState.state.earthH3 = 0
      b.stepTicks(2000) // 33.3s > 30s 降温时长 → coreTemp 应归零
      const s = b.mode().simState.state
      return { outcome: s.outcome, coreTemp: s.coreTemp, ring: s.ring, demand: b.mode().simState.demand }
    })()`) as { outcome: string; coreTemp: number; ring: string; demand: number }
    expect(cooled.outcome, '堆心归零后 outcome 必须仍是 playing（失败线已下线）').toBe('playing')
    expect(cooled.coreTemp).toBe(0)
    expect(cooled.ring, '储量耗尽断环燃料门保留').toBe('decaying')
    expect(cooled.demand, '断环停烧停建停计费：总需求为 0').toBe(0)

    // ── 段 2：SettleModal 保持隐藏 + 败局 UI 已下架（无重试本幕按钮）──
    const settle = await page.evaluate(`(() => {
      const mode = window.__warmCurrent.mode()
      let modal = null
      mode.world.ui._uiActors.forEach(v => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === 'SettleModal') modal = a })
      const find = (a, name) => {
        if (!a) return null
        if (a.root.name === name) return a
        for (const c of a.getChildren()) { const hit = find(c, name); if (hit) return hit }
        return null
      }
      return {
        found: !!modal,
        active: modal ? modal.bActive : null,
        hasRetryBtn: !!find(modal, 'Btn_retry'),
        hasSandboxBtn: !!find(modal, 'Btn_sandbox'),
        hasRestartBtn: !!find(modal, 'Btn_restart'),
      }
    })()`) as { found: boolean; active: boolean | null; hasRetryBtn: boolean; hasSandboxBtn: boolean; hasRestartBtn: boolean }
    expect(settle.found, 'SettleModal 应已由 HudScript 生成').toBe(true)
    expect(settle.active, '无败局：SettleModal 必须保持隐藏').toBe(false)
    expect(settle.hasRetryBtn, '重试本幕按钮已随失败线下架').toBe(false)
    expect(settle.hasSandboxBtn, '沙盒按钮保留（胜利结算用）').toBe(true)
    expect(settle.hasRestartBtn, '重新开始按钮保留').toBe(true)

    // ── 段 3：补燃料 → 回温链仍在（coreWarmSeconds=10 内回满温、环恢复运转）──
    const warmed = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.mode().simState.state.earthH3 = 500
      b.stepTicks(700) // 11.7s > 10s 回温时长 → coreTemp 应回满
      const s = b.mode().simState.state
      return { coreTemp: s.coreTemp, ring: s.ring, outcome: s.outcome }
    })()`) as { coreTemp: number; ring: string; outcome: string }
    expect(warmed.coreTemp, '补燃料后堆心应回满温').toBe(100)
    expect(warmed.ring, '补燃料后环恢复运转').toBe('running')
    expect(warmed.outcome).toBe('playing')
  })
})
