/**
 * warm-current 存档/主菜单 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 前置：dev server 已在 :5173 运行（npm run electron:dev 或 vite）
 * 场景路由事实：启动默认进主菜单场景（无 __warmCurrent 桥——桥在 switchToMapScene 才挂载），
 * 主菜单阶段统一走 window.__ai 事件桥（编辑器层，恒可用）；点「Btn_new」进星图后桥就绪。
 * 回主菜单走暂停菜单「Btn_back」按钮（真实用户链路）。
 * 注意：按钮 onClick 为异步派发，点击后必须轮询等待状态迁移，不能同步读结果；
 *       仿真按真实帧率推进，时间断言一律以 slotMeta 快照值为基线、容差 1s。
 * 注：浏览器模式 electronAPI 走 MockElectronAPI（readJsonFile/writeJsonFile 内存缓存闭环，
 *     不落盘）；保存/读取链路与 Electron 真实 IPC 完全同构，仅存储介质不同。
 */
import { expect, test, type Page } from '@playwright/test'

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

/** 统一前置：打开 WarmCurrent 工程 → ▶ 运行（默认进主菜单）→ 点「新的远征」进星图 */
async function enterGame(page: Page): Promise<void> {
  await page.goto('/')
  const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
  await card.click()
  await page.getByRole('button', { name: '打开工程' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
  await page.locator('button', { hasText: '▶' }).first().click()
  await waitGameRunning(page)
  // 主菜单 UI 就绪后点「新的远征」（ai.clickActor 按名找 UI 按钮；未挂载前 ok=false 轮询）
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.clickActor', { name: 'Btn_new' }).results?.[0]?.ok === true
  }, { timeout: 30_000 })
  await waitGameReady(page)
}

/** 等槽位 n 落盘完成（桥读摘要 savedAt 非空；Mock 为内存缓存闭环） */
async function waitSlotSaved(page: Page, n: number): Promise<void> {
  await page.waitForFunction((slot: number) => {
    const b = (window as unknown as {
      __warmCurrent?: { slotMeta(n: number): { savedAt: string | null } | null }
    }).__warmCurrent
    const m = b && b.slotMeta(slot)
    return !!m && !!m.savedAt
  }, n, { timeout: 15_000 })
}

test.describe('warm-current 存档/主菜单（Esc 三槽位 + 默认主菜单场景）', () => {
  test('默认进入主菜单场景，点「新的远征」切星图后桥就绪', async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    await waitGameRunning(page)
    // 主菜单阶段：先断言游戏桥未挂载（switchToMapScene 才 install）
    const hasBridgeEarly = await page.evaluate(() => !!window.__warmCurrent)
    expect(hasBridgeEarly, '主菜单场景不应有游戏桥').toBe(false)
    // 点「新的远征」（ai.clickActor 异步场景切换）→ 轮询等桥就绪即为点击生效
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean; error?: string }> } } }).__ai
      if (!ai) return false
      return ai.emit('ai.clickActor', { name: 'Btn_new' }).results?.[0]?.ok === true
    }, { timeout: 30_000 })
    await waitGameReady(page)
  })

  test('新开局 → Esc 暂停菜单 → 三槽位保存 → 摘要刷新', async ({ page }) => {
    await enterGame(page)
    // 推进仿真时间（让存档摘要 time 可断言）
    await evalInGame(page, `() => { window.__warmCurrent.stepTicks(300) }`)
    const opened = await evalInGame<Record<string, unknown>>(page, `() => {
      const mode = window.__warmCurrent.mode()
      return { opened: mode.togglePauseMenu(), paused: mode.paused }
    }`)
    expect(opened.opened).toBe(true)
    expect(opened.paused).toBe(true)
    const res = await evalInGame<Record<string, unknown>>(page, `() => {
      const inst = window.__warmCurrent
      const panel = inst.mode().pauseMenuPanel
      const out = { panelFound: !!panel }
      for (let n = 1; n <= 3; n++) {
        out['save' + n] = !!window.__findRec(panel, 'Btn_save' + n)
        out['load' + n] = !!window.__findRec(panel, 'Btn_load' + n)
        out['info' + n] = !!window.__findRec(panel, 'SlotInfo' + n)
      }
      out.resume = !!window.__findRec(panel, 'Btn_resume')
      out.back = !!window.__findRec(panel, 'Btn_back')
      return out
    }`)
    expect(res.panelFound).toBe(true)
    for (let n = 1; n <= 3; n++) {
      expect(res['save' + n], `槽${n}保存按钮`).toBe(true)
      expect(res['load' + n], `槽${n}读取按钮`).toBe(true)
      expect(res['info' + n], `槽${n}摘要行`).toBe(true)
    }
    expect(res.resume).toBe(true)
    expect(res.back).toBe(true)
    // 点「保存到槽1」→ 异步落盘 → 桥读摘要
    await evalInGame(page, `() => { window.__ai.emit('ai.clickActor', { name: 'Btn_save1' }) }`)
    await waitSlotSaved(page, 1)
    const meta = await evalInGame<Record<string, unknown>>(page, `() => {
      const m = window.__warmCurrent.slotMeta(1)
      return m ? { time: m.time, act: m.act, savedAt: m.savedAt } : null
    }`)
    expect(meta).not.toBeNull()
    expect((meta as { time: number }).time).toBeGreaterThan(0)
  })

  test('三槽位读取：改动后读回 → 恢复到存档快照（time 回退）', async ({ page }) => {
    await enterGame(page)
    // 存槽 1（快照 time 在 saveSlot 调用瞬间定格；落盘后从 slotMeta 读基线）
    await evalInGame(page, `() => window.__warmCurrent.saveSlot(1)`)
    await waitSlotSaved(page, 1)
    const base = await evalInGame<number>(page, `() => window.__warmCurrent.slotMeta(1).time`)
    // 推进时间制造差异
    await evalInGame(page, `() => window.__warmCurrent.stepTicks(600)`)
    const drifted = await evalInGame<number>(page, `() => window.__warmCurrent.state().time`)
    expect(drifted).toBeGreaterThan(base)
    // 读档 → 恢复到快照值（loadSlot 同步恢复；evaluate 原子执行，误差仅恢复后几帧）
    await evalInGame(page, `() => window.__warmCurrent.loadSlot(1)`)
    const restored = await evalInGame<Record<string, unknown>>(page, `() => {
      const s = window.__warmCurrent.state()
      const m = window.__warmCurrent.slotMeta(1)
      return { time: s.time, metaTime: m ? m.time : null, paused: window.__warmCurrent.mode().paused }
    }`)
    // 容差 3.0s：恢复后 rAF 插入的真实 dt 帧会推进 sim time；headless 软件渲染下
    // 开 bloom 只有 ~2fps（单帧 dt 0.5s 级），1~2 帧即 1.5s 漂移（实测 1.45）。
    // 断言意图不变：恢复值 ≈ 快照基线（base），而不是推进后的 drifted（= base+10）。
    expect(Math.abs((restored.time as number) - base)).toBeLessThan(3.0)
    expect(restored.time as number).toBeLessThan(drifted)
    expect(restored.paused).toBe(false)
  })

  test('回主菜单（暂停菜单 Btn_back）→ 主菜单读最近档 → 重进游戏恢复', async ({ page }) => {
    await enterGame(page)
    // 存槽 2 基线（本用例唯一写入槽 → 「最近档」必为槽 2）
    await evalInGame(page, `() => window.__warmCurrent.saveSlot(2)`)
    await waitSlotSaved(page, 2)
    const base = await evalInGame<number>(page, `() => window.__warmCurrent.slotMeta(2).time`)
    // 回主菜单：开暂停菜单（spawn 异步排队）→ 轮询点 Btn_back（onClick: 关菜单 + 切场景）
    await evalInGame(page, `() => {
      const m = window.__warmCurrent.mode()
      if (!m.pauseMenuPanel) m.togglePauseMenu()
    }`)
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      // 面板 spawn 未完成时找不到按钮（ok=false），下一轮重试；成功即停，不重复触发
      return ai.emit('ai.clickActor', { name: 'Btn_back' }).results?.[0]?.ok === true
    }, { timeout: 15_000 })
    await page.waitForFunction(() => {
      const b = (window as unknown as {
        __warmCurrent?: { menuMode(): unknown; mode(): unknown }
      }).__warmCurrent
      return !!b && !!b.menuMode() && !b.mode()
    }, { timeout: 15_000 })
    // 主菜单读最近档（handleMenuAction('load') 扫三槽取最新 → 切星图 → loadSlot，异步轮询）
    await evalInGame(page, `() => window.__warmCurrent.menuMode().emitMenuAction('load')`)
    await page.waitForFunction((b: number) => {
      const w = (window as unknown as {
        __warmCurrent?: { mode(): { simState: { state: { time: number } } } | null }
      }).__warmCurrent
      const m = w && w.mode()
      return !!m && Math.abs(m.simState.state.time - b) < 1.0
    }, base, { timeout: 30_000 })
    const restored = await evalInGame<number>(page, `() => window.__warmCurrent.mode().simState.state.time`)
    expect(Math.abs(restored - base)).toBeLessThan(1.0)
  })

  test('暂停菜单 Esc 再按关闭 + 继续按钮恢复运行', async ({ page }) => {
    await enterGame(page)
    const r = await evalInGame<Record<string, unknown>>(page, `() => {
      const mode = window.__warmCurrent.mode()
      const open1 = mode.togglePauseMenu()
      const openPaused = mode.paused
      const close1 = mode.togglePauseMenu()
      const closePaused = mode.paused
      const panelGoneAfterEsc = !mode.pauseMenuPanel
      return { open1, openPaused, close1, closePaused, panelGoneAfterEsc }
    }`)
    expect(r.open1).toBe(true)
    expect(r.openPaused).toBe(true)
    expect(r.close1).toBe(false)
    expect(r.closePaused).toBe(false)
    expect(r.panelGoneAfterEsc).toBe(true)
    // 继续按钮链路：重开菜单（spawn 异步排队）→ 轮询点 Btn_resume → 等菜单关闭且恢复运行
    await evalInGame(page, `() => {
      const m = window.__warmCurrent.mode()
      if (!m.pauseMenuPanel) m.togglePauseMenu()
    }`)
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      // 面板 spawn 未完成时找不到按钮（ok=false），下一轮重试；成功即停，不重复触发
      return ai.emit('ai.clickActor', { name: 'Btn_resume' }).results?.[0]?.ok === true
    }, { timeout: 15_000 })
    await page.waitForFunction(() => {
      const w = (window as unknown as {
        __warmCurrent?: { mode(): { paused: boolean; pauseMenuPanel: unknown } | null }
      }).__warmCurrent
      const m = w && w.mode()
      return !!m && m.paused === false && !m.pauseMenuPanel
    }, { timeout: 15_000 })
  })
})
