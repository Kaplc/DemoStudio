/**
 * 内核管理器：包装 KernelAdapter，处理启动/停止/健康检查/自动重启 + 崩溃日志。
 *
 * 自动重启策略：
 * - 监听 Adapter 抛出的 'error' / 'closed' 事件
 * - 同一崩溃连续 3 次后停止重启，避免死循环
 * - 崩溃记录写入 OutputChannel（含错误消息 + 时间戳）
 * - 重启间隔指数退避（1s → 2s → 4s，最长 8s）
 *
 * M2：默认使用 EmbeddedKernelAdapter；用户配置 `dsh.kernelAdapter` 可切换
 */
import * as path from 'node:path'
import { KernelAdapter, KernelOptions, KernelEvent, Listener } from './adapter'
import { EmbeddedKernelAdapter } from './embeddedAdapter'

const MAX_RESTART = 3
const RESTART_BASE_MS = 1000
const RESTART_MAX_MS = 8000

export interface KernelManagerState {
  running: boolean
  mode: 'embedded' | 'stub'
  restartCount: number
  lastError?: string
  lastStartAt?: number
}

export class KernelManager {
  private adapter: KernelAdapter | null = null
  private state: KernelManagerState = { running: false, mode: 'stub', restartCount: 0 }
  private restarting = false

  constructor(private readonly outputChannel: { appendLine: (s: string) => void }) {}

  async start(workspaceRoot: string): Promise<void> {
    if (this.state.running) return
    // 选择 adapter：默认 Embedded，自动 fallback 到 Stub
    let adapter: KernelAdapter
    try {
      const embedded = new EmbeddedKernelAdapter(this.outputChannel)
      const options = this.resolveRuntimeLaunch(workspaceRoot)
      await embedded.start(options)
      adapter = embedded
      this.state.mode = 'embedded'
    } catch (err) {
      this.outputChannel.appendLine(`[kernel] Embedded 启动失败: ${err}，回退到 StubAdapter`)
      this.state.lastError = String(err)
      const { StubKernelAdapter } = await import('./stubAdapter')
      const stub = new StubKernelAdapter()
      await stub.start({ workspaceRoot })
      adapter = stub
      this.state.mode = 'stub'
    }
    this.adapter = adapter
    this.state.running = true
    this.state.lastStartAt = Date.now()
    this.outputChannel.appendLine(`[kernel] started in mode=${this.state.mode}`)
    this.bindAutoRestart()
  }

  async stop(): Promise<void> {
    if (!this.state.running || !this.adapter) return
    try { await this.adapter.stop() } catch (e) { console.error('[kernel] stop error', e) }
    this.state.running = false
    this.adapter = null
    this.outputChannel.appendLine('[kernel] stopped')
  }

  getAdapter(): KernelAdapter | null {
    return this.adapter
  }

  getState(): KernelManagerState {
    return { ...this.state }
  }

  // ─── 内部 ───

  private bindAutoRestart(): void {
    if (!this.adapter) return
    const events: KernelEvent['type'][] = ['error', 'closed']
    for (const evt of events) {
      this.adapter.on(evt, (e) => {
        if (e.type !== 'error') return
        this.scheduleRestart(e.payload as { message?: string })
      })
    }
  }

  private async scheduleRestart(errorPayload: { message?: string }): Promise<void> {
    if (this.restarting) return
    if (this.state.restartCount >= MAX_RESTART) {
      this.outputChannel.appendLine(`[kernel] 已达最大重启次数 ${MAX_RESTART}，停止重启。错误: ${errorPayload?.message ?? '?'}`)
      this.state.lastError = errorPayload?.message
      return
    }
    this.restarting = true
    const attempt = this.state.restartCount + 1
    const delay = Math.min(RESTART_MAX_MS, RESTART_BASE_MS * Math.pow(2, this.state.restartCount))
    this.outputChannel.appendLine(`[kernel] 崩溃 (${errorPayload?.message ?? '?'})，${delay}ms 后第 ${attempt} 次重启`)
    this.state.lastError = errorPayload?.message
    await new Promise((r) => setTimeout(r, delay))
    try {
      await this.stop()
      const root = process.cwd()
      await this.start(root)
      this.state.restartCount = attempt
      this.state.lastError = undefined
      this.outputChannel.appendLine(`[kernel] 重启成功 (attempt=${attempt})`)
    } catch (err) {
      this.state.restartCount = attempt
      this.outputChannel.appendLine(`[kernel] 重启失败: ${err}`)
    } finally {
      this.restarting = false
    }
  }

  /**
   * 解析 DSH runtime 启动命令。
   *
   * 优先级：
   * 1. 显式 `DSH_RUNTIME_BIN` 环境变量（dsh-source/lib/bin.js 路径）
   * 2. 默认 `${workspaceRoot}/harness/dsh-source/lib/bin.js`（如 vsce 内置 dsh-source，符号链接或拷贝）
   * 3. 全局 `dsh`（本地 `npm i -g @deepseek-ai/dsh`）
   */
  private resolveRuntimeLaunch(workspaceRoot: string): KernelOptions & { runtimeLaunch: { command: string; args: string[]; cwd?: string } } {
    const envBin = process.env.DSH_RUNTIME_BIN
    if (envBin) {
      return {
        workspaceRoot,
        runtimeLaunch: { command: process.execPath, args: [envBin, 'cordis.yml'] },
      }
    }
    // DSH CLI 入口在 apps/cli/lib/bin.js（构建产物）
    const bundledBin = path.join(workspaceRoot, 'harness', 'dsh-source', 'apps', 'cli', 'lib', 'bin.js')
    return {
      workspaceRoot,
      runtimeLaunch: { command: process.execPath, args: [bundledBin], cwd: workspaceRoot },
    }
  }
}
