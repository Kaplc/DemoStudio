/**
 * 消息气泡组件
 * 支持 Markdown 渲染 + 推理折叠
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useState, useCallback, useMemo } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ReasoningBlock } from './ReasoningBlock'
import type { Message } from '../../types/agent'

interface MessageBubbleProps {
  message: Message
  isFinal?: boolean
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ message, isFinal }) => {
  const [copied, setCopied] = useState(false)

  const formatTime = (ts: number): string => {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getRoleLabel = (role: string): string => {
    switch (role) {
      case 'user': return '你'
      case 'assistant': return 'Agent'
      case 'tool': return '工具'
      case 'system': return '系统'
      default: return role
    }
  }

  const getRoleClass = (role: string): string => {
    switch (role) {
      case 'user': return 'message--user'
      case 'assistant': return 'message--assistant'
      case 'tool': return 'message--tool'
      case 'system': return 'message--system'
      default: return ''
    }
  }

  const handleCopy = useCallback(() => {
    const text = message.reasoning
      ? `[推理]\n${message.reasoning}\n\n[回复]\n${message.content}`
      : message.content
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [message.content, message.reasoning])

  const isAssistant = message.role === 'assistant'
  const isUser = message.role === 'user'

  return (
    <div className={`message ${getRoleClass(message.role)}`}>
      <div className="message__header">
        <span className="message__role">
          {getRoleLabel(message.role)}
        </span>
        {message.role === 'system' && (
          <span className="message__time">{formatTime(message.ts)}</span>
        )}
      </div>

      {/* 消息内容 */}
      <div className="message__body">
        {isAssistant ? (
          <MarkdownRenderer content={message.content} streaming={message.streaming} />
        ) : (
          <span>{message.content}</span>
        )}
      </div>

      {/* 消息底部操作栏 */}
      {((isAssistant && isFinal) || isUser) && !message.streaming && (
        <div className="message__footer">
          <span className="message__time">{formatTime(message.ts)}</span>
          {isAssistant && (
            <button
              className="message__footer-btn"
              onClick={handleCopy}
              title="复制"
            >
              {copied ? '✓' : '📋'}
            </button>
          )}
        </div>
      )}

      {/* 统计信息 */}
      {message.stats && (
        <div className="message__stats">
          {message.stats.ttftMs && <span>首token: {message.stats.ttftMs}ms</span>}
          {message.stats.outputTokens && <span>输出: {message.stats.outputTokens} tokens</span>}
          {message.stats.inputTokens && <span>输入: {message.stats.inputTokens} tokens</span>}
        </div>
      )}
    </div>
  )
}

export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => {
  return prev.message.id === next.message.id
    && prev.message.content === next.message.content
    && prev.message.reasoning === next.message.reasoning
    && prev.message.streaming === next.message.streaming
    && prev.message.turnCompleted === next.message.turnCompleted
    && prev.message.ts === next.message.ts
    && prev.isFinal === next.isFinal
    && prev.message.stats === next.message.stats
})
