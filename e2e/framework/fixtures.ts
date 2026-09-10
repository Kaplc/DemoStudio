/**
 * e2e/framework/fixtures — 框架对外入口
 *
 * spec 里这样用（替代直接 import '@playwright/test'）：
 *
 *   import { test, expect } from './framework/fixtures'
 *   test.use({ project: 'fish' })            // 选项目（默认 fish）
 *   test('xxx', async ({ game }) => {        // game = 已引导到游戏运行中的会话
 *     const hud = await game.hud()
 *     ...
 *   })
 *
 * 用例失败时自动 attach 游戏运行时证据：
 * game-console.log / game-state.json / game-hud.json / game-final.png
 */
import { test as base, expect } from '@playwright/test'
import { GameSession } from './session'
import { getProject } from './projects'

export { expect }

export interface GameTestOptions {
  /** 项目 id（e2e/framework/projects.ts 里注册的键），默认 fish */
  project: string
}

interface GameFixtures {
  /** 已引导至目标项目游戏运行中的会话（含失败自动取证） */
  game: GameSession
}

export const test = base.extend<GameFixtures & GameTestOptions>({
  project: ['fish', { option: true }],

  game: async ({ page, project }, use, testInfo) => {
    const session = await GameSession.boot(page, getProject(project))
    await use(session)
    await session.attachEvidenceIfFailed(testInfo)
  },
})
