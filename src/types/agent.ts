/**
 * Agent 相关类型定义
 *
 * 对齐 DSH 官方 SessionEventMap（packages/core/session/src/types.ts）
 * 和 ConversationNodeDefinition 语义
 */

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'
  | 'command' | 'compaction' | 'retry' | 'turn-error' | 'turn-max-tokens' | 'todo'
  | 'context'

/** 文件差异 hunk（对齐 DSH write/edit 工具 result meta.diffs 的权威格式，含 3 行上下文） */
export interface FileDiff {
  /** 相对会话 cwd 的文件路径 */
  path: string
  /** 变更前文本（上下文 + 删除行）；纯新增为 null */
  oldText: string | null
  /** 变更后文本（上下文 + 新增行）；纯删除为空串 */
  newText: string | null
}

export interface ToolState {
  id: string
  name: string
  args: unknown
  result?: unknown
  status: 'pending' | 'running' | 'success' | 'failure'
  /** write/edit 工具的已应用差异 hunk（tool/result meta 携带，展开卡片渲染 diff 视图） */
  diffs?: FileDiff[]
  /** 仅 ask_user_question 工具：待回答的问题请求 */
  questionRequest?: PendingQuestionRequest
  /** 子工具调用列表（code-dispatch 嵌套） */
  subCalls?: ToolState[]
  /** 调用时间戳 */
  callTime?: number
  /** 结果时间戳 */
  resultTime?: number
  /** 错误信息 */
  error?: { name: string; code: string }
}

export interface SessionStats {
  turns?: number
  steps?: number
  ttftMs?: number
  decodeTokens?: number
  inputTokens?: number
  outputTokens?: number
}

// ─── 回合结束原因（对齐 DSH TurnEndReason） ───
export type TurnEndReasonKind = 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted'

export interface TurnEndReason {
  kind: TurnEndReasonKind
  error?: { message: string; code?: string }
  reason?: { kind: string; reason?: string }
}

// ─── LLM 重试状态 ───
export interface RetryAttempt {
  retry: number
  retryState: 'scheduled' | 'started' | 'cancelled'
  turn: number
  step: number
  reason?: string
  delayMs?: number
  seq: number
  time: number
}

// ─── 命令状态 ───
export interface CommandState {
  commandId: string
  name: string
  args?: string
  outcome?: {
    kind: 'success' | 'error' | 'cancelled'
    text?: string
  }
  seq: number
  time: number
}

// ─── 压缩状态 ───
export interface CompactionState {
  compactionId: string
  status: 'running' | 'completed'
  summary?: string
  shadowedItemCount?: number
  shadowedTokenCount?: number
  startTime?: number
  endTime?: number
}

// ─── Todo 项 ───
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

// ─── 上下文注入卡片（对齐 DSH WebUI ContextMessageNode / ContextInjectionRow） ───
/** 已知呈现形态（dsh-llm ContextForm）；未知/缺失形态按原文渲染（opaque） */
export type KnownContextForm = 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall'

/** 注入来源的展示投影（对齐 WebUI contextProvenance + contextForm） */
export interface ContextCardInfo {
  /** 'recall' 仅跨会话引用召回；plugin / skill / 指令同步等均为 'inject' */
  role: 'recall' | 'inject'
  /** 生产者标签：插件名 / skill 名 / 指令文件路径 / source.kind */
  label: string | null
  /** 生产者声明的形态；不可识别时为 null */
  form: KnownContextForm | null
  /** 折叠行一句话摘要（仅 notice 形态记录） */
  summary: string | null
}

/** 实时流 context 事件负载 */
export interface ContextEventPayload extends ContextCardInfo {
  content: string
  seq: number
  time: number
}

// ─── 图片附件（输入框粘贴/拖拽 → 随消息发送） ───
/** DSH session.prompt 接受的图片 MIME 白名单（对齐 dsh-client-ui-conversation imageMediaType） */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** 输入框草稿中的待发送图片：file 为原始文件（发送时编码 base64），previewUrl 为本地预览 URL */
export interface PendingImage {
  id: string
  file: File
  previewUrl: string
  name: string
}

/** 用户消息上屏携带的图片引用（渲染用，不参与发送） */
export interface MessageImageRef {
  id: string
  previewUrl: string
  name?: string
}

/** session.prompt 的 content part：text 或 image（对齐 DSH 线上格式） */
export interface PromptContentPart {
  type: 'text' | 'image'
  text?: string
  /** 图片 MIME（type === 'image' 时必填） */
  mediaType?: string
  /** 图片纯 base64（不带 data: 前缀，type === 'image' 时必填） */
  data?: string
  /** 图片可选文件名 */
  name?: string
}

// ─── 消息节点 ───
export interface Message {
  id: string
  role: MessageRole
  content: string
  reasoning?: string        // 推理过程文本
  streaming?: boolean
  /** 用户消息携带的图片（仅上屏渲染；历史回放不补齐图片） */
  images?: MessageImageRef[]
  /** 回合是否真正结束（turn/end completed），控制底部操作栏显示 */
  turnCompleted?: boolean
  /** 回合结束原因 */
  turnEndReason?: TurnEndReason
  tool?: ToolState
  ts: number
  stats?: SessionStats      // 轮次统计
  /** 命令信息 */
  command?: CommandState
  /** 压缩信息 */
  compaction?: CompactionState
  /** 重试链 */
  retries?: RetryAttempt[]
  /** Todo 列表快照 */
  todos?: TodoItem[]
  /** 回合未闭合的半截 assistant 段（切换到运行中会话时由历史 chunk 回放产出，首个 live 段抵达时原地替换） */
  pendingPartial?: boolean
  /** 沙箱模式 */
  sandboxMode?: string
  /** 计划模式 */
  planMode?: { active: boolean }
  /** 推理卡片是否已折叠（收到 message.delta 时置 true） */
  reasoningCollapsed?: boolean
  /** 上下文注入卡片信息（role === 'context' 时存在） */
  context?: ContextCardInfo
}

/**
 * 连接状态机（agent 常驻化扩展）：
 * - idle        初始/已断开
 * - claiming    等待主进程完成 agent 引导（探测认领或 spawn）
 * - connecting  建立会话中
 * - connected   正常可用
 * - recovering  恢复已有会话中（localStorage 映射 → attach + history 补齐）
 * - disconnected 显式断开
 * - error       一次性错误（可自动重连）
 * - degraded    终态故障：主进程自愈超限/引导失败，需手动重启 agent
 */
export type ConnectionState =
  | 'idle'
  | 'claiming'
  | 'connecting'
  | 'connected'
  | 'recovering'
  | 'disconnected'
  | 'error'
  | 'degraded'

export interface AgentConfig {
  host: string
  portRange: [number, number]
  autoReconnect: boolean
  reconnectInterval: number
}

// ─── Agent 事件类型（完整对齐 DSH） ───
export type AgentEventType =
  // 流式内容（reasoning.delta / content.delta：live 推理与正文节流下发，payload 见 *DeltaPayload）
  | 'message.delta'
  | 'reasoning.delta'
  | 'content.delta'
  // 消息生命周期
  | 'message'
  | 'context'
  | 'toolCall'
  | 'toolResult'
  // Step/Turn 边界
  | 'turnStart'
  | 'turnEnd'
  | 'stepStart'
  | 'stepEnd'
  // LLM 重试
  | 'retryScheduled'
  | 'retryStarted'
  // 命令
  | 'commandRun'
  | 'commandDone'
  // 压缩
  | 'compactionStart'
  | 'compactionSummary'
  | 'compactionEnd'
  // 子工具调用
  | 'toolDispatchStart'
  | 'toolDispatch'
  // Todo
  | 'todoWrite'
  // 请求配置
  | 'requestHeader'
  | 'requestContext'
  // 上下文占用（对齐 DSH token-meter contextPressure 投影的编辑器简化 fold）
  | 'contextPressure'
  // 沙箱/计划
  | 'sandboxMode'
  | 'planMode'
  // 问答
  | 'questionRequest'
  | 'questionResolved'
  // 工具审批
  | 'approvalRequest'
  | 'approvalResolved'
  // 系统
  | 'error'
  | 'ready'
  | 'closed'
  // 运行态变更（含断档续听/会话恢复时的补发，驱动输入框运行态边框）
  | 'runningChange'
  // 会话列表快照更新（session/projection 投影帧实时合并 / listSessions 全量刷新后推送）
  | 'sessionsUpdated'

export interface AgentEvent {
  type: AgentEventType
  payload?: unknown
}

export interface SessionInfo {
  sessionId: string
  title?: string
  updatedAt?: number
  turns?: number
}

/** sessionsUpdated 事件 payload：合并投影帧 / 全量刷新后的最新会话列表快照 */
export interface SessionsUpdatedPayload {
  sessions: SessionInfo[]
}

// ─── 使用统计（对齐 DSH token-meter / session-stats 投影） ───

/**
 * 单会话累计 provider 用量（对齐 DSH TokenUsageProjection，四桶互斥）。
 * reasoning tokens 已含在 outputTokens 内，不重复累计。
 */
export interface SessionTokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 单会话整日志回合/步数与墙钟统计（对齐 DSH SessionStatsProjection 视图） */
export interface SessionStatsProjection {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

/** 使用统计面板的单会话条目（session.list 投影行的编辑器侧映射） */
export interface SessionUsageEntry {
  sessionId: string
  title?: string
  updatedAt?: number
  usage: SessionTokenUsage
  stats?: SessionStatsProjection
}

// ─── 事件 payload 类型 ───

/**
 * 实时推理下发（reasoning.delta）：reasoning-delta 在服务端按周期节流合并后的
 * 全量推理文本（非增量）。面板显示队列空闲时据此即时渲染 live 推理卡片。
 */
export interface ReasoningDeltaPayload {
  text: string
}

/**
 * 实时正文下发（content.delta）：text-delta 在服务端按周期节流合并后的
 * 全量正文文本（非增量）。面板显示队列空闲时据此即时渲染 live 正文。
 */
export interface ContentDeltaPayload {
  text: string
}

export interface TurnStartPayload {
  turn: number
  seq: number
  time: number
}

export interface TurnEndPayload {
  turn: number
  reason: TurnEndReason
  seq: number
  time: number
}

export interface StepStartPayload {
  turn: number
  step: number
  seq: number
  time: number
}

export interface StepEndPayload {
  turn: number
  step: number
  seq: number
  time: number
  reason?: string
}

export interface RetryScheduledPayload {
  retryId: string
  retry: number
  turn: number
  step: number
  reason?: string
  delayMs?: number
  seq: number
  time: number
}

export interface RetryStartedPayload {
  retryId: string
  retry: number
  seq: number
  time: number
}

export interface CommandRunPayload {
  commandId: string
  name: string
  args?: string
  seq: number
  time: number
}

export interface CommandDonePayload {
  commandId: string
  kind: 'success' | 'error' | 'cancelled'
  text?: string
  seq: number
  time: number
}

export interface CompactionStartPayload {
  compactionId: string
  seq: number
  time: number
}

export interface CompactionSummaryPayload {
  compactionId: string
  summary?: string
  shadowedItemCount?: number
  shadowedTokenCount?: number
  seq: number
  time: number
}

export interface CompactionEndPayload {
  compactionId: string
  seq: number
  time: number
}

export interface ToolDispatchStartPayload {
  rootCallId: string
  parentCallId: string
  subCallId: string
  name: string
  arguments: unknown
  seq: number
  time: number
}

export interface ToolDispatchPayload {
  rootCallId: string
  parentCallId: string
  subCallId: string
  name: string
  arguments: unknown
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
  seq: number
  time: number
}

export interface TodoWritePayload {
  todos: TodoItem[]
  seq: number
  time: number
}

export interface RequestHeaderPayload {
  model?: string
  provider?: string
  reasoningEffort?: string
  reason: 'initial' | 'resume' | 'change'
  seq: number
  time: number
}

/**
 * 上下文占用快照（contextPressure）：输入框底部进度圈的数据源。
 * 对齐 DSH token-meter 的 last-wins 语义 —— usedTokens 来自最近一次
 * provider usage 上报（该步完成时的实际占用 = prompt + 输出），contextWindow
 * 来自最近一条 request/context 路由容量。任一字段缺失时 UI 不渲染（对齐
 * DSH ContextMeter 无数据不出环的行为）。
 */
export interface ContextPressurePayload {
  /** 最近一次 usage 上报的占用 token 数（未采样前缺失） */
  usedTokens?: number
  /** 最近一条 request/context 的路由容量（模型未声明或未请求前缺失） */
  contextWindow?: number
  seq: number
  time: number
}

export interface SandboxModePayload {
  mode: string
  seq: number
  time: number
}

export interface PlanModePayload {
  active: boolean
  seq: number
  time: number
}

// --- DSH 问答协议（对齐 DSH 官方 @deepseek-ai/dsh-user-questions/types） ---

/** 一个选项 */
export interface QuestionOption {
  label: string
  description?: string
}

/** 一个问题（对齐 AskUserQuestionItem） */
export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

/** 一个待回答的问题请求（对应 mux 帧 question/requested） */
export interface PendingQuestionRequest {
  /** mux 帧的 rpcId，也是 respond 的回执标识 */
  rpcId: string
  sessionId: string
  questions: QuestionItem[]
}

/** 单个问题的回答 */
export interface QuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

/** 整组回答（对应 QuestionResponsePayload.answer） */
export interface QuestionAnswer {
  answers: QuestionAnswerItem[]
}

// ─── 工具审批（对齐 DSH approval/request 瀑布与 host-apiproxy events.schema） ───

/** 客户端可回答的审批结论（其余 resolved 值由 host 广播，不受理） */
export type ApprovalOutcome = 'allowed-once' | 'rejected'

/** mux 帧 approval/requested 的待审批请求 */
export interface PendingApprovalRequest {
  /** server-request 信封的 rpcId，respond 回执标识 */
  rpcId: string
  sessionId: string
  /** 服务端签发的一次性审批 id（approval/resolved 按它配对） */
  approvalId: string
  /** 请求越权执行的工具名 */
  toolName: string
  /** 关联的工具调用 id（可用来在转录里查命令行） */
  callId?: string
  /** 请求方的可读原因（headline 优先展示它） */
  reason?: string
}
