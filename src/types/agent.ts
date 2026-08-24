/**
 * Agent 相关类型定义
 *
 * 对齐 DSH 官方 SessionEventMap（packages/core/session/src/types.ts）
 * 和 ConversationNodeDefinition 语义
 */

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'
  | 'command' | 'compaction' | 'retry' | 'turn-error' | 'turn-max-tokens' | 'todo' | 'request-header'

export interface ToolState {
  id: string
  name: string
  args: unknown
  result?: unknown
  status: 'pending' | 'running' | 'success' | 'failure'
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

// ─── 消息节点 ───
export interface Message {
  id: string
  role: MessageRole
  content: string
  reasoning?: string        // 推理过程文本
  streaming?: boolean
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
  /** 模型/配置信息 */
  requestHeader?: { model?: string; provider?: string }
  /** 沙箱模式 */
  sandboxMode?: string
  /** 计划模式 */
  planMode?: { active: boolean }
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface AgentConfig {
  host: string
  portRange: [number, number]
  autoReconnect: boolean
  reconnectInterval: number
}

// ─── Agent 事件类型（完整对齐 DSH） ───
export type AgentEventType =
  // 流式内容
  | 'message.delta'
  | 'reasoning.delta'
  // 消息生命周期
  | 'message'
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
  // 沙箱/计划
  | 'sandboxMode'
  | 'planMode'
  // 问答
  | 'questionRequest'
  | 'questionResolved'
  // 系统
  | 'error'
  | 'ready'
  | 'closed'

export interface AgentEvent {
  type: AgentEventType
  payload?: unknown
}

export interface SessionInfo {
  sessionId: string
  title?: string
  updatedAt?: number
  blank?: boolean
  turns?: number
}

// ─── 事件 payload 类型 ───

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
  reason: 'initial' | 'resume' | 'change'
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
