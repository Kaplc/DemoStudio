/**
 * @demostudio/ds-experience — DSH 行为飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"经验库指导"段（order 3000；含 INDEX.md 索引，
 *   仅在有内容时注入；分工声明：记忆=事实与规则热通道，经验=做事轨迹冷通道）
 * - `ctx.tools.register()` × 4 — history_search / history_read（包装 ctx.sessionQuery）/
 *   experience_save / experience_search（按文件名直接读取）
 * - `ctx.on('session/event')` — 回合末（turn/end）主动注入经验提醒，提示 agent
 *   自查"本回合是否完成过有复用价值的完整任务"，有则 experience_save
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
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
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
