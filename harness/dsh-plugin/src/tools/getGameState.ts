/**
 * get_game_state：拉取当前游戏运行状态快照
 *
 * 实现：editor HTTP `/api/command` → `ai_event` → `ai.getState`
 *
 * 安全：只读
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'

export const getGameStateSchema = z.object({})

export async function getGameState(_args: z.infer<typeof getGameStateSchema>, ctx: unknown): Promise<unknown> {
  const ec = getEngineContext(ctx)
  if (!ec) return { ok: false, error: 'EngineContext 未注入' }
  return await ec.engineBridge.callTool('ai_event', { event: 'ai.getState', payload: {} })
}

export const getGameStateTool = {
  name: 'get_game_state',
  description: '读取当前游戏运行状态快照（运行中与否、actor 数量、分数等）。只读操作。',
  schema: getGameStateSchema,
  execute: getGameState,
}
