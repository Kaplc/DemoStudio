/**
 * DSH Chat 数据模型（对齐 DSH client-runtime 的 Node 体系）
 *
 * 消息类型：user / assistant（流式+结构化块） / tool（带状态机） / system / reasoning
 */

// ── 工具调用 ──

export type ToolCallState = 'pending' | 'running' | 'success' | 'error' | 'stopped'
export type ToolVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

export interface ToolCall {
  id: string
  name: string
  variant: ToolVariant
  args: Record<string, unknown>
  state: ToolCallState
  result?: unknown
  error?: string
  filePath?: string
  durationMs?: number
  subCalls: ToolCall[]
  expanded?: boolean
}

// ── 助手消息块 ──

export interface AssistantTextBlock { kind: 'text'; text: string }
export interface AssistantToolCallBlock { kind: 'tool-call'; callId: string }
export interface AssistantReasoningBlock { kind: 'reasoning'; text: string }
export type AssistantBlock = AssistantTextBlock | AssistantToolCallBlock | AssistantReasoningBlock

// ── 消息 ──

export type Role = 'user' | 'assistant' | 'tool' | 'system'

export interface Message {
  id: string
  role: Role
  content: string
  ts: number
  streaming?: boolean
  blocks?: AssistantBlock[]
  tool?: ToolCall
  interrupted?: boolean
}

// ── 状态栏 ──

export type KernelStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface StatusBarState {
  kernelStatus: KernelStatus
  kernelDetail: string
  toolCount: number
  gameRunning: boolean
}
