/**
 * 工具守卫：高危操作默认 ask，可配置改 allow/deny
 *
 * 配置 schema：
 *   dsh.guardPolicy = {
 *     'inspect_scene': 'allow',
 *     'spawn_entity': 'ask',
 *     'run_scenario': 'ask',
 *     'get_game_state': 'allow',
 *     'set_game_speed': 'deny'
 *   }
 * 未配置 → 走默认（高危 = ask）
 */

export type GuardDecision = 'allow' | 'deny' | 'ask'

const HIGH_RISK_TOOLS = new Set(['spawn_entity', 'run_scenario', 'set_game_speed'])
const DEFAULT_DECISION: GuardDecision = 'allow'

export interface GuardPolicy {
  [toolName: string]: GuardDecision
}

/** 获取一个工具的最终决策（合并默认 + 配置） */
export function getDecision(toolName: string, policy: GuardPolicy = {}): GuardDecision {
  if (policy[toolName]) return policy[toolName]
  if (HIGH_RISK_TOOLS.has(toolName)) return 'ask'
  return DEFAULT_DECISION
}

/** 是否需要用户确认 */
export function requiresApproval(toolName: string, policy?: GuardPolicy): boolean {
  return getDecision(toolName, policy) === 'ask'
}

/** 同步询问用户（绕开 DSH，通过 vscode commands 在插件回调中调用） */
export async function askUser(toolName: string, argsSummary: string): Promise<boolean> {
  // 不在 dsh-plugin 内 import vscode（避免硬依赖），由上层 host 注入实现
  const injected = (globalThis as { __dshGuard?: { askUser: (name: string, args: string) => Promise<boolean> } }).__dshGuard
  if (injected?.askUser) return injected.askUser(toolName, argsSummary)
  // 兜底：没有 host 注入时直接拒绝（保守）
  return false
}
