/**
 * Agent 窗口日志转发验证脚本
 * 使用 Playwright Electron 支持自动化测试
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const LOG_DIR = path.join(ROOT, 'logs')

console.log('=== Agent 窗口日志转发 E2E 验证 ===')
console.log('项目根:', ROOT)

// 记录测试前最新日志文件
const beforeFiles = fs.existsSync(LOG_DIR)
  ? fs.readdirSync(LOG_DIR).filter(f => f.startsWith('console_') && f.endsWith('.log'))
  : []
const beforeLatest = beforeFiles.sort().pop()
console.log('测试前最新日志:', beforeLatest || '(无)')

let app
try {
  // ── 1. 启动 Electron ──
  console.log('\n[1] 启动 Electron...')
  app = await electron.launch({
    args: [path.join(ROOT, 'dist-electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 30000,
  })
  console.log('    Electron 已启动')

  // ── 2. 等待主窗口 ──
  console.log('\n[2] 等待主窗口...')
  const mainPage = await app.firstWindow()
  await mainPage.waitForLoadState('domcontentloaded')
  console.log('    主窗口已加载:', mainPage.url())

  // ── 3. 打开 Agent 窗口 ──
  console.log('\n[3] 打开 Agent 窗口...')
  await mainPage.evaluate(() => {
    return (window).electronAPI?.dshOpenAgentWindow?.()
  })

  // 等待新窗口出现（可能先弹出 DevTools，需要过滤）
  let agentWindow = null
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const windows = app.windows()
    for (const w of windows) {
      const u = w.url()
      if (u.includes('agentWindow=1') || u.includes('localhost:5173')) {
        agentWindow = w
        break
      }
    }
    if (agentWindow) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (!agentWindow) {
    // 回退：取所有非主窗口
    const allWindows = app.windows()
    console.log('    所有窗口:', allWindows.map(w => w.url()))
    agentWindow = allWindows.find(w => !w.url().includes('loading.html') && !w.url().includes('devtools://'))
  }
  if (!agentWindow) {
    console.error('    ❌ 找不到 Agent 窗口')
    process.exit(1)
  }
  await agentWindow.waitForLoadState('domcontentloaded')
  console.log('    Agent 窗口已加载:', agentWindow.url())

  // 验证 URL
  const url = agentWindow.url()
  if (!url.includes('agentWindow=1')) {
    console.error('    ❌ Agent 窗口 URL 不包含 agentWindow=1')
    process.exit(1)
  }
  console.log('    ✅ URL 正确')

  // ── 4. 在 Agent 窗口触发日志 ──
  console.log('\n[4] 在 Agent 窗口触发 logger.info...')
  await agentWindow.evaluate(() => {
    console.info('[E2E验证] Agent窗口日志转发测试消息')
  })
  console.log('    已发送 console.info')

  // ── 5. 等待日志写入 ──
  console.log('\n[5] 等待 3 秒让日志写入文件...')
  await new Promise(r => setTimeout(r, 3000))

  // ── 6. 检查日志文件 ──
  console.log('\n[6] 检查日志文件...')
  const afterFiles = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('console_') && f.endsWith('.log'))
  const afterLatest = afterFiles.sort().pop()
  console.log('    最新日志:', afterLatest)

  if (afterLatest) {
    const logPath = path.join(LOG_DIR, afterLatest)
    const content = fs.readFileSync(logPath, 'utf-8')
    const lines = content.split('\n')

    // 检查 [AGENT:] 条目
    const agentLines = lines.filter(l => l.includes('[AGENT:'))
    console.log(`    日志总行数: ${lines.length}, [AGENT:] 行数: ${agentLines.length}`)

    if (agentLines.length > 0) {
      console.log('    ✅ Agent 窗口日志已写入文件!')
      console.log('    最后 5 条 Agent 日志:')
      agentLines.slice(-5).forEach(l => console.log('      ', l.trim()))
    } else {
      console.log('    ⚠️  文件中没有 [AGENT:] 条目（可能 Agent 窗口的 console.info 未触发 console-message）')
    }

    // 检查 E2E 测试消息
    const e2eLines = lines.filter(l => l.includes('E2E验证'))
    if (e2eLines.length > 0) {
      console.log('    ✅ E2E 测试消息已捕获!')
      e2eLines.forEach(l => console.log('      ', l.trim()))
    }
  }

  // ── 7. 检查主窗口 Console 面板 ──
  console.log('\n[7] 检查主窗口 Console 面板...')
  const consoleText = await mainPage.evaluate(() => {
    const el = document.querySelector('.console-output')
    return el ? el.textContent : null
  })

  if (consoleText) {
    if (consoleText.includes('[Agent]') || consoleText.includes('E2E验证')) {
      console.log('    ✅ Console 面板包含 Agent 日志!')
      // 提取相关行
      const relevant = consoleText.split('\n').filter(l => l.includes('[Agent]') || l.includes('E2E'))
      relevant.forEach(l => console.log('      ', l.trim()))
    } else {
      console.log('    ⚠️  Console 面板没有 Agent 日志（IPC 转发可能未生效）')
      console.log('    Console 内容前 200 字符:', consoleText.substring(0, 200))
    }
  } else {
    console.log('    ⚠️  无法获取 Console 面板 DOM')
  }

  console.log('\n=== 验证完成 ===')

} catch (err) {
  console.error('\n❌ 测试失败:', err.message)
  console.error(err.stack)
} finally {
  if (app) {
    console.log('\n关闭 Electron...')
    await app.close()
  }
}
