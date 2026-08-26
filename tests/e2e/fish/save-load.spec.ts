/**
 * ClashMaster 存档系统端到端测试（Esc 存档菜单 → 手动保存/读取）
 *
 * 覆盖链路：
 *   主菜单开始游戏 → 基地阶段 → Esc 呼出存档菜单（save_menu.widget.json）
 *   → 修改运行时状态（注入军队）→ 点"保存存档"
 *   → 再改状态 → 点"读取存档" → 断言状态回滚到保存时刻
 *   → Esc 再次关闭菜单
 *
 * 环境要点（同 full-flow.spec.ts）：
 *   - 纯浏览器模式无 electronAPI 时由 MockElectronAPI 兜底：writeJsonFile/readJsonFile
 *     走内存缓存 —— 本用例验证的是「存/读回滚语义」全链路（含脚本绑定与菜单开关），
 *     真实磁盘写入需在 Electron 窗口手测。
 *   - window.__fishBattle 为游戏实例调试桥（getState/addArmy），仅作断言与造数，
 *     存/读操作本身走真实 UI 按钮（ai.clickActor）。
 */
import { test, expect, type Page } from '../fixtures'
import { clickActor, actorActive } from '../helpers/ai'

/** 对按钮派发原生 click（绕过 hidden 页面的 stable 等待） */
async function dispatchClick(page: Page, buttonName: string) {
  await page.getByRole('button', { name: buttonName }).dispatchEvent('click', { bubbles: true })
}

/** 打开工程并启动游戏（同 full-flow 两步法；工程卡标题为 ClashMaster，历史目录名 fish） */
async function openAndLaunch(page: Page) {
  await page.goto('/')
  await page.getByText('ClashMaster', { exact: false }).first().dispatchEvent('click', { bubbles: true })
  await page.getByRole('button', { name: '打开工程' }).dispatchEvent('click', { bubbles: true })
  await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 30_000 })
  await dispatchClick(page, 'Launch')
}

/** 游戏调试桥 getState 快照（phase/coins/army 等） */
interface FishState {
  phase: string
  coins: number
  elixir: number
  army: string
}

async function getState(page: Page): Promise<FishState> {
  return page.evaluate(() => {
    const b = (window as unknown as Record<string, unknown>).__fishBattle as
      | { getState?: () => FishState }
      | undefined
    return b?.getState?.() ?? ({ phase: 'unknown', coins: -1, elixir: -1, army: '' } as FishState)
  })
}

test.describe('ClashMaster 存档菜单', () => {
  test('基地 Esc 呼出菜单 → 保存 → 改动 → 读取回滚 → Esc 关闭', async ({ page }) => {
    // ── 1. 打开工程 → 启动 → 主菜单 ──
    await openAndLaunch(page)
    await expect.poll(async () => (await actorActive(page, 'StartButton')) !== null, {
      message: '主菜单 StartButton 未出现',
      timeout: 30_000,
    }).toBe(true)

    // ── 2. 开始游戏进入基地（Phase=base 且 HUD 出现）──
    await clickActor(page, 'StartButton')
    await expect.poll(async () => (await getState(page)).phase, {
      message: '未进入基地阶段',
      timeout: 20_000,
    }).toBe('base')
    await expect.poll(async () => (await actorActive(page, 'Btn_build')) !== null, {
      message: '基地 HUD 未出现',
      timeout: 20_000,
    }).toBe(true)

    // ── 3. Esc 呼出存档菜单 ──
    await page.keyboard.press('Escape')
    await expect.poll(async () => actorActive(page, 'SaveMenu'), {
      message: '存档菜单未被 Esc 呼出',
      timeout: 10_000,
    }).toBe(true)
    // 面板控件就位（信息行 = UIScript onStart 已执行、按钮绑定完成的信号）
    await expect.poll(async () => (await actorActive(page, 'InfoLine')) !== null, {
      message: '存档菜单 InfoLine 未生成',
      timeout: 10_000,
    }).toBe(true)

    // ── 4. 保存当前状态（先做一处已知改动再保存，确保快照非默认）──
    const injected = await page.evaluate(() => {
      const b = (window as unknown as Record<string, unknown>).__fishBattle as
        | { addArmy?: (id: string, n: number) => boolean }
        | undefined
      return b?.addArmy?.('barbarian', 5) ?? false
    })
    expect(injected).toBe(true)
    const saved = await getState(page)
    expect(saved.army).toContain('x5')
    const s0 = saved

    await clickActor(page, 'Btn_save')

    // ── 5. 保存后继续改动（不再保存）──
    await page.evaluate(() => {
      const b = (window as unknown as Record<string, unknown>).__fishBattle as
        | { addArmy?: (id: string, n: number) => boolean }
        | undefined
      b?.addArmy?.('giant', 4)
      b?.addArmy?.('barbarian', 3)
    })
    const mutated = await getState(page)
    expect(mutated.army.length).toBeGreaterThan(s0.army.length)

    // ── 6. 读取存档 → 状态回滚到保存时刻 ──
    await clickActor(page, 'Btn_load')
    await expect.poll(async () => (await getState(page)).army, {
      message: '读取存档后军队未回滚到保存时刻',
      timeout: 15_000,
    }).toBe(s0.army)

    const restored = await getState(page)
    expect(restored.coins).toBe(s0.coins)
    expect(restored.phase).toBe('base')

    // ── 7. 读取成功后菜单自动关闭（脚本行为）；随后 Esc 开→关 完整验证切换 ──
    await expect.poll(async () => actorActive(page, 'SaveMenu'), {
      message: '读取成功后存档菜单应自动关闭',
      timeout: 10_000,
    }).not.toBe(true)

    await page.keyboard.press('Escape')
    await expect.poll(async () => actorActive(page, 'SaveMenu'), {
      message: 'Esc 应再次呼出存档菜单',
      timeout: 10_000,
    }).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(async () => actorActive(page, 'SaveMenu'), {
      message: '再次按 Esc 后存档菜单应关闭',
      timeout: 10_000,
    }).not.toBe(true)
  })
})
