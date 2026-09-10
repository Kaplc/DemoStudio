/**
 * @demostudio/ds-memory — DSH 记忆系统插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"记忆指导"段（含 MEMORY.md 索引，仅在有内容时注入）
 * - `ctx.tools.register()` × 5 — memory_write / memory_search / memory_forget / memory_review / memory_list
 * - `ctx.on('agent/pre-step')` — 回合末记忆提醒：新回合第一个 pre-step 追加一条
 *   "检查是否需要保存记忆"的提醒（decision.messages，同 prefix 联想的投递通道）
 * - `ctx.on('tools/pre-execute'/'tools/result'/'agent/pre-step')` — prefix 路径自动联想：
 *   读到满足记忆 `prefix:` 表达式的文件时把该记忆全文自动注入（每会话一次）；
 *   表达式支持 `||`（任一路径命中）与 `&&`（会话内全部路径读过，跨读取累计）
 *
 * 记忆保存与检索的默认分工：
 * - 保存：主 agent 在回合内主动调用 memory_write（指导段 SAVE_FLOW_TEXT 给出具体触发点）
 *   + 回合末自动提醒（END_OF_TURN_REMINDER_TEXT）
 * - 检索：声明 prefix 的记忆由联想器按读取路径自动注入；未声明的按需 memory_search
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
 * 回合末提醒注入文本。agent.inject 在 turn/end 时入队、下一回合 pre-step 进入上下文，
 * 因此措辞按"上一回合已结束、本回合处理"书写。
 */
const END_OF_TURN_REMINDER_TEXT = `## 回合末记忆提醒

上一个回合已结束。快速回顾是否有值得跨会话记住的信息，有则本回合立即调用 memory_write 保存：
- 用户纠正或确认了某个方向？
- 做出了架构/设计/工作流决策？
- 定位到可复用的根因教训？
- 了解到用户的角色/偏好/工作习惯？
- 拿到外部系统指针（看板/文档站 URL）？

没有触发点就不要保存。`

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
   * 是否启用 prefix 自动联想（默认 true）：读到声明了 prefix 的记忆所适用
   * 路径下的文件时自动注入其全文。联想基准的项目根从 memoryDir 推导
   * （<root>/.dsh/memory 形态）；推导不出时联想自动停用并记 warn 日志。
   */
  enableAutoAssociate?: boolean
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string(),
  enableEndOfTurnReminder: z.boolean().default(true),
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

  // ── prefix 路径自动联想（默认开；项目根推导不出时停用并 warn） ──
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
      logger.info('prefix 自动联想已启用（项目根 %s）', associationRoot)
    }
  }

  // ── 回合末记忆提醒（可配置关闭） ──
  // 投递通道：agent/pre-step + decision.messages（与 associate.ts 同款，是被 prefix 联想
  // 长期验证能进入模型请求的路径）。不使用 session/event + agent.inject：Session 无 agent
  // 反向引用需 WeakMap 反查、inject 投递链路不可观测，2026-09-10 实测注入从未落会话日志。
  // 时机：新回合第一个 pre-step（此时上一个回合已结束），与 inject 的实际到达时机一致。
  if (resolved.enableEndOfTurnReminder) {
    // 冷却按 agent 记（WeakMap 随 Agent 回收）；插件全局单水位会让多 agent 互相挤掉提醒
    const lastReminderByAgent = new WeakMap<Agent, number>()

    ctx.on('agent/pre-step', async (
      { agent, step, signal }: { agent: Agent; step: number; signal?: AbortSignal },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      try {
        if (decision.kind === 'reject') return decision
        // 只在新回合第一步注入（每回合至多一条）
        if (step !== 1) return decision
        // 子 agent 上下文归属父 agent，不提醒
        if (isChildAgent(agent)) return decision

        const now = Date.now()
        if (now - (lastReminderByAgent.get(agent) ?? 0) < REMINDER_COOLDOWN_MS) {
          return decision
        }

        signal?.throwIfAborted()
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
        logger.info('已注入回合末记忆提醒')
        return { ...decision, messages: [...decision.messages, message] }
      } catch (error) {
        // 注入失败不应阻塞对话
        if (!signal?.aborted) logger.warn('回合末记忆提醒注入失败: %o', error)
        return decision
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
