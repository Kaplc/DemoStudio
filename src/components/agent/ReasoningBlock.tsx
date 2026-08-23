/**
 * 推理过程折叠块
 *
 * 折叠逻辑：
 *  - streaming=true → 展开（推理进行中）
 *  - streaming=false → 折叠（stepEnd 触发，模型调用结束）
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useState, useRef, useEffect } from 'react'

interface ReasoningBlockProps {
  content: string
  streaming?: boolean
}

const ReasoningBlockInner: React.FC<ReasoningBlockProps> = ({ content, streaming }) => {
  const [expanded, setExpanded] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const wasStreamingRef = useRef(false)
  const expandedRef = useRef(false)

  // 同步 expanded state 到 ref
  const setExpandedSync = (v: boolean) => {
    expandedRef.current = v
    setExpanded(v)
  }

  // 流式时自动滚动到最新行
  useEffect(() => {
    if (streaming && expandedRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [content, streaming])

  // 流式时展开，streaming 结束（stepEnd）时折叠
  useEffect(() => {
    if (streaming) {
      setExpandedSync(true)
      wasStreamingRef.current = true
    } else if (wasStreamingRef.current) {
      // assistant/chunk finish → stepEnd → streaming 变为 false → 折叠
      setExpandedSync(false)
      wasStreamingRef.current = false
    }
  }, [streaming])

  if (!content) return null

  // 流式时显示最后一行预览，折叠时显示行数
  const lines = content.split('\n')
  const preview = streaming ? lines[lines.length - 1] || '' : `${lines.length} 行推理`

  // 使用类似 ToolCard 的样式结构
  const statusClass = streaming ? 'tool-card--running' : 'tool-card--success'

  return (
    <div className={`tool-card ${statusClass}`}>
      <div
        className="tool-card__head"
        onClick={() => setExpandedSync(!expandedRef.current)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedSync(!expandedRef.current) }}
      >
        <span className="tool-card__name">推理</span>
        <span className="tool-card__summary">{streaming ? '思考中...' : preview}</span>
        <span className="tool-card__status-dot"></span>
        <span className="tool-card__arrow">{expandedRef.current ? '▼' : '▶'}</span>
      </div>

      <div className={`reasoning-block__details ${expandedRef.current ? 'reasoning-block__details--expanded' : ''}`}>
        <pre className="reasoning-block__text">{content}</pre>
        <div ref={endRef} />
      </div>
    </div>
  )
}

export const ReasoningBlock = React.memo(ReasoningBlockInner, (prev, next) => {
  return prev.content === next.content
    && prev.streaming === next.streaming
})
