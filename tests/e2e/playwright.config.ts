/**
 * Playwright E2E 配置 — AI 端到端测试入口
 *
 * 用法：
 *   npx playwright test            # 跑全部用例（自动启动 vite dev server）
 *   npx playwright test fish       # 只跑 fish 用例
 *   npx playwright show-report     # 查看 HTML 报告
 *
 * 环境约定（见 doc/playwright_testing.md）：
 *   - 复用/自启 vite dev server（localhost:5173），Electron 窗口弹出属正常现象
 *   - 页面交互一律用 dispatchEvent（hidden 页面下 Playwright click() 会超时）
 *   - 游戏内交互/断言走 window.__ai 事件桥（不依赖渲染循环）
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  // AI 测试场景：串行、单 worker，避免并发 server/游戏实例互相干扰
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    viewport: { width: 1280, height: 800 },
    // AI 现场证据：失败截图（AI 可用 read_image 直接看）+ trace 回放包（console/network/DOM 快照）
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // 视频 AI 无法直接消费且占空间，需要人回放时改为 'retain-on-failure'
    video: 'off',
  },
  // webServer 已禁用：dev server 由外部管理（当前运行在 5174 端口）
  // 如需自动启动，取消注释并确保端口可用：
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:5174',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
})
