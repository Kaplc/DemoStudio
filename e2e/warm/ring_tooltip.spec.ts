/**
 * warm-current 建筑卡片悬停提示 e2e 探针（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 覆盖 2026-09-11 悬停提示链路的真机部分（引擎链式共存/定位公式已由 tests/uiTooltip.test.ts 锁定）：
 *  - RingPanelScript 安装行池挂 UITooltipComponent；tooltip.widget.json 真资产经
 *    UIManager.spawnUIActor 弹出（节点名 TooltipTitle/TooltipText、warm 风格 420x120）
 *  - 提示内容随行数据刷新（名称/效果/造价 H3 文案）
 *  - 按钮交互态不被 tooltip 抢占（同一次 hover，Btn_row 状态机仍进 hover）
 *  - 悬停离开即销毁
 *
 * 悬停触发方式：直呼 ClickableComponent.onHover（桥探针惯例——不在页面 UI 上移动鼠标，
 * 规避点击冷却/射线命中干扰；射线→onHover 的分发由 click_actor_raycast / ui_hit_test 覆盖）。
 */
import { expect, test } from '@playwright/test'

async function waitGameRunning(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.getState', {}).results?.[0]?.running === true
  }, { timeout: 60_000 })
}

async function waitGameReady(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

test.describe('warm-current 建筑卡片悬停提示', () => {
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
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
  })

  test('悬停安装卡片弹出提示面板：真资产弹出/内容随行/按钮 hover 共存/离开销毁', async ({ page }) => {
    // ① 打开聚能环面板并选中 0 号槽（开局 ringSlots=1、空槽 → InstallList 出 6 张安装卡）
    await page.evaluate(() => {
      const mode = (window as unknown as { __warmCurrent: { mode: () => { world: { components: Array<Record<string, unknown>> } } } }).__warmCurrent.mode()
      const ui = mode.world.components.find((c) => (c as { constructor: { name: string } }).constructor.name === 'UIManager') as { hud?: { getChildren(): Array<unknown> } } | undefined
      if (!ui?.hud) throw new Error('no-hud')
      let script: { open(): void; selectedSlot: number } | null = null
      const walk = (a: unknown): void => {
        const actor = a as { getChildren(): unknown[]; components: Array<Record<string, unknown> & { constructor: { name: string }; script?: string; instance?: unknown }> }
        const comp = actor.components?.find((c) => c.constructor.name === 'UIScriptComponent' && c.script === 'gameplay/ui/RingPanelScript')
        if (comp?.instance) { script = comp.instance as unknown as { open(): void; selectedSlot: number }; return }
        for (const ch of actor.getChildren() ?? []) walk(ch)
      }
      for (const c of ui.hud.getChildren()) walk(c)
      if (!script) throw new Error('no-ring-panel-script')
      script.open()
      script.selectedSlot = 0
    })

    // ② 等 0.15s 差分刷新落安装行
    await page.waitForTimeout(400)

    // ③ 触发第一张安装卡的悬停（真 Clickable 通道），同时断言按钮状态机共存
    const hoverInfo = await page.evaluate(() => {
      const mode = (window as unknown as { __warmCurrent: { mode: () => { world: { components: Array<Record<string, unknown>> } } } }).__warmCurrent.mode()
      const ui = mode.world.components.find((c) => (c as { constructor: { name: string } }).constructor.name === 'UIManager') as { hud?: { getChildren(): Array<unknown> } } | undefined
      if (!ui?.hud) throw new Error('no-hud')
      interface Node { root: { name: string }; getChildren(): Node[]; components: Array<Record<string, unknown> & { constructor: { name: string } }> }
      let row: Node | null = null
      const walk = (a: Node): void => {
        if (a.root.name === 'Btn_row' && !row) { row = a; return }
        for (const c of a.getChildren() ?? []) walk(c)
      }
      // 只在 RingPanel 子树内找（InstallList 的第一张安装卡）
      let panel: Node | null = null
      const findPanel = (a: Node): void => {
        if (a.root.name === 'RingPanel') { panel = a; return }
        for (const c of a.getChildren() ?? []) findPanel(c)
      }
      for (const c of ui.hud.getChildren()) findPanel(c as Node)
      if (!panel) throw new Error('no-ring-panel')
      walk(panel)
      if (!row) throw new Error('no-install-row')
      const clickable = (row as Node).components.find((c) => c.constructor.name === 'ClickableComponent') as { onHover?: (h: unknown) => void } | undefined
      if (!clickable?.onHover) throw new Error('no-clickable')
      const btn = (row as Node).components.find((c) => c.constructor.name === 'UIButtonComponent') as { state?: string } | undefined
      clickable.onHover({})
      return { btnState: btn?.state ?? '' }
    })
    expect(hoverInfo.btnState).toBe('hover')

    // ④ 等 tooltip delay(0.25s) + 生成，断言真资产弹出且内容随行
    await page.waitForTimeout(700)
    const tip = await page.evaluate(() => {
      const mode = (window as unknown as { __warmCurrent: { mode: () => { world: { components: Array<Record<string, unknown>> } } } }).__warmCurrent.mode()
      const ui = mode.world.components.find((c) => (c as { constructor: { name: string } }).constructor.name === 'UIManager') as { hud?: { getChildren(): Array<unknown> } } | undefined
      if (!ui?.hud) throw new Error('no-hud')
      interface Node { root: { name: string }; getChildren(): Node[]; components: Array<Record<string, unknown> & { constructor: { name: string } }> }
      const textOf = (a: Node, name: string): string => {
        let hit: string | null = null
        const walk = (n: Node): void => {
          if (n.root.name === name) {
            const t = n.components.find((c) => c.constructor.name === 'UITextComponent') as { text?: string } | undefined
            hit = t?.text ?? null
          }
          for (const c of n.getChildren() ?? []) walk(c)
        }
        walk(a)
        return hit ?? ''
      }
      let tooltip: Node | null = null
      const walk = (a: Node): void => {
        if (a.root.name === 'Tooltip' && !tooltip) { tooltip = a; return }
        for (const c of a.getChildren() ?? []) walk(c)
      }
      let panel: Node | null = null
      const findPanel = (a: Node): void => {
        if (a.root.name === 'RingPanel') { panel = a; return }
        for (const c of a.getChildren() ?? []) findPanel(c)
      }
      for (const c of ui.hud.getChildren()) findPanel(c as Node)
      if (!panel) throw new Error('no-ring-panel')
      walk(panel)
      if (!tooltip) return { exists: false as boolean, title: '', body: '', localY: 0, rowName: '' }
      // 找宿主行（Tooltip Actor 的父节点）
      let rowActor: Node | null = null
      const findRow = (a: Node): boolean => {
        for (const c of a.getChildren() ?? []) {
          if ((c as Node).root.name === 'Tooltip') { rowActor = a; return true }
          if (findRow(c)) return true
        }
        return false
      }
      findRow(panel)
      const y = (tooltip as unknown as { root: { position: { y: number } } }).root.position.y
      return {
        exists: true,
        title: textOf(tooltip as Node, 'TooltipTitle'),
        body: textOf(tooltip as Node, 'TooltipText'),
        localY: y,
        rowName: rowActor ? (rowActor as Node).root.name : '',
      }
    })
    expect(tip.exists).toBe(true)
    expect(tip.title.length).toBeGreaterThan(0)
    expect(tip.body).toContain('H3')
    expect(tip.localY).toBeGreaterThan(0)
    expect(tip.rowName).toBe('Btn_row')

    // 临时视觉取证（TIP_SHOT=<路径> 时落截图）
    if (process.env.TIP_SHOT) await page.screenshot({ path: process.env.TIP_SHOT })

    // ⑤ 离开悬停 → tooltip 立即销毁
    await page.evaluate(() => {
      const mode = (window as unknown as { __warmCurrent: { mode: () => { world: { components: Array<Record<string, unknown>> } } } }).__warmCurrent.mode()
      const ui = mode.world.components.find((c) => (c as { constructor: { name: string } }).constructor.name === 'UIManager') as { hud?: { getChildren(): Array<unknown> } } | undefined
      if (!ui?.hud) throw new Error('no-hud')
      interface Node { root: { name: string }; getChildren(): Node[]; components: Array<Record<string, unknown> & { constructor: { name: string } }> }
      let panel: Node | null = null
      const findPanel = (a: Node): void => {
        if (a.root.name === 'RingPanel') { panel = a; return }
        for (const c of a.getChildren() ?? []) findPanel(c)
      }
      for (const c of ui.hud.getChildren()) findPanel(c as Node)
      if (!panel) throw new Error('no-ring-panel')
      let row: Node | null = null
      const walk = (a: Node): void => {
        if (a.root.name === 'Btn_row' && !row) { row = a; return }
        for (const c of a.getChildren() ?? []) walk(c)
      }
      walk(panel)
      const clickable = (row as Node)?.components.find((c) => c.constructor.name === 'ClickableComponent') as { onHover?: (h: unknown) => void } | undefined
      clickable?.onHover?.(null)
    })
    await page.waitForTimeout(150)
    const gone = await page.evaluate(() => {
      const mode = (window as unknown as { __warmCurrent: { mode: () => { world: { components: Array<Record<string, unknown>> } } } }).__warmCurrent.mode()
      const ui = mode.world.components.find((c) => (c as { constructor: { name: string } }).constructor.name === 'UIManager') as { hud?: { getChildren(): Array<unknown> } } | undefined
      if (!ui?.hud) throw new Error('no-hud')
      let found = false
      const walk = (a: unknown): void => {
        const actor = a as { root: { name: string }; getChildren(): unknown[] }
        if (actor.root.name === 'Tooltip') { found = true; return }
        for (const ch of actor.getChildren() ?? []) walk(ch)
      }
      for (const c of ui.hud.getChildren()) walk(c)
      return found
    })
    expect(gone).toBe(false)
  })
})
