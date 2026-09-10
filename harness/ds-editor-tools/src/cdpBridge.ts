/**
 * CDP Bridge — 自动发现并连接运行中的 DemoStudio 编辑器实例
 *
 * 端口发现策略（三级）：
 *  1. 直连默认端口 9222（最快路径，正常启动都走这里）
 *  2. 读取 Electron userData/DevToolsActivePort 文件获取实际端口
 *     （9222 被幽灵 socket 占用时 Electron 降级为随机端口，写入此文件）
 *  3. 扫描 9222-9232 范围内的活跃 CDP 端口（兜底）
 *
 * 生命周期：
 *  - 懒连接：首次工具调用时才建立连接
 *  - 自动重连：连接断开时下次调用自动重建
 *  - 共享连接：所有工具共享同一个 Page 引用
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const DEFAULT_PORT = 9222
const PORT_SCAN_RANGE = 10  // 9222-9232
const CONNECT_TIMEOUT_MS = 10_000

let _browser: Browser | null = null
let _context: BrowserContext | null = null
let _page: Page | null = null
let _connecting: Promise<Page> | null = null

/** 获取编辑器 Page（懒连接，自动重连） */
export async function getEditorPage(): Promise<Page> {
  // 已有连接且未关闭
  if (_page && !_page.isClosed()) return _page

  // 正在连接中，等待完成
  if (_connecting) return _connecting

  _connecting = connectCDP()
  try {
    _page = await _connecting
    return _page
  } finally {
    _connecting = null
  }
}

/** 自动发现 CDP 端口 */
async function discoverCdpPort(): Promise<number> {
  // 策略1：直连默认端口
  if (await isCdpPortOpen(DEFAULT_PORT)) {
    console.log('[cdpBridge] 发现 CDP 端口:', DEFAULT_PORT)
    return DEFAULT_PORT
  }

  // 策略2：读取 DevToolsActivePort 文件
  const filePort = readDevToolsActivePort()
  if (filePort && filePort !== DEFAULT_PORT && await isCdpPortOpen(filePort)) {
    console.log('[cdpBridge] 从 DevToolsActivePort 发现实际端口:', filePort)
    return filePort
  }

  // 策略3：扫描常用端口范围
  for (let port = DEFAULT_PORT + 1; port < DEFAULT_PORT + PORT_SCAN_RANGE; port++) {
    if (await isCdpPortOpen(port)) {
      console.log('[cdpBridge] 扫描发现 CDP 端口:', port)
      return port
    }
  }

  throw new Error(
    `无法发现编辑器 CDP 端口。请确认编辑器已启动且带有 --remote-debugging-port 参数。` +
    `（已尝试: ${DEFAULT_PORT}、DevToolsActivePort 文件、${DEFAULT_PORT + 1}-${DEFAULT_PORT + PORT_SCAN_RANGE - 1} 端口扫描）`
  )
}

/** 快速检测端口是否有 CDP 服务响应（TCP 连接 + HTTP /json/version 探测） */
async function isCdpPortOpen(port: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    })
    clearTimeout(timer)
    return resp.ok
  } catch {
    return false
  }
}

/** 读取 Electron userData 目录下的 DevToolsActivePort 文件 */
function readDevToolsActivePort(): number | null {
  try {
    // Electron userData 路径：Windows = %APPDATA%/{appName}/
    // app.name 在主进程里是 "DemoStudio"，这里硬编码保持一致
    const appData = process.env.APPDATA
    if (!appData) return null

    const portFile = join(appData, 'DemoStudio', 'DevToolsActivePort')
    if (!existsSync(portFile)) return null

    const content = readFileSync(portFile, 'utf-8').trim()
    // 文件第一行是端口号，第二行是 WebSocket URL
    const firstLine = content.split('\n')[0]?.trim()
    const port = Number(firstLine)
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      return port
    }
    return null
  } catch {
    return null
  }
}

async function connectCDP(): Promise<Page> {
  // 清理旧连接
  await disconnect()

  const port = await discoverCdpPort()
  const cdpUrl = `http://127.0.0.1:${port}`

  try {
    _browser = await chromium.connectOverCDP(cdpUrl, { timeout: CONNECT_TIMEOUT_MS })
    const contexts = _browser.contexts()
    if (contexts.length === 0) {
      throw new Error('CDP 连接成功但没有 BrowserContext（编辑器可能未启动）')
    }
    _context = contexts[0]
    const pages = _context.pages()
    if (pages.length === 0) {
      throw new Error('CDP 连接成功但没有打开的页面')
    }
    // 过滤出编辑器主窗口（排除 devtools:// 等非应用页面）
    const editorPage = pages.find(p => {
      const url = p.url()
      return url && !url.startsWith('devtools://') && !url.startsWith('chrome://')
    })
    if (!editorPage) {
      throw new Error(`CDP 连接成功但未找到编辑器页面（${pages.length} 个页面均为 devtools/chrome 源）`)
    }
    // 等待页面 DOM 就绪
    await editorPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    console.log('[cdpBridge] 已连接到编辑器 CDP:', editorPage.url())
    return editorPage
  } catch (err) {
    await disconnect()
    throw new Error(`连接编辑器 CDP 失败（${cdpUrl}）: ${err}`)
  }
}

/** 断开连接并清理资源 */
export async function disconnect(): Promise<void> {
  _page = null
  _context = null
  if (_browser) {
    try { await _browser.close() } catch { /* ignore */ }
    _browser = null
  }
}

/** 检查连接是否存活 */
export function isConnected(): boolean {
  return _page !== null && !_page.isClosed()
}

/**
 * 定位元素的通用策略（按优先级尝试）
 *
 * @param selector - 可以是：
 *   - CSS 选择器: "button.toolbar-launch"
 *   - 文本选择器: "text=启动游戏"
 *   - 角色选择器: "role=button[name='启动']"
 *   - data-testid: "[data-testid='launch-btn']"
 *   - XPath: "//button[contains(text(),'启动')]"
 */
export function resolveSelector(page: Page, selector: string) {
  // Playwright 原生支持所有上述选择器格式
  return page.locator(selector)
}
