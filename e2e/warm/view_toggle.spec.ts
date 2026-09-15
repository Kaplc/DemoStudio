/**
 * warm-current 视角锁定 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 需求（2026-09-14）：屏蔽太阳系/行星系切换，视角恒锁定地球系；垂直俯视机位移除，
 * 全取景走 observeFocus 斜视角（35°）。原 ViewToggle widget（地球系/太阳系按钮）已下架。
 *
 * ⚠ 坑 46（doc/testing/playwright_commands.md）：warm 游戏 e2e 一个 spec 合并为一个 test，
 * 断言按节组织（beforeEach 二次启动链路会超时）。
 *
 * 不变量：
 *  1. 开局即地球系取景：相机 target ≈ 地球实时位置，viewMode='earth'
 *  2. 相机恒斜视角：相机相对 target 有水平偏移（垂直俯视已移除）
 *  3. ViewToggle widget 不在 UI 树（右下角无地球系/太阳系按钮）
 *  4. 切换入口全部失效：setViewMode('solar') / enterPlanetSystem('mars') 均不改变视角
 *  5. 地球系内仿真时间推进后相机自动跟随地球公转
 */
import { expect, test, type Page } from '@playwright/test'

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

/** 相机 target/位置、地球位置、视角模式快照（地球位置 = 蓝图 Actor root.position，世界坐标） */
async function probeCam(page: Page): Promise<{
  tx: number; tz: number; ex: number; ez: number
  cx: number; cy: number; cz: number
  viewMode: string
}> {
  return page.evaluate(`(() => {
    const b = window.__warmCurrent
    const mode = b.mode()
    const t = mode.cameraActor.rig.target
    const earth = mode.starActors.get('earth')
    const p = earth.root.position
    const cam = mode.cameraActor.camera
    return { tx: t.x, tz: t.z, ex: p.x, ez: p.z, cx: cam.position.x, cy: cam.position.y, cz: cam.position.z, viewMode: mode.viewMode }
  })()`) as Promise<{
    tx: number; tz: number; ex: number; ez: number
    cx: number; cy: number; cz: number
    viewMode: string
  }>
}

test.describe('warm-current 视角锁定地球系（切换屏蔽 + 恒斜视角）', () => {
  test('开局地球系斜视角 + 切换入口全屏蔽 + 自动跟随公转（单 test 分节）', async ({ page }) => {
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

    // ── 1. 开局即地球系取景：target ≈ 地球实时位置（舞台钉扎：聚焦行星恒钉世界原点，
    //      target 随之在原点——旧口径"target 不在原点"是舞台机制引入前的陈旧断言，已废） ──
    const p = await probeCam(page)
    expect(p.viewMode, '开局视角模式应为地球系').toBe('earth')
    expect(Math.hypot(p.tx - p.ex, p.tz - p.ez), '相机 target 应锁定地球位置').toBeLessThan(5)

    // ── 2. 相机恒斜视角：垂直俯视机位已移除（35° 仰角 → 水平偏移 ≈ cos35°×3200 ≈ 2600） ──
    const horiz = Math.hypot(p.cx - p.tx, p.cz - p.tz)
    expect(horiz, '相机应带水平偏移（斜视角，非正上方俯视）').toBeGreaterThan(100)
    expect(p.cy, '相机应在 target 上方').toBeGreaterThan(0)

    // ── 3. ViewToggle widget 已下架：UI 树无 ViewToggle / 两按钮 ──
    const vt = await page.evaluate(`(() => {
      const mode = window.__warmCurrent.mode()
      let root = null
      mode.world.ui._uiActors.forEach(v => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === 'ViewToggle') root = a })
      const find = (a, n) => { if (!a) return null; if (a.root.name === n) return a; for (const c of a.getChildren()) { const h = find(c, n); if (h) return h } return null }
      return { found: !!root, earth: !!find(root, 'Btn_view_earth'), solar: !!find(root, 'Btn_view_solar') }
    })()`) as Promise<{ found: boolean; earth: boolean; solar: boolean }>
    expect(vt.found, 'UI 树不应再有 ViewToggle widget（2026-09-14 已下架）').toBe(false)
    expect(vt.earth, 'Btn_view_earth 按钮应不存在').toBe(false)
    expect(vt.solar, 'Btn_view_solar 按钮应不存在').toBe(false)

    // ── 4. 切换入口全部失效：setViewMode(solar) / enterPlanetSystem(mars) 均保持地球系 ──
    const after = await page.evaluate(`(() => {
      const mode = window.__warmCurrent.mode()
      mode.setViewMode('solar')        // 历史 ViewToggle 路径（已屏蔽）
      mode.enterPlanetSystem('mars')   // 双击其它行星路径（已屏蔽）
      const t = mode.cameraActor.rig.target
      const earth = mode.starActors.get('earth').root.position
      return { viewMode: mode.viewMode, focus: mode.planetFocusBody, tx: t.x, tz: t.z, ex: earth.x, ez: earth.z }
    })()`) as Promise<{ viewMode: string; focus: string; tx: number; tz: number; ex: number; ez: number }>
    expect(after.viewMode, 'setViewMode(solar) 应被屏蔽，视角保持地球系').toBe('earth')
    expect(after.focus, 'enterPlanetSystem(mars) 应被屏蔽，聚焦保持地球').toBe('earth')
    expect(Math.hypot(after.tx - after.ex, after.tz - after.ez), '相机 target 仍锁定地球').toBeLessThan(5)

    // ── 5. 地球系内自动跟随公转：推进仿真 30s（角速度 ≈0.011 rad/s → 位移 ≈ 82px） ──
    await page.evaluate(`(() => {
      const m = window.__warmCurrent.mode()
      m.simState.state.time += 30
      window.__warmCurrent.stepTicks(1)
    })()`)
    const p2 = await probeCam(page)
    expect(p2.viewMode, '推进后视角仍为地球系').toBe('earth')
    expect(Math.hypot(p2.tx - p2.ex, p2.tz - p2.ez), '仿真推进后相机应自动跟随地球公转').toBeLessThan(5)
  })
})
