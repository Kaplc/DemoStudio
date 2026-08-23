import React, { useState, useRef, useEffect } from 'react'

interface ReasoningBlockProps {
  content: string
  streaming?: boolean
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content, streaming }) => {
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

  // 流式时展开，完成后自动折叠
  useEffect(() => {
    if (streaming) {
      setExpandedSync(true)
      wasStreamingRef.current = true
    } else if (wasStreamingRef.current) {
      setExpandedSync(false)
      wasStreamingRef.current = false
    }
  }, [streaming])

  if (!content) return null

  // 流式时显示最后一行预览，折叠时显示行数
  const lines = content.split('\n')
  const preview = streaming ? lines[lines.length - 1] || '' : `${lines.length} 行推理`

  return (
    <div className={`reasoning-block ${expanded ? 'reasoning-block--expanded' : ''}`}>
      <button
        className="reasoning-block__toggle"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? '折叠推理过程' : '展开推理过程'}
      >
        <span className="reasoning-block__arrow">{expanded ? '▼' : '▶'}</span>
        <span className="reasoning-block__label">
          {streaming ? '思考中...' : '推理过程'}
        </span>
        {!expanded && !streaming && (
          <span className="reasoning-block__preview">{preview}</span>
        )}
        {streaming && !expanded && (
          <span className="reasoning-block__preview reasoning-block__preview--streaming">
            {preview}
          </span>
        )}
      </button>
      {expanded && (
        <div className="reasoning-block__content">
          <pre className="reasoning-block__text">{content}</pre>
          <div ref={endRef} />
        </div>
      )}
    </div>
  )
}
