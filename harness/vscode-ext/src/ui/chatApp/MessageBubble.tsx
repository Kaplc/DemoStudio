/**
 * MessageBubble：消息气泡组件（对齐 DSH 的 MessageItem + AssistantNodeView）
 *
 * 支持：
 * - 用户消息：右对齐，带时间戳
 * - 助手消息：Markdown 渲染 + 思考过程 + 流式光标
 * - 工具消息：嵌入 ToolCallTree
 * - 系统消息：居中灰色小字
 * - 重试提示：倒计时显示
 */
import * as React from 'react'
import type { Message, AssistantBlock } from './types'
import { MarkdownText } from './MarkdownText'
import { ToolCallTree } from './ToolCallTree'

interface Props {
  message: Message
  toolMap?: Map<string, import('./types').ToolCall>
}

/** 格式化时间 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 用户消息气泡 */
const UserMessage: React.FC<{ message: Message }> = ({ message }) => (
  <div className="message message--user">
    <div className="message__header">
      <span className="message__role">你</span>
      <span className="message__time">{formatTime(message.ts)}</span>
    </div>
    <div className="message__body">{message.content}</div>
  </div>
)

/** 助手消息气泡（支持结构化块渲染） */
const AssistantMessage: React.FC<{ message: Message; toolMap?: Map<string, import('./types').ToolCall> }> = ({ message, toolMap }) => {
  const blocks = message.blocks ?? []

  // 如果没有 blocks，直接渲染 content
  if (blocks.length === 0) {
    return (
      <div className={`message message--assistant${message.streaming ? ' message--streaming' : ''}`}>
        <div className="message__header">
          <span className="message__role">🤖 DSH</span>
          <span className="message__time">{formatTime(message.ts)}</span>
        </div>
        <div className="message__body">
          {message.content ? <MarkdownText text={message.content} streaming={message.streaming} /> : null}
          {message.streaming && <span className="streaming-cursor">▊</span>}
        </div>
      </div>
    )
  }

  // 按 blocks 渲染
  return (
    <div className={`message message--assistant${message.streaming ? ' message--streaming' : ''}`}>
      <div className="message__header">
        <span className="message__role">🤖 DSH</span>
        <span className="message__time">{formatTime(message.ts)}</span>
      </div>
      <div className="message__body">
        {blocks.map((block, i) => (
          <AssistantBlockView key={i} block={block} toolMap={toolMap} streaming={message.streaming} />
        ))}
        {message.streaming && <span className="streaming-cursor">▊</span>}
      </div>
    </div>
  )
}

/** 单个助手消息块渲染 */
const AssistantBlockView: React.FC<{
  block: AssistantBlock
  toolMap?: Map<string, import('./types').ToolCall>
  streaming?: boolean
}> = ({ block, toolMap, streaming }) => {
  switch (block.kind) {
    case 'text':
      return <MarkdownText text={block.text} streaming={streaming} />
    case 'reasoning':
      return (
        <details className="reasoning-block">
          <summary>💭 思考过程</summary>
          <div className="reasoning-block__body">
            <MarkdownText text={block.text} streaming={streaming} />
          </div>
        </details>
      )
    case 'tool-call': {
      const tool = toolMap?.get(block.callId)
      if (!tool) return null
      return <ToolCallTree tool={tool} />
    }
    default:
      return null
  }
}

/** 工具调用消息（独立的工具消息，非嵌入助手消息中） */
const ToolMessage: React.FC<{ message: Message }> = ({ message }) => {
  if (!message.tool) return null
  return (
    <div className="message message--tool">
      <ToolCallTree tool={message.tool} />
    </div>
  )
}

/** 系统消息 */
const SystemMessage: React.FC<{ message: Message }> = ({ message }) => (
  <div className="message message--system">
    <span className="message__system">{message.content}</span>
  </div>
)

/** 消息气泡主组件 */
export const MessageBubble: React.FC<Props> = ({ message, toolMap }) => {
  switch (message.role) {
    case 'user':
      return <UserMessage message={message} />
    case 'assistant':
      return <AssistantMessage message={message} toolMap={toolMap} />
    case 'tool':
      return <ToolMessage message={message} />
    case 'system':
      return <SystemMessage message={message} />
    default:
      return null
  }
}
