/**
 * Agent 通信服务 —— 通过 Electron IPC 代理到 DSH 内核 (port 3080)
 *
 * 通信协议：DSH RPC (POST /api/<method>)
 *   1. session.list     -> 健康检查
 *   2. session.create   -> 创建会话
 *   3. session.prompt    -> 发送用户消息
 *   4. session.history   -> 轮询获取 AI 回复（assistant/chunk 事件流）
 */
import type { ConnectionState, AgentEvent, ToolState, PendingQuestionRequest, QuestionAnswer, QuestionItem } from '../types/agent'

const POLL_INTERVAL = 200   // 轮询间隔 ms（平衡延迟与性能）
const MAX_POLL_ATTEMPTS = 180 // 最多轮询次数（~144s）
const RECONNECT_BASE_DELAY = 1000 // 重连基础延迟 ms
const RECONNECT_MAX_DELAY = 16000 // 重连最大延迟 ms
const RECONNECT_MAX_ATTEMPTS = 5  // 最大重连次数

const HISTORY_PAGE_MESSAGES = 100 // session.history 每页消息数（DSH host 缺省 50，此处放宽）
const HISTORY_MAX_PAGES = 50      // 向上翻页安全上限（防死循环）

// --- 内部类型 ---
interface ContentPart {
  type: 'text' | 'reasoning' | 'image' | 'tool-call' | 'tool-result' | string
  text?: string
  /** tool-result 嵌套内容（DSH ToolResultBlock: content 数组套 text 块） */
  content?: Array<{ type: string; text?: string }>
}

interface DshChunk {
  type: string
  text?: string
  index?: number
  blockType?: string
  reason?: string
}

interface DshMessage {
  role: string
  content: ContentPart[]
  /** tool/result 消息携带的源调用标识（DSH ToolResultMessage.source.callId） */
  source?: { kind?: string; callId?: string }
}

interface DshEvent {
  type: string
  seq: number
  time?: number
  /** surface 事件标记：'append' 追加 / 其他为替换副本（compaction 模型侧副本，不进人类对话） */
  surfaceOp?: unknown
  data?: {
    chunk?: DshChunk
    message?: DshMessage
    content?: ContentPart[]
    source?: { kind?: string; plugin?: string; callId?: string }
    turn?: number
    step?: number
    name?: string
    callId?: string
    arguments?: string
    error?: { name?: string; code?: string }
  } & DshMessage
}

/** 历史消息（从 session.history 事件流 fold 而来，对齐 DSH conversation-nodes 语义） */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  reasoning?: string
  /** 回合是否真正结束（turn/end completed） */
  turnCompleted?: boolean
  tool?: ToolState
  ts?: number
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
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** HMR 存活标记：防止 dispose 后被 GC */
  private _hmrAlive = true
  // --- Mux WS 下行流（question/requested 等帧） ---
  private muxWs: WebSocket | null = null
  private muxCleanup: (() => void) | null = null
  /** 当前 pending 的问答请求（key = rpcId） */
  private pendingQuestions: Map<string, PendingQuestionRequest> = new Map()
  /** 本地已删除会话黑名单（DSH 不支持远程删除时的兜底） */
  private deletedSessionIds: Set<string> = new Set()

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

      // 启动 mux 下行流（接收 question/requested 等实时帧）
      this.connectMux()
    } catch (error) {
      this.setState('error')
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '连接 DSH 失败' },
      })
      this.scheduleReconnect()
      throw error
    }
  }

  disconnect(): void {
    this.abortPolling = true
    this.disconnectMux()
    this.sessionId = null
    this.reconnectAttempts = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.setState('idle')
  }

  // ═══════════════════════════════════════════════════════════
  //  Mux WS 下行流（question/requested 等帧）
  // ═══════════════════════════════════════════════════════════

  /** 建立 mux 下行流连接（浏览器: WebSocket，Electron: IPC） */
  private connectMux(): void {
    this.disconnectMux() // 清理旧连接
    const api = window.electronAPI

    if (api?.onDshMuxFrame) {
      // Electron 模式：main 进程 WS → IPC 转发
      api.dshMuxConnect().catch(() => {})
      this.muxCleanup = api.onDshMuxFrame((frame: unknown) => this.handleMuxFrame(frame))
    } else {
      // 浏览器模式：直接 WebSocket（Vite WS 代理转发到 DSH :3080）
      try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${location.host}/api/events.mux`)
        this.muxWs = ws

        ws.onmessage = (ev) => {
          try { this.handleMuxFrame(JSON.parse(ev.data)) } catch { /* 忽略解析失败 */ }
        }
        ws.onerror = () => { console.warn('[AgentService] mux WS 错误') }
        ws.onclose = () => {
          this.muxWs = null
          // 自动重连（仅在连接状态时）
          if (this.state === 'connected') {
            setTimeout(() => { if (this.state === 'connected') this.connectMux() }, 3000)
          }
        }
      } catch (err) {
        console.warn('[AgentService] mux WS 创建失败:', err)
      }
    }

    console.log('[AgentService] mux 下行流已启动')
  }

  /** 断开 mux 下行流 */
  private disconnectMux(): void {
    if (this.muxWs) { this.muxWs.close(); this.muxWs = null }
    if (this.muxCleanup) { this.muxCleanup(); this.muxCleanup = null }
    if (window.electronAPI?.dshMuxDisconnect) {
      window.electronAPI.dshMuxDisconnect().catch(() => {})
    }
  }

  /** 处理 mux 帧（question/requested、question/resolved 等） */
  private handleMuxFrame(frame: unknown): void {
    const f = frame as { type?: string; rpcId?: string; method?: string; payload?: Record<string, unknown> }
    // mux 帧格式: { type: 'server-request', rpcId, method: frame.type, payload: frame.payload }
    const method = f.method || f.type
    const payload = (f.payload || f) as Record<string, unknown>
    const rpcId = f.rpcId

    if (method === 'question/requested' && rpcId) {
      const questions = payload.questions as QuestionItem[] | undefined
      const sessionId = payload.sessionId as string | undefined
      if (questions && sessionId) {
        const req: PendingQuestionRequest = { rpcId, sessionId, questions }
        this.pendingQuestions.set(rpcId, req)
        console.log(`[AgentService] question/requested: rpcId=${rpcId}, ${questions.length} 个问题`)
        this.emit({ type: 'questionRequest', payload: req })
      }
      return
    }

    if (method === 'question/resolved') {
      const questionRpcId = payload.questionRpcId as string | undefined
      const outcome = payload.outcome as string | undefined
      if (questionRpcId) {
        this.pendingQuestions.delete(questionRpcId)
        console.log(`[AgentService] question/resolved: rpcId=${questionRpcId}, outcome=${outcome}`)
        this.emit({ type: 'questionResolved', payload: { rpcId: questionRpcId, outcome } })
      }
      return
    }

    // session/event 帧可选处理（tool/call 等实时事件，补充轮询）
    // 当前不处理：轮询已覆盖
  }

  /** 获取当前 pending 的问题请求 */
  getPendingQuestions(): PendingQuestionRequest[] {
    return Array.from(this.pendingQuestions.values())
  }

  // ═══════════════════════════════════════════════════════════
  //  回答问题（POST /api/respond）
  // ═══════════════════════════════════════════════════════════

  /** 发送 client-response 到 DSH（对齐 DSH 官方 ClientResponse 信封） */
  private async respond(rpcId: string, result: { ok: boolean; value?: unknown; error?: { code: string; message: string; details: unknown } }): Promise<boolean> {
    const api = window.electronAPI
    const message = { type: 'client-response', rpcId, result }

    if (api?.dshRespond) {
      // Electron 模式：通过专用 IPC（client-response 信封，非 client-request）
      const resp = await api.dshRespond(message)
      return resp?.accepted === true
    }

    // 浏览器模式：直接 POST /api/respond（Vite 代理到 DSH :3080）
    try {
      const res = await fetch('/api/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(15000),
      })
      const json = await res.json() as { accepted?: boolean; reason?: string }
      return json?.accepted === true
    } catch (err) {
      console.error('[AgentService] respond 失败:', err)
      return false
    }
  }

  /** 回答一组问题（对齐 DSH QuestionResponsePayload.answer 格式） */
  async answerQuestion(rpcId: string, answer: QuestionAnswer): Promise<boolean> {
    const req = this.pendingQuestions.get(rpcId)
    if (!req) {
      console.warn(`[AgentService] answerQuestion: rpcId=${rpcId} 不在 pending 列表中`)
      return false
    }
    const ok = await this.respond(rpcId, {
      ok: true,
      value: { sessionId: req.sessionId, answer },
    })
    if (ok) this.pendingQuestions.delete(rpcId)
    return ok
  }

  /** 取消/关闭一组问题 */
  async cancelQuestion(rpcId: string): Promise<boolean> {
    const ok = await this.respond(rpcId, {
      ok: false,
      error: { code: 'cancelled', message: '用户关闭了问题', details: {} },
    })
    if (ok) this.pendingQuestions.delete(rpcId)
    return ok
  }

  /** 指数退避自动重连 */
  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.warn(`[AgentService] 已达最大重连次数 ${RECONNECT_MAX_ATTEMPTS}，停止重连`)
      return
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    )
    this.reconnectAttempts++
    console.log(`[AgentService] ${delay}ms 后第 ${this.reconnectAttempts} 次重连...`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.reconnect()
      } catch {
        // reconnect 内部会再次 scheduleReconnect
      }
    }, delay)
  }

  /** 重连：复用已有 sessionId（不创建新会话），失败时回退到 connect() */
  private async reconnect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return
    this.setState('connecting')

    try {
      // 先验证 DSH 是否可达
      await this.rpc('session.list')
      this.setState('connected')
      this.reconnectAttempts = 0
      console.log(`[AgentService] 重连成功，会话: ${this.sessionId}`)
      this.emit({ type: 'ready', payload: { sessionId: this.sessionId, recovered: true } })
    } catch (error) {
      this.setState('error')
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '重连失败' },
      })
      this.scheduleReconnect()
    }
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

    // 暂停 HMR：Agent 回合期间不触发页面重载
    this.pauseHmr()

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
            // 模型调用结束（单步 finish）→ 通知前端折叠推理卡片
            if (chunk.type === 'finish') {
              this.emit({ type: 'stepEnd', payload: { reason: chunk.reason } })
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
            const stats = (event.data as { stats?: unknown })?.stats
            const isTurnEnd = event.type === 'turn/end'
            const reason = (event.data as { reason?: { kind?: string } })?.reason
            const completed = isTurnEnd && reason?.kind === 'completed'

            if (assistantBuf || reasoningBuf) {
              this.emit({
                type: 'message',
                payload: {
                  role: 'assistant',
                  content: assistantBuf,
                  reasoning: reasoningBuf || undefined,
                  stats,
                  // 只有 turn/end + completed 才标记回合真正结束
                  turnCompleted: completed,
                },
              })
              assistantBuf = ''
              reasoningBuf = ''
            }

            // 回合结束：检查是否有引擎文件变更，决定 flush 还是 resume
            this.flushOrResumeHmr()

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

  // --- HMR 守卫：Agent 回合期间暂停页面重载 ---

  /** 暂停 HMR（Agent 回合开始时调用） */
  private pauseHmr(): void {
    fetch('/__hmr/pause', { method: 'POST' }).catch(() => {
      // Vite 未运行或不可达，静默忽略
    })
  }

  /** 回合结束：有文件变更则 flush（一次重启），无变更则忽略 */
  private flushOrResumeHmr(): void {
    fetch('/__hmr/flush', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.flushed) {
          console.log(`[AgentService] 回合结束，${data.changedFiles?.length || 0} 个文件变更，页面重启`)
        }
      })
      .catch(() => {
        // Vite 未运行或不可达，静默忽略
      })
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
  // 对齐 DSH 官方客户端（packages/client/runtime session.ts + ui-conversation nodes）的 fold 语义：
  //   1. user/message     ： data 即 UserMessage（content 在 data.content）
  //   2. assistant/message: data = { turn, step, message: AssistantMessage }，内容在 data.message.content
  //   3. surfaceOp 判定   ： 仅 surfaceOp === 'append' 的消息进入人类对话（compaction 替换副本是模型侧视角，渲染会抹掉用户已看过的内容）
  //   4. compaction checkpoint（source.kind === 'plugin' && plugin === 'compact'）跳过
  //   5. source.kind !== 'user' 的注入上下文不当用户消息渲染
  //   6. tool/call + tool/result 按 callId 配对成工具卡片
  //   7. 空内容且无推理的 assistant/message（仅携带 usage 的占位）跳过
  //   8. hasMore=true 时按 beforeSeq 向上翻页拼全量
  async loadHistory(): Promise<HistoryMessage[]> {
    try {
      if (!this.sessionId) {
        console.warn('[AgentService] loadHistory: 无 sessionId')
        return []
      }

      const allEvents: Array<{ event: DshEvent }> = []
      let beforeSeq: number | undefined
      let pages = 0

      // 拉取所有页（首拉尾部页，之后按 beforeSeq 向上翻，直至 hasMore=false）
      while (pages < HISTORY_MAX_PAGES) {
        pages++
        const hist = (await this.rpc('session.history', {
          sessionId: this.sessionId,
          ...(beforeSeq !== undefined ? { beforeSeq } : {}),
          maxMessages: HISTORY_PAGE_MESSAGES,
        })) as { events?: Array<{ event: DshEvent }>; hasMore?: boolean }

        const events = hist?.events ?? []
        if (!events.length) break
        allEvents.unshift(...events)
        if (!hist?.hasMore) break

        // 下一页游标：当前页最老事件的 seq
        beforeSeq = events[0].event.seq
        if (beforeSeq <= 0) break
      }

      console.log(`[AgentService] 历史事件数量: ${allEvents.length}（${pages} 页）`)
      if (!allEvents.length) return []

      // 按 seq 升序排序（跨页拼接保险）
      allEvents.sort((a, b) => a.event.seq - b.event.seq)

      const messages: HistoryMessage[] = []
      // 工具调用缓存：callId -> 待配对的 tool/call（复用 ToolState，与实时流保持一致）
      const pendingTools = new Map<string, ToolState>()
      // 记录每个回合的 turn 编号 → 对应的 assistant 消息 index
      const turnAssistantIndices = new Map<number, number[]>()

      for (const { event } of allEvents) {
        // --- 工具调用（历史也渲染成工具卡片）---
        if (event.type === 'tool/call') {
          const d = event.data
          const callId = String(d?.callId || `tc-${event.seq}`)
          let args: unknown = undefined
          if (d?.arguments) {
            try { args = JSON.parse(d.arguments) } catch { args = d.arguments }
          }
          pendingTools.set(callId, {
            id: callId,
            name: d?.name || 'unknown',
            args,
            status: 'running',
          })
          continue
        }

        // --- 工具结果（DSH 形状：data.message.source.callId，官方 tool.ts rootResult 同源）---
        if (event.type === 'tool/result') {
          const d = event.data
          const callId = String(d?.message?.source?.callId || d?.source?.callId || '')
          const tool = callId ? pendingTools.get(callId) : undefined
          if (tool) {
            tool.status = 'success'
            tool.result = d?.message?.content
            pendingTools.delete(callId)
            messages.push({ role: 'tool', content: '', tool, ts: event.time })
          }
          continue
        }

        // --- 用户消息：data 即 UserMessage ---
        if (event.type === 'user/message') {
          const source = event.data?.source
          // compaction checkpoint：替换副本不渲染（官方 isCompactionCheckpoint）
          if (source?.kind === 'plugin' && source.plugin === 'compact') continue
          // 仅 surfaceOp === 'append' 的消息进入对话
          if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
          // 注入上下文（source.kind !== 'user'）不当用户消息渲染
          if (source && source.kind !== 'user') continue

          const text = this.extractText(event.data?.content)
          if (text) {
            messages.push({ role: 'user', content: text, ts: event.time })
          }
          continue
        }

        // --- AI 消息：内容在 data.message.content（关键修复点）---
        if (event.type === 'assistant/message') {
          if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
          const msg = event.data?.message
          if (!msg || msg.role !== 'assistant') continue

          const text = this.extractText(msg.content)
          const reasoning = this.extractReasoning(msg.content)
          // 空内容且无推理（仅携带 usage 的占位消息）跳过
          if (!text && !reasoning) continue

          const idx = messages.length
          messages.push({
            role: 'assistant',
            content: text,
            reasoning: reasoning || undefined,
            ts: event.time,
          })

          // 记录 turn → assistant 消息 index（用于 turn/end 时标记 turnCompleted）
          const turn = event.data?.turn
          if (typeof turn === 'number') {
            if (!turnAssistantIndices.has(turn)) turnAssistantIndices.set(turn, [])
            turnAssistantIndices.get(turn)!.push(idx)
          }
          continue
        }

        // --- 回合结束：标记该回合最后一条 assistant 消息为 turnCompleted ---
        if (event.type === 'turn/end') {
          const d = event.data as { turn?: number; reason?: { kind?: string } }
          if (d?.reason?.kind === 'completed' && typeof d.turn === 'number') {
            const indices = turnAssistantIndices.get(d.turn)
            if (indices && indices.length > 0) {
              const lastIdx = indices[indices.length - 1]
              if (messages[lastIdx]) {
                messages[lastIdx] = { ...messages[lastIdx], turnCompleted: true }
              }
            }
          }
          continue
        }
      }

      // 未配对完成的工具调用（被中断的回合）也保留为运行中卡片
      for (const tool of pendingTools.values()) {
        messages.push({ role: 'tool', content: '', tool })
      }

      return messages
    } catch (error) {
      console.error('[AgentService] 加载历史失败:', error)
      return []
    }
  }

  // --- 提取 ContentPart[] 中的文本 ---
  private extractText(content?: ContentPart[]): string {
    if (!Array.isArray(content)) return ''
    return content
      .filter(p => p.type === 'text')
      .map(p => p.text || '')
      .join('')
  }

  // --- 提取 ContentPart[] 中的推理文本 ---
  private extractReasoning(content?: ContentPart[]): string {
    if (!Array.isArray(content)) return ''
    return content
      .filter(p => p.type === 'reasoning')
      .map(p => p.text || '')
      .join('')
  }

  // --- 会话管理 ---
  async listSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt?: number; blank?: boolean; turns?: number }>> {
    try {
      const value = (await this.rpc('session.list')) as { items?: Array<{ sessionId: string; updatedAt?: number; blank?: boolean; projections?: { values?: { title?: string; sessionStats?: { turns?: number } } } }> }
      return (value?.items || [])
        .filter(item => !this.deletedSessionIds.has(item.sessionId))
        .map(item => ({
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
    // 先中止旧会话的轮询（pollForResponse 动态读 this.sessionId，不中止会把新会话事件当增量吐出）
    this.abortPolling = true
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
      // 优先使用 DSH 的 workspace.archiveSession 远程归档（会话从列表隐藏）
      await this.rpc('workspace.archiveSession', { sessionId })
      console.log(`[AgentService] 会话已归档: ${sessionId}`)
    } catch {
      // archiveSession 不可用时回退到本地黑名单
      console.log(`[AgentService] 归档不可用，使用本地黑名单: ${sessionId}`)
    }
    // 无论远程是否成功，都加入本地黑名单确保不会被 refreshSessions 重新拉回
    this.deletedSessionIds.add(sessionId)
    // 如果删除的是当前会话，清空
    if (this.sessionId === sessionId) {
      this.sessionId = null
    }
    return true
  }
}

// --- HMR 守卫：跨热更新保留连接状态（每次创建新实例，避免旧实例缺少新方法）---
const AGENT_SVC_KEY = '__ds_agentState__'
const g = globalThis as Record<string, unknown>
const agentService = new AgentService()

// HMR 时保存状态到 globalThis
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    g[AGENT_SVC_KEY] = {
      sessionId: agentService.getSessionId(),
      state: agentService.getState(),
    }
  })
}

// 恢复上次保存的状态
const saved = g[AGENT_SVC_KEY] as { sessionId?: string; state?: ConnectionState } | undefined
if (saved?.sessionId && saved.state === 'connected') {
  // 直接恢复 sessionId 和 connected 状态（不重新 session.create）
  ;(agentService as any).sessionId = saved.sessionId
  ;(agentService as any).state = 'connected'
  console.log(`[AgentService] HMR: 恢复会话 ${saved.sessionId}`)
}

export { agentService }
