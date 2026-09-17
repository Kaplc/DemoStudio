// e2e/home/project_cards.spec.ts — 单根迁移后工程卡全量可见（doc-dev/projects-root-unification §3.4 E2）
import { test, expect } from '../framework/fixtures'

const EXPECTED_CARDS = ['Demo2D', 'ClashMaster', 'Arena', 'WarmCurrent', 'Hoi4', 'Hello']

test('工程卡全量可见（单根发现）', async ({ page }) => {
  // 打开编辑器主页（不进游戏），逐卡断言
  for (const name of EXPECTED_CARDS) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  }
})
