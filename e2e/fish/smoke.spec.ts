/**
 * ClashMaster（fish）冒烟用例 —— 框架示范
 *
 * 覆盖链路：主菜单 HUD → 开始游戏进基地 → 基地 HUD 完整 → GM 桥可用 → 状态快照健康
 * 断言点全部来自真实资产/脚本（main_menu.widget / base_hud.widget / BaseHud.script.ts），
 * 项目名来自 src/projects/fish/register.ts 的 ProjectModule.name = 'ClashMaster'。
 */
import { test, expect } from '../framework/fixtures'
import type { HUDNode } from '../framework/types'

test.use({ project: 'fish' })

test.describe('ClashMaster 冒烟', () => {
  test('主菜单 → 开始游戏 → 基地 HUD 完整，GM 桥与健康状态', async ({ game }) => {
    // ① 主菜单：FishMainMenu 已挂载，开始按钮存在
    const startButtons = await game.findHUD((n: HUDNode) => n.name === 'StartButton')
    expect(startButtons.length, '主菜单应有 StartButton 按钮').toBeGreaterThan(0)

    // ② 点开始 → 切基地场景 → 等 BaseHud 挂载（BaseHud.script.ts 绑定这些按钮）
    await game.clickActor({ name: 'StartButton' }, 30_000)
    await game.waitHUD((n: HUDNode) => n.name === 'Btn_build', 30_000)

    const hudRoots = await game.hud()
    expect(hudRoots.length, '基地阶段应有 UI 根 Actor').toBeGreaterThan(0)
    for (const btn of ['Btn_build', 'Btn_map', 'Btn_gemShop']) {
      const hit = await game.findHUD((n: HUDNode) => n.name === btn)
      expect(hit.length, `基地 HUD 应有 ${btn}`).toBeGreaterThan(0)
    }

    // ③ GM 桥：help 命令应成功并返回命令清单文本
    const help = await game.gm('help')
    expect(help.ok, 'GM help 应执行成功').toBe(true)
    expect(help.message.length, 'GM help 应有输出').toBeGreaterThan(0)

    // ④ 状态快照：运行中、场景里有 Actor
    const state = await game.state()
    expect(state.running).toBe(true)
    expect(state.actorCount, '基地场景应有 Actor').toBeGreaterThan(0)
  })

  test('场景大纲可用（3D + UI Actor 树非空）', async ({ game }) => {
    const outline = await game.outline({ maxDepth: 4 })
    expect(outline.length, '场景大纲应有根节点').toBeGreaterThan(0)
    const names = outline.map((n) => n.name)
    expect(names, '大纲应含 HUD 根 Actor').toContain('HUD')
  })
})
