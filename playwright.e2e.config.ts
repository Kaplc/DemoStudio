import { defineConfig } from '@playwright/test'

/**
 * DemoStudio E2E 回归配置（testDir ./e2e）
 *
 * 前置：dev server 已在运行（npm run dev / electron:dev；默认 :5173，
 * 多实例递增到 5174+ 时用环境变量指路：E2E_BASE_URL=http://localhost:5174）
 *
 * 产物：
 *   - 终端 list 实时输出
 *   - HTML 报告  playwright-report/e2e（npx playwright show-report playwright-report/e2e）
 *   - JSON 报告  test-results/e2e-report.json（机器可读，供日志自愈/回归汇总消费）
 *   - 失败证据   test-results/e2e/<spec>/*（Playwright 截图+trace）
 *                + 框架自动 attach 的 game-console.log / game-state.json / game-hud.json / game-final.png
 *
 * 用例分两类：
 *   - framework 规格的新用例：import { test, expect } from './framework/fixtures'（推荐）
 *   - 既有 warm_* 用例：直接 import '@playwright/test'，继续可用，逐步迁移
 */
export default defineConfig({
  testDir: './e2e',
  // 游戏引导（选卡→打开工程→Launch→整页重载进游戏）单次就要 30s 量级，boot 自愈重试后更长
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/e2e' }],
    ['json', { outputFile: 'test-results/e2e-report.json' }],
  ],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1600, height: 900 },
    headless: true,
    // ⚠ 不加 --disable-background-timer-throttling 等反节流 flags（2026-09-15 实测）：
    // 关掉节流后帧密度骤变，aimAt 滑移收敛/双击链路时序全变（focus_orbit §2 双击失焦），
    // 既有 spec 全部要在新时序下重校。节流环境下的应对在 spec 内做确定性等待（见各注释）。
    // 失败现场：截图 + trace（console/network/DOM 回放包），与框架的游戏侧证据互补
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
