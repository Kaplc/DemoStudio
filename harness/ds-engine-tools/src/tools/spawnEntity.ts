/**
 * spawn_entity：通过 ai.spawnActor AI 事件在运行时场景生成 Actor
 *
 * 危险等级：高危（影响游戏运行状态 + 注入外部实体）→ 默认 ask
 * 实现：editor HTTP `/api/command` → `ai_event` → `ai.spawnActor`
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'
import { requiresApproval, askUser } from '../guards'

export const spawnEntitySchema = z.object({
  blueprint: z.string().optional().describe('蓝图资产路径（如 asset/units/fish.unit.json）；与 baseClass 至少给一个'),
  baseClass: z.string().optional().describe('Actor 基类名（如 GenericActor）；备选方案'),
  name: z.string().optional().describe('Actor 实例名（不指定则引擎自动生成）'),
  position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('世界坐标 [x, y, z]'),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('欧拉角 [rx, ry, rz]（度）'),
  scale: z.tuple([z.number(), z.number(), z.number()]).optional().describe('缩放 [sx, sy, sz]'),
})

export interface SpawnEntityResult {
  ok: boolean
  error?: string
  spawnedName?: string
  handled?: boolean
}

export async function spawnEntity(args: z.infer<typeof spawnEntitySchema>, ctx: unknown): Promise<SpawnEntityResult> {
  if (!args.blueprint && !args.baseClass) {
    return { ok: false, error: '缺少 blueprint 或 baseClass 至少一个' }
  }
  const ec = getEngineContext(ctx)
  if (!ec) return { ok: false, error: 'EngineContext 未注入' }
  // 守卫：高危默认 ask
  const policy = ec.guardPolicy ?? {}
  if (requiresApproval('spawn_entity', policy)) {
    const summary = `spawn_entity(${args.name ?? args.blueprint ?? args.baseClass} @ ${args.position?.join(',') ?? 'auto'})`
    const approved = await askUser('spawn_entity', summary)
    if (!approved) return { ok: false, error: '用户拒绝（requires approval）' }
  }
  const result = await ec.engineBridge.callTool('ai_event', {
    event: 'ai.spawnActor',
    payload: {
      blueprint: args.blueprint,
      baseClass: args.baseClass,
      name: args.name,
      position: args.position,
      rotation: args.rotation,
      scale: args.scale,
    },
  })
  const r = result as { ok?: boolean; error?: string; data?: { name?: string }; results?: unknown[] } | null
  return {
    ok: r?.ok === true || (r?.results && r.results.length > 0) || false,
    error: r?.error,
    spawnedName: r?.data?.name,
    handled: Boolean(r?.results && r.results.length > 0),
  }
}

export const spawnEntityTool = {
  name: 'spawn_entity',
  description: '在当前游戏场景生成 Actor。需要 blueprint 或 baseClass 至少一个。高危操作（默认 ask 守卫）。',
  parameters: {
    blueprint: { type: 'string', description: '蓝图资产路径（如 asset/units/fish.unit.json）；与 baseClass 至少给一个' },
    baseClass: { type: 'string', description: 'Actor 基类名（如 GenericActor）；备选方案' },
    name: { type: 'string', description: 'Actor 实例名（不指定则引擎自动生成）' },
    position: { type: 'array', items: { type: 'number' }, description: '世界坐标 [x, y, z]' },
    rotation: { type: 'array', items: { type: 'number' }, description: '欧拉角 [rx, ry, rz]（度）' },
    scale: { type: 'array', items: { type: 'number' }, description: '缩放 [sx, sy, sz]' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        error: { type: 'string' },
        spawnedName: { type: 'string' },
        handled: { type: 'boolean' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: spawnEntity,
}
