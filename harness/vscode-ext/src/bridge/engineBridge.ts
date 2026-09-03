/**
 * EngineBridge：扩展层唯一接触引擎的入口（架构红线）。
 *
 * 双通道策略：
 * 1. MCP 通道（首选）：spawn `editor/mcp-server.mjs` → stdio MCP client → 完整工具集
 * 2. HTTP 通道（兜底）：直接 fetch `/api/command` 等端点（用于 MCP 尚未启动或断线）
 *
 * 端口探测：从 `9877` 起递增（与编辑器 `findFreePort` 对齐）
 * 自动拉起：编辑器未运行时按 `dsh.engineCommand`（默认 `npm run dev`）拉起
 * 状态机：未启动 → 启动中 → 已连接 → 已断线（自动重连 + 降级）
 */
import * as vscode from 'vscode'
import { ChildProcess, spawn } from 'node:child_process'
import { MCPChannel } from './mcpChannel'
import { SSEClient, SSEEvent } from './sseClient'

const PORT_START = 9877
const PORT_MAX = 9927
const STATUS_TIMEOUT = 1500

export type BridgeState =
  | 'idle'
  | 'probing'
  | 'starting'
  | 'connected'
  | 'disconnected'
  | 'fallback-polling'

export class EngineBridge implements vscode.Disposable {
  private state: BridgeState = 'idle'
  private port: number | null = null
  private mcp: MCPChannel | null = null
  private editorProc: ChildProcess | null = null
  private sse: SSEClient | null = null
  private statusListeners: Set<(s: BridgeState) => void> = new Set()
  private eventListeners: Set<(e: SSEEvent) => void> = new Set()

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  // ─── 生命周期 ────────────────────────────────────────

  /** 主动启动/连接：探测 → 自动拉起（必要时） → MCP 客户端连接。 */
  async start(workspaceRoot: string): Promise<void> {
    this.setState('probing')
    const port = await this.probePort()
    if (port === null) {
      // 未发现运行中的实例，按配置决定是否拉起
      const cfg = vscode.workspace.getConfiguration('dsh')
      const autoStart = cfg.get<boolean>('autoStartEngine', true)
      if (!autoStart) {
        this.setState('idle')
        this.outputChannel.appendLine('[bridge] 编辑器未运行且 autoStartEngine=false；保持 idle')
        return
      }
      this.setState('starting')
      const cmd = cfg.get<string>('engineCommand', 'npm run dev')
      this.outputChannel.appendLine(`[bridge] 自动拉起: ${cmd}`)
      this.editorProc = await this.spawnEngine(cmd, workspaceRoot)
      // 等待端口就绪
      const port2 = await this.waitForEngine(workspaceRoot, 60000)
      if (port2 === null) {
        this.setState('idle')
        vscode.window.showErrorMessage('DemoStudio 编辑器启动超时；请检查终端输出')
        return
      }
      this.port = port2
    } else {
      this.port = port
    }

    // 启动 MCP 通道
    this.mcp = new MCPChannel(
      { editorPort: this.port, workspaceRoot },
      this.outputChannel,
    )
    try {
      await this.mcp.start()
    } catch (err) {
      this.outputChannel.appendLine(`[bridge] MCP 启动失败: ${err}；后续用 HTTP 兜底`)
    }

    // 启动 SSE 订阅
    this.sse = new SSEClient({ editorPort: this.port, outputChannel: this.outputChannel })
    this.sse.on('event', (e) => this.emitEvent(e))
    this.sse.start()

    this.setState('connected')
  }

  async stop(): Promise<void> {
    this.sse?.stop()
    this.sse = null
    await this.mcp?.stop()
    this.mcp = null
    if (this.editorProc) {
      try { this.editorProc.kill() } catch { /* ignore */ }
      this.editorProc = null
    }
    this.port = null
    this.setState('idle')
  }

  dispose(): void {
    this.stop().catch(() => { /* ignore */ })
  }

  // ─── 状态与事件订阅 ────────────────────────────────────────

  onState(cb: (s: BridgeState) => void): vscode.Disposable {
    this.statusListeners.add(cb)
    cb(this.state)
    return { dispose: () => this.statusListeners.delete(cb) }
  }

  onEvent(cb: (e: SSEEvent) => void): vscode.Disposable {
    this.eventListeners.add(cb)
    return { dispose: () => this.eventListeners.delete(cb) }
  }

  // ─── 工具调用（双通道首选 MCP + HTTP 兜底） ──────────────

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (this.state !== 'connected') {
      return { ok: false, error: '引擎不可达（state=' + this.state + '）' }
    }
    // MCP 通道
    if (this.mcp?.isConnected()) {
      try {
        const result = await this.mcp.callTool(name, args)
        return result
      } catch (err) {
        this.outputChannel.appendLine(`[bridge] MCP 失败: ${err}，切 HTTP 兜底`)
      }
    }
    // HTTP 通道
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: name, params: args }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      return json
    } catch (err) {
      return { ok: false, error: `HTTP 兜底也失败: ${err}` }
    }
  }

  /** 读最近控制台日志（HTTP 直调，最常用）。 */
  async readConsoleLogs(): Promise<string[]> {
    if (!this.port) return []
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/api/console-logs`)
      const json = (await resp.json()) as { logs?: string[] }
      return json.logs ?? []
    } catch {
      return []
    }
  }

  /** 编辑器状态查询（HTTP 直调）。 */
  async getStatus(): Promise<{ running: boolean; gameRunning: boolean } | null> {
    if (!this.port) return null
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/api/status`)
      return await resp.json() as any
    } catch {
      return null
    }
  }

  // ─── 内部方法 ────────────────────────────────────────

  private async probePort(): Promise<number | null> {
    for (let p = PORT_START; p <= PORT_MAX; p++) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT)
        const resp = await fetch(`http://127.0.0.1:${p}/api/status`, { signal: controller.signal })
        clearTimeout(timer)
        if (resp.ok) return p
      } catch {
        // 继续下一个
      }
    }
    return null
  }

  private async waitForEngine(workspaceRoot: string, timeoutMs: number): Promise<number | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const port = await this.probePort()
      if (port !== null) return port
      await new Promise((r) => setTimeout(r, 1000))
    }
    return null
  }

  private spawnEngine(cmd: string, cwd: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      // Windows: cmd /c "..." 包裹命令解析 & 重定向
      const proc = spawn(cmd, { cwd, shell: true, stdio: 'pipe' })
      proc.on('error', (err) => reject(err))
      proc.stderr?.on('data', (b: Buffer) => this.outputChannel.append(`[bridge/spawn] ${b}`))
      proc.stdout?.on('data', (b: Buffer) => this.outputChannel.append(`[bridge/spawn] ${b}`))
      resolve(proc)
    })
  }

  private setState(s: BridgeState): void {
    if (this.state === s) return
    this.state = s
    this.outputChannel.appendLine(`[bridge] state -> ${s}`)
    for (const cb of this.statusListeners) {
      try { cb(s) } catch (err) { console.error('[bridge] state listener error', err) }
    }
  }

  private emitEvent(e: SSEEvent): void {
    for (const cb of this.eventListeners) {
      try { cb(e) } catch (err) { console.error('[bridge] event listener error', err) }
    }
  }
}
