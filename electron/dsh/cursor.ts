/**
 * DSH 会话 cursor 簿记（0.1.7 session/follow 流的持久事件水位）
 *
 * 独立成模块的原因：cursor 同时被流桥（写入：snapshot/逐事件推进）与
 * 0.1.7 适配器（读取：session/page 的 throughSeq 不允许超过 cursor）消费，
 * 单独存放避免 adapters ↔ streamBridge 循环引用。
 */

const cursorBySession = new Map<string, number>()
const cursorWaiters = new Map<string, Array<() => void>>()

export function getSessionCursor(sessionId: string): number | undefined {
  return cursorBySession.get(sessionId)
}

export function deleteSessionCursor(sessionId: string): void {
  cursorBySession.delete(sessionId)
}

/** 单调推进某会话 cursor 并唤醒等待者（history/page 的 throughSeq 依赖它） */
export function setSessionCursor(sessionId: string, cursor: number): void {
  const prev = cursorBySession.get(sessionId)
  if (prev !== undefined && prev >= cursor) return
  cursorBySession.set(sessionId, cursor)
  const waiters = cursorWaiters.get(sessionId)
  if (waiters) {
    for (const w of waiters.splice(0)) w()
    cursorWaiters.delete(sessionId)
  }
}

/** 等待某会话的 follow snapshot 报来 cursor（超时返回 null，不抛错） */
export function waitForSessionCursor(sessionId: string, timeoutMs = 4000): Promise<number | null> {
  const known = cursorBySession.get(sessionId)
  if (known !== undefined) return Promise.resolve(known)
  return new Promise<number | null>((resolve) => {
    const waiters = cursorWaiters.get(sessionId) ?? []
    let settled = false
    const done = (v: number | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    waiters.push(() => done(cursorBySession.get(sessionId) ?? null))
    cursorWaiters.set(sessionId, waiters)
    setTimeout(() => done(cursorBySession.get(sessionId) ?? null), timeoutMs)
  }).then((v) => {
    // 唤醒同会话的其他等待者（与旧实现语义一致：任一等待结束都放行同会话队列）
    const waiters = cursorWaiters.get(sessionId)
    if (waiters) {
      for (const w of waiters.splice(0)) w()
      cursorWaiters.delete(sessionId)
    }
    return v
  })
}

/** 仅测试用：清空全部簿记 */
export function __resetCursorForTest(): void {
  cursorBySession.clear()
  cursorWaiters.clear()
}
