/**
 * DSH Agent 会话恢复端到端测试（对应需求验收 1「刷新不断线」）
 *
 * 覆盖链路（AgentUI 已迁移至独立窗口，直接以 ?agentWindow=1 进入）：
 *   打开独立窗口形态 → 等待自动连接（新建会话）
 *   → 记录 localStorage 会话映射 {sessionId, port}
 *   → 整页刷新（模拟 Ctrl+R / HMR 全量刷新）
 *   → 断言「会话已恢复」+ sessionId 保持一致
 *
 * 环境要点（与 fish/full-flow.spec.ts 一致）：
 *   - 需要 Vite dev server（playwright.config.ts webServer 自启/复用）
 *   - **需要 DSH agent 已在 :3080 运行**（正常开发流程中由 Electron main 拉起；
 *     浏览器模式下没有 main 进程，用例探测不到时自动跳过）
 *   - 浏览器模式 RPC 走 Vite 代理（vite.config.ts /api → http://127.0.0.1:3080）
 */
import { test, expect } from '../fixtures'

// ────────────────────────────────────────────────
//  辅助
// ────────────────────────────────────────────────

/** 读取 renderer 持久化的会话映射 */
async function readSavedSession(page: import('@playwright/test').Page): Promise<{ sessionId?: string; port?: number } | null> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('demostudio.dsh.session')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
}

/** DSH agent 是否可达（不可达则整套用例跳过） */
async function isDshAlive(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/api/session.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-probe', method: 'session.list', payload: {} }),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ────────────────────────────────────────────────
//  用例
// ────────────────────────────────────────────────

test.describe('DSH Agent 会话恢复', () => {
  test.beforeEach(async ({ }, testInfo) => {
    // 浏览器模式下无 Electron main 拉 agent；:3080 不在线则跳过（Electron 场景下始终在线）
    if (!(await isDshAlive(testInfo.project.use.baseURL ?? 'http://localhost:5173'))) {
      testInfo.skip(true, 'DSH agent 未在 :3080 运行（请先启动一次编辑器让 main 引导 agent）')
    }
  })

  test('独立窗口形态：整页刷新后会话无感接续（sessionId 保持 + 「会话已恢复」提示）', async ({ page }) => {
    // ── 1. 以独立窗口形态进入（AgentUI 全屏，无需打开工程） ──
    await page.goto('/?agentWindow=1')

    // ── 2. 等待自动连接完成（新建会话路径）──
    await expect(
      page.getByText('已连接到 DSH Agent', { exact: true }),
    ).toBeVisible({ timeout: 70_000 }) // claiming(等 agent 引导 ≤60s) + 新建

    // ── 3. 记录连接建立后的会话映射 ──
    const before = await readSavedSession(page)
    expect(before?.sessionId, '连接成功后应持久化 {sessionId, port} 映射').toBeTruthy()

    // ── 4. 整页刷新（模拟 Ctrl+R / HMR 全量刷新） ──
    await page.reload()

    // ── 5. 断言恢复体验：顶部小字提示「会话已恢复」──
    await expect(page.getByText('会话已恢复', { exact: true })).toBeVisible({ timeout: 30_000 })

    // ── 6. 断言映射保持：refresh 后 attach 回同一 DSH session ──
    const after = await readSavedSession(page)
    expect(after?.sessionId).toBe(before!.sessionId)

    // ── 7. 面板可用性：输入框应回到可发送状态（指示 connected 态） ──
    await expect(page.locator('.composer__input')).toBeEnabled({ timeout: 15_000 })
  })
})
