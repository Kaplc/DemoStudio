/**
 * 工具调用卡片组件
 * 参考 DSH Web UI 的 ToolRow 设计
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useState, useMemo } from 'react'
import type { ToolState } from '../../types/agent'

interface ToolCardProps {
  tool: ToolState
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

/** 缓存 JSON.stringify 结果，避免每次 render 重新序列化 */
function useSerializedJson(value: unknown): string {
  return useMemo(() => {
    if (!value) return ''
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }, [value])
}

const ToolCardInner: React.FC<ToolCardProps> = ({ tool }) => {
  const [expanded, setExpanded] = useState(false)

  const argsStr = useSerializedJson(tool.args)
  const resultStr = useSerializedJson(tool.result)

  // 摘要：显示参数的关键信息（memoize）
  const summary = useMemo(() => {
    // ask_user_question 特殊摘要：显示问题文本
    if (tool.name === 'ask_user_question' && tool.args && typeof tool.args === 'object') {
      const questions = (tool.args as { questions?: Array<{ question?: string }> }).questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0]
        if (first?.question) {
          return truncate(first.question, 80)
        }
      }
    }
    if (!tool.args || typeof tool.args !== 'object') return ''
    const obj = tool.args as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return ''
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'string' && v.length > 0) return truncate(v, 60)
    }
    return truncate(JSON.stringify(obj), 60)
  }, [tool.args, tool.name])

  return (
    <div className={`tool-card tool-card--${tool.status}`}>
      <div
        className="tool-card__head"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded) }}
      >
        <span className="tool-card__name">{tool.name}</span>
        <span className="tool-card__summary">{summary}</span>
        <span className="tool-card__status-dot"></span>
        <span className="tool-card__arrow">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="tool-card__details">
          {argsStr && (
            <div className="tool-card__section">
              <div className="tool-card__section-label">输入</div>
              <div className="md-code-block">
                <pre><code>{argsStr}</code></pre>
              </div>
            </div>
          )}
          {resultStr && (
            <div className="tool-card__section">
              <div className="tool-card__section-label">输出</div>
              <div className={`md-code-block ${tool.status === 'failure' ? 'md-code-block--error' : ''}`}>
                <pre><code>{resultStr}</code></pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCard = React.memo(ToolCardInner, (prev, next) => {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.result === next.tool.result
    && prev.tool.args === next.tool.args
})
