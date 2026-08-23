/**
 * set_game_speed：设置游戏 time scale（影响物理/动画/游戏逻辑速度）
 *
 * 危险等级：中（影响游戏体验）→ 默认 ask
 *
 * 实现：经 MCP/HTTP 调用 `set_game_speed` 命令（编辑器侧需要 B 已实现此命令）。
 * 若编辑器未实现，回退到 `send_command`（控制台 / GM 命令通道）：
 *   "timescale <value>" 或 "set speed <value>"
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'
import { requiresApproval, askUser } from '../guards'

export const setGameSpeedSchema = z.object({
  speed: z.number().min(0).max(10).describe('time scale 倍率；0=暂停，1=正常，2=2 倍速'),
  durationMs: z.number().int().min(0).optional().describe('恢复 1x 倒计时（毫秒）；省略则持久'),
})

export interface SetGameSpeedResult {
  ok: boolean
  applied: boolean
  speed: number
  error?: string
}

export async function setGameSpeed(args: z.infer<typeof setGameSpeedSchema>, ctx: unknown): Promise<SetGameSpeedResult> {
  const ec = getEngineContext(ctx)
  if (!ec) return { ok: false, applied: false, speed: args.speed, error: 'EngineContext 未注入' }
  const policy = ec.guardPolicy ?? {}
  if (requiresApproval('set_game_speed', policy)) {
    const ok = await askUser('set_game_speed', `set_game_speed(${args.speed}x, ${args.durationMs ?? '永久'})`)
    if (!ok) return { ok: false, applied: false, speed: args.speed, error: '用户拒绝' }
  }
  // 优先：直接调 MCP/HTTP 命令 set_game_speed
  const direct = await ec.engineBridge.callTool('set_game_speed', { speed: args.speed, durationMs: args.durationMs })
  const dr = direct as { ok?: boolean; error?: string } | null
  if (dr?.ok) return { ok: true, applied: true, speed: args.speed }
  // 兜底：GM 命令通道
  const fallback = await ec.engineBridge.callTool('send_command', { command: `timescale ${args.speed}` })
  const fr = fallback as { ok?: boolean; error?: string } | null
  if (fr?.ok) return { ok: true, applied: true, speed: args.speed }
  return { ok: false, applied: false, speed: args.speed, error: fr?.error || dr?.error || '通道均不可用' }
}

export const setGameSpeedTool = {
  name: 'set_game_speed',
  description: '设置游戏 time scale 倍率（0=暂停，1=正常，2=2x…）。高危操作（默认 ask 守卫）。',
  schema: setGameSpeedSchema,
  execute: setGameSpeed,
}
