/**
 * 推理过程折叠块
 *
 * 折叠逻辑：
 *  - forceCollapsed=true → 强制折叠（收到 message.delta 时）
 *  - streaming=true → 展开（推理进行中）
 *  - streaming=false → 折叠（stepEnd 触发，模型调用结束）
 *
 * 滚动逻辑（流式贴底）：
 *  直接设置 <pre>.scrollTop，而不是 scrollIntoView —— 哨兵元素是 <pre> 的兄弟节点，
 *  不在 pre 的滚动祖先链上，scrollIntoView 对它无效。
 *  用户手动上翻时停止跟随，回到底部后恢复跟随（避免打断阅读）。
 *
 * bare 模式：
 *  被 StepProcess 收纳时启用。此时不再渲染自己的折叠头（由外层统一控制），
 *  但保留自身限高滚动——否则单个超长推理块会把过程区撑得极长，
 *  外层滚动条要拖很久才能看到后面的工具卡片。
 *  块内跟随：流式时贴到底部，用户上翻后停止跟随（与外层策略一致）。
 *  块内滚动用 overscroll-behavior: contain 阻断滚动链，避免滚到块底后带着外层一起滚。
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'

interface ReasoningBlockProps {
  content: string
  streaming?: boolean
  /** 强制折叠（收到 message.delta 时置 true） */
  forceCollapsed?: boolean
  /**
   * 裸模式：只渲染文本，不渲染折叠头、不限制高度
   * 用于被 StepProcess 包裹时，滚动与折叠由外层统一接管
   */
  bare?: boolean
}

/** 贴底判定容差（px）：距底部小于此值视为"贴底"，继续自动跟随 */
const STICK_THRESHOLD = 24

const ReasoningBlockInner: React.FC<ReasoningBlockProps> = ({ content, streaming, forceCollapsed, bare }) => {
  const [expanded, setExpanded] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const wasStreamingRef = useRef(false)
  const expandedRef = useRef(false)
  /** 是否跟随到底部（用户上翻时置 false，回到底部时恢复 true） */
  const stickToBottomRef = useRef(true)

  // 同步 expanded state 到 ref
  const setExpandedSync = (v: boolean) => {
    expandedRef.current = v
    setExpanded(v)
  }

  // 用户手动滚动：更新贴底标记
  const handleScroll = useCallback(() => {
    const el = preRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceToBottom < STICK_THRESHOLD
  }, [])

  // 流式时贴底：内容增长后把滚动容器推到最新位置
  // bare 模式下也启用 —— 块自身限高滚动，跟随最新推理内容
  useEffect(() => {
    const el = preRef.current
    if (!el) return
    // 仅在展开 + 流式 + 用户未上翻时跟随（bare 模式恒为展开）
    if (!expandedRef.current || !streaming || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [content, streaming, bare])

  // 折叠/展开逻辑（bare 模式下由外层接管折叠，跳过内部状态机）
  useEffect(() => {
    if (bare) {
      // 外层已展开本块，同步为"展开"以启用块内贴底跟随
      expandedRef.current = true
      return
    }
    if (forceCollapsed) {
      // 收到 message.delta → 强制折叠推理卡片
      setExpandedSync(false)
      return
    }
    if (streaming) {
      if (!wasStreamingRef.current) {
        // 新一轮推理开始：重置为跟随底部
        stickToBottomRef.current = true
      }
      setExpandedSync(true)
      wasStreamingRef.current = true
    } else if (wasStreamingRef.current) {
      // assistant/chunk finish → stepEnd → streaming 变为 false → 折叠
      setExpandedSync(false)
      wasStreamingRef.current = false
    }
  }, [streaming, forceCollapsed, bare])

  if (!content) return null

  // ─── 裸模式：只输出文本，折叠与滚动交给 StepProcess ───
  if (bare) {
    return (
      <pre
        ref={preRef}
        className="reasoning-block__text reasoning-block__text--bare"
        onScroll={handleScroll}
      >{content}</pre>
    )
  }

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
        <pre
          ref={preRef}
          className="reasoning-block__text"
          onScroll={handleScroll}
        >{content}</pre>
      </div>
    </div>
  )
}

export const ReasoningBlock = React.memo(ReasoningBlockInner, (prev, next) => {
  return prev.content === next.content
    && prev.streaming === next.streaming
    && prev.forceCollapsed === next.forceCollapsed
    && prev.bare === next.bare
})
