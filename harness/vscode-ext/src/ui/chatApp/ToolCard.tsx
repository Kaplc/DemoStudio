/**
 * 工具调用卡片：展示工具名、调用参数、调用中/成功/失败状态、返回摘要
 */
import * as React from 'react'
import type { ToolState } from './types'

interface Props {
  tool: ToolState
}

const STATUS_ICON: Record<ToolState['status'], string> = {
  pending: '⏳',
  running: '⚙️',
  success: '✅',
  failure: '❌',
}

const STATUS_LABEL: Record<ToolState['status'], string> = {
  pending: '调用中',
  running: '执行中',
  success: '完成',
  failure: '失败',
}

export const ToolCard: React.FC<Props> = ({ tool }) => {
  return (
    <div className={`tool-card tool-card--${tool.status}`}>
      <div className="tool-card__head">
        <span className="tool-card__icon">{STATUS_ICON[tool.status]}</span>
        <code className="tool-card__name">{tool.name}</code>
        <span className="tool-card__status">{STATUS_LABEL[tool.status]}</span>
      </div>
      {tool.args !== undefined && (
        <details className="tool-card__args">
          <summary>参数</summary>
          <pre><code>{JSON.stringify(tool.args, null, 2)}</code></pre>
        </details>
      )}
      {tool.result !== undefined && (
        <details open={tool.status === 'failure'} className="tool-card__result">
          <summary>返回</summary>
          <pre><code>{formatResult(tool.result)}</code></pre>
        </details>
      )}
    </div>
  )
}

function formatResult(r: unknown): string {
  if (typeof r === 'string') return r
  try {
    return JSON.stringify(r, null, 2)
  } catch {
    return String(r)
  }
}
