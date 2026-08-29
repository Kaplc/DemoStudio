/**
 * DSH Chat Plugin - WebSocket 实时流聊天插件
 * 
 * 功能：
 * 1. 启动 WebSocket 服务（端口 9878）
 * 2. 接收 Agent 面板的聊天请求
 * 3. 转发到 DSH 内核处理
 * 4. 流式返回响应
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'

const WS_PORT = 9878

interface ChatMessage {
  type: 'chat' | 'ping' | 'pong'
  id?: string
  content?: string
  history?: Array<{ role: string; content: string }>
}

interface ChatResponse {
  type: 'response' | 'error' | 'stream' | 'done' | 'pong'
  id?: string
  content?: string
  error?: string
}

export const name = '@demostudio/dsh-chat-plugin'

interface DSHContext {
  tools?: { register(tool: unknown): void }
  effect?(fn: (ctx: DSHContext) => void): void
  // DSH 会话 API
  session?: {
    run(prompt: string, options?: any): Promise<any>
  }
  // DSH 事件系统
  on?(event: string, handler: (...args: any[]) => void): void
}

class ChatServer {
  private wss: WebSocketServer | null = null
  private httpServer: any = null
  private clients: Set<WebSocket> = new Set()
  private ctx: DSHContext | null = null

  async start(ctx: DSHContext) {
    this.ctx = ctx
    
    // 创建 HTTP 服务器
    this.httpServer = createServer((req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // 健康检查
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'dsh-chat-plugin' }))
        return
      }

      res.writeHead(404)
      res.end('Not Found')
    })

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ server: this.httpServer })

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[DSH-Chat] 新的 WebSocket 连接')
      this.clients.add(ws)

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as ChatMessage
          this.handleMessage(ws, msg)
        } catch (err) {
          console.error('[DSH-Chat] 解析消息失败:', err)
          this.sendError(ws, '消息格式错误')
        }
      })

      ws.on('close', () => {
        console.log('[DSH-Chat] WebSocket 连接关闭')
        this.clients.delete(ws)
      })

      ws.on('error', (err: Error) => {
        console.error('[DSH-Chat] WebSocket 错误:', err)
        this.clients.delete(ws)
      })

      // 发送欢迎消息
      this.sendMessage(ws, {
        type: 'response',
        content: 'DSH Chat 插件已连接'
      })
    })

    // 启动服务器
    return new Promise<void>((resolve) => {
      this.httpServer.listen(WS_PORT, '127.0.0.1', () => {
        console.log(`[DSH-Chat] WebSocket 服务已启动: ws://127.0.0.1:${WS_PORT}`)
        resolve()
      })
    })
  }

  private async handleMessage(ws: WebSocket, msg: ChatMessage) {
    switch (msg.type) {
      case 'ping':
        this.sendMessage(ws, { type: 'pong' })
        break

      case 'chat':
        if (!msg.content) {
          this.sendError(ws, '消息内容不能为空')
          return
        }
        await this.handleChat(ws, msg)
        break

      default:
        this.sendError(ws, `未知消息类型: ${msg.type}`)
    }
  }

  private async handleChat(ws: WebSocket, msg: ChatMessage) {
    if (!this.ctx) {
      this.sendError(ws, 'DSH 上下文未初始化')
      return
    }

    const requestId = msg.id || `req-${Date.now()}`
    console.log(`[DSH-Chat] 收到消息: ${msg.content}`)

    try {
      // 发送流式开始标记
      this.sendMessage(ws, {
        type: 'stream',
        id: requestId,
        content: ''
      })

      // 使用 DSH 会话处理消息
      if (this.ctx.session) {
        const result = await this.ctx.session.run(msg.content!, {
          onNotification: (notification: any) => {
            // 流式推送通知
            if (notification.type === 'message.delta') {
              this.sendMessage(ws, {
                type: 'stream',
                id: requestId,
                content: notification.payload?.content || ''
              })
            }
          }
        })

        // 发送最终响应
        this.sendMessage(ws, {
          type: 'response',
          id: requestId,
          content: result.finalResponse || result.content || '处理完成'
        })
      } else {
        // 如果没有 session API，返回提示
        this.sendMessage(ws, {
          type: 'response',
          id: requestId,
          content: 'DSH 会话 API 不可用，请检查插件配置'
        })
      }

      // 发送完成标记
      this.sendMessage(ws, {
        type: 'done',
        id: requestId
      })

    } catch (err: any) {
      console.error(`[DSH-Chat] 处理消息失败:`, err)
      this.sendError(ws, err.message || '处理消息失败', requestId)
    }
  }

  private sendMessage(ws: WebSocket, msg: ChatResponse) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  private sendError(ws: WebSocket, error: string, id?: string) {
    this.sendMessage(ws, {
      type: 'error',
      id,
      error
    })
  }

  async stop() {
    // 关闭所有连接
    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()

    // 关闭服务器
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }
}

const chatServer = new ChatServer()

/**
 * DSH 插件入口
 */
export function apply(ctx: DSHContext): void {
  console.log('[DSH-Chat] 插件初始化中...')

  // 注册聊天工具
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    ctx.tools.register({
      name: 'chat',
      description: '发送聊天消息到 AI助手',
      parameters: {
        message: {
          type: 'string',
          description: '聊天消息内容',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string' },
          },
        },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(params: { message: string }) {
        return {
          content: `收到消息: ${params.message}`
        }
      }
    })
  }

  // 启动 WebSocket 服务
  chatServer.start(ctx).then(() => {
    console.log('[DSH-Chat] 插件已就绪')
  }).catch((err) => {
    console.error('[DSH-Chat] 插件启动失败:', err)
  })

  // 注册清理函数
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      return () => {
        chatServer.stop()
      }
    })
  }
}

export { ChatServer }
