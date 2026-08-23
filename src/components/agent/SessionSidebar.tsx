import React from 'react'
import type { SessionInfo } from '../../types/agent'

interface SessionSidebarProps {
  sessions: SessionInfo[]
  currentSessionId?: string
  onSwitch: (sessionId: string) => void
  onNew: () => void
  onDelete: (sessionId: string) => void
  onClose: () => void
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  currentSessionId,
  onSwitch,
  onNew,
  onDelete,
  onClose,
}) => {
  const formatTime = (ts?: number) => {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  const activeSessions = sessions.filter(s => !s.blank)
  const blankSessions = sessions.filter(s => s.blank)

  return (
    <div className="session-sidebar">
      <div className="session-sidebar__header">
        <span>会话列表</span>
        <button className="session-sidebar__close" onClick={onClose}>✕</button>
      </div>

      <button className="session-sidebar__new" onClick={onNew}>
        ＋ 新建会话
      </button>

      <div className="session-sidebar__list">
        {activeSessions.length === 0 && (
          <div className="session-sidebar__empty">暂无会话</div>
        )}
        {activeSessions.map(s => (
          <div
            key={s.sessionId}
            className={`session-sidebar__item ${s.sessionId === currentSessionId ? 'session-sidebar__item--active' : ''}`}
            onClick={() => onSwitch(s.sessionId)}
          >
            <div className="session-sidebar__item-row">
              <div className="session-sidebar__item-title">
                {s.title || s.sessionId.slice(0, 12) + '...'}
              </div>
              <button
                className="session-sidebar__delete"
                title="删除会话"
                onClick={(e) => { e.stopPropagation(); onDelete(s.sessionId) }}
              >
                🗑
              </button>
            </div>
            <div className="session-sidebar__item-meta">
              {s.turns !== undefined && <span>{s.turns} 轮</span>}
              <span>{formatTime(s.updatedAt)}</span>
            </div>
          </div>
        ))}

        {blankSessions.length > 0 && (
          <>
            <div className="session-sidebar__divider">空白会话</div>
            {blankSessions.slice(0, 3).map(s => (
              <div
                key={s.sessionId}
                className="session-sidebar__item session-sidebar__item--blank"
                onClick={() => onSwitch(s.sessionId)}
              >
                <div className="session-sidebar__item-title">
                  {s.sessionId.slice(0, 12)}...
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
