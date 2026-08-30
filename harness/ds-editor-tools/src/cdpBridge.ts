/**
 * CDP Bridge — 通过 Playwright 连接到运行中的 DemoStudio 编辑器实例
 *
 * 编辑器 electron/main.ts 已启用 `--remote-debugging-port=9222`，
 * 我们用 playwright-core 的 chromium.connectOverCDP() 连接到已有实例，
 * 获取 BrowserContext → Page，然后用 Playwright API 操控 UI。
 *
 * 生命周期：
 *  - 懒连接：首次工具调用时才建立连接
 *  - 自动重连：连接断开时下次调用自动重建
 *  - 共享连接：所有工具共享同一个 Page 引用
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

const CDP_URL = 'http://127.0.0.1:9222'
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

async function connectCDP(): Promise<Page> {
  // 清理旧连接
  await disconnect()

  try {
    _browser = await chromium.connectOverCDP(CDP_URL, { timeout: CONNECT_TIMEOUT_MS })
    const contexts = _browser.contexts()
    if (contexts.length === 0) {
      throw new Error('CDP 连接成功但没有 BrowserContext（编辑器可能未启动）')
    }
    _context = contexts[0]
    const pages = _context.pages()
    if (pages.length === 0) {
      throw new Error('CDP 连接成功但没有打开的页面')
    }
    // 取第一个页面（编辑器主窗口）
    const page = pages[0]
    // 等待页面 DOM 就绪
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    console.log('[cdpBridge] 已连接到编辑器 CDP:', page.url())
    return page
  } catch (err) {
    await disconnect()
    throw new Error(`连接编辑器 CDP 失败（${CDP_URL}）: ${err}`)
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
