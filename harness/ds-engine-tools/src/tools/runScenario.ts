/**
 * run_scenario：跑一段测试场景并读结果
 *
 * 实现：
 * 1) 启动游戏（start_game）
 * 2) 等待 durationMs（默认 20s）
 * 3) 拉取 get_game_state + read_console_logs
 * 4) 停止游戏
 *
 * 危险等级：高危（启停游戏）→ 默认 ask
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'
import { requiresApproval, askUser } from '../guards'

export const runScenarioSchema = z.object({
  project: z.string().optional().describe('项目名（eatfish / snake / racing / demo2d）；省略则使用当前打开工程'),
  durationMs: z.number().int().min(1000).max(300_000).default(20_000).describe('场景跑多久后拉取结果（毫秒）'),
  collectLogs: z.boolean().default(true).describe('是否同时收集控制台日志'),
})

export interface RunScenarioResult {
  ok: boolean
  durationMs: number
  gameState?: unknown
  consoleLogs?: string[]
  error?: string
  aborted?: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runScenario(args: z.infer<typeof runScenarioSchema>, ctx: unknown): Promise<RunScenarioResult> {
  const ec = getEngineContext(ctx)
  if (!ec) return { ok: false, durationMs: args.durationMs, error: 'EngineContext 未注入' }
  const policy = ec.guardPolicy ?? {}
  if (requiresApproval('run_scenario', policy)) {
    const ok = await askUser('run_scenario', `run_scenario(project=${args.project ?? 'current'}, ${args.durationMs}ms)`)
    if (!ok) return { ok: false, durationMs: args.durationMs, aborted: true, error: '用户拒绝' }
  }
  // 1. 启动
  const startArgs = args.project ? { project: args.project } : {}
  const startRes = await ec.engineBridge.callTool('start_game', startArgs)
  if ((startRes as { ok?: boolean })?.ok === false) {
    return { ok: false, durationMs: args.durationMs, error: `start_game 失败: ${JSON.stringify(startRes)}` }
  }
  // 2. 等
  await sleep(args.durationMs)
  // 3. 采样
  let gameState: unknown = null
  let consoleLogs: string[] | undefined
  try {
    gameState = await ec.engineBridge.callTool('ai_event', { event: 'ai.getState', payload: {} })
    if (args.collectLogs) consoleLogs = await ec.engineBridge.readConsoleLogs()
  } catch (err) {
    return { ok: false, durationMs: args.durationMs, error: `采样失败: ${err}` }
  } finally {
    // 4. 停止
    try { await ec.engineBridge.callTool('stop_game', {}) } catch { /* ignore */ }
  }
  return { ok: true, durationMs: args.durationMs, gameState, consoleLogs }
}

export const runScenarioTool = {
  name: 'run_scenario',
  description: '启动游戏 → 等待指定时长 → 拉取游戏状态 + 控制台日志 → 停止游戏。一站式跑场景测试，高危操作（默认 ask 守卫）。',
  parameters: {
    project: { type: 'string', description: '项目名（eatfish / snake / racing / demo2d）；省略则使用当前打开工程' },
    durationMs: { type: 'number', description: '场景跑多久后拉取结果（毫秒），默认 20000，范围 1000~300000' },
    collectLogs: { type: 'boolean', description: '是否同时收集控制台日志' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        durationMs: { type: 'number' },
        gameState: { type: 'object' },
        consoleLogs: { type: 'array', items: { type: 'string' } },
        error: { type: 'string' },
        aborted: { type: 'boolean' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: runScenario,
}
