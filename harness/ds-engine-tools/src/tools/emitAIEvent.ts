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

export async function emitAIEvent(args: z.infer<typeof emitAIEventSchema>, ctx: unknown): Promise<EmitAIEventResult> {
  const { event, payload } = args

  if (!event) {
    return { ok: false, event, error: '缺少 event 参数' }
  }

  const ec = getEngineContext(ctx)
  if (!ec) return { ok: false, event, error: 'EngineContext 未注入（编辑器未连接）' }

  // 守卫：高危事件需要用户确认
  const policy = ec.guardPolicy ?? {}
  if (HIGH_RISK_EVENTS.has(event) && requiresApproval('emit_ai_event', policy)) {
    const summary = `emit_ai_event(${event}, ${JSON.stringify(payload ?? {}).slice(0, 100)})`
    const approved = await askUser('emit_ai_event', summary)
    if (!approved) return { ok: false, event, error: '用户拒绝（requires approval）' }
  }

  try {
    const result = await ec.engineBridge.callTool('ai_event', { event, payload: payload ?? {} })
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
