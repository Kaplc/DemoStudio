/**
 * 模型切换系统消息显示名 E2E
 *
 * 无副作用模式：addInitScript hook window.fetch，按 RPC method 返回合成响应
 * （session.list 命中 recovering 路径 → 面板自动连接并拉历史；session.history
 * 合成一条 request/header 事件触发「模型切换」系统消息；session.models 提供
 * 模型目录供名称解析），全程不碰真实 DSH。
 *
 * 覆盖：
 * 1. 目录条目带 name → 系统消息显示名称（5.3f），模型芯片同样显示名称
 * 2. 目录条目无 name → 系统消息回退显示真实模型 id
 */
import { expect, test, type Page } from '@playwright/test'

/** 合成历史里的 request/header 事件（形状对齐 foldEvents 消费的 DshEvent 信封） */
function headerEvent(model: string) {
  return {
    event: {
      type: 'request/header',
      seq: 5,
      time: Date.now(),
      data: {
        reason: 'initial',
        header: { config: { provider: 'zai', model } },
      },
    },
  }
}

async function installStubs(page: Page, opts: { withNames: boolean }) {
  await page.addInitScript((withNames) => {
    const w = window as any
    localStorage.setItem('demostudio.dsh.session', JSON.stringify({
      sessionId: 'e2e-model-name-session',
      port: 3080,
      savedAt: Date.now(),
    }))
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : (input?.url || '')
      if (!url.includes('/api/')) return realFetch(input, init)
      let method = ''
      try {
        method = JSON.parse(init?.body || '{}').method || ''
      } catch { /* 非 RPC 请求走原 fetch */ }
      const ok = (value: unknown) => new Response(
        JSON.stringify({ result: { ok: true, value } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      switch (method) {
        case 'session.list':
          return ok({ items: [{ sessionId: 'e2e-model-name-session', title: 'e2e', updatedAt: Date.now() }] })
        case 'session.history':
          return ok({ events: [w.__headerEvent], hasMore: false })
        case 'session.models':
          return ok({
            groups: [{
              id: 'zai',
              name: 'zai',
              models: withNames
                ? [{ id: 'glm-5.3-flash', name: '5.3f' }]
                : [{ id: 'glm-5.3-flash' }],
            }],
            current: { provider: 'zai', model: 'glm-5.3-flash' },
          })
        case 'settings.describe':
          return ok({ namespaces: [] })
        case 'credentials.describe':
          return ok({ credentials: {} })
        default:
          return ok({})
      }
    }
  }, opts.withNames)
  await page.addInitScript((evt) => { (window as any).__headerEvent = evt }, headerEvent('glm-5.3-flash'))
}

test.describe('模型切换系统消息显示名', () => {
  test('目录带 name → 系统消息与芯片显示名称', async ({ page }) => {
    await installStubs(page, { withNames: true })
    await page.goto('/agent.html')
    await expect(page.getByText('模型切换: 5.3f')).toBeVisible()
    // 模型芯片（选择模型入口）同样显示名称
    await expect(page.locator('.model-selector__label')).toHaveText('5.3f')
  })

  test('目录无 name → 系统消息回退显示真实模型 id', async ({ page }) => {
    await installStubs(page, { withNames: false })
    await page.goto('/agent.html')
    await expect(page.getByText('模型切换: glm-5.3-flash')).toBeVisible()
  })
})
