import React, { useEffect, useState } from 'react'
import type { SessionInfo } from '../../types/agent'
import { splitSessionsByAge } from './sessionGrouping'
// 直连 Logger 模块（勿用 '../../engine' barrel）：本组件在 Agent 独立入口（agent.html）
// 的依赖闭包内，barrel 会把整个引擎拉进 agent 图（见 devdoc/agent-window-independent-entry）
import { logger } from '../../engine/Logger'

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
  /** 「3 天前会话」折叠组展开态：默认收起（自动折叠） */
  const [olderExpanded, setOlderExpanded] = useState(false)

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
  const { recent: recentSessions, older: olderSessions } = splitSessionsByAge(activeSessions, currentSessionId)

  // 生命周期埋点：侧边栏每次打开/列表变化时记录分组结果，便于从日志还原执行路径
  useEffect(() => {
    logger.info(`[SessionSidebar] 会话分组: 近期 ${recentSessions.length} 个平铺, 3天前 ${olderSessions.length} 个（默认${olderExpanded ? '展开' : '折叠'}）`)
    // 仅在分组结果变化时记录，展开态变化由切换处单独记录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentSessions.length, olderSessions.length])

  const toggleOlderGroup = () => {
    const next = !olderExpanded
    setOlderExpanded(next)
    logger.info(`[SessionSidebar] ${next ? '展开' : '折叠'} 3 天前会话组（${olderSessions.length} 个）`)
  }

  const renderItem = (s: SessionInfo, extraClass = '') => (
    <div
      key={s.sessionId}
      className={`session-sidebar__item ${s.sessionId === currentSessionId ? 'session-sidebar__item--active' : ''} ${extraClass}`}
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
  )

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
        {recentSessions.map(s => renderItem(s))}

        {olderSessions.length > 0 && (
          <>
            <div
              className="session-sidebar__group"
              role="button"
              data-testid="session-sidebar-older-group"
              onClick={toggleOlderGroup}
            >
              <span className="session-sidebar__group-arrow">{olderExpanded ? '▾' : '▸'}</span>
              <span>3 天前的会话（{olderSessions.length}）</span>
            </div>
            {olderExpanded && olderSessions.map(s => renderItem(s))}
          </>
        )}

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
