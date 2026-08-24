/**
 * Agent 通信服务 —— 通过 Electron IPC 代理到 DSH 内核 (port 3080)
 *
 * 通信协议：DSH RPC (POST /api/<method>)
 *   1. session.list     -> 健康检查
 *   2. session.create   -> 创建会话
 *   3. session.prompt    -> 发送用户消息
 *   4. session.history   -> 轮询获取 AI 回复（完整 DSH SessionEventMap 事件流）
 *
 * 事件覆盖：对齐 DSH 官方 48 种 SessionEvent 类型
 */
import type {
  ConnectionState, AgentEvent, ToolState, PendingQuestionRequest, QuestionAnswer, QuestionItem,
  TurnEndReason, TurnEndReasonKind, RetryAttempt, CommandState, CompactionState, TodoItem,
  TurnStartPayload, TurnEndPayload, StepStartPayload, StepEndPayload,
  RetryScheduledPayload, RetryStartedPayload, CommandRunPayload, CommandDonePayload,
  CompactionStartPayload, CompactionSummaryPayload, CompactionEndPayload,
  ToolDispatchStartPayload, ToolDispatchPayload, TodoWritePayload,
  RequestHeaderPayload, SandboxModePayload, PlanModePayload,
} from '../types/agent'

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

/** DSH 事件完整形状（覆盖所有 48 种 SessionEvent） */
interface DshEvent {
  type: string
  seq: number
  time?: number
  /** surface 事件标记：'append' 追加 / 其他为替换副本（compaction 模型侧副本，不进人类对话） */
  surfaceOp?: unknown
  data?: {
    // --- assistant/chunk ---
    chunk?: DshChunk
    // --- assistant/message ---
    message?: DshMessage
    // --- user/message ---
    content?: ContentPart[]
    source?: { kind?: string; plugin?: string; callId?: string; compactionId?: string; sourceCommandId?: string }
    id?: string
    // --- 通用 ---
    turn?: number
    step?: number
    // --- tool/call ---
    name?: string
    callId?: string
    arguments?: string
    // --- tool/result ---
    error?: { name?: string; code?: string }
    meta?: unknown
    // --- turn/end ---
    reason?: { kind?: string; error?: { message?: string; code?: string }; reason?: { kind?: string; reason?: string } }
    // --- llm/retry ---
    retryId?: string
    retry?: number
    delayMs?: number
    // --- command/run, command/done ---
    commandId?: string
    args?: string
    kind?: string
    text?: string
    sourceEventSeq?: number
    // --- compaction/* ---
    compactionId?: string
    summary?: Array<{ type: string; text?: string }>
    shadowedSeqs?: number[]
    shadowedTokenCount?: number
    sourceCommandId?: string
    // --- todo/write ---
    todos?: TodoItem[]
    // --- request/header ---
    header?: { config?: { model?: string; provider?: string }; adapterDefaults?: unknown; system?: string; tools?: unknown[] }
    // --- request/context ---
    provider?: string
    model?: string
    contextWindow?: number
    // --- sandbox/mode ---
    mode?: string
    // --- plan/mode ---
    active?: boolean
    // --- tool/code-dispatch ---
    rootCallId?: string
    parentCallId?: string
    subCallId?: string
    // --- tool-workflow/* ---
    runId?: string
    label?: string
    phase?: string
    childId?: string
    outcome?: string
    stopReason?: string
  } & DshMessage
}

/** 历史消息（从 session.history 事件流 fold 而来，对齐 DSH conversation-nodes 语义） */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool' | 'command' | 'compaction' | 'retry' | 'turn-error' | 'turn-max-tokens' | 'todo' | 'request-header'
  content: string
  reasoning?: string
  /** 回合是否真正结束（turn/end completed） */
  turnCompleted?: boolean
  /** 回合结束原因（非 completed 时填充） */
  turnEndReason?: TurnEndReason
  tool?: ToolState
  /** 命令信息 */
  command?: CommandState
  /** 压缩信息 */
  compaction?: CompactionState
  /** 重试链 */
  retries?: RetryAttempt[]
  /** Todo 列表快照 */
  todos?: TodoItem[]
  /** 模型/配置信息 */
  requestHeader?: { model?: string; provider?: string }
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
  /** 实时工具调用缓存：callId -> 工具名（供 tool/result 配对） */
  private pendingTools: Map<string, string> = new Map()

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
        // 只处理当前会话的问题（mux 可能推送其他会话的 pending 帧）
        if (sessionId !== this.sessionId) return
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  轮询 session.history —— 完整对齐 DSH SessionEventMap（48 种事件）
  // ═══════════════════════════════════════════════════════════════════════════
  private async pollForResponse(): Promise<void> {
    if (this.polling) return
    this.polling = true

    let lastSeq = -1
    let assistantBuf = ''
    let reasoningBuf = ''
    let lastEmittedTextLen = 0
    let lastEmittedReasoningLen = 0
    let attempts = 0

    try {
      const hist = (await this.rpc('session.history', {
        sessionId: this.sessionId,
      })) as { events?: Array<{ event: { seq: number } }> }
      if (hist?.events?.length) {
        lastSeq = hist.events[hist.events.length - 1].event.seq
      }
    } catch { /* ignore */ }

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

        attempts = 0

        for (const { event } of newEvents) {
          lastSeq = event.seq
          const d = event.data
          const time = event.time ?? Date.now()

          // ─── Turn/Step 边界 ───
          if (event.type === 'turn/start') {
            this.emit({ type: 'turnStart', payload: { turn: d?.turn ?? 0, seq: event.seq, time } as TurnStartPayload })
            continue
          }

          if (event.type === 'turn/end') {
            const reasonKind = (d?.reason?.kind ?? 'completed') as TurnEndReasonKind
            const reason: TurnEndReason = { kind: reasonKind }
            if (d?.reason?.error) reason.error = { message: d.reason.error.message ?? '', code: d.reason.error.code }
            if (d?.reason?.reason) reason.reason = d.reason.reason as { kind: string; reason?: string }
            this.emit({ type: 'turnEnd', payload: { turn: d?.turn ?? 0, reason, seq: event.seq, time } as TurnEndPayload })

            if (assistantBuf || reasoningBuf) {
              this.emit({
                type: 'message',
                payload: { role: 'assistant', content: assistantBuf, reasoning: reasoningBuf || undefined, turnCompleted: reasonKind === 'completed', turnEndReason: reason },
              })
              assistantBuf = ''
              reasoningBuf = ''
            }
            this.flushOrResumeHmr()
            this.polling = false
            return
          }

          if (event.type === 'step/start') {
            this.emit({ type: 'stepStart', payload: { turn: d?.turn ?? 0, step: d?.step ?? 0, seq: event.seq, time } as StepStartPayload })
            continue
          }

          if (event.type === 'step/end') {
            this.emit({ type: 'stepEnd', payload: { turn: d?.turn ?? 0, step: d?.step ?? 0, seq: event.seq, time } as StepEndPayload })
            continue
          }

          // ─── Assistant 流式内容 ───
          if (event.type === 'assistant/chunk') {
            const chunk = d?.chunk
            if (!chunk) continue
            if (chunk.type === 'text-delta' && chunk.text) assistantBuf += chunk.text
            if (chunk.type === 'reasoning-delta' && chunk.text) reasoningBuf += chunk.text
            if (chunk.type === 'finish') this.emit({ type: 'stepEnd', payload: { reason: chunk.reason, seq: event.seq, time } })
            continue
          }

          if (event.type === 'assistant/message') {
            const msg = d?.message
            if (msg?.role === 'assistant') {
              const reasoningPart = (msg.content || []).find((c: ContentPart) => c.type === 'reasoning')
              if (reasoningPart?.text && !reasoningBuf) reasoningBuf = reasoningPart.text
            }
            continue
          }

          // ─── 工具调用 ───
          if (event.type === 'tool/call') {
            const callId = d?.callId || `tc-${event.seq}`
            const toolName = d?.name || 'unknown'
            if (d?.callId) this.pendingTools.set(d.callId, toolName)
            this.emit({
              type: 'toolCall',
              payload: {
                id: callId, name: toolName,
                args: d?.arguments ? (() => { try { return JSON.parse(d.arguments) } catch { return d.arguments } })() : undefined,
                status: 'running', callTime: time,
              },
            })
            continue
          }

          if (event.type === 'tool/result') {
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
            const pendingName = callId ? this.pendingTools.get(callId) : undefined
            if (callId) this.pendingTools.delete(callId)
            this.emit({
              type: 'toolResult',
              payload: {
                id: callId || `tr-${event.seq}`, name: pendingName || 'tool',
                result: resultText || JSON.stringify(d), status: d?.error ? 'failure' : 'success',
                resultTime: time, error: d?.error,
              },
            })
            continue
          }

          // ─── 子工具调用（code-dispatch） ───
          if (event.type === 'tool/code-dispatch-start') {
            const subCallId = d?.subCallId || `sub-${event.seq}`
            this.emit({
              type: 'toolDispatchStart',
              payload: {
                rootCallId: d?.rootCallId || '', parentCallId: d?.parentCallId || '', subCallId,
                name: d?.name || 'unknown',
                arguments: d?.arguments ? (() => { try { return JSON.parse(d.arguments) } catch { return d.arguments } })() : undefined,
                seq: event.seq, time,
              } as ToolDispatchStartPayload,
            })
            continue
          }

          if (event.type === 'tool/code-dispatch') {
            const subCallId = d?.subCallId || `sub-${event.seq}`
            this.emit({
              type: 'toolDispatch',
              payload: {
                rootCallId: d?.rootCallId || '', parentCallId: d?.parentCallId || '', subCallId,
                name: d?.name || 'unknown', arguments: undefined,
                content: d?.content, isError: !!d?.error, seq: event.seq, time,
              } as ToolDispatchPayload,
            })
            continue
          }

          // ─── LLM 重试 ───
          if (event.type === 'llm/retry') {
            const retryId = d?.retryId || `retry-${event.seq}`
            this.emit({
              type: 'retryScheduled',
              payload: {
                retryId, retry: d?.retry ?? 1, turn: d?.turn ?? 0, step: d?.step ?? 0,
                reason: typeof d?.reason === 'string' ? d.reason : d?.reason?.kind,
                delayMs: d?.delayMs, seq: event.seq, time,
              } as RetryScheduledPayload,
            })
            continue
          }

          if (event.type === 'llm/retry-started') {
            const retryId = d?.retryId || `retry-${event.seq}`
            this.emit({
              type: 'retryStarted',
              payload: { retryId, retry: d?.retry ?? 1, seq: event.seq, time } as RetryStartedPayload,
            })
            continue
          }

          // ─── 命令 ───
          if (event.type === 'command/run') {
            const commandId = d?.commandId || `cmd-${event.seq}`
            this.emit({
              type: 'commandRun',
              payload: { commandId, name: d?.name || 'unknown', args: d?.args, seq: event.seq, time } as CommandRunPayload,
            })
            continue
          }

          if (event.type === 'command/done') {
            const commandId = d?.commandId || `cmd-${event.seq}`
            this.emit({
              type: 'commandDone',
              payload: { commandId, kind: (d?.kind as 'success' | 'error' | 'cancelled') ?? 'success', text: d?.text, seq: event.seq, time } as CommandDonePayload,
            })
            continue
          }

          // ─── 压缩 ───
          if (event.type === 'compaction/start') {
            const compactionId = d?.compactionId || `compact-${event.seq}`
            this.emit({ type: 'compactionStart', payload: { compactionId, seq: event.seq, time } as CompactionStartPayload })
            continue
          }

          if (event.type === 'compaction/summary') {
            const compactionId = d?.compactionId || `compact-${event.seq}`
            const summaryText = d?.summary
              ? d.summary.filter((b: { type: string; text?: string }) => b.type === 'text').map((b: { text?: string }) => b.text || '').join('')
              : undefined
            this.emit({
              type: 'compactionSummary',
              payload: { compactionId, summary: summaryText, shadowedItemCount: d?.shadowedSeqs?.length, shadowedTokenCount: d?.shadowedTokenCount, seq: event.seq, time } as CompactionSummaryPayload,
            })
            continue
          }

          if (event.type === 'compaction/end') {
            const compactionId = d?.compactionId || `compact-${event.seq}`
            this.emit({ type: 'compactionEnd', payload: { compactionId, seq: event.seq, time } as CompactionEndPayload })
            continue
          }

          // ─── Todo ───
          if (event.type === 'todo/write') {
            this.emit({ type: 'todoWrite', payload: { todos: d?.todos ?? [], seq: event.seq, time } as TodoWritePayload })
            continue
          }

          // ─── 请求配置 ───
          if (event.type === 'request/header') {
            const header = d?.header
            this.emit({
              type: 'requestHeader',
              payload: { model: header?.config?.model, provider: header?.config?.provider, reason: d?.reason || 'change', seq: event.seq, time } as RequestHeaderPayload,
            })
            continue
          }

          if (event.type === 'request/context') continue

          // ─── 沙箱/计划模式 ───
          if (event.type === 'sandbox/mode') {
            this.emit({ type: 'sandboxMode', payload: { mode: d?.mode || 'unknown', seq: event.seq, time } as SandboxModePayload })
            continue
          }

          if (event.type === 'plan/mode') {
            this.emit({ type: 'planMode', payload: { active: d?.active ?? false, seq: event.seq, time } as PlanModePayload })
            continue
          }

          // ─── session.idle（兼容旧版） ───
          if (event.type === 'session.idle') {
            if (assistantBuf || reasoningBuf) {
              this.emit({ type: 'message', payload: { role: 'assistant', content: assistantBuf, reasoning: reasoningBuf || undefined, turnCompleted: true } })
              assistantBuf = ''
              reasoningBuf = ''
            }
            this.flushOrResumeHmr()
            this.polling = false
            return
          }
        }

        // 批量发送本轮累积的 delta
        const newTextDelta = assistantBuf.slice(lastEmittedTextLen)
        const newReasoningDelta = reasoningBuf.slice(lastEmittedReasoningLen)
        if (newTextDelta) { this.emit({ type: 'message.delta', payload: newTextDelta }); lastEmittedTextLen = assistantBuf.length }
        if (newReasoningDelta) { this.emit({ type: 'reasoning.delta', payload: newReasoningDelta }); lastEmittedReasoningLen = reasoningBuf.length }
      }
    } finally {
      if (assistantBuf || reasoningBuf) {
        this.emit({ type: 'message', payload: { role: 'assistant', content: assistantBuf, reasoning: reasoningBuf || undefined } })
      }
      this.polling = false
    }
  }

  // --- HMR 守卫：Agent 回合期间暂停页面重载 ---

  /** 暂停 HMR（Agent 回合开始时调用） */
  private pauseHmr(): void {
    fetch('/__hmr/pause', { method: 'POST' }).catch(() => {})
  }

  /** 回合结束：有文件变更则 flush（一次重启），无变更则忽略 */
  private flushOrResumeHmr(): void {
    fetch('/__hmr/flush', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.flushed) console.log(`[AgentService] 回合结束，${data.changedFiles?.length || 0} 个文件变更，页面重启`)
      })
      .catch(() => {})
  }

  // --- 状态管理 ---
  private setState(state: ConnectionState): void {
    this.state = state
    this.stateListeners.forEach(l => l(state))
  }

  getState(): ConnectionState { return this.state }
  isConnected(): boolean { return this.state === 'connected' }

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
    this.pendingTools.clear()
  }

  getMessageHistory(): Array<{ role: string; content: string }> { return [] }
  addAssistantMessage(_content: string): void {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  加载历史消息 —— 完整对齐 DSH SessionEventMap
  // ═══════════════════════════════════════════════════════════════════════════
  async loadHistory(): Promise<HistoryMessage[]> {
    try {
      if (!this.sessionId) {
        console.warn('[AgentService] loadHistory: 无 sessionId')
        return []
      }

      const allEvents: Array<{ event: DshEvent }> = []
      let beforeSeq: number | undefined
      let pages = 0

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
        beforeSeq = events[0].event.seq
        if (beforeSeq <= 0) break
      }

      console.log(`[AgentService] 历史事件数量: ${allEvents.length}（${pages} 页）`)
      if (!allEvents.length) return []

      allEvents.sort((a, b) => a.event.seq - b.event.seq)

      const messages: HistoryMessage[] = []
      const pendingTools = new Map<string, ToolState>()
      const turnAssistantIndices = new Map<number, number[]>()
      // 重试链：retryId -> RetryAttempt[]
      const retryChains = new Map<string, RetryAttempt[]>()
      // 命令状态：commandId -> CommandState
      const commandStates = new Map<string, CommandState>()
      // 压缩状态：compactionId -> CompactionState
      const compactionStates = new Map<string, CompactionState>()

      for (const { event } of allEvents) {
        const d = event.data
        const time = event.time

        // ─── tool/call ───
        if (event.type === 'tool/call') {
          const callId = String(d?.callId || `tc-${event.seq}`)
          let args: unknown = undefined
          if (d?.arguments) { try { args = JSON.parse(d.arguments) } catch { args = d.arguments } }
          pendingTools.set(callId, { id: callId, name: d?.name || 'unknown', args, status: 'running', callTime: time })
          continue
        }

        // ─── tool/result ───
        if (event.type === 'tool/result') {
          const callId = String(d?.message?.source?.callId || d?.source?.callId || '')
          const tool = callId ? pendingTools.get(callId) : undefined
          if (tool) {
            tool.status = d?.error ? 'failure' : 'success'
            tool.result = d?.message?.content
            tool.error = d?.error ? { name: d.error.name ?? '', code: d.error.code ?? '' } : undefined
            tool.resultTime = time
            pendingTools.delete(callId)
            messages.push({ role: 'tool', content: '', tool, ts: time })
          }
          continue
        }

        // ─── user/message ───
        if (event.type === 'user/message') {
          const source = d?.source
          if (source?.kind === 'plugin' && source.plugin === 'compact') continue
          if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
          if (source && source.kind !== 'user') continue
          const text = this.extractText(d?.content)
          if (text) messages.push({ role: 'user', content: text, ts: time })
          continue
        }

        // ─── assistant/message ───
        if (event.type === 'assistant/message') {
          if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
          const msg = d?.message
          if (!msg || msg.role !== 'assistant') continue
          const text = this.extractText(msg.content)
          const reasoning = this.extractReasoning(msg.content)
          if (!text && !reasoning) continue
          const idx = messages.length
          messages.push({ role: 'assistant', content: text, reasoning: reasoning || undefined, ts: time })
          const turn = d?.turn
          if (typeof turn === 'number') {
            if (!turnAssistantIndices.has(turn)) turnAssistantIndices.set(turn, [])
            turnAssistantIndices.get(turn)!.push(idx)
          }
          continue
        }

        // ─── turn/end ───
        if (event.type === 'turn/end') {
          const reasonKind = (d?.reason?.kind ?? 'completed') as TurnEndReasonKind
          if (typeof d?.turn === 'number') {
            const indices = turnAssistantIndices.get(d.turn)
            if (indices && indices.length > 0) {
              const lastIdx = indices[indices.length - 1]
              if (messages[lastIdx]) {
                messages[lastIdx] = { ...messages[lastIdx], turnCompleted: reasonKind === 'completed' }
                if (reasonKind !== 'completed') {
                  const reason: TurnEndReason = { kind: reasonKind }
                  if (d?.reason?.error) reason.error = { message: d.reason.error.message ?? '', code: d.reason.error.code }
                  messages[lastIdx].turnEndReason = reason
                }
              }
            }
          }
          // 非 completed 的 turn/end 也生成一条消息
          if (reasonKind === 'error') {
            const errorMsg = d?.reason?.error?.message || '未知错误'
            messages.push({ role: 'turn-error', content: errorMsg, ts: time })
          }
          if (reasonKind === 'max-tokens') {
            messages.push({ role: 'turn-max-tokens', content: '输出达到 token 上限', ts: time })
          }
          continue
        }

        // ─── llm/retry ───
        if (event.type === 'llm/retry') {
          const retryId = d?.retryId || `retry-${event.seq}`
          let chain = retryChains.get(retryId)
          if (!chain) { chain = []; retryChains.set(retryId, chain) }
          chain.push({
            retry: d?.retry ?? 1, retryState: 'scheduled',
            turn: d?.turn ?? 0, step: d?.step ?? 0,
            reason: typeof d?.reason === 'string' ? d.reason : d?.reason?.kind,
            delayMs: d?.delayMs, seq: event.seq, time: time ?? 0,
          })
          continue
        }

        if (event.type === 'llm/retry-started') {
          const retryId = d?.retryId || `retry-${event.seq}`
          const chain = retryChains.get(retryId)
          if (chain) {
            const last = chain[chain.length - 1]
            if (last && last.retry === (d?.retry ?? 1)) last.retryState = 'started'
          }
          continue
        }

        // ─── command/run ───
        if (event.type === 'command/run') {
          const commandId = d?.commandId || `cmd-${event.seq}`
          commandStates.set(commandId, { commandId, name: d?.name || 'unknown', args: d?.args, seq: event.seq, time: time ?? 0 })
          continue
        }

        // ─── command/done ───
        if (event.type === 'command/done') {
          const commandId = d?.commandId || `cmd-${event.seq}`
          const existing = commandStates.get(commandId)
          if (existing) {
            existing.outcome = { kind: (d?.kind as 'success' | 'error' | 'cancelled') ?? 'success', text: d?.text }
            messages.push({ role: 'command', content: existing.name, command: existing, ts: time })
            commandStates.delete(commandId)
          }
          continue
        }

        // ─── compaction/start ───
        if (event.type === 'compaction/start') {
          const compactionId = d?.compactionId || `compact-${event.seq}`
          compactionStates.set(compactionId, { compactionId, status: 'running', startTime: time })
          continue
        }

        // ─── compaction/summary ───
        if (event.type === 'compaction/summary') {
          const compactionId = d?.compactionId || `compact-${event.seq}`
          const existing = compactionStates.get(compactionId)
          const summaryText = d?.summary
            ? d.summary.filter((b: { type: string; text?: string }) => b.type === 'text').map((b: { text?: string }) => b.text || '').join('')
            : undefined
          if (existing) {
            existing.summary = summaryText
            existing.shadowedItemCount = d?.shadowedSeqs?.length
            existing.shadowedTokenCount = d?.shadowedTokenCount
          }
          continue
        }

        // ─── compaction/end ───
        if (event.type === 'compaction/end') {
          const compactionId = d?.compactionId || `compact-${event.seq}`
          const existing = compactionStates.get(compactionId)
          if (existing) {
            existing.status = 'completed'
            existing.endTime = time
            messages.push({ role: 'compaction', content: existing.summary || '上下文已压缩', compaction: existing, ts: time })
            compactionStates.delete(compactionId)
          }
          continue
        }

        // ─── todo/write ───
        if (event.type === 'todo/write') {
          messages.push({ role: 'todo', content: `${(d?.todos ?? []).length} 个任务`, todos: d?.todos ?? [], ts: time })
          continue
        }

        // ─── request/header ───
        if (event.type === 'request/header') {
          const header = d?.header
          messages.push({
            role: 'request-header',
            content: `模型: ${header?.config?.model || '未知'}`,
            requestHeader: { model: header?.config?.model, provider: header?.config?.provider },
            ts: time,
          })
          continue
        }
      }

      // 重试链输出
      for (const chain of retryChains.values()) {
        if (chain.length > 0) {
          messages.push({ role: 'retry', content: `${chain.length} 次重试`, retries: chain, ts: chain[0].time })
        }
      }

      // 未配对完成的工具调用
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
    return content.filter(p => p.type === 'text').map(p => p.text || '').join('')
  }

  // --- 提取 ContentPart[] 中的推理文本 ---
  private extractReasoning(content?: ContentPart[]): string {
    if (!Array.isArray(content)) return ''
    return content.filter(p => p.type === 'reasoning').map(p => p.text || '').join('')
  }

  // --- 会话管理 ---
  async listSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt?: number; blank?: boolean; turns?: number }>> {
    try {
      const value = (await this.rpc('session.list')) as { items?: Array<{ sessionId: string; updatedAt?: number; blank?: boolean; projections?: { values?: { title?: string; sessionStats?: { turns?: number } } } }> }
      return (value?.items || [])
        .filter(item => !this.deletedSessionIds.has(item.sessionId))
        .map(item => ({
          sessionId: item.sessionId,
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
    this.abortPolling = true
    this.pendingQuestions.clear()
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

  getSessionId(): string | null { return this.sessionId }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      await this.rpc('workspace.archiveSession', { sessionId })
      console.log(`[AgentService] 会话已归档: ${sessionId}`)
    } catch {
      console.log(`[AgentService] 归档不可用，使用本地黑名单: ${sessionId}`)
    }
    this.deletedSessionIds.add(sessionId)
    if (this.sessionId === sessionId) this.sessionId = null
    return true
  }
}

// --- HMR 守卫：跨热更新保留连接状态 ---
const AGENT_SVC_KEY = '__ds_agentState__'
const g = globalThis as Record<string, unknown>
const agentService = new AgentService()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    g[AGENT_SVC_KEY] = {
      sessionId: agentService.getSessionId(),
      state: agentService.getState(),
    }
  })
}

const saved = g[AGENT_SVC_KEY] as { sessionId?: string; state?: ConnectionState } | undefined
if (saved?.sessionId && saved.state === 'connected') {
  ;(agentService as any).sessionId = saved.sessionId
  ;(agentService as any).state = 'connected'
  console.log(`[AgentService] HMR: 恢复会话 ${saved.sessionId}`)
}

export { agentService }
