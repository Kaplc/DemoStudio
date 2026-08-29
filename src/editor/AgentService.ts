/**
 * Agent 通信服务 —— 通过 Electron IPC 代理到 DSH 内核 (port 3080)
 *
 * 通信协议：DSH RPC (POST /api/<method>) + mux 下行流 (WS /api/events.mux)
 *   1. session.list     -> 健康检查
 *   2. session.create   -> 创建会话
 *   3. session.prompt    -> 发送用户消息
 *   4. events.mux (WS)   -> 实时下行主通道：session/event（对齐 DSH WebUI 双流架构中的
 *                           mux 流；turn/chunk/tool 等 48 种 SessionEvent 均由该流推送）
 *   5. session.history   -> 兜底通道：mux 离线时轮询，以及历史消息加载
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
const WATCHDOG_INTERVAL_MS = 3000 // mux 推送静默后的兜底拉取周期
const WATCHDOG_IDLE_MS = 1500     // 静默判定阈值（推送正常流动时心跳自动空转）
const RECONNECT_BASE_DELAY = 1000 // 重连基础延迟 ms
const RECONNECT_MAX_DELAY = 16000 // 重连最大延迟 ms
const RECONNECT_MAX_ATTEMPTS = 5  // 最大重连次数

const HISTORY_PAGE_MESSAGES = 50 // 与 DSH WebUI 一致：尾页/向前翻页每次只取一页
const HISTORY_MAX_PAGES = 50      // 向上翻页安全上限（防死循环）

// ─── 会话恢复 / agent 常驻化 ───
const SESSION_STORAGE_KEY = 'demostudio.dsh.session'   // localStorage: { sessionId, port, savedAt }
const DSH_DEFAULT_PORT = 3080                          // 与 electron/main.ts 保持一致
const AGENT_READY_WAIT_TIMEOUT_MS = 60000              // 等主进程引导完成（认领/冷启动）上限
const MAIN_READY_POLL_INTERVAL_MS = 500                // dsh-status 轮询间隔

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
  /** 产生该历史消息的事件序号，用于分页 prepend 时保持稳定 key。 */
  seq?: number
  ts?: number
}

export interface HistoryPage {
  messages: HistoryMessage[]
  hasMore: boolean
  /** 下一次请求 session.history 时使用的 beforeSeq。 */
  beforeSeq?: number
}

interface RpcResponse {
  type: string
  result?: { ok?: boolean; value?: unknown; error?: { message?: string } }
}

// --- 模型管理类型 ---
export interface ModelInfo {
  id: string
  name?: string
  reasoning?: {
    defaultEffort?: string
    efforts: Array<{ id: string; name: string; description?: string }>
  }
}

export interface ModelGroup {
  id: string
  name?: string
  models: ModelInfo[]
}

interface ModelsResult {
  groups?: ModelGroup[]
  current?: { provider: string; model: string; reasoningEffort?: string }
}

// --- 凭证管理类型 ---
export interface CredentialInfo {
  ref: string
  configured: boolean
  source?: 'user' | 'env' | 'default'
}

// --- 设置管理类型 ---
export interface SettingsPathOp {
  op: 'add' | 'remove' | 'replace' | 'merge'
  path: string[]
  value?: unknown
}

export interface SettingsDescribeResult {
  namespaces: Record<string, {
    schema?: unknown
    user?: unknown
    merged?: unknown
  }>
}

export interface ProviderInfo {
  /** Provider route key (如 'deepseek-official', 'openai') */
  provider: string
  /** 人类可读的显示名称 */
  displayName: string
  /** 设置命名空间 */
  settingsNs: string
  /** 设置路径 */
  settingsPath: string[]
  /** 是否已激活 */
  active: boolean
  /** 是否声明式 */
  declared?: boolean
}

export class AgentService {
  private state: ConnectionState = 'idle'
  private listeners: Set<(event: AgentEvent) => void> = new Set()
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()
  private sessionId: string | null = null
  private polling = false
  private abortPolling = false
  private historyCursor: number | undefined
  private historyHasMore = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** HMR 存活标记：防止 dispose 后被 GC */
  private _hmrAlive = true
  /** AI 是否正在运行（用于判断是否使用 steer 模式） */
  private _isRunning = false
  // --- Mux WS 下行流（question/requested、session/event 等帧） ---
  private muxWs: WebSocket | null = null
  private muxCleanup: (() => void) | null = null
  /** 已消费的最大事件 seq（推送/轮询/心跳三路共用，按 seq 去重） */
  private _lastSeq = -1
  /** 当前 assistant 段的流式缓冲（推送与轮询共用同一套缓冲） */
  private assistantBuf = ''
  private reasoningBuf = ''
  /** 最近一次消费事件的时间（心跳判定推送是否静默） */
  private lastEventAt = 0
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  /** 当前 pending 的问答请求（key = rpcId） */
  private pendingQuestions: Map<string, PendingQuestionRequest> = new Map()
  /** 本地已删除会话黑名单（DSH 不支持远程删除时的兜底） */
  private deletedSessionIds: Set<string> = new Set()
  /** 实时工具调用缓存：callId -> 工具名（供 tool/result 配对） */
  private pendingTools: Map<string, string> = new Map()
  /** DSH agent 端口（waitForAgentReady 就绪后更新，用于会话映射的 port 一致性判断） */
  private _agentPort = 0
  /** 已解析的默认工作区（应用根目录）缓存：getAppInfo 一次进程内不变 */
  private _workspaceCwd: string | null = null

  constructor(private config: { autoReconnect?: boolean } = {}) {
    this.config = { autoReconnect: true, ...this.config }
  }

  /**
   * 解析新建会话的默认工作区（编辑器根目录）。
   * 使用相对路径 '.'，这样在不同设备上都能正常工作。
   * DSH 会使用当前工作目录（项目根目录）作为工作区。
   */
  private async resolveWorkspaceCwd(): Promise<string> {
    if (this._workspaceCwd) return this._workspaceCwd
    // 优先通过 electronAPI 获取真实应用根目录（Electron 模式）
    try {
      const info = await window.electronAPI?.getAppInfo()
      if (info?.appRoot) {
        this._workspaceCwd = info.appRoot
        return this._workspaceCwd
      }
    } catch { /* fallthrough */ }
    // 浏览器模式回退：vite define 注入的 __DEMOSTUDIO_ROOT__
    if (typeof __DEMOSTUDIO_ROOT__ !== 'undefined' && __DEMOSTUDIO_ROOT__) {
      this._workspaceCwd = __DEMOSTUDIO_ROOT__
      return this._workspaceCwd
    }
    // 最终兜底
    this._workspaceCwd = '.'
    return '.'
  }

  // ═══════════════════════════════════════════════════════════
  //  会话恢复（localStorage 映射：{ sessionId, port }）
  // ═══════════════════════════════════════════════════════════

  private readSavedSession(): { sessionId: string; port: number; savedAt: number } | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { sessionId?: string; port?: number; savedAt?: number }
      if (!parsed?.sessionId) return null
      return { sessionId: parsed.sessionId, port: parsed.port ?? 0, savedAt: parsed.savedAt ?? 0 }
    } catch {
      return null
    }
  }

  private persistSession(): void {
    if (!this.sessionId) return
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        sessionId: this.sessionId,
        port: this._agentPort || DSH_DEFAULT_PORT,
        savedAt: Date.now(),
      }))
      console.log(`[AgentService] 会话映射已持久化: ${this.sessionId}`)
    } catch { /* 隐私模式等场景写入失败可容忍 */ }
  }

  private clearPersistedSession(): void {
    try { localStorage.removeItem(SESSION_STORAGE_KEY) } catch { /* ignore */ }
  }

  /** 绑定会话并重置实时流状态（seq 基线 / 半截缓冲 / 工具配对表），防止旧会话 seq 抑制新会话事件 */
  private setSession(id: string | null): void {
    this.sessionId = id
    this._lastSeq = -1
    this.clearLiveBuffers()
    this.pendingTools.clear()
  }

  /** 以服务端最新 seq 刷新去重基线（只推进游标，不消费历史事件进 UI） */
  private async refreshSeqBaseline(): Promise<void> {
    try {
      const hist = (await this.rpc('session.history', {
        sessionId: this.sessionId,
      })) as { events?: Array<{ event: { seq: number } }> }
      const last = hist?.events?.[hist.events.length - 1]?.event.seq
      if (typeof last === 'number') this._lastSeq = Math.max(this._lastSeq, last)
    } catch { /* 基线失败不阻塞主流程，最多多处理一条重复事件（已按 seq 去重） */ }
  }

  /** 校验远端会话是否仍然存在（attach 前提） */
  private async validateSession(sessionId: string): Promise<boolean> {
    try {
      const value = await this.rpc('session.list') as { items?: Array<{ sessionId?: string }> }
      const items = value?.items ?? []
      return items.some(item => item?.sessionId === sessionId)
    } catch (err) {
      console.error(`[AgentService] 会话校验失败(${sessionId}):`, err)
      throw err // 网络级失败与「会话不存在」区分开，由调用方决定回退策略
    }
  }

  /**
   * 等待主进程完成 agent 引导（探测/认领/spawn），返回 agent 端口。
   * - Electron 模式：轮询 dsh-status 直至 ready 或 degraded 终态；
   * - 浏览器模式：无 dshStatus，假定 Vite 代理指向的 :3080 可用，直接返回默认端口。
   * @throws AGENT_DEGRADED —— 主进程自愈超限进入终态，需手动重启
   */
  private async waitForAgentReady(): Promise<number> {
    const api = window.electronAPI
    if (!api?.dshStatus) return DSH_DEFAULT_PORT

    const deadline = Date.now() + AGENT_READY_WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      let status: Awaited<ReturnType<typeof api.dshStatus>>
      try {
        status = await api.dshStatus()
      } catch (err) {
        console.error('[AgentService] dsh-status 查询失败:', err)
        status = undefined as unknown as Awaited<ReturnType<typeof api.dshStatus>>
      }
      if (status?.ready && status.port) return status.port
      if (status?.lifecycle === 'degraded') throw new Error('AGENT_DEGRADED')
      await new Promise(r => setTimeout(r, MAIN_READY_POLL_INTERVAL_MS))
    }
    throw new Error(`等待 agent 就绪超时(${AGENT_READY_WAIT_TIMEOUT_MS}ms)`)
  }

  /**
   * 断档续听：刷新/重连接管后若最后一个回合尚未闭合，继续监听后续事件直到
   * turn/end（补齐断档区间的实时部分）。先用 history 最新 seq 重立去重基线，
   * 不会回放已有事件；mux 在线时由 session/event 推送驱动，离线才回退轮询。
   */
  private resumePendingTurnIfNeeded(): void {
    if (!this.sessionId || this.polling) return
    void (async () => {
      try {
        const hist = await this.rpc('session.history', { sessionId: this.sessionId }) as {
          events?: Array<{ event: { type: string } }>
        }
        const events = hist?.events ?? []
        if (!events.length) return
        for (let i = events.length - 1; i >= 0; i--) {
          const t = events[i].event.type
          if (t === 'turn/end') return            // 最后回合已收尾 → 无未完成工作
          if (t === 'turn/start') break           // 存在未闭合回合 → 续听
        }
        console.log('[AgentService] 检测到未完成回合，启动断档续听（热刷新期间结果将补齐显示）')
        await this.refreshSeqBaseline()
        this.setRunning(true)
        // mux 在线：session/event 推送 + 心跳兜底自动续听；离线才启动轮询回路
        if (!this.isMuxAlive()) await this.pollForResponse()
      } catch (err) {
        console.warn('[AgentService] 断档续听探测失败:', err)
      }
    })()
  }

  // --- DSH RPC 通用调用（通过 Electron IPC 代理，绕过 CORS）---
  async rpc(method: string, payload: Record<string, unknown> = {}): Promise<unknown> {
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
  /**
   * 连接流程（agent 常驻化）：
   *  1. claiming   —— 等主进程完成 agent 引导（探测/认领/spawn），拿到端口
   *  2. recovering —— 有 localStorage 映射则校验并 attach 旧会话（恢复无感接续）
   *  3. connecting —— 无映射或映射失效，回退新建会话
   */
  async connect(): Promise<void> {
    if (['connected', 'connecting', 'claiming', 'recovering'].includes(this.state)) return

    // ── 阶段 1：claiming（等 agent 就绪） ──
    this.setState('claiming')
    let port: number
    try {
      port = await this.waitForAgentReady()
      this._agentPort = port
    } catch (error) {
      if (error instanceof Error && error.message === 'AGENT_DEGRADED') {
        this.setState('degraded')
        this.emit({
          type: 'error',
          payload: { message: 'DSH Agent 故障（自愈失败），请在面板手动重启' },
        })
        throw error
      }
      this.setState('error')
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '连接 DSH 失败' },
      })
      this.scheduleReconnect()
      throw error
    }

    // ── 阶段 2：recovering（attach 持久化的旧会话） ──
    const saved = this.readSavedSession()
    if (saved?.sessionId) {
      this.setState('recovering')
      try {
        const valid = await this.validateSession(saved.sessionId)
        if (valid) {
          this.setSession(saved.sessionId)
          console.log(`[AgentService] DSH 已连接（会话已恢复）: ${this.sessionId} (port=${port})`)
          this.setState('connected')
          this.reconnectAttempts = 0
          this.emit({ type: 'ready', payload: { sessionId: this.sessionId, recovered: true, restored: true } })

          // 启动 mux 下行流（接收 question/requested 等实时帧）
          this.connectMux()
          // 刷新期间若有进行中的回合 → 断档续听补齐
          this.resumePendingTurnIfNeeded()
          return
        }
        console.warn(`[AgentService] 持久化会话已失效，回退新建: ${saved.sessionId}`)
        this.clearPersistedSession()
      } catch (err) {
        // 网络级错误与会话失效都回退到新建路径；网络错误由新建路径自然暴露
        console.warn('[AgentService] 会话恢复尝试失败，回退新建会话:', err)
      }
    }

    // ── 阶段 3：connecting（新建会话，默认工作区 = 编辑器根目录） ──
    this.setState('connecting')
    try {
      const cwd = await this.resolveWorkspaceCwd()
      let createValue: { sessionId?: string } | null = null
      try {
        createValue = (await this.rpc('session.create', { cwd })) as { sessionId?: string }
      } catch (firstErr) {
        // 默认 preset 可能不存在，回退 cordis
        console.warn('[AgentService] 首次 session.create 失败，尝试 fallback preset cordis:', firstErr)
        createValue = (await this.rpc('session.create', { cwd, agentPreset: 'cordis' })) as { sessionId?: string }
      }
      if (!createValue?.sessionId) throw new Error('session.create 未返回 sessionId')
      this.setSession(createValue.sessionId)
      this.persistSession()
      console.log(`[AgentService] DSH 已连接，新会话: ${this.sessionId}`)

      this.setState('connected')
      this.reconnectAttempts = 0
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
    this.setSession(null)
    this.setRunning(false)
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

  /** mux 下行流是否在线（Electron 模式由 main 进程托管连接与 5s 自动重连） */
  private isMuxAlive(): boolean {
    if (window.electronAPI?.onDshMuxFrame) return true
    return this.muxWs?.readyState === WebSocket.OPEN
  }

  /** 断开 mux 下行流 */
  private disconnectMux(): void {
    if (this.muxWs) { this.muxWs.close(); this.muxWs = null }
    if (this.muxCleanup) { this.muxCleanup(); this.muxCleanup = null }
    if (window.electronAPI?.dshMuxDisconnect) {
      window.electronAPI.dshMuxDisconnect().catch(() => {})
    }
  }

  /** HMR：释放旧实例持有的下行流（浏览器 WS / IPC 监听 / 心跳 / 轮询）。
   * Electron main 的 WS 桥保留不断开，由新实例复用。
   * 旧实例置为 idle，掐断其 WS 重连定时器等复活路径。 */
  releaseForHmr(): void {
    this.abortPolling = true
    this.stopTurnWatchdog()
    if (this.muxWs) { this.muxWs.close(); this.muxWs = null }
    if (this.muxCleanup) { this.muxCleanup(); this.muxCleanup = null }
    this.setState('idle')
  }

  /** HMR 接管后重挂实时下行流：mux 连接不会随模块热替换自动恢复，
   * 必须显式重建（浏览器 WS / Electron IPC 监听）并续听未闭合回合。 */
  reattachLiveStream(): void {
    if (this.state !== 'connected' || !this.sessionId) return
    this.abortPolling = false
    this.connectMux()
    this.resumePendingTurnIfNeeded()
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

    // ── session/event：AI 回复事件的实时推送主通道（与 DSH WebUI 同源） ──
    if (method === 'session/event') {
      const sid = payload.sessionId as string | undefined
      const event = payload.event as DshEvent | undefined
      if (event && sid === this.sessionId) this.consumeSessionEvent(event)
      return
    }

    // ── session/subscribed：mux 连接/会话创建时的订阅基线（lastSeq 之前的进历史加载） ──
    if (method === 'session/subscribed') {
      const sid = payload.sessionId as string | undefined
      const lastSeq = payload.lastSeq as number | undefined
      if (sid === this.sessionId && typeof lastSeq === 'number') {
        this._lastSeq = Math.max(this._lastSeq, lastSeq)
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

  /** 重连：优先复用已有 sessionId（attach），失败时回退到 connect() 全流程 */
  private async reconnect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting' || this.state === 'claiming') return
    this.setState('connecting')

    try {
      // 先验证 DSH 是否可达
      await this.rpc('session.list')
      this.setState('connected')
      this.reconnectAttempts = 0
      console.log(`[AgentService] 重连成功，会话: ${this.sessionId}`)
      if (this.sessionId) {
        this.emit({ type: 'ready', payload: { sessionId: this.sessionId, recovered: true } })
        // 断线期间若有未闭合回合 → 续听补齐
        this.resumePendingTurnIfNeeded()
      } else {
        this.emit({ type: 'ready', payload: {} })
        void this.connect().catch(() => { /* 无会话时走全流程补建 */ })
      }
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

    // 上一段轮询回路若仍在跑，先温和停掉（200ms 内自然退出）
    if (this.polling) {
      this.abortPolling = true
      await new Promise(r => setTimeout(r, 200))
    }
    this.abortPolling = false
    this.clearLiveBuffers()
    // 以服务端最新 seq 为去重基线，隔离上一次 stop 遗留的迟到事件
    await this.refreshSeqBaseline()

    this.emit({ type: 'message', payload: { role: 'user', content: text } })
    this.setRunning(true) // AI 开始运行

    try {
      await this.rpc('session.prompt', {
        sessionId: this.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
      // mux 下行流在线时由 session/event 推送驱动；离线才回退轮询
      if (!this.isMuxAlive()) await this.pollForResponse()
    } catch (error) {
      this.setRunning(false) // 出错时停止
      if (this.abortPolling) return
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '发送失败' },
      })
    }
  }

  /**
   * 引导 AI：在 AI 运行中发送新消息，实时注入到当前 turn
   * @param text - 引导消息内容
   */
  async steer(text: string): Promise<void> {
    if (this.state !== 'connected' || !this.sessionId) {
      throw new Error('未连接到 DSH')
    }

    console.log(`[AgentService] 引导 AI: text="${text}", sessionId=${this.sessionId}`)
    this.emit({ type: 'message', payload: { role: 'user', content: text } })

    try {
      const result = await this.rpc('session.prompt', {
        sessionId: this.sessionId,
        mode: 'steer',
        content: [{ type: 'text', text }],
      })
      console.log(`[AgentService] 引导消息已发送:`, result)
    } catch (error) {
      console.error(`[AgentService] 引导失败:`, error)
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '引导失败' },
      })
    }
  }

  /**
   * 停止 AI：取消当前活跃的 turn
   * DSH 会协作式中止当前轮次，保留待处理 inbox 工作
   */
  async stop(): Promise<void> {
    if (!this.sessionId) {
      throw new Error('无活跃会话')
    }

    console.log(`[AgentService] 停止 AI: sessionId=${this.sessionId}`)
    // 先阻止轮询，再等待取消 RPC，避免 RPC 往返期间继续派发历史事件。
    this.abortPolling = true
    this.clearLiveBuffers() // 丢弃半截 assistant 缓冲（对齐旧轮询的中止语义）
    this.setRunning(false)
    try {
      const result = await this.rpc('session.cancel', { sessionId: this.sessionId })
      console.log(`[AgentService] 停止命令已发送:`, result)
    } catch (error) {
      console.error(`[AgentService] 停止失败:`, error)
      this.emit({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '停止失败' },
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  session/event 统一分发 —— 完整对齐 DSH SessionEventMap（48 种事件）
  //  主通道：mux WS 推送（session/event 帧，与 DSH WebUI 同源）；
  //  兜底：mux 离线时轮询 history + 回合运行中的静默心跳。
  // ═══════════════════════════════════════════════════════════════════════════

  /** 提交当前累积的 assistant 段（UI 只接收完整段）。工具调用会把一个 turn 切成
   * 多个 assistant -> tool -> assistant 段，必须在边界事件到达前提交缓冲区。 */
  private flushAssistant(turnCompleted = false, turnEndReason?: TurnEndReason): void {
    if (!this.assistantBuf && !this.reasoningBuf) return
    this.emit({
      type: 'message',
      payload: {
        role: 'assistant',
        content: this.assistantBuf,
        reasoning: this.reasoningBuf || undefined,
        turnCompleted,
        turnEndReason,
      },
    })
    this.assistantBuf = ''
    this.reasoningBuf = ''
  }

  /** 丢弃半截缓冲（stop / 发送前调用，不触发 UI 派发） */
  private clearLiveBuffers(): void {
    this.assistantBuf = ''
    this.reasoningBuf = ''
  }

  /** 消费一条 session/event（推送/轮询/心跳三路共用）：按 seq 去重后统一分发。
   * @returns 是否为回合收尾事件（turn/end / session.idle） */
  private consumeSessionEvent(event: DshEvent): boolean {
    if (this.abortPolling) return false // stop 语义：中止后不再派发任何事件
    if (typeof event?.seq !== 'number' || event.seq <= this._lastSeq) return false
    this._lastSeq = event.seq
    this.lastEventAt = Date.now()
    return this.handleSessionEvent(event)
  }

  /** 48 种 SessionEvent 的统一处理（推送与轮询共用同一套缓冲与边界提交）。
   * @returns 是否为回合收尾事件 */
  private handleSessionEvent(event: DshEvent): boolean {
    const d = event.data
    const time = event.time ?? Date.now()

    // ─── Turn/Step 边界 ───
    if (event.type === 'turn/start') {
      this.emit({ type: 'turnStart', payload: { turn: d?.turn ?? 0, seq: event.seq, time } as TurnStartPayload })
      return false
    }

    if (event.type === 'turn/end') {
      const reasonKind = (d?.reason?.kind ?? 'completed') as TurnEndReasonKind
      const reason: TurnEndReason = { kind: reasonKind }
      if (d?.reason?.error) reason.error = { message: d.reason.error.message ?? '', code: d.reason.error.code }
      if (d?.reason?.reason) reason.reason = d.reason.reason as { kind: string; reason?: string }

      // turn/end 是最后一个 assistant 段的提交边界。先提交消息，
      // 再通知 UI 回合结束，保证视觉顺序和事件顺序一致。
      this.flushAssistant(reasonKind === 'completed', reason)
      this.emit({ type: 'turnEnd', payload: { turn: d?.turn ?? 0, reason, seq: event.seq, time } as TurnEndPayload })
      this.setRunning(false) // turn 结束，AI 不再运行
      return true
    }

    if (event.type === 'step/start') {
      this.emit({ type: 'stepStart', payload: { turn: d?.turn ?? 0, step: d?.step ?? 0, seq: event.seq, time } as StepStartPayload })
      return false
    }

    if (event.type === 'step/end') {
      // 没有工具的普通 step 也要在 step 边界显示完整消息。
      this.flushAssistant()
      this.emit({ type: 'stepEnd', payload: { turn: d?.turn ?? 0, step: d?.step ?? 0, seq: event.seq, time } as StepEndPayload })
      return false
    }

    // ─── Assistant 流式内容 ───
    if (event.type === 'assistant/chunk') {
      const chunk = d?.chunk
      if (!chunk) return false
      if (chunk.type === 'text-delta' && chunk.text) this.assistantBuf += chunk.text
      if (chunk.type === 'reasoning-delta' && chunk.text) this.reasoningBuf += chunk.text
      if (chunk.type === 'finish') this.emit({ type: 'stepEnd', payload: { reason: chunk.reason, seq: event.seq, time } })
      return false
    }

    if (event.type === 'assistant/message') {
      const msg = d?.message
      if (msg?.role === 'assistant') {
        const reasoningPart = (msg.content || []).find((c: ContentPart) => c.type === 'reasoning')
        if (reasoningPart?.text && !this.reasoningBuf) this.reasoningBuf = reasoningPart.text
      }
      return false
    }

    // ─── 工具调用 ───
    if (event.type === 'tool/call') {
      // tool/call 会把当前 assistant 段切开。必须先提交前面的完整文本，
      // 否则工具卡片会先进入 UI，后续文本再到达时就失去正确归属。
      this.flushAssistant()
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
      return false
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
      return false
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
      return false
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
      return false
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
      return false
    }

    if (event.type === 'llm/retry-started') {
      const retryId = d?.retryId || `retry-${event.seq}`
      this.emit({
        type: 'retryStarted',
        payload: { retryId, retry: d?.retry ?? 1, seq: event.seq, time } as RetryStartedPayload,
      })
      return false
    }

    // ─── 命令 ───
    if (event.type === 'command/run') {
      const commandId = d?.commandId || `cmd-${event.seq}`
      this.emit({
        type: 'commandRun',
        payload: { commandId, name: d?.name || 'unknown', args: d?.args, seq: event.seq, time } as CommandRunPayload,
      })
      return false
    }

    if (event.type === 'command/done') {
      const commandId = d?.commandId || `cmd-${event.seq}`
      this.emit({
        type: 'commandDone',
        payload: { commandId, kind: (d?.kind as 'success' | 'error' | 'cancelled') ?? 'success', text: d?.text, seq: event.seq, time } as CommandDonePayload,
      })
      return false
    }

    // ─── 压缩 ───
    if (event.type === 'compaction/start') {
      const compactionId = d?.compactionId || `compact-${event.seq}`
      this.emit({ type: 'compactionStart', payload: { compactionId, seq: event.seq, time } as CompactionStartPayload })
      return false
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
      return false
    }

    if (event.type === 'compaction/end') {
      const compactionId = d?.compactionId || `compact-${event.seq}`
      this.emit({ type: 'compactionEnd', payload: { compactionId, seq: event.seq, time } as CompactionEndPayload })
      return false
    }

    // ─── Todo ───
    if (event.type === 'todo/write') {
      this.emit({ type: 'todoWrite', payload: { todos: d?.todos ?? [], seq: event.seq, time } as TodoWritePayload })
      return false
    }

    // ─── 请求配置 ───
    if (event.type === 'request/header') {
      const header = d?.header
      this.emit({
        type: 'requestHeader',
        payload: { model: header?.config?.model, provider: header?.config?.provider, reason: d?.reason || 'change', seq: event.seq, time } as RequestHeaderPayload,
      })
      return false
    }

    if (event.type === 'request/context') return false

    // ─── 沙箱/计划模式 ───
    if (event.type === 'sandbox/mode') {
      this.emit({ type: 'sandboxMode', payload: { mode: d?.mode || 'unknown', seq: event.seq, time } as SandboxModePayload })
      return false
    }

    if (event.type === 'plan/mode') {
      this.emit({ type: 'planMode', payload: { active: d?.active ?? false, seq: event.seq, time } as PlanModePayload })
      return false
    }

    // ─── session.idle（兼容旧版） ───
    if (event.type === 'session.idle') {
      this.flushAssistant(true)
      this.setRunning(false)
      return true
    }

    return false
  }

  /** 回合运行中的兜底心跳：mux 推送静默超过阈值时主动拉一次 history 补漏。
   * 推送正常流动时（lastEventAt 新鲜）心跳自动空转，不产生多余 RPC。 */
  private startTurnWatchdog(): void {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => {
      if (!this._isRunning || !this.sessionId || this.polling || this.abortPolling) return
      if (Date.now() - this.lastEventAt < WATCHDOG_IDLE_MS) return
      void (async () => {
        try {
          const hist = (await this.rpc('session.history', {
            sessionId: this.sessionId,
          })) as { events?: Array<{ event: DshEvent }> }
          for (const { event } of hist?.events ?? []) {
            if (this.abortPolling) return
            if (this.consumeSessionEvent(event)) return // 回合已收尾（setRunning(false) 会停心跳）
          }
        } catch { /* 下个心跳再试 */ }
      })()
    }, WATCHDOG_INTERVAL_MS)
  }

  private stopTurnWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  /**
   * 兜底轮询 session.history —— 仅在 mux 下行流离线时由 send()/断档续听启动。
   * 事件消费统一走 consumeSessionEvent，与推送路径共用 seq 去重与分发逻辑。
   */
  private async pollForResponse(): Promise<void> {
    if (this.polling) return
    this.polling = true

    let attempts = 0
    try {
      await this.refreshSeqBaseline()
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

        const newEvents = events.filter(e => e.event.seq > this._lastSeq)
        if (!newEvents.length) continue

        attempts = 0

        for (const { event } of newEvents) {
          if (this.consumeSessionEvent(event)) return // 回合收尾，停止轮询
        }
      }
    } finally {
      // session.cancel 会设置 abortPolling。中止路径不能再 flush 缓冲区，
      // 否则停止后会重新派发 assistant 消息并触发前端打字机。
      if (!this.abortPolling) this.flushAssistant()
      this.polling = false
    }
  }

  // --- 状态管理 ---
  private setState(state: ConnectionState): void {
    this.state = state
    this.stateListeners.forEach(l => l(state))
  }

  getState(): ConnectionState { return this.state }
  isConnected(): boolean { return this.state === 'connected' }
  /** AI 是否正在运行（用于判断是否使用 steer 模式） */
  isRunning(): boolean { return this._isRunning }
  /** 设置 AI 运行状态（回合运行期间同时管理推送静默心跳） */
  private setRunning(running: boolean): void {
    console.log(`[AgentService] setRunning: ${running}`)
    this._isRunning = running
    if (running) this.startTurnWatchdog()
    else this.stopTurnWatchdog()
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
    this.pendingTools.clear()
  }

  getMessageHistory(): Array<{ role: string; content: string }> { return [] }
  addAssistantMessage(_content: string): void {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  加载历史消息 —— 完整对齐 DSH SessionEventMap
  // ═══════════════════════════════════════════════════════════════════════════
  async loadHistory(options: {
    /** 只加载一个 beforeSeq 之前的历史页时传入。 */
    beforeSeq?: number
    /** 首次加载历史时可限制页数；不传则保持完整历史加载兼容。 */
    maxPages?: number
    maxMessages?: number
  } = {}): Promise<HistoryMessage[]> {
    try {
      if (!this.sessionId) {
        console.warn('[AgentService] loadHistory: 无 sessionId')
        return []
      }

      const allEvents: Array<{ event: DshEvent }> = []
      let beforeSeq = options.beforeSeq
      let pages = 0
      const maxPages = options.maxPages ?? HISTORY_MAX_PAGES
      const maxMessages = options.maxMessages ?? HISTORY_PAGE_MESSAGES

      if (options.beforeSeq === undefined) {
        this.historyCursor = undefined
        this.historyHasMore = false
      }

      while (pages < maxPages) {
        pages++
        const hist = (await this.rpc('session.history', {
          sessionId: this.sessionId,
          ...(beforeSeq !== undefined ? { beforeSeq } : {}),
          maxMessages,
        })) as { events?: Array<{ event: DshEvent }>; hasMore?: boolean }

        const events = hist?.events ?? []
        if (!events.length) break
        allEvents.unshift(...events)
        this.historyCursor = events[0].event.seq
        this.historyHasMore = !!hist?.hasMore
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
      // 重试卡片在 messages 中的索引，保证后续 retry-started 更新原位置。
      const retryMessageIndices = new Map<string, number>()
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
            messages.push({ role: 'tool', content: '', tool, seq: event.seq, ts: time })
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
          if (text) messages.push({ role: 'user', content: text, seq: event.seq, ts: time })
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
          messages.push({ role: 'assistant', content: text, reasoning: reasoning || undefined, seq: event.seq, ts: time })
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
            messages.push({ role: 'turn-error', content: errorMsg, seq: event.seq, ts: time })
          }
          if (reasonKind === 'max-tokens') {
            messages.push({ role: 'turn-max-tokens', content: '输出达到 token 上限', seq: event.seq, ts: time })
          }
          continue
        }

        // ─── llm/retry ───
        if (event.type === 'llm/retry') {
          const retryId = d?.retryId || `retry-${event.seq}`
          let chain = retryChains.get(retryId)
          if (!chain) { chain = []; retryChains.set(retryId, chain) }
          const attempt: RetryAttempt = {
            retry: d?.retry ?? 1, retryState: 'scheduled',
            turn: d?.turn ?? 0, step: d?.step ?? 0,
            reason: typeof d?.reason === 'string' ? d.reason : d?.reason?.kind,
            delayMs: d?.delayMs, seq: event.seq, time: time ?? 0,
          }
          chain.push(attempt)
          const existingIndex = retryMessageIndices.get(retryId)
          if (existingIndex === undefined) {
            retryMessageIndices.set(retryId, messages.length)
            messages.push({
              role: 'retry',
              content: `${chain.length} 次重试`,
              retries: [...chain],
              seq: event.seq,
              ts: attempt.time,
            })
          } else {
            messages[existingIndex] = {
              ...messages[existingIndex],
              content: `${chain.length} 次重试`,
              retries: [...chain],
            }
          }
          continue
        }

        if (event.type === 'llm/retry-started') {
          const retryId = d?.retryId || `retry-${event.seq}`
          const chain = retryChains.get(retryId)
          if (chain) {
            const last = chain[chain.length - 1]
            if (last && last.retry === (d?.retry ?? 1)) last.retryState = 'started'
            const messageIndex = retryMessageIndices.get(retryId)
            if (messageIndex !== undefined) {
              messages[messageIndex] = {
                ...messages[messageIndex],
                retries: [...chain],
              }
            }
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
            messages.push({ role: 'command', content: existing.name, command: existing, seq: event.seq, ts: time })
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
            messages.push({ role: 'compaction', content: existing.summary || '上下文已压缩', compaction: existing, seq: event.seq, ts: time })
            compactionStates.delete(compactionId)
          }
          continue
        }

        // ─── todo/write ───
        if (event.type === 'todo/write') {
          messages.push({ role: 'todo', content: `${(d?.todos ?? []).length} 个任务`, todos: d?.todos ?? [], seq: event.seq, ts: time })
          continue
        }

        // ─── request/header ───
        if (event.type === 'request/header') {
          const header = d?.header
          messages.push({
            role: 'request-header',
            content: `模型: ${header?.config?.model || '未知'}`,
            requestHeader: { model: header?.config?.model, provider: header?.config?.provider },
            seq: event.seq,
            ts: time,
          })
          continue
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

  /**
   * 首次只取历史尾页；后续传入上一页的 beforeSeq，按 DSH WebUI 的方式向上翻页。
   * 返回的 messages 只对应本次已加载窗口，不会再次扫描整个会话。
   */
  async loadHistoryPage(beforeSeq?: number): Promise<HistoryPage> {
    const messages = await this.loadHistory({ beforeSeq, maxPages: 1 })
    return {
      messages,
      hasMore: this.historyHasMore,
      beforeSeq: this.historyCursor,
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
  async listSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt?: number; blank?: boolean; turns?: number; agentPreset?: string }>> {
    try {
      const value = (await this.rpc('session.list')) as { items?: Array<{ sessionId: string; updatedAt?: number; blank?: boolean; agentPreset?: string; projections?: { values?: { title?: string; sessionStats?: { turns?: number } } } }> }
      return (value?.items || [])
        .filter(item => !this.deletedSessionIds.has(item.sessionId))
        .map(item => ({
          sessionId: item.sessionId,
          title: item.projections?.values?.title || item.sessionId,
          updatedAt: item.updatedAt,
          blank: item.blank,
          turns: item.projections?.values?.sessionStats?.turns,
          agentPreset: item.agentPreset,
        }))
    } catch {
      return []
    }
  }

  async switchSession(sessionId: string): Promise<void> {
    this.abortPolling = true
    this.pendingQuestions.clear()
    this.setSession(sessionId)
    this.persistSession()
    // 新会话的 seq 从 0 起，必须立即重立基线，避免旧会话游标抑制新会话事件
    await this.refreshSeqBaseline()
    console.log(`[AgentService] 切换到会话: ${sessionId}`)
  }

  async createSession(): Promise<string | null> {
    try {
      const cwd = await this.resolveWorkspaceCwd()
      console.log(`[AgentService] 创建新会话 (cwd=${cwd})`)
      let value: { sessionId?: string } | null = null
      try {
        value = (await this.rpc('session.create', { cwd })) as { sessionId?: string }
      } catch (firstErr) {
        // 默认 preset 可能不存在（DSH 远程 preset 路径未解析），回退 cordis
        console.warn('[AgentService] 首次 session.create 失败，尝试 fallback preset cordis:', firstErr)
        value = (await this.rpc('session.create', { cwd, agentPreset: 'cordis' })) as { sessionId?: string }
      }
      if (value?.sessionId) {
        this.setSession(value.sessionId)
        this.persistSession()
        console.log(`[AgentService] 新会话已创建: ${this.sessionId}`)
        return value.sessionId
      }
      console.warn('[AgentService] session.create 未返回 sessionId')
      return null
    } catch (err) {
      console.error('[AgentService] 创建会话失败:', err)
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
    if (this.sessionId === sessionId) {
      // 当前会话被删除：同步清除实时流状态与持久化映射，避免下次刷新重复尝试恢复
      this.setSession(null)
      this.clearPersistedSession()
    }
    return true
  }

  // ═══════════════════════════════════════════════════════════
  //  Preset 管理
  // ═══════════════════════════════════════════════════════════

  /** 获取可用 preset 列表 */
  async listPresets(): Promise<Array<{ id: string; trust: string; name?: string; description?: string }>> {
    try {
      const value = await this.rpc('agentPreset.list', {}) as { presets?: Array<{ id: string; trust: string; name?: string; description?: string }> }
      return value?.presets || []
    } catch {
      return []
    }
  }

  /** 获取当前会话的 preset */
  async getCurrentPreset(): Promise<string | null> {
    try {
      const sessions = await this.listSessions()
      const current = sessions.find(s => s.sessionId === this.sessionId)
      return current?.agentPreset || null
    } catch {
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  模型管理
  // ═══════════════════════════════════════════════════════════

  /** 获取可用模型列表（按 provider 分组）+ 当前选择 */
  async getModels(sessionId?: string): Promise<{ groups: ModelGroup[], current: { provider: string; model: string; reasoningEffort?: string } | null }> {
    const sid = sessionId || this.sessionId
    if (!sid) throw new Error('无活跃会话')
    const value = await this.rpc('session.models', { sessionId: sid }) as ModelsResult
    return {
      groups: value?.groups || [],
      current: value?.current || null,
    }
  }

  /** 切换当前会话的模型 */
  async selectModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
    if (!this.sessionId) throw new Error('无活跃会话')
    console.log(`[AgentService] 尝试切换模型: provider=${provider}, model=${model}, effort=${reasoningEffort || 'default'}`)
    try {
      const result = await this.rpc('session.selectModel', {
        sessionId: this.sessionId,
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      })
      console.log(`[AgentService] 模型切换成功:`, result)
    } catch (err) {
      console.error(`[AgentService] 模型切换失败:`, err)
      throw err
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  凭证管理 (API Key)
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取凭证状态
   * @param refs - 要查询的凭证引用名数组（如 ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']）
   * @returns 凭证状态字典 { ref: CredentialInfo }
   */
  async describeCredentials(refs: string[]): Promise<Record<string, CredentialInfo>> {
    if (refs.length === 0) return {}
    const value = await this.rpc('credentials.describe', { refs }) as { credentials?: Record<string, CredentialInfo> }
    return value?.credentials || {}
  }

  /** 设置 API Key */
  async setCredential(ref: string, value: string): Promise<void> {
    await this.rpc('credentials.set', { ref, value })
    console.log(`[AgentService] 凭证已设置: ${ref}`)
  }

  /** 删除凭证 */
  async unsetCredential(ref: string): Promise<void> {
    await this.rpc('credentials.unset', { ref })
    console.log(`[AgentService] 凭证已删除: ${ref}`)
  }

  // ═══════════════════════════════════════════════════════════
  //  设置管理
  // ═══════════════════════════════════════════════════════════

  /** 获取设置描述 */
  async describeSettings(namespace?: string): Promise<SettingsDescribeResult> {
    const value = await this.rpc('settings.describe', namespace ? { namespace } : {}) as SettingsDescribeResult
    return value || { namespaces: {} }
  }

  /** 修改设置（最小化 diff） */
  async mutateSettings(ops: SettingsPathOp[]): Promise<void> {
    await this.rpc('settings.mutate', { ops })
    console.log(`[AgentService] 设置已更新:`, ops.length, '个操作')
  }

  /** 获取 LLM provider 列表 */
  async getLlmProviders(): Promise<ProviderInfo[]> {
    const value = await this.rpc('llm.providers', {}) as { providers?: ProviderInfo[] }
    return value?.providers || []
  }
}

// --- HMR 守卫：跨热更新保留连接状态 ---
const AGENT_SVC_KEY = '__ds_agentState__'
const g = globalThis as Record<string, unknown>
const agentService = new AgentService()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // 先保存状态，再释放旧实例的下行流（内部会置 idle，掐断重连定时器）
    g[AGENT_SVC_KEY] = {
      sessionId: agentService.getSessionId(),
      state: agentService.getState(),
    }
    agentService.releaseForHmr()
  })
}

const saved = g[AGENT_SVC_KEY] as { sessionId?: string; state?: ConnectionState } | undefined
if (saved?.sessionId && saved.state === 'connected') {
  ;(agentService as any).sessionId = saved.sessionId
  ;(agentService as any).state = 'connected'
  console.log(`[AgentService] HMR: 恢复会话 ${saved.sessionId}，重挂实时下行流`)
  // mux 连接不会跨热替换存活，必须显式重建并续听未闭合回合
  agentService.reattachLiveStream()
}

export { agentService }
