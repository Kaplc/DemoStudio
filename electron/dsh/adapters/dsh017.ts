/**
 * DSH 0.1.7 内核适配器（现行为适配：2026-09-29 全量适配 + 2026-10-01 瀑布应答的翻译知识原样收编）
 *
 * 覆盖内核：>= 0.1.7（typert 网关 + 强制 cookie 鉴权 + remote.mux 单连接多路复用）
 *
 * 本文件即 0.1.7 协议世界的全部知识：
 *   - RPC 改名 + {args} 信封整形 + 响应 reshape（session.list→session/list 等）
 *   - 透传族：$events/result（瀑布应答）、commands/list（斜杠命令）——渲染层直发线格式
 *   - session/history 语义迁移（page 分页 + throughSeq≤cursor）+ 事件加法归一化
 *   - 流式增量在 assistant-stream 瞬态帧（翻译在 streamBridge，此处只声明能力）
 *
 * 内核 0.1.8+ 破坏性更新时：复制本文件为 dsh018.ts 修改差异，registry 登记后 0.1.7
 * 适配器保留——内核回滚时注册表自动重新选中本适配器，编辑器零改动。
 */

import { randomUUID } from 'node:crypto'
import { compareVersions } from '../../dshKernelVersion'
import type { DshKernelAdapter, DshRpcTranslation } from '../gateway'
import { getSessionCursor } from '../cursor'
import { normalizeSessionEvent } from '../eventMap'

/**
 * toArgs 产出完整线上载荷（typert 信封 {args:…} 在此包好）：
 * args 内部 = 描述符按位置参数绑定的命名字段（request/_request 是字段名而非另一层信封）。
 * 多包一层 args = unexpected "args"。
 */
const RPC: Record<string, DshRpcTranslation> = {
  // session/list(_request: {cursor?}) → {items: SessionSummary[]}（字段与旧形状兼容；不触发 follow）
  'session.list': {
    wireMethod: 'session/list',
    toArgs: (p) => ({ args: { _request: { cursor: p.cursor } } }),
  },
  // session/create(request: {cwd?, agentPreset?}) → {sessionId, agentPreset}（兼容）
  // 响应里的 sessionId 的会话激活副作用由 rpcProxy 统一处理（适配器保持纯函数）
  'session.create': {
    wireMethod: 'session/create',
    toArgs: (p) => ({ args: { request: p } }),
  },
  // session/prompt(request: {requestId, sessionId, mode, content})：0.1.7 要求客户端自铸 requestId
  'session.prompt': {
    wireMethod: 'session/prompt',
    toArgs: (p) => ({ args: { request: { requestId: randomUUID(), ...p } } }),
  },
  'session.cancel': { wireMethod: 'session/cancel', toArgs: (p) => ({ args: { request: p } }) },
  // session/modelCatalog() → {default, groups, …}；旧渲染层读 {groups, current}
  'session.models': {
    wireMethod: 'session/modelCatalog',
    toArgs: () => ({ args: {} }),
    reshape: (v) => {
      const c = v as { default?: unknown; groups?: unknown }
      return { groups: c?.groups ?? [], current: c?.default ?? null }
    },
  },
  // session/page(request: {address, throughSeq, beforeSeq?, maxMessages?}) → {records: [{type:'event', event}]}
  // 旧 session.history 响应形状 = {events: [{event}]}；throughSeq 取极大值 = 全量读到当前。
  // reshape 时逐事件做加法归一化（meta.diffs → 方言 diffs 字段），实时/历史两路形状一致。
  'session.history': {
    wireMethod: 'session/page',
    toArgs: (p) => ({
      args: {
        request: {
          address: { kind: 'session', sessionId: p.sessionId },
          // throughSeq 不允许超过会话当前 cursor（越界即 gateway 报错）；等待 follow snapshot 报来后使用
          throughSeq: getSessionCursor(String(p.sessionId)) ?? 0,
          ...(p.beforeSeq !== undefined ? { beforeSeq: p.beforeSeq } : {}),
          // 旧 session.history 是全量语义；page 是分页语义——不传大 maxMessages 只回 1 条
          maxMessages: (p.maxMessages as number | undefined) ?? 10000,
        },
      },
    }),
    reshape: (v) => {
      const records = (v as { records?: unknown[] })?.records ?? []
      return {
        events: records.map((r) => {
          if (!r || typeof r !== 'object') return r
          const rec = r as { event?: unknown }
          if (rec.event && typeof rec.event === 'object' && !Array.isArray(rec.event)) {
            return { ...rec, event: normalizeSessionEvent(rec.event as Record<string, unknown>) }
          }
          return r
        }),
      }
    },
  },
  // skills/list(request: {sessionId})：会话可见技能目录
  'skill.list': { wireMethod: 'skills/list', toArgs: (p) => ({ args: { request: p } }) },
  // settings/describe()：0.1.7 零参（namespace 过滤取消，全量返回 namespaces 数组、渲染层自筛 .ns）
  'settings.describe': { wireMethod: 'settings/describe', toArgs: () => ({ args: {} }) },
  // settings/mutate(ns, ops, expectedRevision?)：渲染层 {ns, ops} 即命名参数本体
  'settings.mutate': { wireMethod: 'settings/mutate', toArgs: (p) => ({ args: p }) },
  // session/selectModel(request: {sessionId, provider, model, reasoningEffort?})
  'session.selectModel': { wireMethod: 'session/selectModel', toArgs: (p) => ({ args: { request: p } }) },
  // workspace/archiveSession(request: {sessionId, stopActivity?})
  'workspace.archiveSession': { wireMethod: 'workspace/archiveSession', toArgs: (p) => ({ args: { request: p } }) },
  // agentPresets/list()：0.1.7 线上名为复数 agentPresets 且零参；{presets:[…]} 渲染层直接消费
  'agentPreset.list': { wireMethod: 'agentPresets/list', toArgs: () => ({ args: {} }) },
  // ── 点号 → 斜杠透传族（0.1.7 未改名的端点；载荷 {args: p} 信封与旧透传行为一致） ──
  'credentials.describe': { wireMethod: 'credentials/describe', toArgs: (p) => ({ args: p }) },
  'credentials.set': { wireMethod: 'credentials/set', toArgs: (p) => ({ args: p }) },
  'credentials.unset': { wireMethod: 'credentials/unset', toArgs: (p) => ({ args: p }) },
  // ── 透传族：渲染层直发线格式（payload 已含 {args:…}），登记只为 fail-loud 白名单化 ──
  // commands/list(request: {agentId})：斜杠命令目录（渲染层直发 {args:{agentId}}）
  'commands/list': { wireMethod: 'commands/list', toArgs: (p) => p },
  // $events/result：交互瀑布应答（审批/提问统一回程，clientId+eventId+outcome 由渲染层组装）
  '$events/result': { wireMethod: '$events/result', toArgs: (p) => p },
}

export const dsh017Adapter: DshKernelAdapter = {
  id: 'dsh017',
  matches: (version) => {
    // 代际下界用 '0.1.7-0'：semver 预发布 < 正式版（0.1.7-rc.2 < 0.1.7），
    // 直接比 '0.1.7' 会把自家 rc 版判给 legacy 适配器
    const c = compareVersions(version, '0.1.7-0')
    return c !== null && c >= 0
  },
  capabilities: {
    authRequired: true,
    assistantStream: true,
    // 0.1.7 内核全库只注册 /api/remote.mux 一个 WS upgrade 路径（api-gateway），
    // /api/events.host 是 0.1.1 legacy 端点、已不存在；webserver 对未注册路径的
    // upgrade 直接 socket.destroy() → 客户端 ECONNRESET "socket hang up" → 5s 重连死循环。
    // 主机级事件（host/session-status 等）由 mux 桥 $events 流的 emit 翻译承载（streamBridge）。
    hostStream: false,
    projection: true,
    contextPressure: true,
  },
  streamMode: 'remote-mux',
  muxEndpoint: '/api/remote.mux',
  // 空串 = 内核无 host 流端点；connectHostWs 按 hostStream/hostEndpoint 守卫短路
  hostEndpoint: '',

  translateRpc(method, payload) {
    const t = RPC[method]
    if (!t) {
      // fail loud：静默透传只会把协议漂移拖到运行时 404（0.1.7 session.list 404 的教训）
      throw new Error(
        `[dsh-adapter:dsh017] 未登记的方言 RPC: ${method}（在 electron/dsh/adapters/dsh017.ts 登记，或为该内核版本新增适配器）`,
      )
    }
    return { method: t.wireMethod, payload: t.toArgs(payload), reshape: t.reshape }
  },
}
