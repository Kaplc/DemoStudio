/**
 * ai.clickActor 射线语义回归 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 背景（2026-09-07）：ai.clickActor 原实现直接调 UIButtonComponent.triggerClick()，
 * 绕过 PhySys 射线仲裁——收起面板里 root.visible=false 的按钮也能被"隔空点响"，
 * 与真实鼠标点击（hitTest 可见性过滤 + UI 拦截仲裁）行为不一致。
 *
 * 新语义：由目标命中层（透明点击层 mesh）中心反投屏幕坐标，走
 * InputSys.handlePointerDown → PhySys.raycastClick 完整管线：
 *  1. 隐藏目标（父链 visible=false）→ 命中层不可见 → 拒绝点击（负向锁定）
 *  2. 可见目标 → 与真实点击同管线命中触发（正向闭环）
 */
import { expect, test, type Page } from '@playwright/test'

/** ai.clickActor 回执（AIModule.emit 聚合结果取首个处理器返回） */
type ClickActorResult = { results?: Array<{ ok?: boolean, clicked?: number, type?: string, error?: string }> }

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

/** 读取 PhySys 可见 UI 拦截画布（经调试桥 phy() 借道——与运行时同模块图实例；
 *  e2e 动态 import /src/... 会创建第二模块图实例，读不到运行状态） */
const BLOCKERS_SRC = `async () => {
  const b = window.__warmCurrent
  if (!b || !b.ready()) return { active: [] }
  const PhySys = b.phy()
  const visibleChain = (o) => { let c = o; while (c) { if (!c.visible) return false; c = c.parent } return true }
  const out = []
  for (const bl of PhySys._uiBlockers) {
    const carrier = bl.hitMesh ?? bl.panel
    if (!carrier) continue
    out.push({ name: bl.owner.root.name, visible: visibleChain(carrier) })
  }
  return { active: out.filter(x => x.visible) }
}`

function readBlockers(page: Page): Promise<{ active: Array<{ name: string | null }> }> {
  return page.evaluate(`(${BLOCKERS_SRC})()`) as Promise<{ active: Array<{ name: string | null }> }>
}

/** ai.clickActor 显式自执行求值（page.evaluate(fn, arg) 序列化在当前工具链不稳，统一 JSON 内联） */
function emitClickActor(page: Page, arg: { name?: string, text?: string, path?: string }): Promise<ClickActorResult> {
  return page.evaluate(`(async () => { return window.__ai.emit('ai.clickActor', ${JSON.stringify(arg)}) })()`) as Promise<ClickActorResult>
}

/** 面板是否展开（ResearchBody 拦截画布可见） */
async function panelOpen(page: Page): Promise<boolean> {
  const blockers = await readBlockers(page)
  return blockers.active.some((x) => x.name === 'ResearchBody')
}

/**
 * 轮询点击入口按钮直到面板达到目标开合态。
 * 容错窗口期：__warmCurrent 桥就绪（switchToMapScene）早于 HudScript.onStart 绑定
 * onClick，过早点击会被消费但回调为 null（无效果）——轮询重试直到状态翻转。
 */
async function clickResearchEntryUntil(page: Page, open: boolean): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await emitClickActor(page, { name: 'Btn_research' })
    await page.waitForTimeout(600)
    if ((await panelOpen(page)) === open) return
  }
  throw new Error(`轮询点击 Btn_research 后面板仍未${open ? '展开' : '收起'}`)
}

test.describe('ai.clickActor 射线语义（走 InputSys → PhySys 完整管线）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    // 菜单阶段用 ai.clickActor 点主菜单 Btn_new 进正式游戏（旧/新语义都必须能进——自身也是回归项）
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as ClickActorResult
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
    // 冻结仿真时间：暂停态 sim.runTick 不推进（GameMode.Tick 判 paused），防自然 defeat
    // 抢先弹出 SettleModal/HexModal 的全屏 Dim 拦截层干扰 UI 点击测试
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)
  })

  test('负向：面板收起时隐藏按钮（root.visible=false）拒绝点击', async ({ page }) => {
    const r = await emitClickActor(page, { name: 'Btn_ship' })
    const first = r.results?.[0]
    expect(first?.ok, '收起面板内的 Btn_ship 不可见，射线语义下必须拒绝（旧直调会误触发）').toBe(false)
    expect(first?.error ?? '', '拒绝原因应说明命中层不可见/未命中').toContain('未命中')
  })

  test('正向：可见入口按钮经管线触发（开→关→开 toggle 闭环）', async ({ page }) => {
    // 兜底收起（防前序用例/重跑遗留展开态），再开→关→开全翻转（轮询节奏 600ms 吸收 500ms 冷却窗）
    await clickResearchEntryUntil(page, false)
    await clickResearchEntryUntil(page, true)
    await clickResearchEntryUntil(page, false)
    await clickResearchEntryUntil(page, true)
    expect(await panelOpen(page), 'toggle 闭环后面板保持展开').toBe(true)
  })

  test('负向：点击冷却窗内连点被拒（与真实鼠标同语义）', async ({ page }) => {
    // 展开基线（手动控制节奏：emit → 立即确认翻转 → 立即再点，间隔 < 500ms 冷却窗）
    for (let i = 0; i < 6; i++) {
      await emitClickActor(page, { name: 'Btn_research' })
      if (await panelOpen(page)) break
      await page.waitForTimeout(600)
    }
    expect(await panelOpen(page), '前置：面板已展开').toBe(true)
    // 冷却窗内（<500ms）立即再点：ClickComponent.clickCooldown 拒绝 → 管线未命中目标
    const r = await emitClickActor(page, { name: 'Btn_research' })
    expect(r.results?.[0]?.ok, '500ms 冷却窗内连点应被拒绝（真实鼠标同样点不动）').toBe(false)
    expect(await panelOpen(page), '被冷却拒绝后面板保持原状').toBe(true)
  })

  test('正向：展开面板内的可见按钮经管线触发（Btn_panel_close 收起）', async ({ page }) => {
    // 先展开（轮询容错回调绑定窗口期）
    await clickResearchEntryUntil(page, true)
    // 面板内关闭按钮（可见）→ 射线命中
    const r = await emitClickActor(page, { name: 'Btn_panel_close' })
    expect(r.results?.[0]?.ok, '展开面板内的 ✕ 关闭可见，应经射线管线命中').toBe(true)
    await page.waitForTimeout(200)
    expect(await panelOpen(page), '关闭后面板应收起').toBe(false)
  })
})
