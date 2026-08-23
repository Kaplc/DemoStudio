/**
 * 消息气泡组件
 * 支持 Markdown 渲染 + 推理折叠
 */
import React, { useState, useCallback } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ReasoningBlock } from './ReasoningBlock'
import type { Message } from '../../types/agent'

interface MessageBubbleProps {
  message: Message
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
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
        {(isAssistant || message.role === 'system') && (
          <span className="message__time">{formatTime(message.ts)}</span>
        )}
        {isUser && (
          <div className="message__actions">
            <span className="message__time">{formatTime(message.ts)}</span>
          </div>
        )}
      </div>

      {/* 推理折叠块（流式时显示，完成后也保留） */}
      {message.reasoning && (
        (() => {
          console.log('[MessageBubble] 渲染 ReasoningBlock, streaming:', message.streaming, 'msgId:', message.id)
          return <ReasoningBlock content={message.reasoning} streaming={message.streaming} />
        })()
      )}

      {/* 消息内容 */}
      <div className="message__body">
        {isAssistant ? (
          <MarkdownRenderer content={message.content} streaming={message.streaming} />
        ) : (
          <span>{message.content}</span>
        )}
      </div>

      {/* AI 消息底部操作栏 */}
      {isAssistant && !message.streaming && (
        <div className="message__footer">
          <button
            className="message__footer-btn"
            onClick={handleCopy}
            title="复制"
          >
            {copied ? '✓' : '📋'}
          </button>
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
