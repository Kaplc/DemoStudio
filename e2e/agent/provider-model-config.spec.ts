/**
 * 供应商设置 · 模型能力配置（上下文大小 / 视觉）E2E
 *
 * 无副作用模式：addInitScript 里 hook window.fetch，按 RPC method 返回合成响应
 * （session.list 命中 recovering 路径 → 面板自动连接；settings.describe 提供带
 * 用户级配置的 glm2），settings.mutate 只记录进 window.__dshMutations 不落真盘，
 * 全程不碰真实 DSH 配置。
 *
 * 覆盖：
 * 1. 只渲染用户级自定义供应商（glm2）；预设目录条目（deepseek-official / zai）不出现
 * 2. 编辑 glm2：改名称 + 上下文 + 勾视觉 → mutate 载荷含 name/input 且保留 maxTokens
 * 3. 添加自定义供应商：名称留空 → mutate 载荷无 name 键（回退按 ID 显示），含 input:['text','image']
 */
import { expect, test, type Page } from '@playwright/test'

/** 面板引导用的合成数据（与 AgentService 的线上形状对齐） */
const STUB_USER_PROVIDERS = {
  glm2: {
    displayName: 'glm2',
    api: 'openai-completions',
    baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    apiKeyEnv: 'GLM2_API_KEY',
    models: [{ id: 'glm-5.3-flash', name: 'glm-5.3-flash', contextWindow: 1000000, maxTokens: 131072 }],
  },
}

async function installStubs(page: Page) {
  await page.addInitScript(() => {
    const w = window as any
    w.__dshMutations = []
    localStorage.setItem('demostudio.dsh.session', JSON.stringify({
      sessionId: 'e2e-settings-session',
      port: 3080,
      savedAt: Date.now(),
    }))
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : (input?.url || '')
      if (!url.includes('/api/')) return realFetch(input, init)
      let method = ''
      let payload: any = {}
      try {
        const body = JSON.parse(init?.body || '{}')
        method = body.method || ''
        payload = body.payload || {}
      } catch { /* 非 RPC 请求走原 fetch */ }
      const ok = (value: unknown) => new Response(
        JSON.stringify({ result: { ok: true, value } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      switch (method) {
        case 'session.list':
          return ok({ items: [{ sessionId: 'e2e-settings-session', title: 'e2e', updatedAt: Date.now() }] })
        case 'session.history':
          return ok({ events: [] })
        case 'llm.providers':
          // 预设供应商目录：面板已不再消费该数据，保留在 stub 中用于断言"预设不渲染"
          return ok({
            providers: [
              { provider: 'glm2', displayName: 'glm2', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'glm2'], active: true, declared: true },
              { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'deepseek-official'], active: false },
              { provider: 'zai', displayName: 'zai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zai'], active: false },
            ],
          })
        case 'settings.describe':
          return ok({ namespaces: [{ ns: 'llm-pi-ai', user: { providers: (window as any).__stubUserProviders } }] })
        case 'credentials.describe':
          return ok({ credentials: {} })
        case 'settings.mutate':
          w.__dshMutations.push(payload)
          return ok({})
        default:
          return ok({})
      }
    }
  })
  // initScript 里引用不了外部变量，挂到 window 供 fetch 钩子取用
  await page.addInitScript((stub) => { (window as any).__stubUserProviders = stub }, STUB_USER_PROVIDERS)
}

async function openSettings(page: Page) {
  await page.goto('/agent.html')
  await page.locator('.agent-panel__settings-btn').click()
  await page.locator('.dropdown-item', { hasText: '供应商设置' }).click()
  await expect(page.locator('.settings-panel__header h2')).toHaveText('供应商设置')
}

test.describe('供应商设置 · 模型上下文与视觉配置', () => {
  test.beforeEach(async ({ page }) => {
    await installStubs(page)
  })

  test('只渲染用户级自定义供应商，预设目录条目不出现', async ({ page }) => {
    await openSettings(page)
    const glm2Card = page.locator('.settings-panel__provider', { hasText: 'glm2' })
    // contextWindow 1000000 → 展示为 1M
    await expect(glm2Card.locator('.settings-panel__model-tag')).toHaveText(/glm-5\.3-flash\s*·\s*1M/)
    // 自定义供应商条目：编辑 + 删除供应商入口始终可用
    await expect(glm2Card.getByRole('button', { name: '编辑' })).toBeVisible()
    await expect(glm2Card.getByRole('button', { name: '删除供应商' })).toBeVisible()
    // 预设目录条目（deepseek-official / zai）不再渲染
    await expect(page.locator('.settings-panel__provider', { hasText: 'deepseek-official' })).toHaveCount(0)
    await expect(page.locator('.settings-panel__provider', { hasText: 'zai' })).toHaveCount(0)
    // 列表里只有用户级条目
    await expect(page.locator('.settings-panel__provider')).toHaveCount(1)
  })

  test('编辑 glm2：改名称/上下文/视觉 → mutate 载荷含 name+input 且保留 maxTokens', async ({ page }) => {
    await openSettings(page)
    const glm2Card = page.locator('.settings-panel__provider', { hasText: 'glm2' })
    await glm2Card.getByRole('button', { name: '编辑' }).click()

    // 名称行在模型 ID 前面：回填旧名称，改成新显示名
    const nameInput = page.locator('.settings-panel__config-edit .settings-panel__model-name')
    await expect(nameInput).toHaveValue('glm-5.3-flash')
    await nameInput.fill('GLM 5.3 Flash')

    const ctxInput = page.locator('.settings-panel__config-edit .settings-panel__model-ctx')
    await expect(ctxInput).toHaveValue('1000000')
    await ctxInput.fill('2000000')
    await page.locator('.settings-panel__config-edit .settings-panel__model-vision input').check()
    await page.getByRole('button', { name: '保存配置' }).click()

    await page.waitForFunction(() => (window as any).__dshMutations.length > 0)
    const mutation = await page.evaluate(() => (window as any).__dshMutations[0])
    expect(mutation.ns).toBe('llm-pi-ai')
    expect(mutation.ops[0].op).toBe('set')
    expect(mutation.ops[0].path).toEqual(['providers', 'glm2'])
    expect(mutation.ops[0].value.models).toEqual([
      { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', contextWindow: 2000000, maxTokens: 131072, input: ['text', 'image'] },
    ])
  })

  test('添加自定义供应商：名称留空 → 载荷无 name 键，模型行上下文与视觉写入', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: '+ 添加自定义第三方' }).click()
    await page.getByPlaceholder('如: my-proxy, moonshot, qwen').fill('e2e-vision')
    await page.getByPlaceholder('如: https://api.openai.com/v1 或中转完整地址').fill('https://api.example.com/v1')
    await page.getByPlaceholder('模型 ID（如 gpt-4o）').fill('my-vl-model')
    await page.locator('.settings-panel__custom-form .settings-panel__model-ctx').fill('128000')
    await page.locator('.settings-panel__custom-form .settings-panel__model-vision input').check()
    await page.getByRole('button', { name: '保存并注册' }).click()

    await page.waitForFunction(() => (window as any).__dshMutations.length > 0)
    const mutation = await page.evaluate(() => (window as any).__dshMutations[0])
    expect(mutation.ops[0].path).toEqual(['providers', 'e2e-vision'])
    // 名称留空 = 不写 name 键，选择器/切换消息回退按 ID 显示
    expect(mutation.ops[0].value.models).toEqual([
      { id: 'my-vl-model', contextWindow: 128000, input: ['text', 'image'] },
    ])
  })
})
