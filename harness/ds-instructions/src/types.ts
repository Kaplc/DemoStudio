/**
 * ds-instructions 的消息来源契约与公共类型。
 *
 * 注入消息采用 DSH 官方 `agent-instructions` 语义来源（§10.1），前端
 * AgentService/ContextCard 已支持：从 `changes[].path` 显示指令文件路径，
 * `form: 'instructions'` 识别为可折叠上下文卡片。scope 编码为
 * `<指令目录>\0<文件名>`，与官方 `candidateScopeKey` 结构一致，因此官方
 * dsh-agent-instructions 插件与本插件共存时会把我们的 scope 当作普通指令
 * scope 探测同名文件（路径+digest 一致 → 静默），不会互相覆盖状态。
 *
 * @module @demostudio/ds-instructions/types
 */

/** 一次指令状态迁移（官方 AgentInstructionChange 同构）。 */
export interface AgentInstructionChange {
  /** `set` 首次出现；`replace` 内容已变化、新替代旧；`remove` 文件已删除/不再适用。 */
  action: 'set' | 'replace' | 'remove'
  /** 逻辑 scope：`<指令文件相对目录>\u0000<文件名>`。 */
  scope: string
  /** 项目根相对的指令文件展示路径。 */
  path: string
  /** 内容 SHA-1（十六进制）；remove 无 digest。 */
  digest?: string
}

/** 本插件注入消息的 source 结构。 */
export interface DemoInstructionSource {
  kind: 'agent-instructions'
  form: 'instructions'
  changes: AgentInstructionChange[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-instructions': DemoInstructionSource
  }
}

/** 判断任意 source 是否为本插件可消费的 agent-instructions 结构。 */
export function isInstructionSource(
  source: unknown,
): source is { kind: 'agent-instructions'; changes: unknown[] } {
  return typeof source === 'object' && source !== null
    && 'kind' in source && (source as { kind?: unknown }).kind === 'agent-instructions'
    && 'changes' in source && Array.isArray((source as { changes?: unknown }).changes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从 source 中解析合法的 change 列表（畸形条目直接丢弃，防伪造）。 */
export function parseInstructionChanges(source: { changes: unknown[] }): AgentInstructionChange[] {
  const changes: AgentInstructionChange[] = []
  for (const value of source.changes) {
    if (!isRecord(value)) continue
    if (value.action !== 'set' && value.action !== 'replace' && value.action !== 'remove') continue
    if (typeof value.scope !== 'string' || typeof value.path !== 'string') continue
    if (value.digest !== undefined && typeof value.digest !== 'string') continue
    changes.push({
      action: value.action,
      scope: value.scope,
      path: value.path,
      ...value.digest !== undefined ? { digest: value.digest } : {},
    })
  }
  return changes
}
