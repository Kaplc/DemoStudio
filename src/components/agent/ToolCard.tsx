/**
 * 工具调用卡片组件
 * 参考 DSH Web UI 的 ToolRow 设计
 */
import React, { useState } from 'react'
import type { ToolState } from '../../types/agent'

interface ToolCardProps {
  tool: ToolState
}



function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const [expanded, setExpanded] = useState(false)

  const argsStr = tool.args ? (() => {
    try { return JSON.stringify(tool.args, null, 2) } catch { return String(tool.args) }
  })() : ''

  const resultStr = tool.result ? (() => {
    try { return JSON.stringify(tool.result, null, 2) } catch { return String(tool.result) }
  })() : ''

  // 摘要：第一个参数值或工具名
  const summary = tool.args && typeof tool.args === 'object'
    ? truncate(Object.values(tool.args as Record<string, unknown>).map(String).join(' '), 60)
    : tool.name

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
              <div className="tool-card__section-label">📥 输入</div>
              <pre className="tool-card__code"><code>{argsStr}</code></pre>
            </div>
          )}
          {resultStr && (
            <div className="tool-card__section">
              <div className="tool-card__section-label">📤 输出</div>
              <pre className={`tool-card__code ${tool.status === 'failure' ? 'tool-card__code--error' : ''}`}>
                <code>{resultStr}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
