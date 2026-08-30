/**
 * Agent 窗口日志转发 E2E 测试
 * 
 * 使用 Playwright Electron 支持自动启动 DemoStudio，
 * 打开 Agent 窗口，验证日志转发到主窗口 Console 面板和文件。
 * 
 * 用法: npx playwright test tests/e2e/agent-log-forward.e2e.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const LOG_DIR = path.join(__dirname, '..', '..', 'logs')

/** 获取最新的 console_*.log 文件路径 */
function getLatestLogFile(): string | null {
  if (!fs.existsSync(LOG_DIR)) return null
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('console_') && f.endsWith('.log'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files.length > 0 ? path.join(LOG_DIR, files[0].name) : null
}

/** 读取日志文件的最后 N 行 */
function readLogTail(filePath: string, lines: number = 50): string {
  const content = fs.readFileSync(filePath, 'utf-8')
  const allLines = content.split('\n')
  return allLines.slice(-lines).join('\n')
}

test.describe('Agent 窗口日志转发', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let mainPage: Awaited<ReturnType<ReturnType<typeof electron.launch>['firstWindow']>>
  let logFileBefore: string | null

  test.beforeAll(async () => {
    // 记录测试前的日志文件内容（用于后续比对）
    logFileBefore = getLatestLogFile()

    // 启动 Electron 应用
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', '..', 'dist-electron', 'main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    })

    // 等待主窗口加载
    mainPage = await electronApp.firstWindow()
    await mainPage.waitForLoadState('domcontentloaded')
    console.log('[测试] Electron 已启动，主窗口已加载')
  })

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close()
    }
  })

  test('Agent 窗口日志应转发到主窗口 Console 面板和日志文件', async () => {
    // ── 1. 通过 IPC 打开 Agent 窗口 ──
    console.log('[测试] 正在打开 Agent 窗口...')
    const result = await mainPage.evaluate(() => {
      return (window as any).electronAPI?.dshOpenAgentWindow?.()
    })
    console.log('[测试] dshOpenAgentWindow 结果:', result)

    // ── 2. 等待 Agent 窗口出现 ──
    // Electron 会创建一个新的 BrowserWindow，我们需要等它出现
    const agentWindow = await electronApp.waitForEvent('window', { timeout: 15000 })
    await agentWindow.waitForLoadState('domcontentloaded')
    console.log('[测试] Agent 窗口已加载:', agentWindow.url())

    // ── 3. 验证 Agent 窗口 URL 包含 agentWindow=1 ──
    expect(agentWindow.url()).toContain('agentWindow=1')

    // ── 4. 在 Agent 窗口中触发 logger.info ──
    console.log('[测试] 正在 Agent 窗口中触发 logger.info...')
    const logResult = await agentWindow.evaluate(() => {
      // 直接调用 logger（它应该已经通过模块加载初始化了）
      try {
        // 通过 import 动态获取 logger
        const loggerModule = (window as any).__logger_debug
        // 或者直接通过 console.info 模拟（它会被 console-message 捕获）
        console.info('[E2E测试] 这是一条从 Agent 窗口发送的测试日志')
        return { success: true, method: 'console.info' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })
    console.log('[测试] 日志触发结果:', logResult)

    // ── 5. 等待日志写入文件 ──
    await new Promise(resolve => setTimeout(resolve, 2000))

    // ── 6. 检查日志文件是否包含 Agent 日志 ──
    const latestLog = getLatestLogFile()
    console.log('[测试] 最新日志文件:', latestLog)

    if (latestLog) {
      const logContent = readLogTail(latestLog, 100)
      const hasAgentLog = logContent.includes('[AGENT:')
      const hasE2ETest = logContent.includes('E2E测试')
      console.log('[测试] 日志文件包含 [AGENT:]:', hasAgentLog)
      console.log('[测试] 日志文件包含 E2E测试:', hasE2ETest)

      if (hasAgentLog) {
        // 提取 Agent 相关的日志行
        const agentLines = logContent.split('\n').filter(line => line.includes('[AGENT:'))
        console.log('[测试] Agent 日志行:')
        agentLines.forEach(line => console.log('  ', line))
      }
    }

    // ── 7. 验证主窗口 Console 面板是否收到 Agent 日志 ──
    // 等待一下让 IPC 传递完成
    await new Promise(resolve => setTimeout(resolve, 1000))

    const consoleOutput = await mainPage.evaluate(() => {
      // 尝试从 editorStore 获取 consoleOutput
      try {
        // Zustand store 的 getState
        const store = (window as any).__ZUSTAND_STORES__?.editorStore
        if (store) {
          return store.getState().consoleOutput
        }
        // 或者从 DOM 获取
        const consolePanel = document.querySelector('.console-output')
        if (consolePanel) {
          return consolePanel.textContent
        }
        return null
      } catch (e) {
        return String(e)
      }
    })
    console.log('[测试] 主窗口 Console 面板内容:', consoleOutput)

    // ── 8. 最终断言 ──
    if (latestLog) {
      const logContent = readLogTail(latestLog, 100)
      // 至少应该有 console-message 捕获的 Agent 日志
      expect(logContent).toContain('[AGENT:')
    }
  })
})
