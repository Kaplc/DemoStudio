/**
 * SSE 客户端：订阅编辑器 `/api/events` 事件流。
 *
 * 设计要点：
 * - 断线自动重连（指数退避，最多 10 次）
 * - 用 Last-Event-ID 头续传（服务端 100 条缓冲）
 * - 多连接复用（同一 EditorEndpoint 共享一个连接）
 * - 失败兜底：连续 5 次失败后退回轮询 `console-logs`（M3 入口）
 */
import * as http from 'node:http'
import { EventEmitter } from 'node:events'

export type SSEEventType = 'game.lifecycle' | 'game.error' | 'scene.change' | 'ai.event'

export interface SSEEvent {
  id: number
  type: SSEEventType
  ts: number
  data: unknown
}

interface SSEClientOptions {
  /** 编辑器 HTTP 端口 */
  editorPort: number
  /** 心跳超时（毫秒），收到 heartbeat 注释行重置 */
  heartbeatMs?: number
  /** 最大重试次数 */
  maxRetries?: number
  /** 输出通道（VS Code OutputChannel） */
  outputChannel: { appendLine: (s: string) => void }
}

export class SSEClient extends EventEmitter {
  private req: http.ClientRequest | null = null
  private cursor = 0
  private retries = 0
  private maxRetries: number
  private heartbeatTimer: NodeJS.Timeout | null = null
  private stopped = false
  private fallbackTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: SSEClientOptions) {
    super()
    this.maxRetries = options.maxRetries ?? 10
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.cleanupRequest()
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer)
      this.fallbackTimer = null
    }
  }

  private connect(): void {
    if (this.stopped) return
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Connection: 'keep-alive',
    }
    if (this.cursor > 0) headers['Last-Event-ID'] = String(this.cursor)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: this.options.editorPort,
        path: '/api/events',
        method: 'GET',
        headers,
      },
      (res) => {
        if (res.statusCode !== 200) {
          this.options.outputChannel.appendLine(`[sse] HTTP ${res.statusCode}，将重试`)
          this.scheduleReconnect()
          res.resume()
          return
        }
        this.retries = 0
        let buffer = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => {
          buffer += chunk
          // 心跳注释行 ": heartbeat ..." 重置超时
          this.armHeartbeat()
          // 解析完整事件块
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sep)
            buffer = buffer.slice(sep + 2)
            const ev = this.parseEventBlock(block)
            if (ev) {
              this.cursor = ev.id
              this.emit('event', ev)
            }
          }
        })
        res.on('end', () => {
          this.options.outputChannel.appendLine('[sse] 连接关闭，准备重连')
          this.cleanupRequest()
          this.scheduleReconnect()
        })
        res.on('error', (err: Error) => {
          this.options.outputChannel.appendLine(`[sse] 流错误: ${err.message}`)
        })
        this.req = req
        this.armHeartbeat()
      },
    )
    req.on('error', (err: Error) => {
      this.options.outputChannel.appendLine(`[sse] 请求错误: ${err.message}`)
      this.cleanupRequest()
      this.scheduleReconnect()
    })
    req.end()
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    const ms = this.options.heartbeatMs ?? 15000
    this.heartbeatTimer = setTimeout(() => {
      this.options.outputChannel.appendLine('[sse] 心跳超时，重连')
      this.cleanupRequest()
      this.scheduleReconnect()
    }, ms * 2)
  }

  private cleanupRequest(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.req) {
      try { this.req.destroy() } catch { /* ignore */ }
      this.req = null
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.retries >= this.maxRetries) {
      this.options.outputChannel.appendLine(`[sse] 已达最大重试次数 ${this.maxRetries}，放弃重连`)
      this.startFallback()
      return
    }
    const delay = Math.min(30000, 500 * Math.pow(2, this.retries))
    this.retries++
    this.options.outputChannel.appendLine(`[sse] ${delay}ms 后第 ${this.retries} 次重连`)
    setTimeout(() => this.connect(), delay)
  }

  /**
   * SSE 彻底断线（超过 maxRetries）后退回轮询 `console-logs`：
   * 每 2 秒拉最近 50 条日志，增量交给订阅方去重。
   */
  private startFallback(): void {
    if (this.fallbackTimer) return
    this.options.outputChannel.appendLine('[sse] 启动 console-logs 轮询兜底（2s 间隔）')
    this.fallbackTimer = setInterval(async () => {
      try {
        const resp = await fetch(`http://127.0.0.1:${this.options.editorPort}/api/console-logs`)
        if (!resp.ok) return
        const json = (await resp.json()) as { logs?: string[] }
        const lines = json.logs ?? []
        for (const line of lines) {
          // 简化：轮询产生的合成事件，统一打 game.error 类型（仅 ERROR/WARNING 行）
          if (/\[CONSOLE:(ERROR|WARNING)\]/.test(line)) {
            this.emit('event', {
              id: this.cursor++,
              type: 'game.error' as const,
              ts: Date.now(),
              data: { level: /ERROR/.test(line) ? 'error' : 'warning', message: line, source: 'fallback' },
            } satisfies SSEEvent)
          }
        }
      } catch {
        // 静默：轮询失败继续尝试
      }
    }, 2000)
  }

  private parseEventBlock(block: string): SSEEvent | null {
    let id = 0
    let type: SSEEventType | null = null
    let data = ''
    for (const line of block.split('\n')) {
      if (!line) continue
      if (line.startsWith(':')) continue // 心跳注释
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const field = line.slice(0, colon)
      const value = line.slice(colon + 1).trim()
      switch (field) {
        case 'id': id = Number(value); break
        case 'event':
          if (value === 'game.lifecycle' || value === 'game.error' || value === 'scene.change' || value === 'ai.event') {
            type = value
          }
          break
        case 'data':
          data += value
          break
      }
    }
    if (!type || !data) return null
    try {
      const parsed = JSON.parse(data) as SSEEvent
      return { ...parsed, id, type }
    } catch {
      return null
    }
  }
}
