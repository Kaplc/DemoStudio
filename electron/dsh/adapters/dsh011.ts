/**
 * DSH 0.1.1（及更早）内核适配器（legacy 兼容适配）
 *
 * 覆盖内核：< 0.1.7（unary 点号路由 + 裸载荷信封 + 无鉴权 + events.mux/events.host 双流）
 *
 * 内核回退场景（npm i -g @deepseek-ai/dsh@0.1.1-rc.2）后，注册表按安装版本自动
 * 重新选中本适配器——编辑器零改动回到旧内核可用状态。
 *
 * 0.1.1 协议要点（2026-09-29 升级战役实录）：
 *   - RPC：方言方法名即线上名（session.list 点号形式），载荷裸传（无 {args} 信封），
 *     响应即方言形状（session.history 全量 {events:[{event}]}、session.models {groups,current}）
 *   - 流：/api/events.mux 裸下行帧 = 渲染方言帧原样转发（session/event、question/requested
 *     server-request 信封、session/projection）；主机级帧走独立 /api/events.host
 *   - 鉴权：无
 */

import { compareVersions } from '../../dshKernelVersion'
import type { DshKernelAdapter } from '../gateway'

export const dsh011Adapter: DshKernelAdapter = {
  id: 'dsh011',
  matches: (version) => {
    // 代际上界用 '0.1.7-0'：0.1.7 的预发布（如 0.1.7-rc.2）属 0.1.7 代，不归 legacy
    const c = compareVersions(version, '0.1.7-0')
    return c !== null && c < 0
  },
  capabilities: {
    authRequired: false,
    assistantStream: false, // chunk 增量在 0.1.1 是持久会话事件 assistant/chunk
    hostStream: true,
    projection: false,
    contextPressure: false,
  },
  streamMode: 'legacy-events',
  muxEndpoint: '/api/events.mux',
  hostEndpoint: '/api/events.host',

  translateRpc(method, payload) {
    // 恒等翻译：旧网关是朴素路由表，方言面与线上一致，任何方言方法都合法透传。
    // （与 0.1.7 适配器的 fail-loud 不同：旧协议没有「登记表」概念，透传即忠实。）
    return { method, payload: { ...payload } }
  },
}
