/**
 * e2e/framework/console — 页面控制台收集器
 *
 * 自 boot 起收集 renderer console 与未捕获异常（环形缓冲，防长局刷爆内存）。
 * 用例失败时由 GameSession 落盘并 attach 进报告——这是"日志自愈"的证据来源：
 * 失败报告自动携带游戏运行时的日志窗口，不用人肉翻 devtools。
 */
import type { Page } from '@playwright/test'

const MAX_LINES = 800
const MAX_LINE_CHARS = 2000

export class ConsoleCollector {
  private lines: string[] = []
  private attached = false

  /** 挂到页面上（boot 前调用，确保早期日志不丢） */
  attach(page: Page): void {
    if (this.attached) return
    this.attached = true

    page.on('console', (msg) => {
      this.push(`[console.${msg.type()}] ${msg.text()}`)
    })
    page.on('pageerror', (err) => {
      this.push(`[pageerror] ${err.message}${err.stack ? `\n${err.stack}` : ''}`)
    })
    page.on('crash', () => {
      this.push('[page-crash] 页面进程崩溃')
    })
  }

  /** 框架自身的过程标记（boot 各阶段等），与页面日志混排成一条时间线 */
  mark(text: string): void {
    this.push(`[e2e] ${text}`)
  }

  private push(line: string): void {
    const ts = new Date().toISOString().slice(11, 23)
    const clipped = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line
    this.lines.push(`${ts} ${clipped}`)
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES)
    }
  }

  dump(): string {
    return this.lines.join('\n')
  }
}
