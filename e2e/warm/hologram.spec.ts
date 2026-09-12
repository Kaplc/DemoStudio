/**
 * warm-current 全息勘探 e2e（2026-09-12：行星矿产开发）
 *
 * 覆盖：
 *  1. 开合：openHologram 需本行星系视角（地球系开月球全息 ✓）；closeHologram 复位俯视取景
 *  2. 表驱动数据：月球 2 条 he3 矿点行 + 2 行矿建（extractor/processor）
 *  3. 落位：placeMine 扣款 → stepTicks 灌工期建成 → 产出递增（extracted 门控在储量内）
 *  4. 真实点击拾取：holoMarkerScreenPos 投影坐标 → page.mouse 真实 down/up（位移 0 = 轻点）
 *     → Controller 屏幕空间拾取 → 选中态同步 vm（deposit selected=true）
 *  5. 行星观察互斥 / Esc 由手测与 GM 兜底（本 spec 锁核心链路）
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

test.describe('warm-current 全息勘探（行星矿产开发）', () => {
  test('开合/表驱动落位/产出/真实点击拾取全链路', async ({ page }) => {
    test.setTimeout(180_000)
    await bootToMap(page)

    // ── 1. 开合：地球系视角开月球全息 ✓（相机改斜视角环绕） ──
    const opened = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.openHologram('moon')
      const v = b.view()
      const info = b.holoInfo()
      return {
        viewMode: v?.viewMode,
        focus: v?.planetFocusBody,
        camY: v?.cameraY, camZ: v?.cameraZ,
        body: info?.body, bodyName: info?.bodyName,
        depositCount: info?.deposits.length ?? 0,
        buildCount: info?.buildRows.length ?? 0,
        firstDeposit: info?.deposits[0] ?? null,
      }
    })()`) as Record<string, any>
    expect(opened.viewMode).toBe('earth')
    // 卫星全息：聚焦体保持母星（地月系聚焦 earth），全息目标 = moon
    expect(opened.focus).toBe('earth')
    expect(opened.body).toBe('moon')
    expect(opened.depositCount).toBe(2)
    expect(opened.buildCount).toBe(2)
    expect(opened.firstDeposit.typeName).toContain('氦-3')
    // 斜视角：相机 y < 距离（35° 仰角）→ 不再垂直俯视
    expect(opened.camY).toBeGreaterThan(0)

    // ── 2. 落位 + 建成 + 产出 ──
    const mined = await page.evaluate(`(async () => {
      const b = window.__warmCurrent
      const h3Before = b.state().earthH3
      const ok = b.placeMine('m1', 'extractor')
      const afterPlace = b.state().earthH3
      // 12s 工期 → 760 tick 灌满（建成即开始产出）
      b.stepTicks(760)
      const mine = b.state().mines.find((m) => m.depositId === 'm1')
      const extractedAt0 = mine.extracted
      b.stepTicks(120) // +2s 产出 0.5/s ≈ 1.0 t
      const extractedAt1 = b.state().mines.find((m) => m.depositId === 'm1').extracted
      return {
        ok, h3Before, afterPlace, cost: h3Before - afterPlace,
        built: mine.built, progress: mine.progress,
        extractedAt0, delta: extractedAt1 - extractedAt0,
        holoInfoBuilt: b.holoInfo().deposits.find((d) => d.id === 'm1')?.status,
      }
    })()`) as Record<string, any>
    expect(mined.ok).toBe(true)
    expect(mined.cost).toBe(150)
    expect(mined.built).toBe(true)
    expect(mined.extractedAt0).toBeGreaterThan(0)
    expect(mined.delta).toBeGreaterThan(0.5)
    expect(mined.delta).toBeLessThan(2)
    expect(String(mined.holoInfoBuilt)).toContain('开采中')

    // ── 3. 真实点击拾取（轻点矿点 → 选中态进 vm） ──
    // 月球公转 + 相机跟随在近距离取景下屏幕漂移显著，「先取坐标后点击」跨帧不稳定；
    // 坐标捕获与 down/up 必须同帧原子完成：页内派发 DOM 鼠标事件（与真实输入同一管线：
    // canvas mousedown → InputSys.handlePointerDown → controller，window mouseup → released → 轻点判定）
    const sel = await page.evaluate(`(async () => {
      const b = window.__warmCurrent
      const pos = b.holoMarkerScreenPos('m2')
      if (!pos) return { error: 'no-pos' }
      const canvas = [...document.querySelectorAll('canvas')]
        .filter((c) => { const r = c.getBoundingClientRect(); return r.width > 100 && r.height > 100 && pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom })
        .sort((a, c) => c.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
      if (!canvas) return { error: 'no-canvas' }
      const init = { clientX: pos.x, clientY: pos.y, button: 0, bubbles: true }
      canvas.dispatchEvent(new MouseEvent('mousedown', init))
      window.dispatchEvent(new MouseEvent('mouseup', init))
      await new Promise((r) => setTimeout(r, 300))
      const info = b.holoInfo()
      return { selectedId: info.selectedId, row: info.deposits.find((d) => d.id === 'm2') }
    })()`) as Record<string, any>
    expect(sel.error).toBeUndefined()
    expect(sel.selectedId).toBe('m2')
    expect(sel.row.selected).toBe(true)

    // 视觉确认截图（全息球 + 矿点标记 + 右侧面板）
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'test-results/holo_moon.png' })

    // ── 4. 关闭：复位俯视取景 ──
    const closed = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.closeHologram()
      const v = b.view()
      return { holo: b.holoInfo(), viewMode: v?.viewMode, camY: v?.cameraY, camZ: v?.cameraZ }
    })()`) as Record<string, any>
    expect(closed.holo).toBeNull()
    expect(closed.viewMode).toBe('earth')
    // 复位垂直俯视：camera z ≈ 0（正上方），y = 距离
    expect(Math.abs(closed.camZ)).toBeLessThan(2)
  })

  test('太阳系全景拒绝开全息（取景门）', async ({ page }) => {
    test.setTimeout(120_000)
    await bootToMap(page)
    // 切太阳系全景（真实 ViewToggle 按钮路径）
    const clicked = await page.evaluate(`(() => {
      const ai = window.__ai
      const r = ai.emit('ai.clickActor', { name: 'Btn_view_solar' })
      return JSON.stringify(r?.results?.[0] ?? {})
    })()`)
    expect(clicked).toContain('ok')
    await page.waitForTimeout(900)
    const denied = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.openHologram('moon')
      return { viewMode: b.view().viewMode, holo: b.holoInfo() }
    })()`) as Record<string, any>
    expect(denied.viewMode).toBe('solar')
    expect(denied.holo).toBeNull()
  })
})
