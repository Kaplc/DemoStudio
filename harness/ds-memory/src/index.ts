/**
 * @demostudio/ds-memory — DSH 记忆系统插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"记忆指导"段（含 MEMORY.md 索引，仅在有内容时注入）
 * - `ctx.tools.register()` × 5 — memory_write / memory_search / memory_forget / memory_review / memory_list
 * - `ctx.on('tools/pre-execute'/'tools/result'/'agent/pre-step')` — prefix 文件自动联想：
 *   读到记忆 `prefix:` 触发文件列表中的文件时把该记忆全文自动注入（每会话一次）；
 *   只按具体文件精确匹配（2026-09-12 起目录前缀、`&&`/`||` 表达式、`/` 全局废弃）
 * - `ctx.on('agent/turn-stopping')` — 回合末记忆提醒：回合结束前通过 steer 注入一条
 *   "检查是否需要保存记忆"的提醒（agent.steer()，驱动会多跑一步处理提醒）；
 *   **本回合已成功保存过记忆（memory_write）时跳过**——跳过判定"各自只看自己"：
 *   同一次事件常需双写（结论进记忆、轨迹进经验），只存了经验不代表没漏存记忆，
 *   所以经验保存不抑制本提醒（经验侧由 ds-experience 的回合末提醒自行判定）
 *   （agent/pre-step 记录当前回合号，tools/result 登记保存类工具的成功调用）
 *
 * 记忆保存与检索的默认分工：
 * - 保存：主 agent 在回合内主动调用 memory_write（指导段 SAVE_FLOW_TEXT 给出具体触发点）
 *   + 回合末自动提醒（END_OF_TURN_REMINDER_TEXT）
 * - 检索：声明 prefix 的记忆由联想器按触发文件列表自动注入；未声明的按需 memory_search
 * 子 agent（delegationDepth > 0）变更类记忆工具（write/forget/review）在工具层拒绝调用，
 * 联想注入也只服务主 agent（上下文归属父 agent）。
 *
 * @module @demostudio/ds-memory
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { deriveProjectRoot, isChildAgent, registerAssociator } from './associate.js'
import { truncateEntrypoint } from './memoryScan.js'
import {
  MEMORY_ENTRYPOINT,
  memoryGuideSectionText,
} from './memoryTypes.js'
import { memoryDir } from './paths.js'
import { createMemoryTools } from './tools.js'

export const name = '@demostudio/ds-memory'

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。 */
export const inject = ['tools', 'systemPrompt']

/** 记忆指导段在 system prompt 中的排序（工具段之后、结构化输出之前的空档）。 */
const SECTION_NAME = 'memory:guide'
const SECTION_ORDER = 3200

/** 回合末记忆提醒间隔（毫秒）：防止过于频繁地注入提醒。 */
const REMINDER_COOLDOWN_MS = 60_000

/**
 * 回合末提醒注入文本。agent/turn-stopping 时通过 steer 注入，驱动会多跑一步处理提醒，
 * 因此措辞按"上一回合已结束、请检查是否需要保存记忆"书写。
 */
const END_OF_TURN_REMINDER_TEXT = `## 回合末记忆提醒

上一个回合已结束。快速回顾是否有值得跨会话记住的信息，有则本回合立即调用 memory_write 保存：
- 用户纠正或确认了某个方向？
- 做出了架构/设计/工作流决策？
- 定位到可复用的根因教训？
- 了解到用户的角色/偏好/工作习惯？
- 拿到外部系统指针（看板/文档站 URL）？

没有触发点就不要保存。`

/**
 * 回合末提醒的"已保存"判定工具：本回合内成功调用过其中之一就不再提醒。
 * 默认只认本插件的 memory_write——跳过判定"各自只看自己"：
 * 同一次事件常需双写（结论进记忆、轨迹进经验），只存了经验不代表没漏存记忆，
 * 因此 experience_save 不再抑制本提醒（经验侧由 @demostudio/ds-experience 的
 * 回合末提醒自行判定，那边默认只认 experience_save）。
 */
export const DEFAULT_REMINDER_SKIP_TOOLS: readonly string[] = [
  'memory_write',
]

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 记忆目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/memory。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把记忆钉到项目根（如 E:/DemoStudio/.dsh/memory）。
   */
  memoryDir?: string
  /** 是否启用回合末自动提醒（默认 true）。 */
  enableEndOfTurnReminder?: boolean
  /**
   * 本回合内已成功调用过这些工具时，跳过回合末提醒
   * （默认仅 memory_write——记忆/经验提醒各自只看自己的保存工具，
   * 经验保存不抑制记忆提醒；需旧行为可配 ["memory_write","experience_save"]）。
   * 传空数组 = 关闭该判定，退回"每回合都提醒"。
   */
  reminderSkipTools?: string[]
  /**
   * 是否启用 prefix 自动联想（默认 true）：读到记忆 prefix 声明的触发文件列表
   * 中的文件时自动注入其全文（按具体文件精确匹配）。联想基准的项目根从
   * memoryDir 推导（<root>/.dsh/memory 形态）；推导不出时联想自动停用并记 warn 日志。
   */
  enableAutoAssociate?: boolean
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string(),
  enableEndOfTurnReminder: z.boolean().default(true),
  reminderSkipTools: z.array(z.string()).default([...DEFAULT_REMINDER_SKIP_TOOLS]),
  enableAutoAssociate: z.boolean().default(true),
})

/**
 * 注册记忆系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    memoryDir: config?.memoryDir,
    enableEndOfTurnReminder: config?.enableEndOfTurnReminder ?? true,
    reminderSkipTools: config?.reminderSkipTools ?? [...DEFAULT_REMINDER_SKIP_TOOLS],
    enableAutoAssociate: config?.enableAutoAssociate ?? true,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 记忆目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根），否则 <cwd>/.dsh/memory
  const memoryDirectory = resolved.memoryDir !== undefined && resolved.memoryDir.trim() !== ''
    ? resolve(resolved.memoryDir.trim())
    : memoryDir(projectRoot)

  const logger = ctx.logger('ds-memory')

  // ── 常驻记忆指导段（含 MEMORY.md 索引；索引仅在有内容时注入，300 行/40KB 截断） ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => memoryGuideSectionText(readEntrypointSync(memoryDirectory)),
  })

  // ── 5 个显式记忆工具 ──
  for (const tool of createMemoryTools({
    memoryDirectory,
    ctx,
  })) {
    ctx.tools.register(tool)
  }

  // ── prefix 文件自动联想（默认开；项目根推导不出时停用并 warn） ──
  if (resolved.enableAutoAssociate) {
    const associationRoot = deriveProjectRoot(memoryDirectory)
    if (associationRoot === undefined) {
      logger.warn(
        'enableAutoAssociate 已开启但无法从 memoryDir (%s) 推导项目根（期望 <root>/.dsh/memory 形态）；自动联想停用',
        memoryDirectory,
      )
    } else {
      registerAssociator(ctx, {
        memoryDirectory,
        projectRoot: associationRoot,
      })
      logger.info('prefix 文件联想已启用（按具体文件精确匹配；项目根 %s）', associationRoot)
    }
  }

  // ── 回合末记忆提醒（可配置关闭） ──
  // 投递通道：agent/turn-stopping + agent.steer()：回合即将关闭时注入 steering，
  // 驱动会多跑一步处理提醒（模型看到"上一回合已结束"的提示后自行决定是否保存记忆）。
  // 时机：回合结束前（turn-stopping serial 事件），提醒在当前回合末尾被模型处理。
  // 跳过条件：本回合内已成功调用过保存类工具（默认仅 memory_write）——
  // 已经保存过记忆就不再提醒，避免"刚存完又被催一次"。
  // 跳过判定"各自只看自己"：经验保存不抑制本提醒（双写场景下只存了经验仍可能漏存记忆），
  // 经验侧的同类判定在 ds-experience 插件。
  if (resolved.enableEndOfTurnReminder) {
    // 冷却按 agent 记（WeakMap 随 Agent 回收）；插件全局单水位会让多 agent 互相挤掉提醒
    const lastReminderByAgent = new WeakMap<Agent, number>()

    // 保存类工具名（去空项；空集合 = 关闭"已保存"判定，退回每回合都提醒）
    const skipTools: ReadonlySet<string> = new Set(
      resolved.reminderSkipTools
        .filter((toolName): toolName is string => typeof toolName === 'string' && toolName.trim() !== '')
        .map(toolName => toolName.trim()),
    )
    // 当前回合号（agent/pre-step 携带 turn）与"保存类工具成功时所在回合"（tools/result 登记）
    const currentTurnByAgent = new WeakMap<Agent, number>()
    const savedTurnByAgent = new WeakMap<Agent, number>()

    // 记录当前回合号：agent/pre-step 是 waterfall 事件，必须 await next() 并把决策原样传下去
    // （不调用 next() 会否决链上后续监听器与内建行为）
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

    ctx.on('agent/turn-stopping', async (
      { agent, turn, signal }: { agent: Agent; turn: number; signal: AbortSignal },
    ): Promise<void> => {
      try {
        // 子 agent 上下文归属父 agent，不提醒
        if (isChildAgent(agent)) return

        // 本回合已经保存过记忆 → 不需要提醒
        if (savedTurnByAgent.get(agent) === turn) {
          logger.info('回合 %d 已保存过记忆，跳过回合末提醒', turn)
          return
        }

        const now = Date.now()
        if (now - (lastReminderByAgent.get(agent) ?? 0) < REMINDER_COOLDOWN_MS) {
          return
        }

        signal.throwIfAborted()
        const message = createUserMessage({
          content: [{ type: 'text', text: END_OF_TURN_REMINDER_TEXT }],
          source: {
            kind: 'plugin',
            plugin: '@demostudio/ds-memory',
            form: 'notice',
            summary: '回合末记忆提醒',
          },
        })
        lastReminderByAgent.set(agent, now)
        agent.steer(message)
        logger.info('已注入回合末记忆提醒')
      } catch (error) {
        // 注入失败不应阻塞对话
        if (!signal.aborted) logger.warn('回合末记忆提醒注入失败: %o', error)
      }
    })
  }
}

/**
 * 同步读取并截断 MEMORY.md（section text provider 是同步接口；
 * 小索引文件的同步 IO 可接受）。目录/文件不存在或为空返回 undefined。
 */
function readEntrypointSync(memoryDirectory: string): string | undefined {
  try {
    const text = readFileSync(join(memoryDirectory, MEMORY_ENTRYPOINT), 'utf8').trim()
    if (text.length === 0) return undefined
    return truncateEntrypoint(text).text
  } catch {
    return undefined
  }
}
