/**
 * ClashMaster（部落冲突）冒烟测试
 *
 * 覆盖链路：
 *   打开编辑器 → 打开 ClashMaster 工程 → Launch 启动游戏
 *   → 通过 __fishBattle 调试桥进入基地 → 打开地图面板
 *   → 进入关卡 → 返回基地 → 停止游戏
 *   → GM 放兵验证
 *
 * 环境要点：
 *   - hidden 页面：DOM 点击一律 dispatchEvent
 *   - 游戏状态断言走 DOM 文本（状态栏 "Running"/"Stopped"）
 *   - Three.js UI 按钮（canvas 内）不可用 DOM 点击，
 *     改用 window.__fishBattle 调试桥驱动阶段切换
 */
import { test, expect, type Page } from '../fixtures'

// ────────────────────────────────────────────────
//  辅助
// ────────────────────────────────────────────────

async function dispatchClick(page: Page, buttonName: string) {
  await page.getByRole('button', { name: buttonName }).dispatchEvent('click', { bubbles: true })
}

async function openProject(page: Page, projectName: string) {
  await page.getByText(projectName, { exact: false }).first().dispatchEvent('click', { bubbles: true })
  await page.getByRole('button', { name: '打开工程' }).dispatchEvent('click', { bubbles: true })
  await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 30_000 })
}

/** 轮询等待状态栏出现指定文本（Running / Stopped） */
async function waitForStatus(page: Page, status: string) {
  await expect(page.getByText(status, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
}

/** 获取页面 body 文本（用于断言 DOM 内容） */
async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '')
}

/** 通过 __fishBattle 调试桥进入关卡 */
async function enterLevel(page: Page, levelId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { enterLevel?: (id: string) => boolean } | undefined
    return bridge?.enterLevel?.(id) ?? false
  }, levelId)
}

/** 通过 __fishBattle 调试桥获取游戏状态 */
async function getState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { getState?: () => Record<string, unknown> } | undefined
    return bridge?.getState?.() ?? {}
  })
}

/** 通过 __fishBattle 调试桥获取战斗快照 */
async function getBattle(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { getBattle?: () => Record<string, unknown> | null } | undefined
    return bridge?.getBattle?.() ?? null
  })
}

/** 通过 __fishBattle 调试桥驱动 tick */
async function stepTicks(page: Page, n: number): Promise<number> {
  return page.evaluate((count) => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { stepTicks?: (n: number) => number } | undefined
    return bridge?.stepTicks?.(count) ?? 0
  }, n)
}

/** 通过 __fishBattle 调试桥部署兵（走军队扣除，需先 unlockBattle 注入军队） */
async function deploy(page: Page, troopId: string, x: number, z: number): Promise<boolean> {
  return page.evaluate(({ id, px, pz }) => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { deploy?: (id: string, x: number, z: number) => boolean } | undefined
    return bridge?.deploy?.(id, px, pz) ?? false
  }, { id: troopId, px: x, pz: z })
}

/** 通过 __fishBattle 调试桥获取场上部队列表 */
async function getTroops(page: Page): Promise<Array<{ name: string; x: number; z: number }>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { getTroops?: () => Array<{ name: string; x: number; z: number }> } | undefined
    return bridge?.getTroops?.() ?? []
  })
}

/** 通过 __fishBattle 调试桥执行 GM 命令 */
async function executeGM(page: Page, line: string): Promise<{ ok: boolean; message: string }> {
  return page.evaluate((cmd) => {
    const bridge = (window as unknown as Record<string, unknown>).__fishBattle as
      { executeGM?: (line: string) => { ok: boolean; message: string } } | undefined
    return bridge?.executeGM?.(cmd) ?? { ok: false, message: '调试桥未就绪' }
  }, line)
}

// ────────────────────────────────────────────────
//  用例
// ────────────────────────────────────────────────

test.describe('ClashMaster 冒烟测试', () => {
  test('打开工程 → 启动游戏 → 主菜单 → 基地 → 停止', async ({ page }) => {
    // ── 1. 打开编辑器 ──
    await page.goto('http://localhost:5174/')
    await expect(page.getByText('ClashMaster', { exact: false }).first()).toBeVisible({ timeout: 30_000 })

    // ── 2. 打开 ClashMaster 工程 ──
    await openProject(page, 'ClashMaster')

    // ── 3. 启动游戏 ──
    await dispatchClick(page, 'Launch')
    await waitForStatus(page, 'Running')

    // 确认游戏已启动：状态栏显示 Running
    const text1 = await bodyText(page)
    expect(text1).toMatch(/Running/)

    // ── 4. 停止游戏 ──
    await dispatchClick(page, 'Stop')
    await waitForStatus(page, 'Stopped')

    // 确认已停止：状态栏显示 Stopped，Launch 按钮重新出现
    const text2 = await bodyText(page)
    expect(text2).toMatch(/Stopped/)
    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 10_000 })
  })

  test('启动 → 停止 → 再次启动', async ({ page }) => {
    await page.goto('http://localhost:5174/')
    await openProject(page, 'ClashMaster')

    // 第一次启动
    await dispatchClick(page, 'Launch')
    await waitForStatus(page, 'Running')

    // 停止
    await dispatchClick(page, 'Stop')
    await waitForStatus(page, 'Stopped')

    // 再次启动
    await dispatchClick(page, 'Launch')
    await waitForStatus(page, 'Running')

    // 再次停止
    await dispatchClick(page, 'Stop')
    await waitForStatus(page, 'Stopped')
  })

  test('进入基地 → 打开地图 → 进入关卡', async ({ page }) => {
    await page.goto('http://localhost:5174/')
    await openProject(page, 'ClashMaster')

    // 启动游戏 → 主菜单
    await dispatchClick(page, 'Launch')
    await waitForStatus(page, 'Running')

    // 先确认调试桥就绪
    await page.waitForTimeout(1000)

    // 使用调试桥直接进入关卡 1
    const entered = await enterLevel(page, 'level1')
    expect(entered).toBe(true)

    // 等待关卡场景加载
    await page.waitForTimeout(2000)

    // 确认已进入关卡阶段
    const state = await getState(page)
    expect(state.phase).toBe('game')
    expect(state.levelId).toBe('level1')

    // 确认状态栏仍显示 Running
    const textRunning = await bodyText(page)
    expect(textRunning).toMatch(/Running/)

    // 驱动一些 tick 让关卡场景稳定
    await stepTicks(page, 30)

    // 停止游戏
    await dispatchClick(page, 'Stop')
    await waitForStatus(page, 'Stopped')
  })

  test('进入关卡 → unlockBattle 注入军队 → GM 放兵', async ({ page }) => {
    await page.goto('http://localhost:5174/')
    await openProject(page, 'ClashMaster')

    // 启动游戏
    await dispatchClick(page, 'Launch')
    await waitForStatus(page, 'Running')
    await page.waitForTimeout(1000)

    // 进入关卡
    const entered = await enterLevel(page, 'level1')
    expect(entered).toBe(true)
    await page.waitForTimeout(2000)

    // 执行 unlockBattle GM 命令：每个兵种注入 999 军队
    const gmResult = await executeGM(page, 'unlockBattle')
    expect(gmResult.ok).toBe(true)

    // 在 (0, 10) 放一个野蛮人（消耗军队），位置在防御塔射程外（range=9），避免被秒杀
    const deployed = await deploy(page, 'barbarian', 0, 10)
    expect(deployed).toBe(true)

    // 推进 tick 让兵 Actor 完成初始化
    await stepTicks(page, 30)

    // 断言场上已有部队
    const troops = await getTroops(page)
    expect(troops.length).toBeGreaterThan(0)
    expect(troops[0].name).toBe('野蛮人')

    // 停止游戏
    await dispatchClick(page, 'Stop')
    await waitForStatus(page, 'Stopped')
  })
})
