/**
 * 上下文占用圈跨会话保持 E2E
 *
 * 无副作用模式：addInitScript hook window.fetch，按 RPC method 返回合成响应。
 * 数据源对齐 DSH 权威 contextPressure 投影：session.list 行内
 * projections.values.contextPressure（wire 视图 {contextWindow, projectedTokens}）
 * 被 AgentService 收割进按会话快照缓存，切会话即时恢复进度圈，
 * 不再依赖新会话历史 fold 碰运气 seed（此前切会话圈消失的根因）。
 *
 * 覆盖：
 * 1. 挂载收割：当前会话（ring-a）的占用圈出现，百分比 = 102400/512000 = 20%
 * 2. 切换会话：切到 ring-b 后圈保持显示，百分比切换为 128000/256000 = 50%
 */
import { expect, test, type Page } from '@playwright/test'

/** 两个合成会话的权威占用投影（分母/分子按 contextPressure wire 视图形状） */
const SESSIONS = [
  { sessionId: 'e2e-ring-a', contextWindow: 512000, projectedTokens: 102400 },
  { sessionId: 'e2e-ring-b', contextWindow: 256000, projectedTokens: 128000 },
]

async function installStubs(page: Page) {
  await page.addInitScript((sessions) => {
    localStorage.setItem('demostudio.dsh.session', JSON.stringify({
      sessionId: 'e2e-ring-a',
      port: 3080,
      savedAt: Date.now(),
    }))
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : (input?.url || '')
      if (!url.includes('/api/')) return realFetch(input, init)
      let method = ''
      try { method = JSON.parse(init?.body || '{}').method || '' } catch { /* 非 RPC 请求走原 fetch */ }
      const ok = (value: unknown) => new Response(
        JSON.stringify({ result: { ok: true, value } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      switch (method) {
        case 'session.list':
          return ok({
            items: sessions.map((s: (typeof sessions)[number]) => ({
              sessionId: s.sessionId,
              updatedAt: Date.now(),
              projections: {
                values: {
                  contextPressure: { contextWindow: s.contextWindow, projectedTokens: s.projectedTokens },
                },
              },
            })),
          })
        case 'session.history':
          return ok({ events: [] })
        case 'settings.describe':
          return ok({ namespaces: [] })
        case 'credentials.describe':
          return ok({ credentials: {} })
        default:
          return ok({})
      }
    }
  }, SESSIONS)
}

test.describe('上下文占用圈跨会话保持', () => {
  test('挂载收割：当前会话占用圈出现且百分比分母正确', async ({ page }) => {
    await installStubs(page)
    await page.goto('/agent.html')
    const ring = page.locator('.composer__ctx-ring')
    await expect(ring).toBeVisible()
    // 102400 / 512000 = 20%
    await expect(ring).toHaveAttribute('title', /上下文已用 20%.*102K \/ 512K/)
  })

  test('切换会话：占用圈保持显示且切换为目标会话的占比', async ({ page }) => {
    await installStubs(page)
    await page.goto('/agent.html')
    await expect(page.locator('.composer__ctx-ring')).toBeVisible()
    // 侧栏默认收起：先点头部 ☰ 打开会话列表
    await page.locator('.agent-panel__sidebar-btn').click()
    await page.locator('.session-sidebar__item', { hasText: 'e2e-ring-b' }).click()
    const ring = page.locator('.composer__ctx-ring')
    // 128000 / 256000 = 50%（切换后不清空，立即恢复目标会话的权威快照）
    await expect(ring).toBeVisible()
    await expect(ring).toHaveAttribute('title', /上下文已用 50%.*128K \/ 256K/)
  })
})
