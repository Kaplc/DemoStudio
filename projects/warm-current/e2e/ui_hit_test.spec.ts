/**
 * warm-current UI 点击拦截回归 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 背景（2026-09-07 badcase）：research_panel.widget 全屏 Root 写了 hit-test: block，
 * 而脚本收起时只隐藏 ResearchBody 子树 → 全屏隐形拦截层常驻，游戏内一切点击
 * 被 [PhySys] 点击被 UI 拦截画布消费（zOrder=89）吞掉。
 *
 * 本测试锁定两个不变量：
 *  1. 面板收起时：UI 拦截画布数为 0（游戏世界点击可穿透）
 *  2. 面板展开时：拦截画布存在且 == 面板本体尺寸（ResearchBody，非全屏 Root）
 */
import { expect, test, type Page } from '@playwright/test'

/** ai.clickActor 回执（AIModule.emit 聚合结果取首个处理器返回） */
type ClickActorResult = { results?: Array<{ ok?: boolean, error?: string }> }

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

/** 读取 PhySys 可见 UI 拦截画布（经调试桥 phy() 借道——与运行时同模块图实例；
 *  e2e 动态 import /src/... 会创建第二模块图实例，读不到运行状态）。
 *  以 `(${SRC})()` 显式自执行求值——Playwright evaluate 对 async 箭头函数字符串的自动识别不稳。 */
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

type BlockersResult = { active: Array<{ name: string | null }> }

function readBlockers(page: Page): Promise<BlockersResult> {
  return page.evaluate(`(${BLOCKERS_SRC})()`) as Promise<BlockersResult>
}

/** ai.clickActor 显式自执行求值（page.evaluate(fn, arg) 序列化在当前工具链不稳，统一 JSON 内联） */
function emitClickActor(page: Page, arg: { name: string }): Promise<ClickActorResult> {
  return page.evaluate(`(async () => { return window.__ai.emit('ai.clickActor', ${JSON.stringify(arg)}) })()`) as Promise<ClickActorResult>
}

test.describe('warm-current UI 点击拦截回归（research_panel hit-test 收敛）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    // 游戏 -> 菜单 -> 主界面。注意：__warmCurrent 桥只在正式游戏阶段挂载（switchToMapScene），
    // 菜单阶段不存在，须用编辑器级 __ai.clickActor 点主菜单 Btn_new（ai.clickActor 扫描 UI Actor 树），
    // ok=true 即点击生效（未挂载/按钮未就绪时 ok=false，轮询重试）
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as ClickActorResult
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
    // 冻结仿真时间：暂停态 sim.runTick 不推进（GameMode.Tick 判 paused），防自然 defeat
    // 抢先弹出 SettleModal/HexModal 的全屏 Dim 拦截层干扰拦截画布计数
    await page.evaluate(`(() => { const m = window.__warmCurrent.mode(); if (m && !m.paused) m.togglePause() })()`)
  })

  test('面板收起时 research_panel 零拦截贡献（HUD bar 合法拦截除外）', async ({ page }) => {
    const res = await readBlockers(page)
    const research = res.active.filter(x => x.name === 'Root' || x.name === 'ResearchBody' || x.name === 'PanelRoot')
    expect(research, '收起态不应存在 research_panel 的任何拦截画布').toHaveLength(0)
  })

  test('面板展开时唯一新增拦截画布 == ResearchBody（面板矩形，非全屏 Root）', async ({ page }) => {
    // 射线语义 + 500ms 点击冷却：单发点击可能被冷却/回调绑定窗口吞掉，600ms 间隔轮询直到画布出现
    for (let i = 0; i < 10; i++) {
      await emitClickActor(page, { name: 'Btn_research' })
      await page.waitForTimeout(600)
      const probe = await readBlockers(page)
      if (probe.active.some(x => x.name === 'ResearchBody')) break
    }
    const res = await readBlockers(page)
    const research = res.active.filter(x => x.name === 'Root' || x.name === 'ResearchBody' || x.name === 'PanelRoot')
    expect(research, '展开态 research_panel 应有且仅有 1 个拦截画布').toHaveLength(1)
    expect(research[0].name, '拦截画布应为面板本体 ResearchBody（block 已从全屏 Root 挪出）').toBe('ResearchBody')
  })
})
