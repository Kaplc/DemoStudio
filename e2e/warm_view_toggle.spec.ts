/**
 * warm-current 视角切换 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 需求（2026-09-07）：warm 项目开局场景只看地球+月球（其他星球未解锁），
 * 初始相机取景地球系；右下角新增 ViewToggle widget 切换「地球系 / 太阳系」星图视角。
 *
 * TDD：本文件先锁定新行为口径（当前实现为开局全景，会红），实现后跑绿。
 *
 * 不变量：
 *  1. 开局即地球系取景：相机 target ≈ 地球实时位置（画布→世界换算 x-960 / z-540），viewMode='earth'
 *  2. ViewToggle widget 挂在 UI 树（Root 名 ViewToggle），含 Btn_view_earth / Btn_view_solar 两按钮
 *  3. 点「太阳系」→ target 回世界原点全景（viewMode='solar'）
 *  4. 点「地球系」→ target 回地球位置；仿真时间推进后相机自动跟随地球公转（无需再点按钮）
 */
import { expect, test, type Page } from '@playwright/test'

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

/** 相机 target / 地球位置 / 视角模式快照（地球位置 = 蓝图 Actor root.position，世界坐标） */
async function probeCam(page: Page): Promise<{ tx: number; tz: number; ex: number; ez: number; viewMode: string }> {
  return page.evaluate(`(() => {
    const b = window.__warmCurrent
    const mode = b.mode()
    const t = mode.cameraActor.rig.target
    const earth = mode.starActors.get('earth')
    const p = earth.root.position
    return { tx: t.x, tz: t.z, ex: p.x, ez: p.z, viewMode: mode.viewMode }
  })()`) as Promise<{ tx: number; tz: number; ex: number; ez: number; viewMode: string }>
}

async function clickViewBtn(page: Page, name: string): Promise<void> {
  await page.evaluate(`(() => { window.__ai.emit('ai.clickActor', { name: '${name}' }) })()`)
  await page.waitForTimeout(300)
}

test.describe('warm-current 视角切换（开局地球系 + ViewToggle widget）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    // 菜单阶段点主菜单 Btn_new 进正式游戏（__ai 编辑器级桥，ai.clickActor 扫 UI Actor 树）
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
  })

  test('开局即地球系取景（target ≈ 地球实时位置，viewMode=earth）', async ({ page }) => {
    const p = await probeCam(page)
    expect(p.viewMode, '开局视角模式应为地球系').toBe('earth')
    expect(Math.hypot(p.tx - p.ex, p.tz - p.ez), '相机 target 应锁定地球位置').toBeLessThan(5)
    expect(Math.hypot(p.tx, p.tz), 'target 不在世界原点（非全景取景，地球轨道半径 250px）').toBeGreaterThan(100)
  })

  test('ViewToggle widget 存在且含地球系/太阳系两按钮', async ({ page }) => {
    const res = await page.evaluate(`(() => {
      const mode = window.__warmCurrent.mode()
      let vt = null
      mode.world.ui._uiActors.forEach(v => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === 'ViewToggle') vt = a })
      const find = (a, n) => { if (!a) return null; if (a.root.name === n) return a; for (const c of a.getChildren()) { const h = find(c, n); if (h) return h } return null }
      return { found: !!vt, earth: !!find(vt, 'Btn_view_earth'), solar: !!find(vt, 'Btn_view_solar') }
    })()`) as Promise<{ found: boolean; earth: boolean; solar: boolean }>
    expect(res.found, 'UI 树应有 ViewToggle widget').toBe(true)
    expect(res.earth, '应有 Btn_view_earth 按钮').toBe(true)
    expect(res.solar, '应有 Btn_view_solar 按钮').toBe(true)
  })

  test('切太阳系全景 → 切回地球系并自动跟随公转', async ({ page }) => {
    // 太阳系：target 回世界原点
    await clickViewBtn(page, 'Btn_view_solar')
    let p = await probeCam(page)
    expect(p.viewMode, '点击太阳系按钮后视角模式应为 solar').toBe('solar')
    expect(Math.hypot(p.tx, p.tz), '太阳系全景 target 应回世界原点').toBeLessThan(5)

    // 地球系：target 拉回地球
    await clickViewBtn(page, 'Btn_view_earth')
    p = await probeCam(page)
    expect(p.viewMode, '点击地球系按钮后视角模式应为 earth').toBe('earth')
    expect(Math.hypot(p.tx - p.ex, p.tz - p.ez), '切回地球系后 target 重新锁定地球').toBeLessThan(5)

    // 跟随：推进仿真时间 30s（直接推进 state.time；地球角速度 ≈0.011 rad/s → 位移 ≈ 82px），
    // 相机 target 应自动跟上地球新位置（无需再点按钮）
    await page.evaluate(`(() => {
      const m = window.__warmCurrent.mode()
      m.simState.state.time += 30
      window.__warmCurrent.stepTicks(1)
    })()`)
    const p2 = await probeCam(page)
    expect(Math.hypot(p2.tx - p2.ex, p2.tz - p2.ez), '仿真推进后相机应自动跟随地球公转').toBeLessThan(5)
  })
})
