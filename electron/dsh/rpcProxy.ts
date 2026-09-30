/**
 * DSH RPC 代理：渲染进程 → main → DSH（绕过 CORS）
 *
 * 职责：活跃适配器翻译方言 RPC → 线上请求；鉴权头与 401 重换；
 * 会话激活副作用（follow 流跟随）。翻译本身在 adapters/<ver>.ts
 * （本文件零内核协议知识，端点/信封均来自适配器产物）。
 *
 * 交互瀑布（审批/提问）的应答由渲染层经 dsh-rpc('$events/result') 直发
 * （dsh017 适配器已登记透传），本模块无专用应答通道。
 */

import { DSH_PORT_DEFAULT } from './context'
import { getActiveAdapter } from './registry'
import { ensureDshAuthCookie, resetDshAuthCookie, dshAuthHeaders } from './auth'
import { ensureSessionCursor, muxSetActiveSession } from './streamBridge'

/** dsh-rpc 执行器（main.ts ipcMain.handle('dsh-rpc') 薄委托入口） */
export async function dshRpcRequest(method: string, payload: unknown, timeoutMs?: number): Promise<unknown> {
  const rpcId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const reqPayload = (payload as Record<string, unknown>) ?? {}
  const adapter = getActiveAdapter()

  // session/page 的 throughSeq 依赖 follow snapshot 的 cursor：先开 follow 再等 cursor 报来
  if (method === 'session.history' && typeof reqPayload.sessionId === 'string') {
    await ensureSessionCursor(reqPayload.sessionId)
  }
  // 会话激活副作用（follow 流跟随活跃会话）：prompt/history 以请求载荷里的 sessionId 激活；
  // create 的 sessionId 在响应里，reshape 成功后激活（见下）——原适配器 toArgs/reshape 内嵌副作用的等价搬迁。
  if (
    adapter.streamMode === 'remote-mux'
    && typeof reqPayload.sessionId === 'string'
    && (method === 'session.prompt' || method === 'session.history')
  ) {
    muxSetActiveSession(reqPayload.sessionId)
  }

  let t: { method: string; payload: Record<string, unknown>; reshape?: (value: unknown) => unknown }
  try {
    t = adapter.translateRpc(method, reqPayload)
  } catch (err) {
    // fail loud：未登记的方言 RPC 不透传（静默透传只会在内核侧 404，排障更难）
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[dsh-rpc] ${msg}`)
    return { type: 'server-response', rpcId, result: { ok: false, error: { message: msg } } }
  }

  const post = () => fetch(`http://127.0.0.1:${DSH_PORT_DEFAULT}/api/${t.method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...dshAuthHeaders() },
    body: JSON.stringify({ type: 'client-request', rpcId, method: t.method, payload: t.payload }),
    // 默认 30s；长耗时调用（如 /compact 压缩摘要）由调用方显式传更大的 timeoutMs
    signal: AbortSignal.timeout(timeoutMs ?? 30000),
  })
  try {
    let res = await post()
    if (res.status === 401) {
      // cookie 失效（token 轮换）→ 重换一次再试
      resetDshAuthCookie()
      await ensureDshAuthCookie()
      res = await post()
    }
    const json = await res.json() as { result?: { ok?: boolean; value?: unknown } }
    if (t.reshape && json?.result?.ok && json.result.value !== undefined) {
      json.result.value = t.reshape(json.result.value)
      // session/create 成功：以响应里的 sessionId 激活 follow 会话
      if (method === 'session.create' && adapter.streamMode === 'remote-mux') {
        const sid = (json.result.value as { sessionId?: unknown })?.sessionId
        if (typeof sid === 'string') muxSetActiveSession(sid)
      }
    }
    return json
  } catch (err) {
    return { type: 'server-response', rpcId, result: { ok: false, error: { message: String(err) } } }
  }
}
