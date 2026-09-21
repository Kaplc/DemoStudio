/**
 * 性能分析器 e2e —— 两条消费通道全分支覆盖
 *
 * A. 编辑器页采集器（真实游戏运行）：
 *    A1 window.__dsPerf 快照四模块齐全 + draw call 为正（autoReset 接管口径）
 *    A2 ai.getPerfStats 基础读数 + samples 附带历史（AI 通道）
 *    A3 游戏停止 → 快照冻结 running:false
 * B. perf.html 独立窗口（浏览器 Mock 模式，无需 Electron）：
 *    B1 未运行空态渲染
 *    B2 合成快照：大数字 / 内置段 / 未知模块通用段（扩展契约）
 *
 * 注意：A 组走 fish 项目框架引导（选卡→打开工程→Launch）；B 组零引导直开独立入口。
 */
import { test, expect } from '../framework/fixtures'
import { emitAI, firstResult } from '../framework/ai'

interface PerfSnapshotLike {
  ts: number
  game: { running: boolean }
  modules: Record<string, Record<string, unknown>>
}

test.use({ project: 'fish' })

test.describe('性能采集器（编辑器页 · 游戏运行中）', () => {
  test('A1 window.__dsPerf：四模块齐全，draw call 为正，autoReset 接管生效', async ({ game }) => {
    const page = game.page
    // 等采集器积累几帧（fps EMA 收敛 + render 两趟累计口径稳定）
    await page.waitForFunction(() => {
      const c = (window as unknown as { __dsPerf?: { getSnapshot(): PerfSnapshotLike | null } }).__dsPerf
      return !!c?.getSnapshot()?.modules.render
    }, { timeout: 30_000 })

    const snap = await page.evaluate(() => {
      const c = (window as unknown as {
        __dsPerf?: { getSnapshot(): PerfSnapshotLike | null; isRunning(): boolean }
      }).__dsPerf!
      return { running: c.isRunning(), snapshot: c.getSnapshot() }
    })

    expect(snap.running, '游戏运行中采集器应运行').toBe(true)
    expect(snap.snapshot).not.toBeNull()
    expect(snap.snapshot!.game.running).toBe(true)
    for (const key of ['fps', 'render', 'scene', 'js']) {
      expect(snap.snapshot!.modules[key], `模块 ${key} 应有输出`).toBeDefined()
    }
    // autoReset 接管口径：世界 + UI 两趟之和必然 > 0（fish 场景可见渲染）
    expect(snap.snapshot!.modules.render.calls).toBeGreaterThan(0)
    // 场景计数口径：菜单 HUD 至少有 mesh（按钮点击层/图片面板）
    expect(snap.snapshot!.modules.scene.uiTotal).toBeGreaterThan(0)
  })

  test('A2 ai.getPerfStats：基础读数 ok，samples 附带历史', async ({ game }) => {
    const page = game.page
    // 等历史缓冲积累 >1 条（两帧以上）
    await page.waitForFunction(() => {
      const c = (window as unknown as { __dsPerf?: { getHistory(n: number): PerfSnapshotLike[] } }).__dsPerf
      return (c?.getHistory(2).length ?? 0) >= 2
    }, { timeout: 30_000 })

    // 基础读数：无历史（控上下文体积的默认口径）
    const basic = await firstResult<{ ok: boolean; running: boolean; current: PerfSnapshotLike }>(
      await emitAI(page, 'ai.getPerfStats'),
      'ai.getPerfStats',
    )
    expect(basic.ok).toBe(true)
    expect(basic.running).toBe(true)
    expect(basic.current.modules.render.calls).toBeGreaterThan(0)

    // samples 附带历史（1~120 夹取）
    const withHistory = await firstResult<{ ok: boolean; history?: PerfSnapshotLike[] }>(
      await emitAI(page, 'ai.getPerfStats', { samples: 5 }),
      'ai.getPerfStats',
    )
    expect(withHistory.ok).toBe(true)
    expect(withHistory.history!.length).toBeGreaterThanOrEqual(2)
    expect(withHistory.history!.length).toBeLessThanOrEqual(5)
  })

  test('A3 游戏停止 → 快照冻结 running:false，采样循环停转', async ({ game }) => {
    const page = game.page
    await page.waitForFunction(() => {
      const c = (window as unknown as { __dsPerf?: { getSnapshot(): PerfSnapshotLike | null } }).__dsPerf
      return !!c?.getSnapshot()
    }, { timeout: 30_000 })

    // 菜单栏 Stop 按钮（■ Stop / ▶ Launch 同一枚按钮）
    await page.getByRole('button', { name: '■ Stop' }).click()

    // shutdown 是异步链（销毁实例→回收单例→collector.stop），轮询等冻结
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const c = (window as unknown as { __dsPerf?: { getSnapshot(): PerfSnapshotLike | null } }).__dsPerf!
            return c.getSnapshot()!.game.running
          }),
        { timeout: 20_000 },
      )
      .toBe(false)

    // 冻结后 tick 不再推进：ts 不随时间变化
    const ts1 = await page.evaluate(() =>
      (window as unknown as { __dsPerf?: { getSnapshot(): PerfSnapshotLike | null } }).__dsPerf!.getSnapshot()!.ts,
    )
    await page.waitForTimeout(1200)
    const ts2 = await page.evaluate(() =>
      (window as unknown as { __dsPerf?: { getSnapshot(): PerfSnapshotLike | null } }).__dsPerf!.getSnapshot()!.ts,
    )
    expect(ts2).toBe(ts1)
  })
})

test.describe('性能分析器独立窗口（perf.html · 浏览器 Mock 模式）', () => {
  test('B1 未运行空态：徽标 + 暂无快照提示', async ({ page }) => {
    await page.goto('/perf.html')
    await expect(page.locator('.perf-header__title')).toHaveText('性能分析器')
    await expect(page.locator('.perf-header__badge')).toContainText('未运行')
    await expect(page.locator('.perf-empty')).toContainText('暂无快照')
  })

  test('B2 合成快照：大数字 / 内置段 / 未知模块通用段（扩展契约）', async ({ page }) => {
    await page.goto('/perf.html')
    // 运行时替换 Mock 的 perfGetSnapshot 喂合成快照（面板 1s 轮询自动吃到）
    await page.evaluate(() => {
      ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.perfGetSnapshot = async () => ({
        running: true,
        current: {
          ts: 123456,
          game: { running: true, project: 'e2e' },
          modules: {
            fps: { fps: 60, frameMs: 16.6 },
            render: { calls: 42, triangles: 12000, geometries: 8, textures: 5 },
            scene: { worldVisible: 10, worldTotal: 12, uiVisible: 3, uiTotal: 4 },
            js: { heapUsedMB: 100.5, heapTotalMB: 200, longTasks: 1 },
            // 未知模块：未来扩展的模拟——面板应走通用键值段自动展示
            customModule: { foo: 1.25, bar: 'hello' },
          },
        },
      })
    })

    await expect(page.locator('.perf-header__badge')).toContainText('采样中', { timeout: 15_000 })
    // 大数字行第三卡 = Draw Calls
    await expect(page.locator('.perf-bigstat__num').nth(2)).toHaveText('42')
    // 内置段：JS 内存
    await expect(page.locator('.perf-kv__val', { hasText: '100.5 MB' })).toBeVisible()
    // 未知模块通用段：标题 = 模块键名，键值原样展示
    await expect(page.locator('.perf-section__title', { hasText: 'customModule' })).toBeVisible()
    await expect(page.locator('.perf-kv__val', { hasText: 'hello' })).toBeVisible()
  })
})
