/**
 * SessionGhostStore — 虚拟会话数据层（2026-09-20）
 *
 * 解决的问题：面板停留在会话 A 时，后台运行的会话 B/C 的事件经 mux 全会话广播
 * 已经实时到达面板（此前 consumeForeignSessionEvent 只提炼 turn 边界做通知气泡，
 * 其余事件全部丢弃）；用户切回 B 时却要走一次 session.history RPC 重新拉取——
 * DSH host 繁忙时（数百会话全量扫描、多会话并发回合）RPC 30s 超时，切换表现为
 * "卡在加载态"。本层把到手的 foreign 事件按会话持续 fold 进原始事件缓冲：
 * 切换时直接用缓冲 fold 出尾页消息上屏（零 RPC 瞬时切换），缓冲覆盖不到的更早
 * 历史由现有分页机制（beforeSeq = 缓冲首条 seq，上翻拉取）补齐。
 *
 * 内存治理：
 *  - 单会话缓冲超限（条数 / 近似字符量）→ dropped 硬降级：清空缓冲释放内存，
 *    切换回退 RPC 路径；下一个 turn/start 到来时从零重跟踪（新回合事件完整）；
 *  - 会话数上限 LRU：超出时优先淘汰「非 running 且最不活跃」的会话；
 *  - mux 重连时必须整体作废（断流期间事件有缺口，缓冲不再完整）——由
 *    AgentService.connectMux 接线 clearAll()。
 *
 * 纯数据层：无 window / RPC 依赖，可直接实例化单测。
 */
import type { DshEvent } from './AgentService'

/** 单个后台会话的虚拟缓冲：面板存活期间收到的事件按 seq 升序累积 */
export interface SessionGhost {
  sessionId: string
  /** 原始事件缓冲（fold 输入，与 session.history 事件同形状） */
  events: Array<{ event: DshEvent }>
  /** 缓冲内最早事件的 seq（分页 beforeSeq 锚点；dropped 后为 undefined） */
  firstSeq?: number
  /** 缓冲内最晚事件的 seq（重放去重水位） */
  lastSeq?: number
  /** 是否有未闭合回合（turn/start 后未见 turn/end） */
  running: boolean
  /** 近似字符量（文本增量字段抽样估算），超限判据之一 */
  approxChars: number
  /** 硬降级标记：缓冲已超限清空，切换须走 RPC；下个 turn/start 重跟踪 */
  dropped: boolean
  lastActivityAt: number
}

/** 单会话缓冲事件条数上限（约等于一个较长回合的事件量） */
export const GHOST_MAX_EVENTS = 3000
/** 单会话缓冲近似字符量上限（约 3MB 文本） */
export const GHOST_MAX_CHARS = 3_000_000
/** 跟踪的会话数上限（超出按 LRU 淘汰） */
export const GHOST_MAX_SESSIONS = 8

/** 近似字符量估算：chunk.text 与 message.content[].text 是体量大头，其余按常数计 */
function approxEventChars(event: DshEvent): number {
  let n = 24
  const d = event.data
  const chunkText = d?.chunk?.text
  if (typeof chunkText === 'string') n += chunkText.length
  const content = d?.message?.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part?.text === 'string') n += part.text.length
    }
  }
  const args = d?.arguments
  if (typeof args === 'string') n += args.length
  return n
}

export class SessionGhostStore {
  private ghosts = new Map<string, SessionGhost>()

  /**
   * 消费一条 foreign 会话事件：按 seq 去重后追加进该会话的虚拟缓冲。
   * turn/start 翻 running（dropped 会话从零重跟踪）；turn/end 清 running。
   * 事件类型不做白名单过滤——history fold 管线认得自己的事件子集，
   * 多存只多耗内存且上限受控，漏存则会丢消息。
   */
  fold(sessionId: string, event: DshEvent): void {
    if (!sessionId || typeof event?.seq !== 'number') return
    let ghost = this.ghosts.get(sessionId)
    if (!ghost) {
      ghost = { sessionId, events: [], running: false, approxChars: 0, dropped: false, lastActivityAt: Date.now() }
      this.ghosts.set(sessionId, ghost)
      this.evict()
    }
    ghost.lastActivityAt = Date.now()
    if (event.seq <= (ghost.lastSeq ?? Number.NEGATIVE_INFINITY)) return // mux 重放/乱序帧
    if (event.type === 'turn/start') {
      // 新回合：dropped 的旧缓冲从零重跟踪（新回合事件完整，快速路径重新可用）
      if (ghost.dropped) {
        ghost.dropped = false
        ghost.events = []
        ghost.approxChars = 0
        ghost.firstSeq = undefined
      }
      ghost.running = true
    } else if (event.type === 'turn/end') {
      ghost.running = false
    }
    ghost.events.push({ event })
    ghost.approxChars += approxEventChars(event)
    if (ghost.firstSeq === undefined) ghost.firstSeq = event.seq
    ghost.lastSeq = event.seq
    if (ghost.events.length > GHOST_MAX_EVENTS || ghost.approxChars > GHOST_MAX_CHARS) {
      // 超限硬降级：立即释放缓冲（切回走 RPC 兜底），元数据保留供诊断
      ghost.events = []
      ghost.firstSeq = undefined
      ghost.dropped = true
    }
  }

  /** 查看某会话的虚拟缓冲（不取走） */
  peek(sessionId: string): SessionGhost | undefined {
    return this.ghosts.get(sessionId)
  }

  /** 取走并删除某会话的虚拟缓冲（切换消费；调用方对 dropped/空缓冲回退 RPC） */
  take(sessionId: string): SessionGhost | undefined {
    const ghost = this.ghosts.get(sessionId)
    if (ghost) this.ghosts.delete(sessionId)
    return ghost
  }

  /** 会话归档/删除时作废其虚拟缓冲 */
  discard(sessionId: string): void {
    this.ghosts.delete(sessionId)
  }

  /** mux 重连/断流后整体作废：断流期间事件有缺口，缓冲不完整不可信 */
  clearAll(): void {
    this.ghosts.clear()
  }

  size(): number {
    return this.ghosts.size
  }

  /** 超出会话数上限时淘汰：优先非 running 且 lastActivityAt 最旧；全 running 则最旧 */
  private evict(): void {
    while (this.ghosts.size > GHOST_MAX_SESSIONS) {
      let victim: SessionGhost | undefined
      for (const ghost of this.ghosts.values()) {
        if (victim === undefined
          || (victim.running === ghost.running && ghost.lastActivityAt < victim.lastActivityAt)
          || (victim.running && !ghost.running)) {
          victim = ghost
        }
      }
      if (!victim) break
      this.ghosts.delete(victim.sessionId)
    }
  }
}
