/**
 * Agent 通信服务 —— 通过 Electron IPC 代理到 DSH 内核 (port 3080)
 *
 * 通信协议：DSH RPC (POST /api/<method>)
 *   1. session.list     -> 健康检查
 *   2. session.create   -> 创建会话
 *   3. session.prompt    -> 发送用户消息
 *   4. session.history   -> 轮询获取 AI 回复（assistant/chunk 事件流）
 */
import type { ConnectionState, AgentEvent } from '../types/agent'

const POLL_INTERVAL = 200   // 轮询间隔 ms（平衡延迟与性能）
const MAX_POLL_ATTEMPTS = 180 // 最多轮询次数（~144s）

// --- 内部类型 ---
interface ContentPart {
  type: 'text' | 'reasoning' | 'image'
  text?: string
}

interface DshChunk {
  type: string
  text?: string
  index?: number
  blockType?: string
}

interface DshMessage {
  role: string
  content: ContentPart[]
}

interface DshEvent {
  type: string
  seq: number
  data?: {
    chunk?: DshChunk
    message?: DshMessage
  }
}

interface RpcResponse {
  type: string
  result?: { ok?: boolean; value?: unknown; error?: { message?: string } }
}

export class AgentService {
  private state: ConnectionState = 'idle'
  private listeners: Set<(event: AgentEvent) => void> = new Set()
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()
  private sessionId: string | null = null
  private polling = false
  private abortPolling = false

  constructor(private config: { autoReconnect?: boolean } = {}) {
    this.config = { autoReconnect: true, ...this.config }
  }

  // --- DSH RPC 通用调用（通过 Electron IPC 代理，绕过 CORS）---
  private async rpc(method: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const api = window.electronAPI
    if (!api?.dshRpc) {
      // 浏览器模式回退：通过 Vite 代理（/api -> DSH :3080）
      const rpcId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const res = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: AbortSignal.timeout(15000),
      })
      const json = (await res.json()) as RpcResponse
      if (json.result?.ok === false) throw new Error(json.result.error?.message || 'RPC error')
      return json.result?.value
    }

    // Electron 模式：通过 IPC 代理
    const json = (await api.dshRpc(method, payload)) as RpcResponse
    if (json.result?.ok === false) {
      throw new Error(`DSH RPC ${method} error: ${json.result.error?.message || 'unknown'}`)
    }
    return json.result?.value
  }

  // --- 连接 ---
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return
    this.setState('connecting')

    try {
      const value = (await this.rpc('session.list')) as { items?: unknown[] }
      if (!value || !Array.isArray(value.items)) {
        throw new Error('DSH 返回格式异常')
      }

      const createValue = (await this.rpc('session.create', {
        cwd: 'e:\\DemoStudio',
      })) as { sessionId?: string }
      if (!createValue?.sessionId) throw new Error('session.create 未返回 sessionId')
      this.sessionId = createValue.sessionId
      console.log(`[AgentService] DSH 已连接，会话: ${this.sessionId}`)

      this.setState('connected')
      this.emit({ type: 'ready', payload: { sessionId: this.sessionId } })
    } catch (error) {
      this.setState('error')
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '连接 DSH 失败' },
      })
      throw error
    }
  }

  disconnect(): void {
    this.abortPolling = true
    this.sessionId = null
    this.setState('idle')
  }

  // --- 发送消息 ---
  async send(text: string): Promise<void> {
    if (this.state !== 'connected' || !this.sessionId) {
      throw new Error('未连接到 DSH')
    }

    this.abortPolling = true
    await new Promise(r => setTimeout(r, 200))
    this.abortPolling = false

    this.emit({ type: 'message', payload: { role: 'user', content: text } })

    try {
      await this.rpc('session.prompt', {
        sessionId: this.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
      await this.pollForResponse()
    } catch (error) {
      if (this.abortPolling) return
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '发送失败' },
      })
    }
  }

  // --- 轮询 session.history 获取 AI 回复 ---
  private async pollForResponse(): Promise<void> {
    if (this.polling) return
    this.polling = true

    let lastSeq = -1
    try {
      const hist = (await this.rpc('session.history', {
        sessionId: this.sessionId,
      })) as { events?: Array<{ event: { seq: number } }> }
      if (hist?.events?.length) {
        lastSeq = hist.events[hist.events.length - 1].event.seq
      }
    } catch { /* ignore */ }

    let assistantBuf = ''
    let reasoningBuf = ''
    let lastEmittedTextLen = 0
    let lastEmittedReasoningLen = 0
    let attempts = 0

    try {
      while (attempts < MAX_POLL_ATTEMPTS && !this.abortPolling) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL))
        if (this.abortPolling) break
        attempts++

        let events: Array<{ event: DshEvent }> = []
        try {
          const hist = (await this.rpc('session.history', {
            sessionId: this.sessionId,
          })) as { events?: Array<{ event: DshEvent }> }
          events = hist?.events ?? []
        } catch {
          continue
        }

        const newEvents = events.filter(e => e.event.seq > lastSeq)
        if (!newEvents.length) continue

        for (const { event } of newEvents) {
          lastSeq = event.seq

          if (event.type === 'assistant/chunk') {
            const chunk = event.data?.chunk
            if (!chunk) continue
            if (chunk.type === 'text-delta' && chunk.text) {
              assistantBuf += chunk.text
            }
            if (chunk.type === 'reasoning-delta' && chunk.text) {
              reasoningBuf += chunk.text
            }
          }

          // assistant/message 包含完整对话上下文（会重复用户输入），跳过
          // 只依赖 assistant/chunk 流式输出 + turn/end 提交最终消息
          if (event.type === 'assistant/message') {
            // 从 assistant/message 提取推理内容（如果有）
            const msg = event.data?.message
            if (msg?.role === 'assistant') {
              const reasoningPart = (msg.content || []).find((c: ContentPart) => c.type === 'reasoning')
              if (reasoningPart?.text && !reasoningBuf) {
                reasoningBuf = reasoningPart.text
              }
            }
            // 不清空 assistantBuf — 让 turn/end 统一 emit
          }

          // 工具调用开始
          if (event.type === 'tool/call') {
            const d = event.data
            this.emit({
              type: 'toolCall',
              payload: {
                id: d?.callId || `tc-${event.seq}`,
                name: d?.name || 'unknown',
                args: d?.arguments ? (() => { try { return JSON.parse(d.arguments) } catch { return d.arguments } })() : undefined,
                status: 'running',
              },
            })
          }

          // 工具调用结果
          if (event.type === 'tool/result') {
            const d = event.data
            const callId = d?.message?.source?.callId || d?.callId
            const resultContent = d?.message?.content
            let resultText = ''
            if (Array.isArray(resultContent)) {
              for (const part of resultContent) {
                if (part.content && Array.isArray(part.content)) {
                  resultText += part.content.filter((c: ContentPart) => c.type === 'text').map((c: ContentPart) => c.text).join('')
                }
              }
            }
            this.emit({
              type: 'toolResult',
              payload: {
                id: callId || `tr-${event.seq}`,
                name: 'tool',
                result: resultText || JSON.stringify(d),
                status: 'success',
              },
            })
          }

          if (event.type === 'turn/end' || event.type === 'session.idle') {
            // 收集统计
            const stats = event.data?.stats
            if (assistantBuf || reasoningBuf) {
              this.emit({
                type: 'message',
                payload: {
                  role: 'assistant',
                  content: assistantBuf,
                  reasoning: reasoningBuf || undefined,
                  stats,
                },
              })
              assistantBuf = ''
              reasoningBuf = ''
            }
            this.polling = false
            return
          }
        }

        // 批量发送本轮累积的 delta（一次 re-render 处理整个轮询周期的所有 token）
        const newTextDelta = assistantBuf.slice(lastEmittedTextLen)
        const newReasoningDelta = reasoningBuf.slice(lastEmittedReasoningLen)
        if (newTextDelta) {
          this.emit({ type: 'message.delta', payload: newTextDelta })
          lastEmittedTextLen = assistantBuf.length
        }
        if (newReasoningDelta) {
          this.emit({ type: 'reasoning.delta', payload: newReasoningDelta })
          lastEmittedReasoningLen = reasoningBuf.length
        }
      }
    } finally {
      if (assistantBuf || reasoningBuf) {
        this.emit({
          type: 'message',
          payload: { role: 'assistant', content: assistantBuf, reasoning: reasoningBuf || undefined },
        })
      }
      this.polling = false
    }
  }

  // --- 状态管理 ---
  private setState(state: ConnectionState): void {
    this.state = state
    this.stateListeners.forEach(l => l(state))
  }

  getState(): ConnectionState {
    return this.state
  }

  isConnected(): boolean {
    return this.state === 'connected'
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => l(event))
  }

  dispose(): void {
    this.disconnect()
    this.listeners.clear()
    this.stateListeners.clear()
  }

  getMessageHistory(): Array<{ role: string; content: string }> {
    return []
  }

  addAssistantMessage(_content: string): void {
    // DSH 自己管理历史，不需要外部追加
  }

  // --- 加载历史消息 ---
  async loadHistory(): Promise<Array<{ role: string; content: string; reasoning?: string; ts?: number }>> {
    try {
      console.log('[AgentService] 加载历史, sessionId:', this.sessionId)
      const hist = (await this.rpc('session.history', {
        sessionId: this.sessionId,
      })) as { events?: Array<{ event: DshEvent }> }
      
      console.log('[AgentService] 历史事件数量:', hist?.events?.length || 0)
      
      if (!hist?.events?.length) return []
      
      // 打印所有事件类型
      hist.events.forEach(({ event }, i) => {
        console.log(`[AgentService] 事件 ${i}: type=${event.type}, dataKeys=${event.data ? Object.keys(event.data).join(',') : 'none'}`)
        if (event.type === 'user/message') {
          console.log(`[AgentService] 用户消息 data:`, JSON.stringify(event.data).slice(0, 300))
        }
      })
      
      const messages: Array<{ role: string; content: string; reasoning?: string; ts?: number }> = []
      let currentAssistant = ''
      let currentReasoning = ''
      
      for (const { event } of hist.events) {
        if (event.type === 'assistant/chunk') {
          const chunk = event.data?.chunk
          if (!chunk) continue
          if (chunk.type === 'text-delta' && chunk.text) {
            currentAssistant += chunk.text
          }
          if (chunk.type === 'reasoning-delta' && chunk.text) {
            currentReasoning += chunk.text
          }
        }
        
        if (event.type === 'assistant/message') {
          const msg = event.data?.message
          if (msg?.role === 'assistant' && msg.content?.length) {
            const textParts = msg.content.filter((p: ContentPart) => p.type === 'text')
            const text = textParts.map((p: ContentPart) => p.text || '').join('')
            if (text) {
              messages.push({
                role: 'assistant',
                content: currentAssistant || text,
                reasoning: currentReasoning || undefined,
              })
            }
            currentAssistant = ''
            currentReasoning = ''
          }
        }
        
        if (event.type === 'user/message') {
          // user/message 的 data 直接就是 UserMessage 对象
          const msg = event.data as unknown as { role?: string; content?: ContentPart[] }
          if (msg?.content?.length) {
            const textParts = msg.content.filter((p: ContentPart) => p.type === 'text')
            const text = textParts.map((p: ContentPart) => p.text || '').join('')
            if (text) {
              messages.push({ role: 'user', content: text })
            }
          }
        }
      }
      
      return messages
    } catch (error) {
      console.error('[AgentService] 加载历史失败:', error)
      return []
    }
  }

  // --- 会话管理 ---
  async listSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt?: number; blank?: boolean; turns?: number }>> {
    try {
      const value = (await this.rpc('session.list')) as { items?: Array<{ sessionId: string; updatedAt?: number; blank?: boolean; projections?: { values?: { title?: string; sessionStats?: { turns?: number } } } }> }
      return (value?.items || []).map(item => ({
        sessionId: item.sessionId,
        // 从 projections.values.title 读取标题
        title: item.projections?.values?.title || item.sessionId,
        updatedAt: item.updatedAt,
        blank: item.blank,
        turns: item.projections?.values?.sessionStats?.turns,
      }))
    } catch {
      return []
    }
  }

  async switchSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId
    console.log(`[AgentService] 切换到会话: ${sessionId}`)
  }

  async createSession(): Promise<string | null> {
    try {
      const value = (await this.rpc('session.create', { cwd: 'e:\\DemoStudio' })) as { sessionId?: string }
      if (value?.sessionId) {
        this.sessionId = value.sessionId
        return value.sessionId
      }
      return null
    } catch {
      return null
    }
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      await this.rpc('session.delete', { sessionId })
      // 如果删除的是当前会话，清空
      if (this.sessionId === sessionId) {
        this.sessionId = null
      }
      return true
    } catch {
      return false
    }
  }
}

export const agentService = new AgentService()
