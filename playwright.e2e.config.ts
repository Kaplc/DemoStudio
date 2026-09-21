import { defineConfig } from '@playwright/test'

/**
 * DemoStudio E2E 回归配置
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
 * 用例分两类（按写法）：
 *   - framework 规格的新用例：import { test, expect } from '<root>/e2e/framework/fixtures'（推荐）
 *   - 既有 warm_* 用例：直接 import '@playwright/test'，继续可用，逐步迁移
 *
 * 用例分两层（按 testDir 划分，报告与 CLI --project 都按此分组，见 projects 配置）：
 *   - engine（引擎/编辑器侧 + 测试框架）：根目录 e2e/ 下的一切 spec——agent（agent 面板）、
 *     home（首页工程卡）、perf（性能分析器，借 fish boot 当宿主，断言的是引擎指标）；
 *     根 e2e/ 下新增目录自动归入本层，无需改配置
 *   - projects（游戏项目回归）：projects/<项目>/e2e/ 下的 spec——目录约定自动扫描，
 *     新项目零注册（只需在 projects/<id>/e2e/ 写 spec，描述符从 register.ts 自动解析）
 *
 * ⚠ 没有全量入口：跑测试必须指定 engine（npm run test:e2e）或具体项目
 *   （npm run test:e2e:project -- projects/<id>），项目 vs 引擎不混跑（2026-09-22 用户决策）。
 */
export default defineConfig({
  projects: [
    {
      name: 'engine',
      testDir: './e2e',
    },
    {
      name: 'projects',
      testDir: './projects',
      // 只收 projects/<项目>/e2e/ 下的 spec（gameplay 等目录里的 *.spec.ts 不收）
      testMatch: /[\\/]e2e[\\/].+\.spec\.ts$/,
    },
  ],
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
