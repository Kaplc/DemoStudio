/**
 * SessionSidebar 会话按时间分组纯逻辑。
 *
 * 需求（2026-09-10）：历史会话侧边栏自动折叠超过 3 天的会话，不要全部平铺显示。
 * 抽成纯函数便于 vitest 全分支覆盖（outlineCore 同款模式）。
 *
 * 分组规则：
 * - updatedAt 距今超过 3 天 → 归入「更早会话」折叠组（默认收起）
 * - updatedAt 缺失 → 无法判定年龄，保守归入近期组（不隐藏）
 * - 当前会话即使超过 3 天也保留在近期组（避免用户正在用的会话被折叠后"消失"）
 * - 相对顺序保持入参原序（调用方已按 updatedAt 排序）
 */
import type { SessionInfo } from '../../types/agent'

/** 超过该时长的会话归入「更早会话」折叠组（3 天） */
export const OLD_SESSION_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000

export interface SessionAgeGroups {
  /** 近期会话（3 天内 + 当前会话 + 无 updatedAt 的会话），正常平铺 */
  recent: SessionInfo[]
  /** 超过 3 天的会话（不含当前会话），折叠组内展示 */
  older: SessionInfo[]
}

/** 单个会话是否为"超 3 天且非当前"的折叠候选 */
export function isOldSession(s: SessionInfo, currentSessionId: string | undefined, now: number): boolean {
  if (s.sessionId === currentSessionId) return false
  if (s.updatedAt === undefined) return false
  return s.updatedAt < now - OLD_SESSION_THRESHOLD_MS
}

/** 把会话分为近期/更早两组（blank 会话已在 AgentService.listSessions 过滤） */
export function splitSessionsByAge(
  sessions: SessionInfo[],
  currentSessionId: string | undefined,
  now: number = Date.now(),
): SessionAgeGroups {
  const recent: SessionInfo[] = []
  const older: SessionInfo[] = []
  for (const s of sessions) {
    if (isOldSession(s, currentSessionId, now)) older.push(s)
    else recent.push(s)
  }
  return { recent, older }
}
