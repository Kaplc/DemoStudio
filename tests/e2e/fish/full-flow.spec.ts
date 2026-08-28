/**
 * FishMaster（捕鱼达人）全流程端到端测试
 *
 * 覆盖链路（对应 doc/playwright_testing.md §4.1）：
 *   打开编辑器 → 打开 FishMaster 工程 → Launch 启动游戏
 *   → 主菜单 StartButton → 基地阶段（ActionBar 出现）
 *   → 建造菜单 开/关 → 地图面板 → 停止游戏 → 可再次启动
 *
 * 环境要点：
 *   - hidden 页面：DOM 点击一律 dispatchEvent（Playwright click() 会等 stable 超时）
 *   - 游戏交互/断言一律走 window.__ai 事件桥（不依赖渲染循环）
 *   - window.__ai 是编辑器级注册（EditorInitializer），停止游戏不会注销，
 *     但游戏事件处理器（操作 World）在游戏停止后不可用
 */
import { test, expect, type Page } from '../fixtures'
import { clickActor, actorActive, listEvents, isBridgeReady } from '../helpers/ai'

// ────────────────────────────────────────────────
//  辅助：hidden 页面下的原生事件派发
// ────────────────────────────────────────────────

/** 对按钮派发原生 click（绕过 hidden 页面的 stable 等待） */
async function dispatchClick(page: Page, buttonName: string) {
  await page.getByRole('button', { name: buttonName }).dispatchEvent('click', { bubbles: true })
}

/** 打开工程：先 click 选中卡片，再点"打开工程"按钮（StartupProjectSelector 的
 *  onDoubleClick 要求 selected === 本卡片，两步法最接近真实用户且不依赖事件顺序） */
async function openProject(page: Page, projectName: string) {
  await page.getByText(projectName, { exact: false }).first().dispatchEvent('click', { bubbles: true })
  await page.getByRole('button', { name: '打开工程' }).dispatchEvent('click', { bubbles: true })
  // 打开成功后状态栏出现 Launch 按钮
  await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 30_000 })
}

/** 轮询等待 AI 桥就绪（编辑器初始化后 window.__ai 注册） */
async function waitForBridge(page: Page) {
  await expect.poll(async () => isBridgeReady(page), {
    message: 'window.__ai 事件桥未就绪（编辑器未初始化？）',
    timeout: 30_000,
  }).toBe(true)
}

/** 轮询等待某 UI Actor 出现（按资产节点名） */
async function waitForActor(page: Page, name: string) {
  await expect.poll(async () => (await actorActive(page, name)) !== null, {
    message: `UI Actor "${name}" 未出现`,
    timeout: 20_000,
  }).toBe(true)
}

/** 轮询等待某 UI Actor 的 active 状态翻转 */
async function expectActorActive(page: Page, name: string, expected: boolean) {
  await expect.poll(async () => actorActive(page, name), {
    message: `Actor "${name}" active 未变为 ${expected}`,
    timeout: 15_000,
  }).toBe(expected)
}

/** 轮询等待某 UI Actor 消失或非激活（场景切换时 HUD 可能被销毁而非置 inactive） */
async function expectActorNotActive(page: Page, name: string) {
  await expect.poll(async () => (await actorActive(page, name)) !== true, {
    message: `Actor "${name}" 应消失或非激活`,
    timeout: 15_000,
  }).toBe(true)
}

// ────────────────────────────────────────────────
//  用例
// ────────────────────────────────────────────────

test.describe('FishMaster 全流程', () => {
  test('打开工程 → 启动游戏 → 主菜单 → 基地 → 建造菜单 → 停止', async ({ page }) => {
    // ── 1. 打开编辑器 ──
    await page.goto('/')
    await expect(page.getByText('ClashMaster', { exact: false }).first()).toBeVisible({ timeout: 30_000 })

    // ── 2. 打开 ClashMaster 工程 ──
    await openProject(page, 'ClashMaster')

    // ── 3. 启动游戏 ──
    await dispatchClick(page, 'Launch')
    await waitForBridge(page)

    // 桥可用：事件列表应包含游戏交互核心事件
    const events = await listEvents(page)
    expect(events).toContain('clickActor')
    expect(events).toContain('getActor')

    // ── 4. 主菜单 → 点开始游戏 → 进入基地阶段 ──
    await waitForActor(page, 'StartButton')
    const start = await clickActor(page, 'StartButton')
    expect(start.handled).toBe(true)

    // 基地 HUD 出现（ActionBar 的建造/地图按钮），主菜单已销毁
    await waitForActor(page, 'Btn_build')
    await waitForActor(page, 'Btn_map')
    await expectActorNotActive(page, 'StartButton')

    // ── 5. 建造菜单：打开 → 断言可见 → 关闭 ──
    await expectActorActive(page, 'BuildMenu', false) // 默认隐藏
    await clickActor(page, 'Btn_build')
    await expectActorActive(page, 'BuildMenu', true)
    await clickActor(page, 'Btn_close')
    await expectActorActive(page, 'BuildMenu', false)

    // ── 6. 停止游戏（状态栏按钮变 Stop）→ 编辑器恢复可再次启动 ──
    await dispatchClick(page, 'Stop')
    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 20_000 })
  })

  test('主菜单 → 直接进入捕鱼关卡（ai.switchScene）→ Esc 暂停菜单', async ({ page }) => {
    await page.goto('/')
    await openProject(page, 'ClashMaster')
    await dispatchClick(page, 'Launch')
    await waitForBridge(page)
    await waitForActor(page, 'StartButton')

    // 通过 AI 事件桥直接切换场景到关卡 1（等价 ai.switchScene 事件）
    const r = await page.evaluate(async () => {
      const bridge = (window as unknown as { __ai?: { emit?: (ev: string, pl: unknown) => Promise<unknown> } }).__ai
      return bridge?.emit?.('ai.switchScene', { scene: 'FishLevel1' }) ?? null
    })
    expect(r).not.toBeNull()
    const rr = r as { ok?: boolean; error?: string }
    expect(rr.ok, rr.error).toBe(true)

    // 关卡战斗 HUD 出现
    await waitForActor(page, 'BattleHUD')

    // Esc 打开暂停菜单（FishLevelGameMode.togglePauseMenu），再"继续游戏"关闭
    await page.keyboard.press('Escape')
    await expectActorActive(page, 'PauseMenu', true)
    await clickActor(page, 'Btn_resume')
    await expectActorNotActive(page, 'PauseMenu')
  })
})
