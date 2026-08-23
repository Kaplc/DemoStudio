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
  type: 'message.delta' | 'reasoning.delta' | 'message' | 'toolCall' | 'toolResult' | 'error' | 'ready' | 'closed'
  payload?: unknown
}

export interface SessionInfo {
  sessionId: string
  title?: string
  updatedAt?: number
  blank?: boolean
  turns?: number
}
