/**
 * warm-current 全息地球大陆轮廓 e2e（2026-09-17：全息风大陆轮廓层）
 *
 * 覆盖：
 *  1. 开全息地球 → console 指纹「大陆轮廓层已挂载」（层已建，buildHolo 新链路生效）
 *  2. 贴图异步就绪指纹「大陆轮廓贴图就绪」（earth.jpg → 1024×512 海岸线/陆地填充派生）
 *  3. holoInfo body='earth'（全息开合链路不回归）
 *  4. 关闭 → 重开：层重建（挂载指纹第 2 次）且贴图不重算（就绪指纹仍 1 次 = 页面级 canvas 缓存复用）
 *  5. 视觉截图（test-results/holo_earth_contour.png，图像复核大陆轮廓观感）
 *
 * 验证口径：日志指纹（memory:gameplay_edit_stale_module_cache——画面之外先看指纹防假阳性）。
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

/** 页面 console 收集器（boot 后挂载，指纹断言数据源） */
function attachConsole(page: Page): { lines: string[], count(substr: string): number } {
  const lines: string[] = []
  page.on('console', (msg) => lines.push(msg.text()))
  return {
    lines,
    count(substr: string) {
      return lines.filter((l) => l.includes(substr)).length
    },
  }
}

/** 轮询等待 console 累计出现 ≥ n 次指定指纹（节流环境下异步链路的确定性等待） */
async function waitForFingerprint(page: Page, counter: { count(s: string): number }, substr: string, atLeast: number, timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (counter.count(substr) >= atLeast) return counter.count(substr)
    await page.waitForTimeout(250)
  }
  return counter.count(substr)
}

test.describe('warm-current 全息地球大陆轮廓', () => {
  test('挂载指纹 + 贴图就绪 + 关闭重开缓存复用 + 截图', async ({ page }) => {
    test.setTimeout(240_000)
    await bootToMap(page)
    const console_ = attachConsole(page)

    // ── 1. 开全息地球（默认初始取景即地球系视角）→ holoInfo 链路 + 层挂载指纹 ──
    const opened = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.openHologram('earth')
      const info = b.holoInfo()
      return { body: info?.body, bodyName: info?.bodyName }
    })()`) as Record<string, any>
    expect(opened.body).toBe('earth')

    // 挂载指纹：同步打点，轮询兜节流抖动
    const mounts = await waitForFingerprint(page, console_, '全息地球大陆轮廓层已挂载', 1)
    expect(mounts).toBeGreaterThanOrEqual(1)

    // ── 2. 贴图异步就绪（Image 解码 + 逐像素海陆分类一次性派生） ──
    // 计数口径：游戏日志每个事件落 console 两行（渲染 sink + MockGameLog sink），
    // 断言一律用「与首开基线的差值」而非绝对数，防 sink 数量变化误伤
    const readies = await waitForFingerprint(page, console_, '全息地球大陆轮廓贴图就绪', 1)
    const diag = console_.lines.filter((l) => l.includes('starTextures') || l.includes('轮廓')).join(' | ')
    expect(readies, `就绪指纹未命中；starTextures/轮廓 console 行: ${diag || '（无）'}`).toBeGreaterThanOrEqual(1)
    // 失败告警不应出现（出现 = earth.jpg 解码/像素管线异常）
    expect(console_.count('全息大陆轮廓贴图生成失败')).toBe(0)

    // 贴图淡入后视觉取证（整页：全息球 + 面板 + 底栏）
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'test-results/holo_earth_contour.png' })

    // ── 3. 关闭 → 重开（同天体）：语义 = 隐藏不摘组（closeHologram 只清状态，
    //    syncHologram 置 holoRoot.visible=false），重开零重建 → 挂载/就绪指纹都不增 ──
    const closed = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.closeHologram()
      return { holo: b.holoInfo() }
    })()`) as Record<string, any>
    expect(closed.holo).toBeNull()

    const mountsBefore = console_.count('全息地球大陆轮廓层已挂载')
    const readiesBefore = console_.count('全息地球大陆轮廓贴图就绪')
    await page.evaluate(`(() => { window.__warmCurrent.openHologram('earth') })()`)
    await page.waitForTimeout(1_500)
    expect(console_.count('全息地球大陆轮廓层已挂载')).toBe(mountsBefore)
    expect(console_.count('全息地球大陆轮廓贴图就绪')).toBe(readiesBefore)
    const reopened = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      return { body: b.holoInfo()?.body ?? null }
    })()`) as Record<string, any>
    expect(reopened.body).toBe('earth')

    // ── 4. 切换天体（earth → moon → earth）：disposeHolo 真重建轮廓层，
    //    挂载指纹严格增长；贴图从页面级缓存 canvas 重建 CanvasTexture，就绪指纹不增 ──
    await page.evaluate(`(() => { window.__warmCurrent.openHologram('moon') })()`)
    await page.waitForTimeout(800)
    await page.evaluate(`(() => { window.__warmCurrent.openHologram('earth') })()`)
    const mountsAfter = await waitForFingerprint(page, console_, '全息地球大陆轮廓层已挂载', mountsBefore + 1)
    expect(mountsAfter).toBeGreaterThan(mountsBefore)
    await page.waitForTimeout(1_500)
    expect(console_.count('全息地球大陆轮廓贴图就绪')).toBe(readiesBefore)
    expect(console_.count('全息大陆轮廓贴图生成失败')).toBe(0)
  })
})
