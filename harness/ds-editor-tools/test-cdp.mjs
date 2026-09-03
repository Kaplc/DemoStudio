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

// ═══ Part 1: editor.* AI 事件（已于 2026-09-03 移除，验证 unhandled） ═══
console.log('\n📋 Part 1: editor.* AI 事件（已移除）\n')

await test('editor.* — 已移除（emit 返回 handled=false）', async () => {
  const r = await mcpEmit('editor.getState')
  if (r.handled !== false) throw new Error('editor.getState 应未被处理')
  return { handled: r.handled }
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

await test('editor_emit — 通过 CDP 调用 ai.getState', async () => {
  const result = await page.evaluate(() => {
    const w = window
    const ai = w.__ai
    if (!ai || typeof ai.emit !== 'function') throw new Error('window.__ai 未就绪')
    return ai.emit('ai.getState', {})
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
