/**
 * emit_ai_event：通用 AI 事件调用工具
 *
 * 可调用编辑器注册的任意 AI 事件（ai.clickActor / ai.getActor / ai.switchScene 等），
 * 而不是为每个事件硬编码单独的工具。
 *
 * 实现：editor HTTP `/api/command` → `ai_event` → AIModule.emit(event, payload)
 *
 * 安全：根据事件类型可能影响游戏状态，默认 ask 守卫
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'
import { requiresApproval, askUser } from '../guards'

export const emitAIEventSchema = z.object({
  event: z.string().describe('AI 事件名（如 ai.clickActor, ai.getActor, ai.switchScene）'),
  payload: z.record(z.unknown()).optional().describe('事件载荷（JSON 对象，结构取决于具体事件）'),
})

export interface EmitAIEventResult {
  ok: boolean
  event: string
  handled?: boolean
  result?: unknown
  error?: string
}

/** 高危事件列表：这些事件会修改游戏状态，需要用户确认 */
const HIGH_RISK_EVENTS = new Set([
  'ai.spawnActor',
  'ai.destroyActor',
  'ai.transformActor',
  'ai.setScore',
  'ai.addScore',
  'ai.gameOver',
  'ai.switchScene',
  'ai.clickActor',
  'ai.dragActor',
  'ai.selectActor',
])

/**
 * 直接通过 HTTP 调用编辑器 MCP API（绕过 engineBridge 抽象层）。
 *
 * 根因：engineBridge.callTool 在 DSH Cordis ctx 注入链路中会丢失嵌套 payload
 * （bridge 内部可能对 params 做了浅拷贝/序列化，导致 { event, payload: { panel: 'x' } }
 * 的 payload 子对象被丢弃）。直接用 fetch 构造完整请求体可绕过此问题。
 *
 * 端口发现优先级：
 *   1. DSH_ENGINE_PORT 环境变量
 *   2. engineBridge 内部端口（尝试读取 .port 属性）
 *   3. 编辑器默认 MCP 端口 9877
 */
const EDITOR_MCP_PORT_DEFAULT = 9877

function discoverMCPBridgePort(ec: { engineBridge: { port?: number } }): number {
  const envPort = process.env.DSH_ENGINE_PORT
  if (envPort) {
    const p = parseInt(envPort, 10)
    if (!isNaN(p) && p > 0) return p
  }
  // HttpEngineBridge 有 .port 属性
  if (ec.engineBridge?.port && typeof ec.engineBridge.port === 'number') {
    return ec.engineBridge.port
  }
  return EDITOR_MCP_PORT_DEFAULT
}

async function callMCPRaw(port: number, command: string, params: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(`http://127.0.0.1:${port}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params }),
  })
  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`)
  return await resp.json()
}

export async function emitAIEvent(args: z.infer<typeof emitAIEventSchema>, ctx: unknown): Promise<EmitAIEventResult> {
  // DSH 工具运行时可能将嵌套对象序列化为 JSON 字符串，需要反序列化
  let { event, payload } = args as { event: string; payload: unknown }
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { /* 保持原值 */ }
  }

  if (!event) {
    return { ok: false, event, error: '缺少 event 参数' }
  }

  // 守卫检查（需要 engineContext 获取 guardPolicy）
  const ec = getEngineContext(ctx)
  const policy = ec?.guardPolicy ?? {}
  if (HIGH_RISK_EVENTS.has(event) && requiresApproval('emit_ai_event', policy)) {
    const summary = `emit_ai_event(${event}, ${JSON.stringify(payload ?? {}).slice(0, 100)})`
    const approved = await askUser('emit_ai_event', summary)
    if (!approved) return { ok: false, event, error: '用户拒绝（requires approval）' }
  }

  try {
    // 直接 HTTP 调用：跳过 engineBridge.callTool，避免 payload 丢失
    const port = ec ? discoverMCPBridgePort(ec as { engineBridge: { port?: number } }) : EDITOR_MCP_PORT_DEFAULT
    const result = await callMCPRaw(port, 'ai_event', { event, payload: payload ?? {} })

    const r = result as {
      status?: string
      event?: string
      handled?: boolean
      result?: unknown
      results?: unknown[]
      error?: string
    } | null

    // 解析编辑器返回的结构
    if (r?.status === 'error') {
      return { ok: false, event, error: r.error ?? '编辑器返回错误' }
    }

    return {
      ok: true,
      event: r?.event ?? event,
      handled: r?.handled ?? false,
      result: r?.result ?? (r?.results && r.results.length > 0 ? r.results[0] : null),
    }
  } catch (err) {
    return { ok: false, event, error: `调用失败: ${err}` }
  }
}

export const emitAIEventTool = {
  name: 'emit_ai_event',
  description: `调用编辑器注册的任意 AI 事件。可触发游戏/编辑器操作，如：
- ai.clickActor: 点击 UI 元素 {name: 'ButtonName'}
- ai.getActor: 查询 Actor 信息 {name: 'ActorName'}
- ai.switchScene: 切换场景 {scene: 'SceneName'}
- ai.spawnActor: 生成 Actor {blueprint: 'path/to/unit.json'}
- ai.getState: 获取游戏状态 {}
- ai.setScore: 设置分数 {score: 100}
- 等等...

高危事件（spawn/destroy/click 等）默认需要用户确认。`,
  parameters: {
    event: { type: 'string', description: 'AI 事件名（如 ai.clickActor, ai.getActor, ai.switchScene）' },
    payload: { type: 'object', description: '事件载荷（JSON 对象，结构取决于具体事件）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        event: { type: 'string' },
        handled: { type: 'boolean' },
        result: {},
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: emitAIEvent,
}
