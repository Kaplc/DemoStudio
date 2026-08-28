/**
 * 关卡战斗放兵回归测试
 *
 * 回归背景（真实 Bug）：FishLevelGameMode 覆盖了 StartPlay() 但未调用 super.StartPlay()，
 * 导致基类 SpawnPlayer() 从不执行 → FishLevelPlayerController 从未创建 →
 * InputSys.handlePointerDown 的 hasController=false → 点击场景永远放不了兵。
 *
 * 覆盖链路（走与真实鼠标点击完全相同的引擎路径）：
 *   InputSys.handlePointerDown → PhySys.raycastClick
 *   → FishLevelPlayerController.OnPointerDownScreen
 *   → FishLevelGameMode.onScreenDown → deployAtScreen → spawnTroopActor
 *
 * 环境要点：hidden 页面 canvas getBoundingClientRect 可能为 0，
 *   故不走 DOM 事件，改用 __fishBattle.debugClick 驱动同一条引擎链路。
 */
import { test, expect, type Page } from '../fixtures'

async function dispatchClick(page: Page, buttonName: string) {
  await page.getByRole('button', { name: buttonName }).dispatchEvent('click', { bubbles: true })
}

async function openProject(page: Page, projectName: string) {
  await page.getByText(projectName, { exact: false }).first().dispatchEvent('click', { bubbles: true })
  await page.getByRole('button', { name: '打开工程' }).dispatchEvent('click', { bubbles: true })
  await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 30_000 })
}

async function waitForStatus(page: Page, status: string) {
  await expect(page.getByText(status, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
}

test.describe('关卡战斗放兵', () => {
  test('进入关卡 → 选兵 → 点击场景 → 放兵成功', async ({ page }) => {
    await page.goto('http://localhost:5174/')
    await openProject(page, 'ClashMaster')

    await dispatchClick(page, 'Launch')
    await waitForStatus(page, 'Running')
    await page.waitForTimeout(1500)

    // 进入关卡
    const entered = await page.evaluate(() => (window as any).__fishBattle?.enterLevel?.('level1') ?? false)
    expect(entered).toBe(true)
    await page.waitForTimeout(2000)

    // 前置校验：本阶段 Controller 必须存在（StartPlay 回归防线）
    const probe = await page.evaluate(() => (window as any).__fishBattle?.probe?.() ?? null)
    expect(probe?.hasController).toBe(true)
    expect(probe?.controllerName).toBe('FishLevelPlayerController')

    // 注入军队（放兵会扣军队额度）
    const gmOk = await page.evaluate(() => (window as any).__fishBattle?.executeGM?.('unlockBattle')?.ok ?? false)
    expect(gmOk).toBe(true)

    // ① 未选兵时点击 → 不应放兵（基线对照：验证不会误触）
    const before = await page.evaluate(() => {
      const b = (window as any).__fishBattle
      b?.debugClick?.(600, 400)
      return b?.getTroops?.() ?? []
    })
    expect(before.length).toBe(0)

    // ② 选兵（等价点击 HUD 兵种卡片）→ 应进入放置模式
    const placeId = await page.evaluate(() => (window as any).__fishBattle?.selectTroop?.('barbarian') ?? null)
    expect(placeId).toBe('barbarian')

    // ③ 选兵后点击场景 → 应放兵成功（走完整 InputSys → Controller → GameMode 链路）
    const troops = await page.evaluate(() => {
      const b = (window as any).__fishBattle
      b?.debugClick?.(600, 400)
      return b?.getTroops?.() ?? []
    })
    expect(troops.length).toBe(1)
    expect(troops[0].name).toBe('野蛮人')

    // ④ 推进 tick：兵应存活并朝建筑移动（未被防御塔瞬秒）
    await page.evaluate(() => (window as any).__fishBattle?.stepTicks?.(10))
    const after = await page.evaluate(() => (window as any).__fishBattle?.getTroops?.() ?? [])
    expect(after.length).toBe(1)

    await dispatchClick(page, 'Stop')
    await waitForStatus(page, 'Stopped')
  })
})
