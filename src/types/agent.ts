/**
 * Agent 相关类型定义
 */

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'

export interface ToolState {
  id: string
  name: string
  args: unknown
  result?: unknown
  status: 'pending' | 'running' | 'success' | 'failure'
  /** 仅 ask_user_question 工具：待回答的问题请求 */
  questionRequest?: PendingQuestionRequest
}

export interface SessionStats {
  turns?: number
  steps?: number
  ttftMs?: number
  decodeTokens?: number
  inputTokens?: number
  outputTokens?: number
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  reasoning?: string        // 推理过程文本
  streaming?: boolean
  /** 回合是否真正结束（turn/end completed），控制底部操作栏显示 */
  turnCompleted?: boolean
  tool?: ToolState
  ts: number
  stats?: SessionStats      // 轮次统计
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface AgentConfig {
  host: string
  portRange: [number, number]
  autoReconnect: boolean
  reconnectInterval: number
}

export interface AgentEvent {
  type: 'message.delta' | 'reasoning.delta' | 'message' | 'toolCall' | 'toolResult' | 'stepEnd'
    | 'questionRequest' | 'questionResolved' | 'error' | 'ready' | 'closed'
  payload?: unknown
}

export interface SessionInfo {
  sessionId: string
  title?: string
  updatedAt?: number
  blank?: boolean
  turns?: number
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

