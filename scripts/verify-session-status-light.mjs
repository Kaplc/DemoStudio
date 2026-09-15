/**
 * 会话状态灯真机取证脚本（CDP 连接运行中的编辑器）
 * 用法：node scripts/verify-session-status-light.mjs <mode>
 *   observe —— 重载独立 agent 窗口 → 开侧边栏 → 轮询等待 .session-status-light 出现 → 截图退出
 *   after   —— 重连检查灯是否按预期消失（completed 收尾清灯）→ 截图退出
 */
import { chromium } from 'playwright'

const mode = process.argv[2] || 'observe'
const CDP = 'http://127.0.0.1:9222'
const shot = `logs/screenshots/status-light-${mode}-${Date.now()}.png`

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
const pages = ctx.pages()
const agentPage = pages.find(p => p.url().includes('agent.html'))
if (!agentPage) { console.error('NO_AGENT_PAGE'); process.exit(1) }

await agentPage.bringToFront()
await agentPage.reload({ waitUntil: 'domcontentloaded' })
// 等面板连接恢复（mux mock 不可用，真机走 Electron IPC 桥）
await agentPage.waitForSelector('.agent-panel', { timeout: 30000 })
await agentPage.waitForTimeout(2500)

// 开会话侧边栏
const sidebarBtn = agentPage.locator('.agent-panel__sidebar-btn[title="会话列表"]')
if (await sidebarBtn.count() > 0) await sidebarBtn.click()
await agentPage.waitForTimeout(800)

if (mode === 'observe') {
  // 轮询等状态灯出现（外部会话 turn/start 由真实 mux 广播驱动）
  const light = agentPage.locator('.session-status-light')
  try {
    await light.first().waitFor({ state: 'visible', timeout: 150000 })
    const info = await light.evaluateAll(els => els.map(el => ({
      sessionId: el.getAttribute('data-session-id'),
      status: el.getAttribute('data-status'),
      bg: getComputedStyle(el).backgroundColor,
      title: el.getAttribute('title'),
    })))
    console.log('LIGHT_FOUND', JSON.stringify(info))
  } catch {
    console.log('LIGHT_TIMEOUT')
  }
} else {
  const n = await agentPage.locator('.session-status-light').count()
  console.log('LIGHT_COUNT_AFTER', n)
}

await agentPage.screenshot({ path: shot })
console.log('SHOT', shot)
await browser.close()
