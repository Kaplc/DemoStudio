/**
 * 会话列表状态灯的纯归约层（AgentService 的 mux 接线只负责把帧翻译成动作）
 *
 * 数据源与跨会话动态通知同一根：mux 的 session/event 对全会话广播（无订阅过滤），
 * 只关心回合边界：
 *   - turn/start → 该会话进入 running（清除旧 error 灯）
 *   - turn/end   → reason.kind=error 记 error 灯；其余收尾（completed/blocked/aborted…）清灯
 *   - mux 流重建 → 清全部 running 灯（断连期间外部会话可能已结束，防僵尸绿灯；error 灯是事实记录保留）
 *   - 会话删除   → 删条目
 *
 * 与 sessionNotices 的语义差异（为何不复用同一 reducer）：通知是"一次性事件提醒"
 * （用户看到/切会话即清除），状态灯是"持久状态标记"（error 灯保留到该会话下次开回合）。
 */
import type { SessionRunStatus } from '../types/agent'

/** 状态灯表：sessionId → 当前状态灯（无条目 = 无灯） */
export type SessionStatusMap = Record<string, SessionRunStatus>

/** AgentService 从 mux 帧 / 生命周期路径翻译出的状态灯动作（可辨识联合） */
export type SessionStatusAction =
  /** 某会话新回合开始（当前会话与外部会话同源） */
  | { type: 'turn-started'; sessionId: string }
  /** 某会话回合收尾：error 记红灯，settled（completed/blocked/aborted/max-tokens…）清灯 */
  | { type: 'turn-ended'; sessionId: string; kind: 'error' | 'settled' }
  /** mux 下行流重建（connect/reconnect/HMR reattach）：running 灯不可信，全清 */
  | { type: 'stream-reopened' }
  /** 会话删除/归档 */
  | { type: 'session-removed'; sessionId: string }

/**
 * 不可变归约：应用一条动作，返回新状态灯表。
 * 无变化时返回原引用（调用方据此跳过事件广播）。
 */
export function reduceSessionStatusLights(map: SessionStatusMap, action: SessionStatusAction): SessionStatusMap {
  switch (action.type) {
    case 'turn-started': {
      if (map[action.sessionId] === 'running') return map
      return { ...map, [action.sessionId]: 'running' }
    }

    case 'turn-ended': {
      if (action.kind === 'error') {
        if (map[action.sessionId] === 'error') return map
        return { ...map, [action.sessionId]: 'error' }
      }
      if (!(action.sessionId in map)) return map
      const next = { ...map }
      delete next[action.sessionId]
      return next
    }

    case 'stream-reopened': {
      const runningIds = Object.keys(map).filter(id => map[id] === 'running')
      if (runningIds.length === 0) return map
      const next = { ...map }
      for (const id of runningIds) delete next[id]
      return next
    }

    case 'session-removed': {
      if (!(action.sessionId in map)) return map
      const next = { ...map }
      delete next[action.sessionId]
      return next
    }
  }
}
