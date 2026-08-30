import { defineConfig } from 'vitest/config'

// 本地配置：防止 vitest 向上拾取 DemoStudio 根部的 vite.config（electron-renderer 插件会劫持 node:fs）
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
})
