import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 独立本地配置：防止 vitest 向上拾取 DemoStudio 根部 vite.config（electron-renderer 插件会劫持 node:fs）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // Playwright e2e spec（tests/e2e/）由 playwright.config 单独跑，vitest 收集会报 test.describe 误用
    exclude: ['tests/e2e/**'],
    environment: 'jsdom',
    globals: false,
    css: false,
  },
})
