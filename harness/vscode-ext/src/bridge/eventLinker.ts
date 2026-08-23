/**
 * 引擎事件联动（崩溃自动诊断）。
 *
 * 订阅 EngineBridge.onEvent：
 * - game.lifecycle.crash → 注入诊断 prompt
 * - game.error (level=error) → 注入日志分析 prompt
 * - scene.change → 可选回放
 *
 * 工作机制：
 * - 构造一个"系统消息"作为 user prompt 注入 agent
 * - 由 AgentExecutor.handle 自动 route 到 LLM（DSH runtime 推理）
 * - 简化版（无 DSH 真集成）：把诊断消息直接 postMessage 到 chatView
 *
 * 设计要点：
 * - 不依赖 DSH 内部 API（架构红线 FR-4.7）
 * - 通过 EngineBridge 事件总线统一收口
 * - 可由 `dsh.enableEngineEvents` 配置开关
 */
import * as vscode from 'vscode'

interface EventLinkerOptions {
  outputChannel: { appendLine: (s: string) => void }
  bridgeEventSource: { onEvent(cb: (e: { type: string; data: unknown }) => void): vscode.Disposable }
  injectPrompt: (prompt: string) => Promise<void>
}

export class EngineEventLinker implements vscode.Disposable {
  private sub: vscode.Disposable | null = null

  constructor(private readonly options: EventLinkerOptions) {}

  start(): void {
    if (!vscode.workspace.getConfiguration('dsh').get<boolean>('enableEngineEvents', true)) {
      this.options.outputChannel.appendLine('[event-linker] 配置禁用（dsh.enableEngineEvents=false）')
      return
    }
    this.sub = this.options.bridgeEventSource.onEvent((e) => this.handle(e))
    this.options.outputChannel.appendLine('[event-linker] started')
  }

  dispose(): void {
    this.sub?.dispose()
    this.sub = null
  }

  private async handle(e: { type: string; data: unknown }): Promise<void> {
    if (e.type === 'game.lifecycle') {
      const data = e.data as { event?: string; reason?: string; exitCode?: number }
      if (data.event === 'crash') {
        await this.options.injectPrompt(
          `[自动诊断] 引擎渲染进程崩溃：reason=${data.reason ?? '?'}, exitCode=${data.exitCode ?? '?'}。请拉取最新 console-logs + get_game_state 分析根因，并给出修复建议。`,
        )
      } else if (data.event === 'launch') {
        this.options.outputChannel.appendLine('[event-linker] 游戏已启动')
      } else if (data.event === 'stop') {
        this.options.outputChannel.appendLine('[event-linker] 游戏已停止')
      }
    } else if (e.type === 'game.error') {
      // 高频错误仅记账，不每次注入
      const data = e.data as { level?: string; message?: string }
      if (data.level === 'error' && data.message && /(uncaught|TypeError|ReferenceError)/i.test(data.message)) {
        await this.options.injectPrompt(
          `[自动诊断] 检测到未捕获错误：${data.message.slice(0, 200)}。请定位修复点。`,
        )
      }
    }
  }
}
