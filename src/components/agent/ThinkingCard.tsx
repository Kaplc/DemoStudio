/**
 * ThinkingCard — AI 尚未产出任何内容时的等待卡片
 *
 * 定位：用户发出消息后、AI 首个 token（reasoning / tool / content）到达之前，
 * 这段空窗期没有任何可渲染的节点，界面会看起来"没反应"。
 * 本卡片填补这段空窗，一旦收到任何实质输出即由 AgentPanel 移除。
 *
 * 显隐由外部控制（AgentPanel 派生），本组件只负责呈现，不持有状态：
 *  显示条件 = isAgentRunning && 本轮尚未收到任何 assistant/tool 输出
 *
 * 动画：三点依次跳动（stagger），纯 CSS，无 JS 定时器。
 * 尊重 prefers-reduced-motion：该模式下退化为静态呼吸效果。
 */
import React from 'react'

interface ThinkingCardProps {
  /** 自定义文案，默认"正在思考" */
  text?: string
}

const ThinkingCardInner: React.FC<ThinkingCardProps> = ({ text = '正在思考' }) => {
  return (
    <div className="agent-thinking-card" role="status" aria-live="polite">
      <span className="agent-thinking-card__dots" aria-hidden="true">
        <span className="agent-thinking-card__dot" />
        <span className="agent-thinking-card__dot" />
        <span className="agent-thinking-card__dot" />
      </span>
      <span className="agent-thinking-card__text">{text}</span>
    </div>
  )
}

export const ThinkingCard = React.memo(ThinkingCardInner)
