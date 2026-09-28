/**
 * 损失探针：进程内订阅会话事件流（ctx.on('session/event')，post-commit 全事件馈送），
 * 零成本把损失信号落盘 `.dsh/loss/signals.jsonl`，并维护一份**同步可读**的按会话摘要缓存
 * （规则段 text provider 是同步接口，摘要块从缓存取，不走异步 IO）。
 *
 * 订阅清单（契约见 DSH dsh-session types / dsh-agent-loop）：
 * - `turn/start {turn}` → 回合号簿记（工具侧信号归因用）
 * - `turn/end {turn, reason}` → reason.kind='error'|'max-tokens' 记 turn_error；'aborted' 记 turn_aborted
 * - `llm/retry {turn, failure}` → 记 retry（llm/retry-started 不记，避免同链双计）
 * - `agent/inbox/spliced {target:'next-step'}` → steer 插入记 steer_interrupt（canceled/next-turn 不记）
 * - `tools/result`（rule_propose 成功）→ 记 rule_propose（显式纠正强信号）
 *
 * 明确不可观测：编辑器本地队列"撤回重新编辑"（消息未进 DSH）——edit_resend 类别保留给编辑器侧上报。
 * 子 agent 会话（delegationDepth > 0）不采集。零 LLM。
 *
 * @module lossProbe
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { appendSignal, healthScore, summarizeSignals, DEFAULT_WEIGHTS } from './lossStore.js'
import type { LossSignal, LossSignalKind, LossSummary } from './lossStore.js'

/** 单会话内存环上限（摘要块只看最近信号，全量在磁盘）。 */
export const MAX_SESSION_RING = 50

/** 摘要块保留的摘录条数上限（保留最近的）。 */
export const MAX_VIEW_EXCERPTS = 3

/** 会话损失视图（规则段摘要块的输入；同步可读）。 */
export interface SessionLossView {
  sessionId: string
  score: number
  summary: LossSummary
  /** 最近的信号摘录（最多 MAX_VIEW_EXCERPTS 条，时间升序）。 */
  excerpts: string[]
}

/** 探针运行环境。 */
export interface LossProbeHost {
  /** 损失目录（绝对路径，配置钉到项目根）。 */
  lossDirectory: string
  /** 结构化日志（测试桩可省略）。 */
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void }
}

interface SessionRecord {
  currentTurn: number
  signals: LossSignal[]
}

/** turn/end reason 的最小形状（只取探针关心的字段）。 */
interface TurnEndReasonLike {
  kind?: string
  error?: { message?: string; code?: string }
}

/**
 * 创建损失探针：`register(ctx)` 挂事件监听；`viewFor(sessionId)` 同步取会话摘要视图；
 * `noteExternal` 供探针外的事件源（如预筛命中）补记信号。
 * 所有落盘为 fire-and-forget，失败只 warn 不阻塞对话。
 */
export function createLossProbe(host: LossProbeHost): {
  register: (ctx: Context) => void
  viewFor: (sessionId: string) => SessionLossView | undefined
  noteExternal: (session: Session, kind: LossSignalKind, turn: number, excerpt?: string) => void
} {
  const bySession = new Map<string, SessionRecord>()

  const recordOf = (sessionId: string): SessionRecord => {
    let record = bySession.get(sessionId)
    if (record === undefined) {
      record = { currentTurn: 0, signals: [] }
      bySession.set(sessionId, record)
    }
    return record
  }

  const headerOf = (session: Session): { id: string; delegationDepth: number } => {
    const header = session.header as { id?: unknown; delegationDepth?: unknown }
    return {
      id: typeof header?.id === 'string' && header.id !== '' ? header.id : 'unknown',
      delegationDepth: typeof header?.delegationDepth === 'number' ? header.delegationDepth : 0,
    }
  }

  const record = (
    session: Session,
    kind: LossSignalKind,
    turn: number,
    excerpt?: string,
  ): void => {
    const { id } = headerOf(session)
    const recordItem = recordOf(id)
    const signal: LossSignal = {
      ts: Date.now(),
      sessionId: id,
      turn: turn > 0 ? turn : recordItem.currentTurn,
      kind,
      weight: DEFAULT_WEIGHTS[kind],
      excerpt: excerpt?.trim() === '' || excerpt === undefined ? undefined : excerpt,
    }
    recordItem.signals.push(signal)
    if (recordItem.signals.length > MAX_SESSION_RING) {
      recordItem.signals.splice(0, recordItem.signals.length - MAX_SESSION_RING)
    }
    void appendSignal(host.lossDirectory, signal).catch((error: unknown) => {
      host.logger?.warn('损失信号落盘失败（kind=%s turn=%d）: %o', kind, signal.turn, error)
    })
  }

  const register = (ctx: Context): void => {
    ctx.on('session/event', (session: Session, event: SessionEvent): void => {
      try {
        const { delegationDepth } = headerOf(session)
        if (delegationDepth > 0) return
        const recordItem = recordOf(headerOf(session).id)
        if (event.type === 'turn/start') {
          const turn = (event.data as { turn?: number }).turn
          if (typeof turn === 'number') recordItem.currentTurn = turn
          return
        }
        if (event.type === 'turn/end') {
          const data = event.data as { turn?: number; reason?: TurnEndReasonLike }
          const kind = data.reason?.kind
          const turn = typeof data.turn === 'number' ? data.turn : recordItem.currentTurn
          if (kind === 'error') {
            record(session, 'turn_error', turn, data.reason?.error?.message ?? data.reason?.error?.code)
          } else if (kind === 'max-tokens') {
            record(session, 'turn_error', turn, 'max-tokens')
          } else if (kind === 'aborted') {
            record(session, 'turn_aborted', turn)
          }
          return
        }
        // rc.2 的 SessionEvent 联合尚未收录 llm/retry（dsh-llm-retry 动态 append），走宽松比较
        if ((event.type as string) === 'llm/retry') {
          const data = (event as { data?: { turn?: number; failure?: { message?: string } } }).data
          record(session, 'retry', typeof data?.turn === 'number' ? data.turn : recordItem.currentTurn, data?.failure?.message)
          return
        }
        if (event.type === 'agent/inbox/spliced') {
          const data = event.data as { target?: string; outcome?: string; inserted?: unknown[] }
          if (data.target !== 'next-step' || data.outcome === 'canceled') return
          if (!Array.isArray(data.inserted) || data.inserted.length === 0) return
          record(session, 'steer_interrupt', recordItem.currentTurn)
        }
      } catch (error) {
        host.logger?.warn('损失探针事件处理失败（type=%s）: %o', event.type, error)
      }
    })

    // 显式规则提案 = 确属纠正的强损失信号（提案成功才算）
    ctx.on('tools/result', (
      exec: Readonly<{ name: string; agent?: { session: Session } }>,
      result: Readonly<{ isError?: boolean }>,
    ): undefined => {
      try {
        if (result.isError) return undefined
        if (exec.name !== 'rule_propose' || exec.agent === undefined) return undefined
        const { delegationDepth } = headerOf(exec.agent.session)
        if (delegationDepth > 0) return undefined
        record(exec.agent.session, 'rule_propose', 0)
      } catch (error) {
        host.logger?.warn('rule_propose 损失信号登记失败: %o', error)
      }
      return undefined
    })
  }

  const viewFor = (sessionId: string): SessionLossView | undefined => {
    const recordItem = bySession.get(sessionId)
    if (recordItem === undefined || recordItem.signals.length === 0) return undefined
    const excerpts = recordItem.signals
      .filter(signal => signal.excerpt !== undefined)
      .map(signal => signal.excerpt as string)
      .slice(-MAX_VIEW_EXCERPTS)
    return {
      sessionId,
      score: healthScore(recordItem.signals),
      summary: summarizeSignals(recordItem.signals),
      excerpts,
    }
  }

  const noteExternal = (session: Session, kind: LossSignalKind, turn: number, excerpt?: string): void => {
    try {
      if (headerOf(session).delegationDepth > 0) return
      record(session, kind, turn, excerpt)
    } catch (error) {
      host.logger?.warn('外部损失信号登记失败（kind=%s）: %o', kind, error)
    }
  }

  return { register, viewFor, noteExternal }
}

/**
 * 规则段末尾的损失摘要块（无信号返回 undefined 不注入）。
 * 措辞对齐复盘强化闭环：信号只是 loss 值，归因与是否产候选由主 agent 判定，候选走提案-确认制。
 */
export function lossSectionText(view: SessionLossView | undefined): string | undefined {
  if (view === undefined || view.summary.total === 0) return undefined
  const kinds = Object.entries(view.summary.byKind)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(' ')
  const lines = [
    `## 回合末损失摘要（健康分 ${view.score}/100）`,
    '',
    `本会话累计损失信号 ${view.summary.total} 条（${kinds}）。损失信号是自我优化的 loss 值：提示本会话存在值得归因的摩擦，不是必须处理的告警。`,
  ]
  if (view.excerpts.length > 0) {
    lines.push('', ...view.excerpts.map(excerpt => `> ${excerpt}`))
  }
  lines.push(
    '',
    '复盘指引：若某类信号反复出现且你能归因到具体的行为修正（缺规则 / 提醒文案缺失 / 指令缺口），用 gradient_propose 提出文本梯度候选（只写 pending 不生效），向用户转述并等确认后 gradient_apply；一次性偶发信号不要产候选。无需向用户主动汇报本摘要。',
  )
  return lines.join('\n')
}
