/**
 * ds-editor-tools 全覆盖测试
 * 直接通过 Playwright CDP 连接编辑器，验证所有工具的底层能力
 */
import { chromium } from 'playwright-core'

const CDP_URL = 'http://127.0.0.1:9222'
const MCP_PORT = 9877
let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    const result = await fn()
    console.log(`✅ ${name}`)
    if (result) console.log(`   → ${JSON.stringify(result).slice(0, 200)}`)
    passed++
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`)
    failed++
  }
}

// ─── MCP HTTP 辅助（测试 editor.* 事件）───
async function mcpEmit(event, payload = {}) {
  const resp = await fetch(`http://127.0.0.1:${MCP_PORT}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'ai_event', params: { event, payload } }),
  })
  const json = await resp.json()
  return json.result ?? json
}

// ─── 测试开始 ───
console.log('\n🔧 ds-editor-tools 全覆盖测试\n')
console.log('='.repeat(60))

// ═══ Part 1: editor.* AI 事件测试（通过 MCP HTTP） ═══
console.log('\n📋 Part 1: editor.* AI 事件\n')

await test('editor.getState — 读取编辑器状态', async () => {
  const r = await mcpEmit('editor.getState')
  if (!r.currentProject && !r.gameState) throw new Error('返回结构异常')
  return { currentProject: r.currentProject?.name ?? null, activeTab: r.activeTabId, panels: Object.keys(r.panels).filter(k => r.panels[k].visible) }
})

await test('editor.togglePanel — 开关 console 面板', async () => {
  const before = await mcpEmit('editor.getState')
  const r = await mcpEmit('editor.togglePanel', { panel: 'console' })
  if (!r.ok) throw new Error(r.error)
  const after = await mcpEmit('editor.getState')
  // 恢复
  await mcpEmit('editor.togglePanel', { panel: 'console' })
  return { toggled: r.panel, beforeVisible: before.panels.console.visible, afterVisible: after.panels.console.visible }
})

await test('editor.togglePanel — 错误参数', async () => {
  const r = await mcpEmit('editor.togglePanel', {})
  if (r.ok) throw new Error('应该返回错误')
  return { error: r.error }
})

await test('editor.togglePanel — 无效面板名', async () => {
  const r = await mcpEmit('editor.togglePanel', { panel: 'nonexistent' })
  if (r.ok) throw new Error('应该返回错误')
  return { error: r.error }
})

await test('editor.setLeftPanelTab — 切换到 assets', async () => {
  const r = await mcpEmit('editor.setLeftPanelTab', { tab: 'assets' })
  if (!r.ok) throw new Error(r.error)
  const state = await mcpEmit('editor.getState')
  // 恢复
  await mcpEmit('editor.setLeftPanelTab', { tab: 'outline' })
  return { switched: r.leftPanelTab, confirmed: state.leftPanelTab }
})

await test('editor.setGizmos — 关闭 Gizmo', async () => {
  const r = await mcpEmit('editor.setGizmos', { enabled: false })
  if (!r.ok) throw new Error(r.error)
  const state = await mcpEmit('editor.getState')
  // 恢复
  await mcpEmit('editor.setGizmos', { enabled: true })
  return { gizmosOff: !state.viewport.gizmos }
})

await test('editor.toggleConsole — 开关控制台', async () => {
  const r = await mcpEmit('editor.toggleConsole')
  if (!r.ok) throw new Error(r.error)
  // 恢复
  await mcpEmit('editor.toggleConsole')
  return { consoleVisible: r.consoleVisible }
})

await test('editor.clearConsole — 清空控制台', async () => {
  const r = await mcpEmit('editor.clearConsole')
  if (!r.ok) throw new Error(r.error)
  const state = await mcpEmit('editor.getState')
  return { consoleOutputLength: state.consoleOutput.length }
})

await test('editor.setActiveTab — 切换到 scene 页签', async () => {
  const r = await mcpEmit('editor.setActiveTab', { tabId: 'scene' })
  if (!r.ok) throw new Error(r.error)
  return { activeTabId: r.activeTabId }
})

await test('editor.setActiveTab — 无效页签', async () => {
  const r = await mcpEmit('editor.setActiveTab', { tabId: 'nonexistent' })
  if (r.ok) throw new Error('应该返回错误')
  return { error: r.error }
})

await test('editor.switchProject — 无 folder 参数', async () => {
  const r = await mcpEmit('editor.switchProject', {})
  if (r.ok) throw new Error('应该返回错误')
  return { error: r.error }
})

// ═══ Part 2: CDP/Playwright 连接测试 ═══
console.log('\n📋 Part 2: CDP/Playwright 连接\n')

let browser, page

await test('CDP 连接编辑器', async () => {
  browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 })
  const contexts = browser.contexts()
  if (contexts.length === 0) throw new Error('无 BrowserContext')
  const pages = contexts[0].pages()
  if (pages.length === 0) throw new Error('无页面')
  page = pages[0]
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
  return { url: page.url(), contexts: contexts.length, pages: pages.length }
})

await test('editor_read — 读取页面标题', async () => {
  const title = await page.title()
  return { title }
})

await test('editor_read — 读取页面 body 文本片段', async () => {
  const text = await page.locator('body').textContent().catch(() => '')
  return { length: text.length, preview: text.trim().slice(0, 100) }
})

await test('editor_screenshot — 全页面截图', async () => {
  const buffer = await page.screenshot({ type: 'png', fullPage: false })
  return { size: buffer.length, format: 'png' }
})

await test('editor_click — 查找可点击元素', async () => {
  // 查找所有 button 元素
  const buttons = page.locator('button')
  const count = await buttons.count()
  if (count === 0) throw new Error('页面上没有 button 元素')
  // 读取前 5 个按钮的文本
  const texts = []
  for (let i = 0; i < Math.min(count, 5); i++) {
    const t = await buttons.nth(i).textContent().catch(() => '')
    if (t.trim()) texts.push(t.trim().slice(0, 50))
  }
  return { buttonCount: count, samples: texts }
})

await test('editor_read — 读取所有 tab 文本', async () => {
  const tabs = page.locator('[role="tab"], .tab, [class*="tab"]')
  const count = await tabs.count()
  const texts = []
  for (let i = 0; i < Math.min(count, 10); i++) {
    const t = await tabs.nth(i).textContent().catch(() => '')
    if (t.trim()) texts.push(t.trim().slice(0, 30))
  }
  return { tabCount: count, texts }
})

await test('editor_emit — 通过 CDP 调用 editor.getState', async () => {
  const result = await page.evaluate(() => {
    const w = window
    const ai = w.__ai
    if (!ai || typeof ai.emit !== 'function') throw new Error('window.__ai 未就绪')
    return ai.emit('editor.getState', {})
  })
  return { handled: result?.handled, hasResult: result?.results?.length > 0 }
})

// ═══ Part 3: 清理 ═══
console.log('\n📋 Part 3: 清理\n')

await test('断开 CDP 连接', async () => {
  if (browser) await browser.close()
  return { disconnected: true }
})

// ═══ 结果汇总 ═══
console.log('\n' + '='.repeat(60))
console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 项\n`)
if (failed > 0) process.exit(1)
