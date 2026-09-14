/**
 * SessionNoticeStack - 跨会话动态气泡栈（消息区左上角浮层）
 *
 * 显示**非当前会话**的动态提醒：回合完成 / 出错 / 阻塞 / 等待批准 / 等待回答。
 * 数据来自 AgentService 的 sessionNotice 事件（mux 全会话广播帧提炼，纯函数归约见
 * src/editor/sessionNotices.ts）。
 *
 * 展示策略（2026-09-14 用户反馈"不能挡住当前会话的内容"）：
 *   - 新动态到达 → 展开单行紧凑气泡 8 秒（看得见发生了什么）→ 自动收起成角落小徽标
 *   - 点徽标重新展开并保持（pinned，新动态也不自动收起）；点栈尾"收起"立即收起
 *   - 展开态点气泡切换到对应会话（该会话通知随切换视为已读清除），× 单条关闭
 * 样式约定：无 icon/emoji，状态色只用状态点（2026-09-14 用户决策去掉左色条）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionInfo, SessionNotice, SessionNoticeKind } from '../../types/agent'

interface SessionNoticeStackProps {
  notices: SessionNotice[]
  /** 会话列表缓存：用于把 sessionId 解析成标题 */
  sessions: SessionInfo[]
  /** 点击气泡：切换到对应会话 */
  onOpen: (sessionId: string) => void
  /** 点击 ×：手动关闭一条通知 */
  onDismiss: (id: string) => void
}

/** 新动态到达后展开展示的时长，到点自动收起成徽标 */
const EXPAND_DURATION_MS = 8000

/** 按类别生成正文摘要（detail 由服务层提炼，这里只拼人类可读前缀） */
function noticeText(notice: SessionNotice): string {
  switch (notice.kind) {
    case 'completed':
      return '回合完成'
    case 'error':
      return notice.detail ? `出错：${notice.detail}` : '回合出错'
    case 'blocked':
      return notice.detail ? `已阻塞：${notice.detail}` : '回合被阻塞，需要关注'
    case 'approval':
      return `等待批准：${notice.detail ?? '工具调用'}`
    case 'question':
      return `等待回答：${notice.detail ?? 'Agent 有问题需要确认'}`
  }
}

/** 徽标上的状态点着色类（独立命名空间，避免与展开态气泡的 .session-notice--{kind} 选择器相撞） */
const KIND_DOT_CLASS: Record<SessionNoticeKind, string> = {
  completed: 'session-notice-badge__dot--completed',
  error: 'session-notice-badge__dot--error',
  blocked: 'session-notice-badge__dot--blocked',
  approval: 'session-notice-badge__dot--approval',
  question: 'session-notice-badge__dot--question',
}

export function SessionNoticeStack({ notices, sessions, onOpen, onDismiss }: SessionNoticeStackProps) {
  const [collapsed, setCollapsed] = useState(false)
  /** 用户点徽标展开后置位：自动收起定时器到点也不收（直到手动收起） */
  const pinnedRef = useRef(false)
  /** 用户手动收起后置位：吞掉同一次 idsKey 变化的自动展开（否则收起会被 effect 立刻覆盖） */
  const suppressAutoExpandRef = useRef(false)
  /** 通知 id 指纹：变化 = 有新动态或被清除 */
  const idsKey = notices.map(n => n.id).join('|')

  useEffect(() => {
    if (notices.length === 0) return
    if (suppressAutoExpandRef.current) {
      suppressAutoExpandRef.current = false
      return
    }
    setCollapsed(false)
    const timer = setTimeout(() => {
      if (!pinnedRef.current) setCollapsed(true)
    }, EXPAND_DURATION_MS)
    return () => clearTimeout(timer)
  }, [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // sessionId → 标题（复用面板的会话列表缓存；列表还没有该会话时回退短 id）
  const titleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sessions) {
      map.set(s.sessionId, s.title && s.title !== s.sessionId ? s.title : `${s.sessionId.slice(0, 8)}…`)
    }
    return map
  }, [sessions])

  if (notices.length === 0) return null

  // ── 收起态：角落小徽标（状态点 + 数量），点击展开并保持 ──
  if (collapsed) {
    const summary = notices.map(n => `${titleById.get(n.sessionId) ?? n.sessionId.slice(0, 8)}：${noticeText(n)}`).join('\n')
    return (
      <div className="session-notice-stack session-notice-stack--collapsed" data-testid="session-notice-stack">
        <button
          type="button"
          className="session-notice-badge"
          title={`${summary}｜点击展开`}
          aria-label={`${notices.length} 条会话动态`}
          onClick={() => { pinnedRef.current = true; setCollapsed(false) }}
        >
          <span className="session-notice-badge__dots">
            {notices.slice(0, 3).map(n => (
              <span key={n.id} className={`session-notice__dot ${KIND_DOT_CLASS[n.kind]}`} aria-hidden="true" />
            ))}
          </span>
          <span>{notices.length}</span>
        </button>
      </div>
    )
  }

  // ── 展开态：单行紧凑气泡栈 ──
  return (
    <div className="session-notice-stack" data-testid="session-notice-stack">
      {notices.map(notice => {
        const title = titleById.get(notice.sessionId) ?? `${notice.sessionId.slice(0, 8)}…`
        return (
          <div
            key={notice.id}
            className={`session-notice session-notice--${notice.kind}`}
            role="button"
            tabIndex={0}
            data-session-id={notice.sessionId}
            title={`${title}｜${noticeText(notice)}${notice.detail && notice.kind !== 'completed' ? `（${notice.detail}）` : ''}｜点击查看该会话`}
            onClick={() => onOpen(notice.sessionId)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(notice.sessionId) }}
          >
            <span className="session-notice__dot" aria-hidden="true" />
            <span className="session-notice__line">
              <span className="session-notice__title">{title}</span>
              <span className="session-notice__text">{noticeText(notice)}</span>
            </span>
            <button
              type="button"
              className="session-notice__close"
              aria-label="关闭提醒"
              title="关闭提醒"
              onClick={(e) => { e.stopPropagation(); onDismiss(notice.id) }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="session-notice-stack__collapse"
        title="收起提醒"
        aria-label="收起提醒"
        onClick={() => { pinnedRef.current = false; suppressAutoExpandRef.current = true; setCollapsed(true) }}
      >
        ‹
      </button>
    </div>
  )
}
