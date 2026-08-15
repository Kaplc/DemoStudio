/**
 * registerGMBridge — ai.gmCommand AI/MCP 桥接（GM 命令的第二触发渠道）
 *
 * 事件：ai.gmCommand，payload { command: string; args?: string[] }
 * 如 { command: 'addCoins', args: ['100'] } → 等价控制台执行 'addCoins 100'。
 * 处理器经 GameInstance.current.gm.execute 执行，返回值回传 AI：
 *   { ok: boolean; message: string }
 *
 * 注册幂等（与 registerBuiltinAIHandlers 同模式）：每次调用先 clearEvent
 * 旧处理器再注册，HMR 重载不重复触发。
 * 在 registry.ts 的 registerAllProjectModules 中调用（引擎初始化时全局注册一次）。
 */
import { AIModule } from '../ai/AIModule'
import { AI_EVENT_GM_COMMAND, type AIGMCommandPayload } from '../ai/AIEvents'
import { GameInstance } from '../gameflow/GameInstance'
import { logger } from '../Logger'

/** ai.gmCommand 返回结构（回传 AI / Playwright 断言） */
export interface AIGMCommandResult {
  ok: boolean
  message: string
}

/**
 * 注册 ai.gmCommand 桥接（幂等：先清旧处理器再注册）。
 * 游戏未运行时返回 { ok: false, message: 'GM 命令需要游戏运行中' }。
 */
export function registerGMBridge(): void {
  const ai = AIModule.instance
  ai.clearEvent(AI_EVENT_GM_COMMAND)

  ai.register(AI_EVENT_GM_COMMAND, (payload: unknown): AIGMCommandResult => {
    const p = (payload ?? {}) as AIGMCommandPayload
    const command = p.command ?? ''
    if (!command) {
      logger.warn('[GM-Bridge] ai.gmCommand 缺少 command')
      return { ok: false, message: '缺少 command 字段' }
    }
    const line = [command, ...(p.args ?? [])].join(' ')

    const inst = GameInstance.current
    if (!inst) {
      logger.warn('[GM-Bridge] ai.gmCommand 需要游戏运行中（当前未运行）')
      return { ok: false, message: 'GM 命令需要游戏运行中' }
    }
    const gm = (inst as unknown as { gm?: { execute: (line: string, out?: (text: string) => void) => AIGMCommandResult } }).gm
    if (!gm) {
      logger.warn('[GM-Bridge] 游戏实例未挂载 GMModule')
      return { ok: false, message: '游戏实例未挂载 GMModule' }
    }
    // 收集 handler 的 ctx.output 文本作为回传 message（AI 可读命令实际输出）
    const outputs: string[] = []
    const result = gm.execute(line, (text) => {
      outputs.push(text)
    })
    const message = outputs.length > 0 ? outputs.join('\n') : result.message
    logger.info(`[GM-Bridge] ai.gmCommand "${line}" → ${result.ok ? '成功' : '失败'}: ${message}`)
    return { ok: result.ok, message }
  })

  logger.info('[GM-Bridge] ai.gmCommand 桥接已注册（幂等）')
}
