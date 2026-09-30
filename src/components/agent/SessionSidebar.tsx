import React, { useEffect, useState } from 'react'
import type { SessionInfo, SessionRunStatus } from '../../types/agent'
import { splitSessionsByAge } from './sessionGrouping'
// 直连 Logger 模块（勿用 '../../engine' barrel）：本组件在 Agent 独立入口（agent.html）
// 的依赖闭包内，barrel 会把整个引擎拉进 agent 图（见 devdoc/agent-window-independent-entry）
import { logger } from '../../engine/Logger'

interface SessionSidebarProps {
  sessions: SessionInfo[]
  /** 会话状态灯表（绿=回合运行中/红=上次回合失败），无条目 = 无灯 */
  sessionStatuses?: Record<string, SessionRunStatus>
  /** 会话健康分表（损失信号派生：max(0,100−Σweight)），无条目 = 无徽标 */
  healthScores?: Record<string, number>
  currentSessionId?: string
  onSwitch: (sessionId: string) => void
  /** 点击运行中状态灯 → 停止该会话回合（跨会话远程停止/僵尸灯清理）；缺省 = 灯纯展示 */
  onStopSession?: (sessionId: string) => void
  onNew: () => void
  onClose: () => void
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  sessionStatuses,
  healthScores,
  currentSessionId,
  onSwitch,
  onStopSession,
  onNew,
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

  const { recent: recentSessions, older: olderSessions } = splitSessionsByAge(sessions, currentSessionId)

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

  /** 状态灯描述文案（title 悬停提示） */
  const statusTitle: Record<SessionRunStatus, string> = {
    running: '运行中',
    error: '上次回合失败',
  }

  const renderItem = (s: SessionInfo, extraClass = '') => {
    const status: SessionRunStatus | undefined = sessionStatuses?.[s.sessionId]
    // 健康分徽标：有损失记录才展示（<60 红 / 60-89 黄 / ≥90 绿）
    const score = healthScores?.[s.sessionId]
    const scoreClass = score === undefined ? '' : score >= 90 ? 'good' : score >= 60 ? 'fair' : 'poor'
    return (
      <div
        key={s.sessionId}
        className={`session-sidebar__item ${s.sessionId === currentSessionId ? 'session-sidebar__item--active' : ''} ${extraClass}`}
        onClick={() => onSwitch(s.sessionId)}
      >
        <div className="session-sidebar__item-row">
          <div className="session-sidebar__item-title">
            {s.title || s.sessionId.slice(0, 12) + '...'}
          </div>
        </div>
        <div className="session-sidebar__item-meta">
          {s.turns !== undefined && <span>{s.turns} 轮</span>}
          <span>{formatTime(s.updatedAt)}</span>
        </div>
        {score !== undefined && (
          <span
            className={`session-health session-health--${scoreClass}`}
            data-testid="session-health"
            data-session-id={s.sessionId}
            data-score={score}
            title={`会话健康分 ${score}/100（损失信号扣减，详见 .dsh/loss/signals.jsonl）`}
          >
            {score}
          </span>
        )}
        {status && (
          <span
            className={`session-status-light session-status-light--${status}${status === 'running' && onStopSession ? ' session-status-light--actionable' : ''}`}
            data-testid="session-status-light"
            data-session-id={s.sessionId}
            data-status={status}
            title={status === 'running' && onStopSession ? '运行中（点击停止该会话回合）' : statusTitle[status]}
            onClick={status === 'running' && onStopSession
              ? (e) => {
                  e.stopPropagation() // 灯点击 = 停止该会话，不触发列表项的切换
                  logger.info(`[SessionSidebar] 点击状态灯停止会话: ${s.sessionId}`)
                  onStopSession(s.sessionId)
                }
              : undefined}
          />
        )}
      </div>
    )
  }

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
        {sessions.length === 0 && (
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
      </div>
    </div>
  )
}
