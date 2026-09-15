/**
 * Agent 面板 F5 刷新 E2E（2026-09-15 需求：agent 界面支持 F5 刷新）
 *
 * 背景：主编辑器窗口的 F5 由全局快捷键接管（KeyboardShortcuts → location.reload），
 * 但 Agent 独立窗口（agent.html）没有任何 F5 处理；内嵌面板下焦点在聊天输入框时
 * 又会被 KeyboardShortcuts 的 INPUT/TEXTAREA 守卫跳过。修复：AgentPanel（两窗口
 * 共用组件）内新增 window 级 F5 兜底（defaultPrevented / 修饰键让路，
 * 见 doc/editor/integration/agent_panel_system.md §15）。
 *
 * 无副作用模式：addInitScript 写 localStorage 合成会话 + hook fetch 返回合成 RPC，
 * 全程不碰真实 DSH；入口直接 goto /agent.html（§14.4：?agentWindow=1 重定向
 * 窗口期 evaluate 会撞 context destroyed）。
 *
 * ⚠ 两条 e2e 机制坑（实测探针证实，改判别逻辑前先读懂）：
 * 1. headless Chromium 里 F5 本就有浏览器默认刷新，「页面重载了」不构成特性生效的
 *    证据——必须证明重载来自面板 handler（它 preventDefault 取消了浏览器默认）。
 *    判别器：面板挂载后从测试里**再注册一个排在最后的 once 冒泡监听**，同一轮
 *    keydown 派发内同步读 defaultPrevented 终值写 sessionStorage（跨重载存活）。
 *    面板 handler（注册在前）已 preventDefault → 读到 'true'；特性缺失（只有
 *    Chromium 默认刷新）→ 'false'。
 *    不能用"捕获阶段监听 + 微任务落值"：trusted 按键派发中捕获阶段排队的微任务
 *    会在 bubble 之前执行，读到的是面板 handler 生效前的旧值（探针实测 'false'）。
 * 2. 合成事件不能 `window.dispatchEvent`：事件直接派发在 target 上，capture/bubble
 *    之分塌缩成注册顺序，捕获阶段的 preventDefault 排不到面板 handler 前面，
 *    会让"让路"分支误触发刷新。必须派到 `document.body` 走真实传播路径。
 *
 * 覆盖：
 * 1. 真实按键 F5（焦点在页面）→ 面板接管并真实重载（probe 丢失 + f5Prevented='true'）
 * 2. 真实按键 F5（焦点在聊天输入框）→ 同样接管并重载（INPUT 守卫不再吞键）
 * 3. defaultPrevented（编辑器全局快捷键已处理）→ 面板不重复触发
 * 4. Shift+F5 / Ctrl+F5 → 面板不接管（保持编辑器语义）
 */
import { expect, test, type Page } from '@playwright/test'

/** 无副作用引导：合成会话 + RPC 全合成 */
async function installStubs(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('demostudio.dsh.session', JSON.stringify({
      sessionId: 'e2e-f5-refresh-session',
      port: 3080,
      savedAt: Date.now(),
    }))
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : (input?.url || '')
      if (!url.includes('/api/')) return realFetch(input, init)
      let method = ''
      try { method = JSON.parse(init?.body || '{}').method || '' } catch { /* 非 RPC 走合成 ok */ }
      const ok = (value: unknown) => new Response(
        JSON.stringify({ result: { ok: true, value } }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      if (method === 'session.list') return ok({ items: [] })
      if (method === 'session.history') return ok({ events: [] })
      return ok({})
    }
  })
}

/**
 * 装 F5 判别器：面板 handler 挂载在前（组件 mount effect），这里注册在其后，
 * 同一次 keydown 派发内它最后执行——读到的 defaultPrevented 已包含面板 handler
 * 的 preventDefault。once 防多次按键污染；sessionStorage 跨重载存活供断言读取。
 */
async function installF5Discriminator(page: Page) {
  await page.evaluate(() => {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F5') return
      try { sessionStorage.setItem('e2eF5Prevented', String(e.defaultPrevented)) } catch { /* 忽略 */ }
    }, { once: true })
  })
}

async function openAgentPanel(page: Page) {
  await page.goto('/agent.html')
  await expect(page.locator('.agent-panel')).toBeVisible()
}

test.describe('Agent 面板 F5 刷新', () => {
  test('真实按键 F5（页面焦点）：面板接管并真实重载', async ({ page }) => {
    await installStubs(page)
    await openAgentPanel(page)
    await installF5Discriminator(page)
    await page.evaluate(() => { (window as any).__f5Probe = 'alive-before-reload' })

    const loaded = page.waitForEvent('load', { timeout: 15_000 })
    await page.keyboard.press('F5')
    await loaded

    // 页面已真实重载：probe 随导航丢失
    expect(await page.evaluate(() => (window as any).__f5Probe)).toBeUndefined()
    // 重载来自面板 handler（preventDefault 取消浏览器默认）而非 Chromium 默认 F5 刷新
    expect(await page.evaluate(() => sessionStorage.getItem('e2eF5Prevented'))).toBe('true')
    // 面板重新挂载可用
    await expect(page.locator('.agent-panel')).toBeVisible()
  })

  test('真实按键 F5（焦点在聊天输入框）：同样接管并重载', async ({ page }) => {
    await installStubs(page)
    await openAgentPanel(page)
    const input = page.locator('.composer__input')
    await input.click()
    await expect(input).toBeFocused()
    await installF5Discriminator(page)
    await page.evaluate(() => { (window as any).__f5Probe = 'alive-before-reload' })

    const loaded = page.waitForEvent('load', { timeout: 15_000 })
    await page.keyboard.press('F5')
    await loaded

    expect(await page.evaluate(() => (window as any).__f5Probe)).toBeUndefined()
    expect(await page.evaluate(() => sessionStorage.getItem('e2eF5Prevented'))).toBe('true')
    await expect(page.locator('.agent-panel')).toBeVisible()
  })

  test('defaultPrevented（编辑器全局快捷键已处理）时面板不重复触发', async ({ page }) => {
    await installStubs(page)
    await openAgentPanel(page)
    await page.evaluate(() => { (window as any).__f5Probe = 'kept' })
    await page.evaluate(() => {
      // window 捕获阶段抢先 preventDefault，模拟编辑器全局快捷键（KeyboardShortcuts）已处理；
      // 事件派到 document.body 走真实传播路径（window 上直接派发时 capture/bubble 塌缩，见文件头坑 2）
      window.addEventListener('keydown', (e) => { if (e.key === 'F5') e.preventDefault() }, { capture: true, once: true })
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', cancelable: true, bubbles: true }))
    })
    // 若被误触发，重载导航早已开始（probe 会变 undefined）
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as any).__f5Probe)).toBe('kept')
  })

  test('Shift+F5 / Ctrl+F5 面板不接管（保持编辑器语义）', async ({ page }) => {
    await installStubs(page)
    await openAgentPanel(page)
    await page.evaluate(() => { (window as any).__f5Probe = 'kept' })
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', shiftKey: true, cancelable: true, bubbles: true }))
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', ctrlKey: true, cancelable: true, bubbles: true }))
    })
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as any).__f5Probe)).toBe('kept')
  })
})
