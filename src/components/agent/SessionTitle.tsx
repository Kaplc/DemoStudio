import React from 'react'
import type { SessionInfo } from '../../types/agent'

/**
 * SessionTitle - 面板头部当前会话标题。
 *
 * 标题解析规则（resolveSessionTitle 纯函数，供单测与渲染共用）：
 * - 无当前会话（未连接/尚未建立会话）→ 回退占位「Agent」；
 * - 会话存在但列表未含该 id（DSH 侧 blank 新会话被 session.list 过滤）→ 「新会话」；
 * - 会话在列表中但无标题投影，或投影仍回退为 sessionId 原文 → 「新会话」；
 * - 其余 → 显示会话标题投影原文。
 */
export const resolveSessionTitle = (sessionId: string | undefined, sessions: SessionInfo[]): string => {
  if (!sessionId) return 'Agent'
  const current = sessions.find(s => s.sessionId === sessionId)
  // DSH listSessions 对未命名会话的 title 回退为 sessionId（UUID 原文），视为未命名
  if (!current?.title || current.title === sessionId) return '新会话'
  return current.title
}

interface SessionTitleProps {
  /** 当前会话 id（agentService.getSessionId()，未连接时为 undefined） */
  sessionId?: string
  /** 会话列表（含标题投影，来自 AgentService.listSessions） */
  sessions: SessionInfo[]
}

export const SessionTitle: React.FC<SessionTitleProps> = ({ sessionId, sessions }) => {
  const title = resolveSessionTitle(sessionId, sessions)
  return (
    <span className="agent-panel__title" title={title}>
      {title}
    </span>
  )
}
