/**
 * @demostudio/ds-experience — DSH 行为飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"经验库指导"段（order 3000；含 INDEX.md 索引，
 *   仅在有内容时注入；分工声明：记忆=事实与规则，经验=做事轨迹）
 * - `ctx.tools.register()` × 4 — history_search / history_read（包装 ctx.sessionQuery）/
 *   experience_save / experience_search（按文件名直接读取）
 * - `ctx.on('session/event')` — 回合末（turn/end）主动注入经验提醒，提示 agent
 *   自查"本回合是否完成过有复用价值的完整任务"，有则 experience_save；
 *   **本回合已成功保存过经验（experience_save）时跳过**——跳过判定"各自只看自己"：
 *   同一次事件常需双写（结论进记忆、轨迹进经验），只存了记忆不代表没漏存经验，
 *   所以记忆保存不抑制本提醒（记忆侧由 ds-memory 的回合末提醒自行判定）
 *   （agent/pre-step 记录当前回合号，tools/result 登记保存工具的成功调用）
 * - `ctx.on('tools/pre-execute'/'tools/result'/'agent/pre-step')` — prefix 路径自动联想：
 *   读到满足经验 `prefix:` 表达式的文件时把该经验全文自动注入（每会话一次）；
 *   表达式支持 `||`（任一路径命中）与 `&&`（会话内全部路径读过，跨读取累计）
 *
 * 经验保存与检索完全由主 agent 自觉调用工具完成（system prompt 指导段 + 回合末提醒驱动），
 * 不做回合末自动提炼，不走 LLM 检索。
 *
 * @module @demostudio/ds-experience
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { deriveExperienceProjectRoot, isChildAgent, registerExperienceAssociator } from './associate.js'
import {
  END_OF_TURN_EXPERIENCE_REMINDER_TEXT,
  EXPERIENCE_DIR_SEGMENT,
  EXPERIENCE_INDEX_FILE,
  MAX_INDEX_BYTES,
  MAX_INDEX_LINES,
  PLUGIN_NAME,
  SECTION_NAME,
  SECTION_ORDER,
  experienceGuideSectionText,
} from './experienceTypes.js'
import { createExperienceTools } from './experienceTools.js'
import { createHistoryTools } from './historyTools.js'

export const name = PLUGIN_NAME

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。 */
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

/** 回合末经验提醒间隔（毫秒）：防止过于频繁地注入提醒。 */
const REMINDER_COOLDOWN_MS = 60_000

/**
 * 回合末经验提醒的"已保存"判定工具：本回合内成功调用过就不再提醒。
 * 默认只认本插件的 experience_save——跳过判定"各自只看自己"：
 * 同一次事件常需双写（结论进记忆、轨迹进经验），只存了记忆不代表没漏存经验，
 * 因此 memory_write 不抑制本提醒（记忆侧由 @demostudio/ds-memory 的回合末提醒自行判定）。
 */
export const DEFAULT_EXPERIENCE_REMINDER_SKIP_TOOLS: readonly string[] = [
  'experience_save',
]

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 经验目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/experience。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把经验库钉到项目根（如 E:/DemoStudio/.dsh/experience）。
   */
  experienceDir?: string
  /** 是否启用回合末自动提醒（默认 true）。 */
  enableEndOfTurnReminder?: boolean
  /**
   * 本回合内已成功调用过这些工具时，跳过回合末经验提醒
   * （默认仅 experience_save——记忆/经验提醒各自只看自己的保存工具，
   * 记忆保存不抑制经验提醒）。
   * 传空数组 = 关闭该判定，退回"每回合都提醒"。
   */
  reminderSkipTools?: string[]
  /**
   * 是否启用 prefix 自动联想（默认 true）：读到声明了 prefix 的经验所适用
   * 路径下的文件时自动注入其全文。联想基准的项目根从 experienceDir 推导
   * （<root>/.dsh/experience 形态）；推导不出时联想自动停用并记 warn 日志。
   */
  enableAutoAssociate?: boolean
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  experienceDir: z.string(),
  enableEndOfTurnReminder: z.boolean().default(true),
  reminderSkipTools: z.array(z.string()).default([...DEFAULT_EXPERIENCE_REMINDER_SKIP_TOOLS]),
  enableAutoAssociate: z.boolean().default(true),
})

/**
 * 注册经验系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt/sessionQuery 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    experienceDir: config?.experienceDir,
    enableEndOfTurnReminder: config?.enableEndOfTurnReminder ?? true,
    reminderSkipTools: config?.reminderSkipTools ?? [...DEFAULT_EXPERIENCE_REMINDER_SKIP_TOOLS],
    enableAutoAssociate: config?.enableAutoAssociate ?? true,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 经验目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根）
  const experienceDirectory = resolved.experienceDir !== undefined && resolved.experienceDir.trim() !== ''
    ? resolve(resolved.experienceDir.trim())
    : resolve(join(projectRoot, EXPERIENCE_DIR_SEGMENT))

  const logger = ctx.logger('ds-experience')

  // ── 常驻经验指导段（含 INDEX.md 索引；索引仅在有内容时注入，300 行/40KB 截断） ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => experienceGuideSectionText(readIndexSync(experienceDirectory)),
  })

  // ── 4 个显式工具 ──
  for (const tool of createHistoryTools({ ctx })) {
    ctx.tools.register(tool)
  }
  for (const tool of createExperienceTools({
    experienceDirectory,
    ctx,
  })) {
    ctx.tools.register(tool)
  }

  // ── prefix 路径自动联想（默认开；项目根推导不出时停用并 warn） ──
  if (resolved.enableAutoAssociate) {
    const associationRoot = deriveExperienceProjectRoot(experienceDirectory)
    if (associationRoot === undefined) {
      logger.warn(
        'enableAutoAssociate 已开启但无法从 experienceDir (%s) 推导项目根（期望 <root>/.dsh/experience 形态）；自动联想停用',
        experienceDirectory,
      )
    } else {
      registerExperienceAssociator(ctx, {
        experienceDirectory,
        projectRoot: associationRoot,
      })
      logger.info('prefix 自动联想已启用（项目根 %s）', associationRoot)
    }
  }

  // ── 回合末经验提醒（可配置关闭） ──
  if (resolved.enableEndOfTurnReminder) {
    // session/event 不携带 agent（Session 上没有 agent 反向引用，旧实现 `(session as any).agent`
    // 恒为 undefined 导致提醒整段静默失效），改用 WeakMap 从 agent 事件登记反查：
    const agentBySession = new WeakMap<Session, Agent>()
    // 冷却按 agent 记（WeakMap 随 Agent 回收）；全局单水位会让多 agent 会话互相挤掉提醒
    const lastReminderByAgent = new WeakMap<Agent, number>()
    const rememberAgent = (agent: Agent): void => {
      agentBySession.set(agent.session, agent)
    }
    // 双保险登记：agent/created 覆盖新建 agent；agent/status 幂等补登（覆盖插件晚于 agent 挂载的场景）
    ctx.on('agent/created', (payload: { agent: Agent }) => rememberAgent(payload.agent))
    ctx.on('agent/status', (payload: { agent: Agent }) => rememberAgent(payload.agent))

    // 保存类工具名（去空项；空集合 = 关闭"已保存"判定，退回每回合都提醒）
    const skipTools: ReadonlySet<string> = new Set(
      resolved.reminderSkipTools
        .filter((toolName): toolName is string => typeof toolName === 'string' && toolName.trim() !== '')
        .map(toolName => toolName.trim()),
    )
    // "本回合已保存"判定与联想开关解耦：这里独立注册监听，不依赖 associate 的监听器。
    // session/event（turn/end）不携带回合号，与 ds-memory 同构凑齐信息：
    // agent/pre-step（waterfall，必须 await next()）记当前回合号，
    // tools/result 记"保存发生在哪个回合"，turn/end 时两者相等即跳过。
    const currentTurnByAgent = new WeakMap<Agent, number>()
    const savedTurnByAgent = new WeakMap<Agent, number>()

    ctx.on('agent/pre-step', async (
      { agent, turn }: { agent: Agent; turn: number },
      next: () => Promise<PreStepDecision>,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      try {
        currentTurnByAgent.set(agent, turn)
      } catch (error) {
        // 登记失败不影响对话
        logger.warn('回合号登记失败: %o', error)
      }
      return decision
    })

    // 登记"本回合已保存"：只有成功（!isError）的保存类工具调用才算数
    // （tools/result 的返回值类型是 undefined，必须显式 return undefined）
    ctx.on('tools/result', (
      exec: Readonly<ToolExecution>,
      result: Readonly<ToolExecutionResult>,
    ): undefined => {
      try {
        if (result.isError) return
        const agent = exec.agent
        if (agent === undefined) return
        if (!skipTools.has(exec.name)) return
        const turn = currentTurnByAgent.get(agent)
        if (turn === undefined) return
        savedTurnByAgent.set(agent, turn)
        logger.info('回合 %d 内已成功调用 %s，回合末不再提醒', turn, exec.name)
      } catch (error) {
        // 登记失败按"未保存"处理（该提醒还是要提醒），不阻塞对话
        logger.warn('保存类工具登记失败: %o', error)
      }
      return undefined
    })

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      // 只在 turn/end 时触发
      if (event.type !== 'turn/end') return

      const agent = agentBySession.get(session)
      if (agent === undefined) {
        // 登记缺失必须可见：旧行为静默跳过，提醒失效时无从排查
        logger.warn('回合末经验提醒：session 未登记 agent 引用（插件晚于 agent 挂载？），跳过注入')
        return
      }
      // 子 agent 上下文归属父 agent，不提醒
      if (isChildAgent(agent)) return

      // 本回合已经保存过经验 → 不需要提醒（fail-open：未观测到回合号一律照常提醒）
      const currentTurn = currentTurnByAgent.get(agent)
      if (currentTurn !== undefined && savedTurnByAgent.get(agent) === currentTurn) {
        logger.info('回合 %d 已保存过经验，跳过回合末提醒', currentTurn)
        return
      }

      // 检查冷却时间
      const now = Date.now()
      if (now - (lastReminderByAgent.get(agent) ?? 0) < REMINDER_COOLDOWN_MS) {
        return
      }

      try {
        // 入队模型可见上下文，下一回合 pre-step 进入对话（history_read 按 plugin source 过滤）
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: END_OF_TURN_EXPERIENCE_REMINDER_TEXT }],
          source: {
            kind: 'plugin',
            plugin: '@demostudio/ds-experience',
            form: 'notice',
            summary: '回合末经验提醒',
          },
        }))
        lastReminderByAgent.set(agent, now)
        logger.info('已注入回合末经验提醒')
      } catch (error) {
        // 注入失败不应阻塞对话
        logger.warn('回合末经验提醒注入失败: %o', error)
      }
    })
  }
}

/**
 * 同步读取并截断 INDEX.md（section text provider 是同步接口；
 * 小索引文件的同步 IO 可接受）。目录/文件不存在或为空返回 undefined。
 */
function readIndexSync(experienceDirectory: string): string | undefined {
  try {
    const text = readFileSync(join(experienceDirectory, EXPERIENCE_INDEX_FILE), 'utf8').trim()
    if (text.length === 0) return undefined
    return truncateIndexText(text)
  } catch {
    return undefined
  }
}

/** 索引截断（300 行/40KB，同 memory 索引水位语义）。 */
function truncateIndexText(text: string): string {
  let lines = text.split('\n')
  let truncated = false
  if (lines.length > MAX_INDEX_LINES) {
    lines = lines.slice(0, MAX_INDEX_LINES)
    truncated = true
  }
  let result = lines.join('\n')
  if (Buffer.byteLength(result, 'utf8') > MAX_INDEX_BYTES) {
    while (Buffer.byteLength(result, 'utf8') > MAX_INDEX_BYTES && result.length > 0) {
      result = result.slice(0, Math.floor(result.length * 0.9))
    }
    truncated = true
  }
  return truncated ? `${result}\n[...索引过长已截断]` : result
}
