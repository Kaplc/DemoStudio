/**
 * warm-current 主菜单 SVG 重设计 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 设计稿 asset/ui/warm-main-menu.svg → main_menu.widget.json 的运行时行为锁：
 *  1. 结构：主菜单 HUD 挂载后，标题块/SELECT OPERATION/四菜单项/遥测页脚文案齐备
 *  2. 占位项：SETTINGS / EXIT TO DESKTOP 为纯 div（无 UIButton），clickActor 不可点、点击不切场景
 *  3. CONTINUE：读仓库出厂档 data/slot1.json（Mock fetch 回退/真机磁盘均可读）→ 切星图 → 桥就绪
 *  4. NEW EXPEDITION：clickActor(Btn_new) → 切星图 → __warmCurrent 桥就绪（全仓 e2e 共用入口）
 *
 * 前置：dev server 已在 :5173 运行；主菜单阶段 __warmCurrent 桥已存在（switchToMenuScene 也
 * installDebugBridge）但 ready() 为 false（仅星图场景 ready），切场景断言一律用 ready() 而非桥存在性。
 * 按钮 onClick 异步派发，点击后轮询等状态迁移。
 */
import { expect, test, type Page } from '@playwright/test'

/** 等游戏运行起来（▶ 后 ai.getState.running=true） */
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

/** 打开 WarmCurrent 工程 → ▶ 运行 → 等主菜单 HUD（WarmCurrentMenu 根）挂载 */
async function openMenu(page: Page): Promise<void> {
  await page.goto('/')
  const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
  await card.click()
  await page.getByRole('button', { name: '打开工程' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
  await page.locator('button', { hasText: '▶' }).first().click()
  await waitGameRunning(page)
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean; hud?: unknown[] }> } } }).__ai
    if (!ai) return false
    const hud = ai.emit('ai.getHUD', {}).results?.[0]?.hud ?? []
    return JSON.stringify(hud).includes('WarmCurrentMenu')
  }, { timeout: 30_000 })
}

/** 在 HUD 树（数组）中按 name 深度查找节点 */
const FIND_HUD_FN = `(nodes, name) => {
  const queue = [...nodes]
  while (queue.length) {
    const n = queue.shift()
    if (n.name === name) return n
    if (Array.isArray(n.children)) queue.push(...n.children)
  }
  return null
}`

/** 收集 HUD 树全部文本（多根合并） */
const COLLECT_TEXTS_FN = `(nodes) => {
  const out = []
  const walk = (n) => { if (n.text) out.push(n.text); (n.children || []).forEach(walk) }
  nodes.forEach(walk)
  return out
}`

test.describe('warm-current 主菜单 SVG 重设计', () => {
  test('结构：标题块 + SELECT OPERATION + 四菜单项 + 遥测页脚文案齐备', async ({ page }) => {
    await openMenu(page)
    const tree = await page.evaluate(`(() => {
      const ai = window.__ai
      const hud = ai.emit('ai.getHUD', {}).results?.[0]?.hud ?? []
      const find = ${FIND_HUD_FN}
      return {
        root: !!find(hud, 'WarmCurrentMenu'),
        btnNew: !!find(hud, 'Btn_new'),
        btnLoad: !!find(hud, 'Btn_load'),
        labelLoadText: find(hud, 'Label_load')?.text ?? null,
        titleText: find(hud, 'Title')?.text ?? null,
        texts: (${COLLECT_TEXTS_FN})(hud),
      }
    })()`)
    expect(tree.root, '主菜单 HUD 根已挂载').toBe(true)
    expect(tree.btnNew, 'Btn_new 节点存在').toBe(true)
    expect(tree.btnLoad, 'Btn_load 节点存在').toBe(true)
    expect(tree.titleText, '标题为 WARM').toBe('WARM')
    // 脚本 refreshLoadButton 按最近档改写：有档 "CONTINUE · S<n>" / 无档 "CONTINUE"
    expect(tree.labelLoadText, 'CONTINUE 标签按存档槽位改写').toMatch(/^CONTINUE( · S\d+)?$/)
    for (const expected of [
      'CURRENT / ORBITAL LOGISTICS',
      'MISSION CONTROL // SYSTEM ONLINE',
      'SELECT OPERATION',
      'NEW EXPEDITION',
      'SETTINGS',
      'EXIT TO DESKTOP',
      'LIVE TELEMETRY',
      'SOLAR WIND 24.8 km/s',
      'CORE TEMP 31.4°',
      'BUILD 0.9.7 // HELIOS NETWORK',
      'ENTER / SELECT',
    ]) {
      expect(tree.texts, `文案存在：${expected}`).toContain(expected)
    }
    expect(tree.texts.join('|'), '旧版中文文案不再出现').not.toContain('暖流计划')
  })

  test('占位项 SETTINGS/EXIT 不可点，点击后停留主菜单', async ({ page }) => {
    await openMenu(page)
    const clickGhost = await page.evaluate(`(() => {
      const ai = window.__ai
      return {
        settings: ai.emit('ai.clickActor', { name: 'ItemGhost' }).results?.[0]?.ok === true,
        exit: ai.emit('ai.clickActor', { name: 'ItemGhost_2' }).results?.[0]?.ok === true,
      }
    })()`)
    expect(clickGhost.settings, 'SETTINGS 占位项不可点（无 UIButton）').toBe(false)
    expect(clickGhost.exit, 'EXIT 占位项不可点（无 UIButton）').toBe(false)
    // 点击后场景未切换：主菜单 HUD 仍在、星图桥未就绪（桥在菜单场景就存在，ready() 仅星图为 true）
    await page.waitForTimeout(800)
    const still = await page.evaluate(`(() => {
      const ai = window.__ai
      const hud = ai.emit('ai.getHUD', {}).results?.[0]?.hud ?? []
      const b = window.__warmCurrent
      return { menu: JSON.stringify(hud).includes('WarmCurrentMenu'), ready: !!b && b.ready() }
    })()`)
    expect(still.menu, '仍在主菜单').toBe(true)
    expect(still.ready, '未切入星图').toBe(false)
  })

  test('CONTINUE 读取最近存档（仓库出厂档 data/slot1.json）切星图，桥就绪', async ({ page }) => {
    await openMenu(page)
    // Mock/真机都能读到仓库自带出厂档 projects/warm-current/data/slot1.json
    // （Mock readJsonFile 有 dev server fetch 回退；真机直读磁盘）→ handleMenuAction('load') 切星图并 loadSlot
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      return ai.emit('ai.clickActor', { name: 'Btn_load' }).results?.[0]?.ok === true
    }, { timeout: 30_000 })
    // 读档是异步链（扫槽 → 切场景 → loadSlot），轮询等桥 ready 即为完成
    await waitGameReady(page)
  })

  test('NEW EXPEDITION（Btn_new）进星图，桥就绪', async ({ page }) => {
    await openMenu(page)
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      return ai.emit('ai.clickActor', { name: 'Btn_new' }).results?.[0]?.ok === true
    }, { timeout: 30_000 })
    await waitGameReady(page)
  })
})
