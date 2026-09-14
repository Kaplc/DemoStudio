/**
 * 跨会话动态通知的纯归约层（AgentService 的 mux 接线只负责把帧翻译成动作）
 *
 * 数据源（全部来自编辑器已有的 mux 下行流，DSH host 对 mux 订阅者广播**所有会话**的帧，
 * 见 dsh-host-apiproxy events.mux：session/event 无订阅过滤、question/approval 待定请求
 * 在开流时还会按稳定 rpcId 重放）：
 *   - 其他会话 turn/end（completed/error/blocked）→ 回合结算通知（同一会话只保留最新一条）
 *   - 其他会话 turn/start → 该会话的旧回合结算通知过期，移除
 *   - question/requested / approval/requested（非当前会话）→ 等待通知，resolved 时移除
 *
 * 通知的清除路径：用户点开该会话（session-viewed）、手动关闭（dismiss）、
 * 请求被决议（question/approval-resolved）、会话归档（session-removed）。
 */
import type { SessionNotice, SessionNoticeKind } from '../types/agent'

/** 通知容量上限：溢出时淘汰最旧（按插入序，替换不改变位置） */
export const MAX_SESSION_NOTICES = 8

/** 回合结算通知 id（同一会话只保留最新一条 turn 结算） */
export const turnNoticeId = (sessionId: string): string => `${sessionId}:turn`
/** 跨会话问答通知 id（一个 pending 请求一条） */
export const questionNoticeId = (sessionId: string, rpcId: string): string => `${sessionId}:question:${rpcId}`
/** 跨会话审批通知 id */
export const approvalNoticeId = (sessionId: string, approvalId: string): string => `${sessionId}:approval:${approvalId}`

/** AgentService 从 mux 帧 / 会话切换路径翻译出的归约动作（可辨识联合） */
export type SessionNoticeAction =
  /** 其他会话新回合开始：清除该会话过期的回合结算通知 */
  | { type: 'turn-started'; sessionId: string }
  /** 其他会话回合结束：upsert 一条回合结算通知 */
  | { type: 'turn-ended'; sessionId: string; kind: Extract<SessionNoticeKind, 'completed' | 'error' | 'blocked'>; detail?: string; at: number }
  /** 其他会话收到提问（ask_user_question） */
  | { type: 'question-requested'; sessionId: string; rpcId: string; detail?: string; at: number }
  /** 提问被回答/取消：按 rpcId 移除（resolved 帧不带可靠 sessionId 时也要能删） */
  | { type: 'question-resolved'; questionRpcId: string }
  /** 其他会话请求工具越权审批 */
  | { type: 'approval-requested'; sessionId: string; approvalId: string; detail?: string; at: number }
  /** 审批被决议/撤销：按 approvalId 移除 */
  | { type: 'approval-resolved'; approvalId: string }
  /** 用户打开/切到某会话：清除该会话全部通知（面板上已可见） */
  | { type: 'session-viewed'; sessionId: string }
  /** 会话归档/删除 */
  | { type: 'session-removed'; sessionId: string }
  /** 用户手动关闭某条通知 */
  | { type: 'dismiss'; id: string }

/** 找到某动作会移除的通知下标集合（内部工具：倒序 splice 用） */
function removalIndexes(notices: SessionNotice[], shouldRemove: (n: SessionNotice) => boolean): number[] {
  const indexes: number[] = []
  notices.forEach((n, i) => { if (shouldRemove(n)) indexes.push(i) })
  return indexes
}

function removeMatching(notices: SessionNotice[], shouldRemove: (n: SessionNotice) => boolean): SessionNotice[] {
  const indexes = removalIndexes(notices, shouldRemove)
  if (indexes.length === 0) return notices
  const next = notices.slice()
  for (let i = indexes.length - 1; i >= 0; i--) next.splice(indexes[i]!, 1)
  return next
}

/**
 * 不可变归约：应用一条动作，返回新通知数组。
 * 无变化时返回原数组引用（调用方据此跳过事件广播）。
 * upsert（turn-ended / question-requested / approval-requested）：同 id 就地替换（保序），
 * 新 id 追加到末尾；追加后超容量则淘汰最旧。
 */
export function reduceSessionNotices(notices: SessionNotice[], action: SessionNoticeAction): SessionNotice[] {
  switch (action.type) {
    case 'turn-started':
      return removeMatching(notices, n => n.id === turnNoticeId(action.sessionId))

    case 'turn-ended': {
      const notice: SessionNotice = {
        id: turnNoticeId(action.sessionId),
        sessionId: action.sessionId,
        kind: action.kind,
        ...(action.detail !== undefined ? { detail: action.detail } : {}),
        at: action.at,
      }
      return upsertNotice(notices, notice)
    }

    case 'question-requested': {
      const notice: SessionNotice = {
        id: questionNoticeId(action.sessionId, action.rpcId),
        sessionId: action.sessionId,
        kind: 'question',
        ...(action.detail !== undefined ? { detail: action.detail } : {}),
        at: action.at,
      }
      return upsertNotice(notices, notice)
    }

    case 'approval-requested': {
      const notice: SessionNotice = {
        id: approvalNoticeId(action.sessionId, action.approvalId),
        sessionId: action.sessionId,
        kind: 'approval',
        ...(action.detail !== undefined ? { detail: action.detail } : {}),
        at: action.at,
      }
      return upsertNotice(notices, notice)
    }

    case 'question-resolved':
      return removeMatching(notices, n => n.kind === 'question' && n.id === questionNoticeId(n.sessionId, action.questionRpcId))

    case 'approval-resolved':
      return removeMatching(notices, n => n.kind === 'approval' && n.id.endsWith(`:${action.approvalId}`))

    case 'session-viewed':
    case 'session-removed':
      return removeMatching(notices, n => n.sessionId === action.sessionId)

    case 'dismiss':
      return removeMatching(notices, n => n.id === action.id)
  }
}

/** 就地 upsert（保序）+ 容量淘汰；无变化时返回原引用 */
function upsertNotice(notices: SessionNotice[], notice: SessionNotice): SessionNotice[] {
  const index = notices.findIndex(n => n.id === notice.id)
  if (index !== -1) {
    const before = notices[index]!
    if (before.kind === notice.kind && before.detail === notice.detail && before.at === notice.at) return notices
    const next = notices.slice()
    next[index] = notice
    return next
  }
  const next = [...notices, notice]
  if (next.length > MAX_SESSION_NOTICES) next.splice(0, next.length - MAX_SESSION_NOTICES)
  return next
}
