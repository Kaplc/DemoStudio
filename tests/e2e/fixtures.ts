/**
 * 测试 fixture — 浏览器现场证据自动收集
 *
 * 目的：让 AI 在测试失败时能"完整获取"浏览器环境现场：
 *   - browser-console.log  全部 console 输出（游戏 logger 走 console，失败根因常在此）
 *   - page-errors.log      未捕获的 JS 异常（pageerror）
 *   - page-dom.txt         页面 DOM 文本快照（hidden 页面下 UI 树/大纲都在 DOM 里）
 * 加上 playwright.config.ts 的失败截图 + trace，构成完整证据链。
 *
 * 用法：spec 文件从本模块 import { test, expect }（代替 '@playwright/test'）。
 */
import { test as base } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleMsgs: string[] = []
    const pageErrors: string[] = []

    page.on('console', (msg) => {
      // 只保留有诊断价值的类型，避免噪音
      if (['log', 'warning', 'error'].includes(msg.type())) {
        consoleMsgs.push(`[${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', (err) => {
      pageErrors.push(String(err?.stack ?? err))
    })

    await use(page)

    // 用例结束：失败/中断时附加现场证据（成功时零开销）
    const failed = testInfo.status !== 'passed' && testInfo.status !== 'skipped'
    if (!failed) return

    if (consoleMsgs.length > 0) {
      await testInfo.attach('browser-console.log', {
        body: consoleMsgs.slice(-500).join('\n'), // 截尾，防超大
        contentType: 'text/plain',
      }).catch(() => {})
    }
    if (pageErrors.length > 0) {
      await testInfo.attach('page-errors.log', {
        body: pageErrors.slice(-100).join('\n'),
        contentType: 'text/plain',
      }).catch(() => {})
    }
    // DOM 快照：hidden 页面下取 body 文本（对应文档"切 UI 大纲页签读 innerText"）
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (bodyText.trim()) {
      await testInfo.attach('page-dom.txt', {
        body: bodyText.slice(0, 20_000),
        contentType: 'text/plain',
      }).catch(() => {})
    }
  },
})

export { expect } from '@playwright/test'
