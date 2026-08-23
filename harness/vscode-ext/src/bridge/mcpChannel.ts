/**
 * MCP 通道：调起 `editor/mcp-server.mjs` 作为子进程，通过 stdio 与 MCP 服务器通信。
 *
 * 设计要点：
 * - MCP 客户端（@modelcontextprotocol/sdk）按需连接；HTTP 不可达时不连
 * - 通道不可用时 throw，调用方由 EngineBridge 切 HTTP 兜底
 * - 子进程生命周期跟随 EngineBridge.start/stop
 */
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import * as path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface MCPChannelOptions {
  /** 编辑器 HTTP 端口（被 mcp-server.mjs --port 接收） */
  editorPort: number
  /** workspace 根目录（mcp-server.mjs 通过 cwd 启动） */
  workspaceRoot: string
  /** mcp-server.mjs 相对路径，默认 `${workspaceRoot}/editor/mcp-server.mjs` */
  scriptPath?: string
}

export class MCPChannel {
  private proc: ChildProcessWithoutNullStreams | null = null
  private client: Client | null = null
  private connected = false
  private readonly outputChannel: { appendLine: (s: string) => void }

  constructor(private readonly options: MCPChannelOptions, outputChannel: { appendLine: (s: string) => void }) {
    this.outputChannel = outputChannel
  }

  async start(): Promise<void> {
    const scriptPath = this.options.scriptPath ?? path.join(this.options.workspaceRoot, 'editor', 'mcp-server.mjs')
    this.proc = spawn(process.execPath, [scriptPath, '--port', String(this.options.editorPort)], {
      cwd: this.options.workspaceRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc.on('exit', (code) => {
      this.connected = false
      if (code !== 0 && code !== null) {
        this.outputChannel.appendLine(`[bridge/mcp] 子进程退出 code=${code}`)
      }
    })
    this.proc.stderr?.on('data', (buf: Buffer) => {
      this.outputChannel.appendLine(`[bridge/mcp] ${buf.toString().trim()}`)
    })

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [scriptPath, '--port', String(this.options.editorPort)],
    })
    this.client = new Client({ name: 'demostudio-harness', version: '0.1.0' }, { capabilities: {} })
    await this.client.connect(transport)
    this.connected = true
    this.outputChannel.appendLine(`[bridge/mcp] connected to editor :${this.options.editorPort}`)
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.close() } catch { /* ignore */ }
      this.client = null
    }
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  /** 通过 MCP 调起工具（已注册的 MCP 工具名见 editor/mcp-server.mjs）。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this.connected) {
      throw new Error('MCP 通道未连接')
    }
    const result = await this.client.callTool({ name, arguments: args })
    // MCP 返回 content: Array<{type:'text', text:string}>，还原 JSON
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content
    if (!content || content.length === 0) return result
    const text = content.find((c) => c.type === 'text')?.text
    if (!text) return result
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
}
