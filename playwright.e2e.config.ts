import { defineConfig } from '@playwright/test'

/**
 * ClashMaster E2E 测试配置（独立于编辑器主 config；dev server 需已在 :5173 运行）
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1600, height: 900 },
    headless: true,
  },
})
