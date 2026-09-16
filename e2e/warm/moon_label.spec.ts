/**
 * warm-current 月球悬浮字下架 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 需求（2026-09-19 用户定案）：月球头顶"满载 N/船"悬浮字整体移除（此前仅月球全息
 * 期间隐藏，2026-09-15 定案作废）；其余天体（地球等）悬浮字照旧由 LOD 仲裁。
 *
 * ⚠ 坑 46（doc/testing/playwright_commands.md）：warm 游戏 e2e 一个 spec 合并为一个 test，
 * 断言按节组织（beforeEach 二次启动链路会超时）。
 *
 * 不变量：
 *  1. syncNodes 不再给月球写副标文本（clear 口径）——LOD 拉近（subA=1）也不点亮月球副标
 *  2. 其余天体副标不受影响：地球副标在近机位（LOD subA=1 + 视图集含地球）正常点亮
 *  3. LOD 拉远（subA=0）时地球副标隐藏、月球副标恒隐藏（两分支都不复活月球悬浮字）
 */
import { expect, test, type Page } from '@playwright/test'

/** 等待游戏桥接就绪（window.__warmCurrent.ready()） */
async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

interface LabelProbe {
  moonVisible: boolean
  earthVisible: boolean
  earthOpacity: number
}

/** 用假机位直驱 syncLabelLod（只读 cam.position.y），同帧读副标显隐，规避真实相机逐帧覆写 */
async function probeLabelLod(page: Page, camY: number): Promise<LabelProbe> {
  return page.evaluate(`(() => {
    const sm = window.__warmCurrent.mode().starMap
    sm.syncLabelLod({ position: { y: ${camY} } })
    const moon = sm.starViews.moon.sub.sprite
    const earth = sm.starViews.earth.sub.sprite
    return { moonVisible: moon.visible, earthVisible: earth.visible, earthOpacity: earth.material.opacity }
  })()`) as Promise<LabelProbe>
}

test.describe('warm-current 月球悬浮字下架（其余天体副标照旧）', () => {
  test('月球副标恒隐藏 + 地球副标 LOD 正常（单 test 分节）', async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    // 场景路由事实（同 route_lane）：启动默认进主菜单场景，点「Btn_new 新的远征」切星图后桥才就绪
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
      if (!ai) return false
      return ai.emit('ai.getState', {}).results?.[0]?.running === true
    }, { timeout: 60_000 })
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      return ai.emit('ai.clickActor', { name: 'Btn_new' }).results?.[0]?.ok === true
    }, { timeout: 30_000 })
    await waitGameReady(page)
    // 推进一步，确保 syncNodes/syncLabelLod 至少完整跑过一帧
    await page.evaluate(`(() => { window.__warmCurrent.stepTicks(1) })()`)

    // ── 1. 近机位（dist=100 → subA=1，视图集 earth 模式恒含 moon+earth）：
    //      旧口径下月球副标应点亮 → 新口径必须恒隐藏（悬浮字已下架）──
    const near = await probeLabelLod(page, 100)
    expect(near.moonVisible, '月球"满载 N/船"悬浮字已下架：近机位也不得点亮').toBe(false)
    expect(near.earthVisible, '地球副标不受影响：近机位应正常点亮').toBe(true)
    expect(near.earthOpacity, '近机位副标透明度应饱和（subA=1）').toBeGreaterThan(0.95)

    // ── 2. 远机位（dist=10000 → subA=0）：地球副标被 LOD 折叠，月球副标恒隐藏 ──
    const far = await probeLabelLod(page, 10000)
    expect(far.earthVisible, '远机位地球副标应被 LOD 折叠隐藏').toBe(false)
    expect(far.moonVisible, '远机位月球副标同样恒隐藏').toBe(false)
  })
})
