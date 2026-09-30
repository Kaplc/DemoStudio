/**
 * DSH 流桥：内核流端点 → 渲染方言帧
 *
 * 双模式（由活跃适配器的 streamMode 决定，内核回滚自动切换）：
 *   - remote-mux（0.1.7+）：单连接 /api/remote.mux 多路复用——$events 网关通知流 +
 *     每活跃会话 session/follow 流；翻译回方言帧（session/subscribed、session/event、
 *     assistant-stream 瞬态帧 → transient assistant/chunk）+ host 帧翻译。
 *   - legacy-events（0.1.1）：/api/events.mux 裸下行帧 = 方言帧原样转发。
 *
 * 翻译纯函数（translateFollowItem / translateEventsItem）导出供契约测试；
 * 连接/重连/广播等副作用在本模块应用层。host 桥（/api/events.host）两代际同构。
 */

import { randomUUID } from 'node:crypto'
import { DSH_PORT_DEFAULT, dshCtx } from './context'
import { getActiveAdapter } from './registry'
import { ensureDshAuthCookie } from './auth'
import { normalizeSessionEvent } from './eventMap'
import { setSessionCursor, deleteSessionCursor, waitForSessionCursor } from './cursor'
import type { DshKernelAdapter } from './gateway'

// ─── mux 连接状态（remote-mux 模式） ───
let _muxWs: import('ws').WebSocket | null = null
let _muxReconnectTimer: ReturnType<typeof setTimeout> | null = null
let _muxEventsStreamId: string | null = null
let _muxClientId: string | null = null // $events 流的客户端身份（$events/result 应答必带，ready 首帧下发）
const _muxFollowBySession = new Map<string, string>() // sessionId → streamId
const _muxStreamMeta = new Map<string, { kind: 'events' } | { kind: 'follow'; sessionId: string; cursor: number }>()
const _muxRemoteEvents = new Map<string, string>() // eventId → 瀑布事件名（approval/request 等，cancel 翻译用）
let _muxActiveSession: string | null = null // 当前跟随的活跃会话（单会话模型）

function muxWsSend(frame: Record<string, unknown>): boolean {
  if (!_muxWs || _muxWs.readyState !== 1) return false // 1 = WebSocket.OPEN
  _muxWs.send(JSON.stringify(frame))
  return true
}

function broadcastMuxFrame(frame: unknown): void {
  dshCtx().broadcast('dsh-mux-frame', frame)
}

function broadcastHostFrame(frame: unknown): void {
  dshCtx().broadcast('dsh-host-frame', frame)
}

function muxOpenFollow(sessionId: string): void {
  if (_muxFollowBySession.has(sessionId)) return
  // WS 未就绪时不登记：否则 open 回调的补开会被上面的 guard 挡住，流永远发不出去
  if (!_muxWs || _muxWs.readyState !== 1) return
  const streamId = randomUUID()
  _muxFollowBySession.set(sessionId, streamId)
  _muxStreamMeta.set(streamId, { kind: 'follow', sessionId, cursor: 0 })
  const sent = muxWsSend({
    type: 'open', streamId, endpoint: 'session/follow',
    payload: { args: { request: { address: { kind: 'session', sessionId }, assistantStream: true } } },
  })
  console.log(`[DSH-mux] follow 开流: ${sessionId.slice(0, 20)}… sent=${sent}`)
}

function muxCloseFollow(sessionId: string): void {
  const streamId = _muxFollowBySession.get(sessionId)
  if (!streamId) return
  _muxFollowBySession.delete(sessionId)
  _muxStreamMeta.delete(streamId)
  muxWsSend({ type: 'cancel', streamId })
}

/** 以「活跃会话」对齐 follow 流：面板实时事件只跟当前会话（388 会话全跟会把内核事件循环压垮——实测教训）。
 *  活跃会话由渲染层的 create/prompt/history 调用驱动；全局运行灯由 $events 的 api-session/status 保障（不依赖 follow）。 */
export function muxSetActiveSession(sessionId: string): void {
  if (getActiveAdapter().streamMode !== 'remote-mux') return // legacy 模式无 follow 概念
  if (!sessionId || sessionId === _muxActiveSession) return
  _muxActiveSession = sessionId
  if (!_muxWs || _muxWs.readyState !== 1) return
  for (const [sid, streamId] of [..._muxFollowBySession]) {
    if (sid !== sessionId) {
      _muxFollowBySession.delete(sid)
      _muxStreamMeta.delete(streamId)
      muxWsSend({ type: 'cancel', streamId })
    }
  }
  muxOpenFollow(sessionId)
}

// ─── 翻译纯函数（契约测试直测；副作用由 apply* 应用） ───

export interface FollowTranslationResult {
  /** 翻译后的新 cursor（无水位变化时 undefined） */
  cursor?: number
  frames: Array<Record<string, unknown>>
}

/** session/follow 流单项值 → 方言帧（snapshot/event/assistant-stream 瞬态帧） */
export function translateFollowItem(
  meta: { sessionId: string; cursor: number },
  value: Record<string, unknown> | null,
  normalizeEvent: (e: Record<string, unknown>) => Record<string, unknown> = normalizeSessionEvent,
): FollowTranslationResult | null {
  if (!value || typeof value !== 'object') return null
  if (value.type === 'snapshot') {
    let cursor = meta.cursor
    if (typeof value.cursor === 'number') cursor = value.cursor
    // 对齐旧协议的订阅基线帧：渲染层以此立 seq 基线（历史由 session.history → page 兜底加载）
    return { cursor, frames: [{ type: 'session/subscribed', sessionId: meta.sessionId, lastSeq: cursor }] }
  }
  if (value.type === 'event' && value.event && typeof value.event === 'object') {
    const event = value.event as { seq?: number }
    let cursor = meta.cursor
    if (typeof event.seq === 'number' && event.seq > cursor) cursor = event.seq
    return {
      cursor,
      frames: [{ type: 'session/event', sessionId: meta.sessionId, event: normalizeEvent(event as Record<string, unknown>) }],
    }
  }
  if (value.type === 'assistant-stream' && value.frame && typeof value.frame === 'object') {
    const f = value.frame as { type?: string; chunk?: unknown }
    // 0.1.7 把吐字增量挪进进程内 assistant-stream（不再持久化）：翻译回旧 assistant/chunk 事件形状。
    // 帧自带 attemptId/revision/index（revision 是与持久 seq 无关的独立连续性空间，WebUI 客户端
    // 用它校验跳号而非 seq 去重），chunk 是原始 StreamChunk（text-delta/reasoning-delta/…，
    // 与渲染层旧 assistant/chunk 分支同词表，无需展开）。
    // 瞬态帧绝不标 seq：cursor 与渲染层 _lastSeq 由同一批持久事件锁步推进（恒相等），带 cursor
    // 序号会被渲染层 seq 去重闸整体吞掉（2026-09-29 思考卡流式全灭的根因）。渲染层对带 transient
    // 标记的事件旁路去重直入实时缓冲（consumeSessionEvent），只走实时通道一次、永不重放。
    if (f.type === 'chunk' && f.chunk) {
      return {
        frames: [{
          type: 'session/event', sessionId: meta.sessionId,
          event: { transient: true, type: 'assistant/chunk', data: { chunk: f.chunk } },
        }],
      }
    }
    return null
  }
  return null
}

export interface EventsTranslationResult {
  frames: Array<Record<string, unknown>>
  /** api-session/removed 附带：需要清理的会话 id（follow 流关闭 + cursor 删除） */
  removedSession?: string
  /** ready 首帧附带：本 $events 代的客户端身份（应答瀑布时原样带回） */
  clientId?: string
  /** waterfall 帧附带：登记待应答远程事件（cancel 翻译与断开清场依赖） */
  register?: { eventId: string; event: string }
  /** cancel 帧附带：注销待应答远程事件 */
  unregisterEventId?: string
}

/**
 * $events 网关通知流单项值 → host 方言帧 / 瀑布 server-request 帧。
 * 纯函数：clientId / 已登记事件由调用方传入，状态变更以 register/unregister 返回。
 */
export function translateEventsItem(
  value: Record<string, unknown> | null,
  ctx: { clientId: string | null; registeredEvent: (eventId: string) => string | undefined } = {
    clientId: null,
    registeredEvent: () => undefined,
  },
): EventsTranslationResult | null {
  if (!value || typeof value !== 'object') return null
  if (value.type === 'ready' && typeof value.clientId === 'string') {
    // 开流首帧：本 $events 代的客户端身份，应答瀑布时必须原样带回
    return { frames: [], clientId: value.clientId }
  }
  if (value.type === 'waterfall' && typeof value.eventId === 'string' && typeof value.event === 'string') {
    // 待应答远程事件（0.1.7 的 question/approval 交互通道）：翻译为渲染层既有的
    // server-request 帧（rpcId=eventId），渲染层经 dsh-rpc('$events/result') 回决议。
    // request 是 host 投影后的 JSON 安全载荷（agent/signal 已剥离），原样透传 + 附 eventId/clientId。
    if (value.event === 'approval/request' || value.event === 'user-questions/request') {
      const request = (value.request && typeof value.request === 'object' ? value.request : {}) as Record<string, unknown>
      const method = value.event === 'approval/request' ? 'approval/request' : 'question/request'
      return {
        register: { eventId: value.eventId, event: value.event },
        frames: [{
          type: 'server-request', rpcId: value.eventId, method,
          payload: { ...request, eventId: value.eventId, clientId: ctx.clientId ?? undefined },
        }],
      }
    }
    return null
  }
  if (value.type === 'cancel' && typeof value.eventId === 'string') {
    // 瀑布已被决议/撤销（本端之外的他端决议或 host 取消）：翻译为 resolved 帧驱动卡片移除
    const event = ctx.registeredEvent(value.eventId)
    if (event === 'approval/request') {
      return {
        unregisterEventId: value.eventId,
        frames: [{ type: 'server-request', rpcId: value.eventId, method: 'approval/resolved', payload: { approvalId: value.eventId } }],
      }
    }
    if (event === 'user-questions/request') {
      return {
        unregisterEventId: value.eventId,
        frames: [{ type: 'server-request', rpcId: value.eventId, method: 'question/resolved', payload: { questionRpcId: value.eventId } }],
      }
    }
    return null
  }
  if (value.type === 'emit') {
    const name = String(value.event ?? '')
    const arg0 = Array.isArray(value.args) ? value.args[0] as Record<string, unknown> | undefined : undefined
    const sessionId = typeof arg0?.sessionId === 'string' ? arg0.sessionId : undefined
    if (name === 'api-session/added') {
      return { frames: [{ type: 'host/session-added', payload: { sessionId } }] }
    }
    if (name === 'api-session/removed') {
      return {
        removedSession: sessionId,
        frames: [{ type: 'host/session-removed', payload: { sessionId } }],
      }
    }
    if (name === 'api-session/status' && sessionId && typeof arg0?.running === 'boolean') {
      return { frames: [{ type: 'host/session-status', payload: { sessionId, running: arg0.running } }] }
    }
    if (name === 'api-session/error') {
      return { frames: [{ type: 'host/agent-error', payload: { sessionId, message: arg0?.message } }] }
    }
    // 其余主机级事件（模型目录失效等）：转发给渲染层既有 host/remote-event 白名单通道
    return { frames: [{ type: 'host/remote-event', payload: { event: name, args: value.args } }] }
  }
  return null
}

// ─── 翻译结果应用（副作用层） ───

function applyFollowValue(meta: { kind: 'follow'; sessionId: string; cursor: number }, value: Record<string, unknown> | null): void {
  const adapter = getActiveAdapter()
  const r = translateFollowItem(meta, value, adapter.normalizeSessionEvent ?? normalizeSessionEvent)
  if (!r) return // 未知 follow 项静默忽略（与原行为一致）
  if (r.cursor !== undefined) {
    meta.cursor = r.cursor
    setSessionCursor(meta.sessionId, r.cursor)
  }
  for (const f of r.frames) broadcastMuxFrame(f)
}

function applyEventsValue(value: Record<string, unknown> | null): void {
  const r = translateEventsItem(value, {
    clientId: _muxClientId,
    registeredEvent: (eventId) => _muxRemoteEvents.get(eventId),
  })
  if (!r) {
    if (value?.type === 'waterfall') {
      console.log(`[DSH-mux] $events 未处理的瀑布事件: ${value.event}`)
    } else {
      console.log('[DSH-mux] $events 未知项:', JSON.stringify(value).slice(0, 240))
    }
    return
  }
  if (r.clientId !== undefined && r.clientId !== null) {
    _muxClientId = r.clientId
    console.log(`[DSH-mux] $events 流就绪 clientId=${r.clientId.slice(0, 8)}…`)
  }
  if (r.register) _muxRemoteEvents.set(r.register.eventId, r.register.event)
  if (r.unregisterEventId) _muxRemoteEvents.delete(r.unregisterEventId)
  if (r.removedSession) {
    if (r.removedSession === _muxActiveSession) _muxActiveSession = null
    muxCloseFollow(r.removedSession)
    deleteSessionCursor(r.removedSession)
  }
  // 帧分流：host/* 走 host 通道；瀑布 server-request 等走 mux 通道（渲染层按帧类型消费）
  for (const f of r.frames) {
    if (String(f.type).startsWith('host/')) broadcastHostFrame(f)
    else broadcastMuxFrame(f)
  }
}

function handleMuxMessage(raw: string): void {
  let msg: { streamId?: string; type?: string; value?: Record<string, unknown>; error?: unknown } | null = null
  try { msg = JSON.parse(raw) } catch { return }
  if (!msg?.streamId) return
  const meta = _muxStreamMeta.get(msg.streamId)
  if (!meta) return
  if (msg.type === 'item') {
    if (meta.kind === 'events') applyEventsValue(msg.value ?? null)
    else applyFollowValue(meta, msg.value ?? null)
    return
  }
  if (msg.type === 'error') {
    console.warn('[DSH-mux] 流错误:', JSON.stringify(msg.error ?? {}).slice(0, 200))
    if (meta.kind === 'follow') {
      // 会话已消失（follow 打不开）：清流；活跃信号由渲染层下一次 history/prompt 重建
      _muxFollowBySession.delete(meta.sessionId)
      _muxStreamMeta.delete(msg.streamId)
      deleteSessionCursor(meta.sessionId)
    } else {
      _muxEventsStreamId = null
    }
    return
  }
  if (msg.type === 'end') {
    if (meta.kind === 'follow') {
      _muxFollowBySession.delete(meta.sessionId)
      _muxStreamMeta.delete(msg.streamId)
      deleteSessionCursor(meta.sessionId)
    } else {
      _muxEventsStreamId = null
    }
  }
}

/** history 专用：确保 follow 已开 + 等到 cursor；超时则重开一次 follow 再等一轮（自愈竞态） */
export async function ensureSessionCursor(sessionId: string): Promise<number | null> {
  if (getActiveAdapter().streamMode !== 'remote-mux') return null // legacy 模式全量 history 无需 cursor
  muxSetActiveSession(sessionId)
  let cursor = await waitForSessionCursor(sessionId)
  if (cursor === null) {
    console.warn(`[DSH-mux] cursor 等待超时，重开 follow: ${sessionId.slice(0, 20)}…`)
    // 直接删流重开：muxSetActiveSession 对同 id 幂等返回，重开必须绕过它
    _muxFollowBySession.delete(sessionId)
    muxOpenFollow(sessionId)
    cursor = await waitForSessionCursor(sessionId, 3000)
  }
  return cursor
}

// ─── 连接管理 ───

/** remote-mux 模式连接（0.1.7 单连接多路复用；cookie 就绪前稍后重试） */
async function connectMuxRemote(adapter: DshKernelAdapter): Promise<void> {
  try {
    const cookie = await ensureDshAuthCookie()
    if (!cookie) {
      // 0.1.7 鉴权 cookie 未就绪（启动 URL 尚未打印）：稍后重试
      _muxReconnectTimer = setTimeout(() => { void connectMuxWs() }, 2000)
      return
    }
    const WebSocket = require('ws') as typeof import('ws').default
    const ws = new WebSocket(`ws://127.0.0.1:${DSH_PORT_DEFAULT}${adapter.muxEndpoint}`, { headers: { cookie, Origin: `http://127.0.0.1:${DSH_PORT_DEFAULT}` } })
    _muxWs = ws

    ws.on('open', () => {
      console.log(`[DSH-mux] ${adapter.muxEndpoint} 已连接`)
      _muxEventsStreamId = randomUUID()
      _muxStreamMeta.set(_muxEventsStreamId, { kind: 'events' })
      muxWsSend({ type: 'open', streamId: _muxEventsStreamId, endpoint: '$events', payload: { args: {} } })
      if (_muxActiveSession) muxOpenFollow(_muxActiveSession)
    })

    ws.on('message', (raw: Buffer) => {
      try { handleMuxMessage(raw.toString()) } catch { /* 解析失败忽略 */ }
    })

    ws.on('close', () => {
      console.log('[DSH-mux] WS 已断开，5s 后重连')
      _muxWs = null
      _muxStreamMeta.clear()
      _muxFollowBySession.clear()
      _muxEventsStreamId = null
      // 断开即失效的 $events 代：未决议的瀑布卡全部按 resolved 清除，
      // 重连后网关会把仍 pending 的瀑布用新 eventId 重放（upsert 成新卡）
      _muxClientId = null
      for (const [eventId, event] of _muxRemoteEvents) {
        if (event === 'approval/request') {
          broadcastMuxFrame({ type: 'server-request', rpcId: eventId, method: 'approval/resolved', payload: { approvalId: eventId } })
        } else if (event === 'user-questions/request') {
          broadcastMuxFrame({ type: 'server-request', rpcId: eventId, method: 'question/resolved', payload: { questionRpcId: eventId } })
        }
      }
      _muxRemoteEvents.clear()
      _muxReconnectTimer = setTimeout(() => { void connectMuxWs() }, 5000)
    })

    ws.on('error', (err: Error) => {
      console.error('[DSH-mux] WS 错误:', err.message)
      ws.close()
    })
  } catch (err) {
    console.error('[DSH-mux] WS 初始化失败:', err)
    _muxReconnectTimer = setTimeout(() => { void connectMuxWs() }, 5000)
  }
}

/** legacy-events 模式连接（0.1.1 events.mux 裸下行：方言帧原样转发，零翻译） */
async function connectMuxLegacy(adapter: DshKernelAdapter): Promise<void> {
  try {
    const headers: Record<string, string> = { Origin: `http://127.0.0.1:${DSH_PORT_DEFAULT}` }
    if (adapter.capabilities.authRequired) {
      const cookie = await ensureDshAuthCookie()
      if (cookie) headers.cookie = cookie
    }
    const WebSocket = require('ws') as typeof import('ws').default
    const ws = new WebSocket(`ws://127.0.0.1:${DSH_PORT_DEFAULT}${adapter.muxEndpoint}`, { headers })
    _muxWs = ws

    ws.on('open', () => {
      console.log(`[DSH-mux] ${adapter.muxEndpoint} 已连接（legacy 直通模式）`)
    })

    ws.on('message', (raw: Buffer) => {
      try { broadcastMuxFrame(JSON.parse(raw.toString())) } catch { /* 解析失败忽略 */ }
    })

    ws.on('close', () => {
      console.log('[DSH-mux] WS 已断开，5s 后重连')
      _muxWs = null
      _muxReconnectTimer = setTimeout(() => { void connectMuxWs() }, 5000)
    })

    ws.on('error', (err: Error) => {
      console.error('[DSH-mux] WS 错误:', err.message)
      ws.close()
    })
  } catch (err) {
    console.error('[DSH-mux] WS 初始化失败:', err)
    _muxReconnectTimer = setTimeout(() => { void connectMuxWs() }, 5000)
  }
}

export function connectMuxWs(): void {
  if (_muxWs) return
  const adapter = getActiveAdapter()
  if (adapter.streamMode === 'legacy-events') void connectMuxLegacy(adapter)
  else void connectMuxRemote(adapter)
}

export function disconnectMuxWs(): void {
  if (_muxReconnectTimer) { clearTimeout(_muxReconnectTimer); _muxReconnectTimer = null }
  if (_muxWs) { _muxWs.close(); _muxWs = null }
}

// ─── Host 事件流 WS 下行桥（/api/events.host，0.1.1 legacy 专用） ───
// 主机级帧（host/session-status、host/session-added|removed、host/agent-error 等）。
// 与 mux 桥同构：main 进程连 WS → 解析 JSON 帧 → IPC 广播渲染进程；
// 单向下行协议：客户端发送任何消息会被服务端以 1008 "downlink only" 关闭，绝不上行。
// 0.1.7+ 内核无此端点（主机级事件由 mux 桥 $events 翻译承载）——connectHostWs 按适配器
// capability 守卫短路，严禁对不存在的端点发起重连循环（socket hang up 刷屏的教训）。
let _hostWs: import('ws').WebSocket | null = null
let _hostReconnectTimer: ReturnType<typeof setTimeout> | null = null

export function connectHostWs(): void {
  if (_hostWs) return
  const adapter = getActiveAdapter()
  // 适配器声明无 host 流端点（如 0.1.7：/api/events.host 已随 typert 网关改版移除，
  // 主机级事件由 mux 桥 $events 翻译承载）→ 不连接、不重试；否则内核 webserver 对
  // 未注册 upgrade 路径直接 socket.destroy()，客户端陷入 "socket hang up" 5s 重连死循环
  if (!adapter.capabilities.hostStream || !adapter.hostEndpoint) return
  try {
    const WebSocket = require('ws') as typeof import('ws').default
    const ws = new WebSocket(`ws://127.0.0.1:${DSH_PORT_DEFAULT}${adapter.hostEndpoint}`, { headers: { Origin: `http://127.0.0.1:${DSH_PORT_DEFAULT}` } })
    _hostWs = ws

    ws.on('open', () => { console.log('[DSH-host] WS 已连接') })

    ws.on('message', (raw: Buffer) => {
      try {
        const frame = JSON.parse(raw.toString())
        broadcastHostFrame(frame)
      } catch { /* 解析失败忽略 */ }
    })

    ws.on('close', () => {
      console.log('[DSH-host] WS 已断开，5s 后重连')
      _hostWs = null
      _hostReconnectTimer = setTimeout(connectHostWs, 5000)
    })

    ws.on('error', (err: Error) => {
      console.error('[DSH-host] WS 错误:', err.message)
      ws.close()
    })
  } catch (err) {
    console.error('[DSH-host] WS 初始化失败:', err)
    _hostReconnectTimer = setTimeout(connectHostWs, 5000)
  }
}

export function disconnectHostWs(): void {
  if (_hostReconnectTimer) { clearTimeout(_hostReconnectTimer); _hostReconnectTimer = null }
  if (_hostWs) { _hostWs.close(); _hostWs = null }
}

/** 仅测试用：复位模块状态 */
export function __resetStreamBridgeForTest(): void {
  _muxWs = null
  _muxEventsStreamId = null
  _muxActiveSession = null
  _muxClientId = null
  _muxFollowBySession.clear()
  _muxStreamMeta.clear()
  _muxRemoteEvents.clear()
  _hostWs = null
}
