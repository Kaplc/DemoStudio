/**
 * @demostudio/ds-reminder — DSH 回合末通用提醒插件。
 *
 * 把"回合边界向模型注入提醒"的机制从业务插件中抽出来收敛为一处：
 * 配置声明 N 条提醒（提醒文本文件 + 投递通道 + 跳过判定工具 + 冷却），插件负责全部监听与簿记。
 * **提醒文案是数据不是代码**：每条提醒指向 `.dsh/reminder/` 下的一个文本文件，
 * 注入前实时读取文件内容——改文件即生效，无需重编译或重启 agent。
 * 默认内置两条提醒（从 ds-memory / ds-experience 平移，行为逐字保留）：
 * - `memory-end-of-turn`：steer 通道（agent/turn-stopping + agent.steer()，回合多跑一步），
 *   文本文件 `.dsh/reminder/memory-end-of-turn.md`，跳过判定 memory_write
 * - `experience-end-of-turn`：inject 通道（session/event turn/end + agent.inject()，入队下一回合），
 *   文本文件 `.dsh/reminder/experience-end-of-turn.md`，跳过判定 experience_save
 *
 * 机制要点（与原实现逐条对齐）：
 * - 跳过判定"各自只看自己"：每条提醒只认自己的 skipTools；双写场景（结论进记忆 + 轨迹进经验）互不抑制
 * - 簿记三件套：agent/pre-step（waterfall，必须 await next() 并原样返回决策）记当前回合号；
 *   tools/result 登记成功（!isError）的保存类工具调用发生在哪个回合；回合末两者相等即跳过
 * - fail-open：未观测到回合号时照常提醒（宁可重复提醒不漏提醒）；文本文件读取失败时若有
 *   内联 text 回退则回退，否则本轮不注入（冷却水位不消耗，下回合重试）
 * - 冷却按 agent × 提醒 记（WeakMap 随 Agent 回收）；子 agent（delegationDepth > 0）不注入
 * - 注入失败只记 warn，绝不阻塞对话
 *
 * 零 LLM：纯事件监听 + 文件读取 + 文本注入（harness_no_llm_design）。
 *
 * @module @demostudio/ds-reminder
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = '@demostudio/ds-reminder'

/** 本插件只监听事件、读文件与注入消息：logger/ctx.on 均为 Context 内建能力，无需 inject 服务。 */
export const inject: string[] = []

/** 默认冷却间隔（毫秒）：防止同一提醒对同一 agent 过于频繁地注入。 */
const DEFAULT_COOLDOWN_MS = 60_000

/** 提醒文案目录名（相对项目根；缺省 reminderDir 时使用 <cwd>/.dsh/reminder）。 */
const REMINDER_DIR_SEGMENT = '.dsh/reminder'

/** 提醒投递通道：steer=回合收尾注入（驱动多跑一步）；inject=入队下一回合开头。 */
export type ReminderChannel = 'steer' | 'inject'

/** 单条提醒配置（cordis.patch.yml 可配置项）。 */
export interface ReminderConfig {
  /** 唯一 id：冷却水位与日志标识。 */
  id?: string
  /**
   * 提醒文本文件（相对 reminderDir 的路径或绝对路径），注入前实时读取——改文件即生效。
   * 读取失败/为空时回退到内联 text；file 与 text 都缺省或全空则该条无效。
   */
  file?: string
  /** 内联提醒文本：file 缺省或读取失败时的回退来源。 */
  text?: string
  /** 投递通道（默认 steer）。 */
  channel?: ReminderChannel
  /** 本回合内成功调用过其中任一工具则跳过该提醒（默认 [] = 每回合都提醒）。 */
  skipTools?: string[]
  /** 冷却毫秒，按 agent × 提醒 记（默认 60000）。 */
  cooldownMs?: number
  /** 单条开关（默认 true）。 */
  enabled?: boolean
  /** notice 卡片摘要（默认用 id）。 */
  summary?: string
}

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时一切静默，什么都不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 提醒文本目录（绝对路径，或相对 cwd 的路径）。缺省 = <cwd>/.dsh/reminder。
   * 编辑器以 dsh-source 为 cwd 拉起内核时，用此配置把提醒目录钉到项目根
   * （如 E:/DemoStudio/.dsh/reminder）。提醒条目里的相对 file 基于该目录解析。
   */
  reminderDir?: string
  /**
   * 提醒条目列表。缺省 = 内置两条默认提醒（记忆/经验）；
   * 显式传空数组 = 一条提醒都没有（不注册任何监听）。
   */
  reminders?: ReminderConfig[]
}

/** normalize 后的提醒条目（运行时使用的规范形态）。 */
export interface NormalizedReminder {
  readonly id: string
  readonly file: string
  readonly text: string
  readonly channel: ReminderChannel
  readonly skipTools: readonly string[]
  readonly cooldownMs: number
  readonly summary: string
}

/**
 * 默认提醒条目：文本全部来自 .dsh/reminder/ 下的文件（不内联），插件配置只声明读哪个文件。
 * 默认两条为 ds-memory / ds-experience 平移的记忆与经验提醒。
 * 注意：必须声明在 Config schema 之前——schema 的 default 值在模块加载时求值。
 */
export const DEFAULT_REMINDERS: readonly ReminderConfig[] = [
  {
    id: 'memory-end-of-turn',
    file: 'memory-end-of-turn.md',
    channel: 'steer',
    skipTools: ['memory_write'],
    summary: '回合末记忆提醒',
  },
  {
    id: 'experience-end-of-turn',
    file: 'experience-end-of-turn.md',
    channel: 'inject',
    skipTools: ['experience_save'],
    summary: '回合末经验提醒',
  },
]

/**
 * Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。
 * reminders 用 z.any 透传（嵌套对象 + 可选字段 + 字面量联合与 schemastery 推导类型对不上，
 * 强行声明会让 schema default 的输入类型要求全字段）；有效性由运行时 normalizeReminder 把关。
 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  reminderDir: z.string().default(''),
  reminders: z.any<ReminderConfig[]>().default([...DEFAULT_REMINDERS]),
})

/** ctx.logger 的结构化类型（避免依赖 cordis 具体 Logger 类型）。 */
type PluginLogger = ReturnType<Context['logger']>

/**
 * 把一条原始配置 normalize 成规范形态；无效条目记 warn 并丢弃（不抛错、不阻塞装载）。
 * schema 层已兜底缺省字段，这里做语义校验：id 非空、channel 合法、file/text 至少一项非空。
 */
function normalizeReminder(raw: ReminderConfig, logger: PluginLogger): NormalizedReminder | undefined {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') {
    logger.warn('提醒配置缺少非空 id，已跳过：%j', raw)
    return undefined
  }
  const channel = raw.channel
  if (channel !== 'steer' && channel !== 'inject') {
    logger.warn('提醒 %s 的 channel 必须是 steer|inject，实际为 %j，已跳过', id, raw.channel)
    return undefined
  }
  const file = typeof raw.file === 'string' ? raw.file.trim() : ''
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (file === '' && text === '') {
    logger.warn('提醒 %s 缺少提醒文本来源（file 与 text 都为空），已跳过', id)
    return undefined
  }
  const skipTools = Array.isArray(raw.skipTools)
    ? raw.skipTools
        .filter((toolName): toolName is string => typeof toolName === 'string' && toolName.trim() !== '')
        .map(toolName => toolName.trim())
    : []
  const cooldownMs = typeof raw.cooldownMs === 'number' && Number.isFinite(raw.cooldownMs) && raw.cooldownMs > 0
    ? raw.cooldownMs
    : DEFAULT_COOLDOWN_MS
  if (raw.enabled === false) {
    logger.info('提醒 %s 已通过 enabled=false 关闭', id)
    return undefined
  }
  const summary = typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary : id
  return { id, file, text, channel, skipTools, cooldownMs, summary }
}

/** 判断是否为子 agent（delegationDepth > 0）：子 agent 上下文归属父 agent，不注入提醒。 */
function isChildAgent(agent: Agent | undefined): boolean {
  const depth = (agent?.session.header as { delegationDepth?: number } | undefined)?.delegationDepth
  return typeof depth === 'number' && depth > 0
}

/**
 * 注册回合末提醒引擎全部监听。
 * @param ctx - Cordis 上下文（仅用内建 ctx.on / ctx.logger）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  // enabled: false — 一切静默，什么都不注册
  if (config?.enabled === false) return

  const logger = ctx.logger('ds-reminder')

  // 提醒文本目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根），
  // 否则 <cwd>/.dsh/reminder
  const configuredDir = typeof config?.reminderDir === 'string' ? config.reminderDir.trim() : ''
  const reminderDirectory = configuredDir !== ''
    ? resolve(configuredDir)
    : resolve(join(process.cwd(), REMINDER_DIR_SEGMENT))

  // normalize 提醒条目（缺省 = 内置两条；显式空数组 = 没有提醒）
  const rawReminders = config?.reminders ?? DEFAULT_REMINDERS
  const reminders = rawReminders
    .map(raw => normalizeReminder(raw, logger))
    .filter((reminder): reminder is NormalizedReminder => reminder !== undefined)
  if (reminders.length === 0) {
    logger.info('没有启用中的回合末提醒，不注册任何监听（reminderDir=%s）', reminderDirectory)
    return
  }

  const steerReminders = reminders.filter(reminder => reminder.channel === 'steer')
  const injectReminders = reminders.filter(reminder => reminder.channel === 'inject')
  const skipToolCount = reminders.filter(reminder => reminder.skipTools.length > 0).length
  logger.info(
    '回合末提醒引擎启动：%d 条（steer=%d，inject=%d，带跳过判定=%d；reminderDir=%s）',
    reminders.length,
    steerReminders.length,
    injectReminders.length,
    skipToolCount,
    reminderDirectory,
  )

  // ── 共享簿记（WeakMap 随 Agent 回收；跨 agent / 跨提醒互相隔离） ──
  // 当前回合号（agent/pre-step 携带 turn）
  const currentTurnByAgent = new WeakMap<Agent, number>()
  // 本 agent 内"保存类工具成功发生在哪个回合"（toolName → turn）
  const savedTurnByTool = new WeakMap<Agent, Map<string, number>>()
  // 每 agent × 提醒的冷却水位（reminderId → timestamp）
  const lastReminderAt = new WeakMap<Agent, Map<string, number>>()
  // session → agent 登记（inject 通道从 session/event 反查 agent；Session 无 agent 反向引用）
  const agentBySession = new WeakMap<Session, Agent>()
  const rememberAgent = (agent: Agent): void => {
    agentBySession.set(agent.session, agent)
  }

  /** 记录冷却水位（按 agent × 提醒隔离）。 */
  const markLastReminderAt = (agent: Agent, reminderId: string, at: number): void => {
    let byReminder = lastReminderAt.get(agent)
    if (byReminder === undefined) {
      byReminder = new Map<string, number>()
      lastReminderAt.set(agent, byReminder)
    }
    byReminder.set(reminderId, at)
  }

  /**
   * 判定某条提醒对该 agent 当前是否应该注入：
   * 子 agent 恒否 → 本回合已成功调用该提醒的 skipTools 之一则跳过 → 冷却内跳过。
   * @param payloadTurn - 投递事件自带的回合号（steer 通道有；inject 通道缺省时读簿记，fail-open）。
   */
  const shouldDeliver = (agent: Agent, reminder: NormalizedReminder, payloadTurn?: number): boolean => {
    // 子 agent 上下文归属父 agent，不提醒
    if (isChildAgent(agent)) return false

    // 本回合已经成功保存过（命中该提醒的 skipTools）→ 不需要提醒。
    // fail-open：未观测到回合号时按"未保存"处理（宁可重复提醒不漏提醒）。
    const currentTurn = payloadTurn ?? currentTurnByAgent.get(agent)
    if (currentTurn !== undefined && reminder.skipTools.length > 0) {
      const savedTurns = savedTurnByTool.get(agent)
      const savedTool = savedTurns === undefined
        ? undefined
        : reminder.skipTools.find(toolName => savedTurns.get(toolName) === currentTurn)
      if (savedTool !== undefined) {
        logger.info('提醒 %s：回合 %d 已成功调用 %s，跳过', reminder.id, currentTurn, savedTool)
        return false
      }
    }

    // 冷却窗口内不重复提醒
    const now = Date.now()
    const last = lastReminderAt.get(agent)?.get(reminder.id) ?? 0
    if (now - last < reminder.cooldownMs) return false
    return true
  }

  /**
   * 解析提醒文本：优先实时读取 file（改文件即生效），失败/为空回退内联 text。
   * @returns 注入文本；无法取得时返回 undefined（调用方跳过本轮注入，冷却水位不消耗）。
   */
  const resolveReminderText = (reminder: NormalizedReminder): string | undefined => {
    if (reminder.file !== '') {
      const filePath = resolve(reminderDirectory, reminder.file)
      try {
        const fileText = readFileSync(filePath, 'utf8').trim()
        if (fileText !== '') return fileText
        logger.warn('提醒 %s 的文本文件为空：%s（回退内联 text 或跳过）', reminder.id, filePath)
      } catch (error) {
        logger.warn('提醒 %s 读取文本文件失败：%s（%o）', reminder.id, filePath, error)
      }
    }
    return reminder.text !== '' ? reminder.text : undefined
  }

  /** 投递一条提醒：读文本 → 构造 notice 消息 → 记冷却水位 → 按通道注入；失败只 warn 不抛。 */
  const deliver = (agent: Agent, reminder: NormalizedReminder, signal?: AbortSignal): void => {
    const text = resolveReminderText(reminder)
    if (text === undefined) {
      logger.warn('提醒 %s 无法取得提醒文本（文件缺失且无内联回退），本轮不注入', reminder.id)
      return
    }
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: name,
          form: 'notice',
          summary: reminder.summary,
        },
      })
      // 先记水位再投递：即使投递抛错也不在冷却窗口内反复重试刷屏
      markLastReminderAt(agent, reminder.id, Date.now())
      if (reminder.channel === 'steer') agent.steer(message)
      else agent.inject(message)
      logger.info('已注入回合末提醒 %s（channel=%s，text=%s）', reminder.id, reminder.channel, reminder.file !== '' ? reminder.file : '内联文本')
    } catch (error) {
      // 注入失败不应阻塞对话
      if (signal === undefined || !signal.aborted) logger.warn('回合末提醒 %s 注入失败: %o', reminder.id, error)
    }
  }

  // ── 跳过判定簿记：任一提醒声明了 skipTools 才需要登记（pre-step waterfall + tools/result） ──
  if (reminders.some(reminder => reminder.skipTools.length > 0)) {
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

    // 登记"本回合已保存"：只有成功（!isError）的保存类工具调用才算数。
    // 所有提醒的 skipTools 并集进入观察清单，具体命中哪条提醒由回合末各提醒自行比对。
    const watchedTools: ReadonlySet<string> = new Set(reminders.flatMap(reminder => [...reminder.skipTools]))
    ctx.on('tools/result', (
      exec: Readonly<ToolExecution>,
      result: Readonly<ToolExecutionResult>,
    ): undefined => {
      try {
        if (result.isError) return
        const agent = exec.agent
        if (agent === undefined) return
        if (!watchedTools.has(exec.name)) return
        const turn = currentTurnByAgent.get(agent)
        if (turn === undefined) return
        let savedTurns = savedTurnByTool.get(agent)
        if (savedTurns === undefined) {
          savedTurns = new Map<string, number>()
          savedTurnByTool.set(agent, savedTurns)
        }
        savedTurns.set(exec.name, turn)
        logger.info('回合 %d 内已成功调用 %s，相关提醒回合末跳过', turn, exec.name)
      } catch (error) {
        // 登记失败按"未保存"处理（该提醒还是要提醒），不阻塞对话
        logger.warn('保存类工具登记失败: %o', error)
      }
      return undefined
    })
  }

  // ── inject 通道：turn/end 时经 agent.inject 入队，下一回合开头进入对话 ──
  if (injectReminders.length > 0) {
    // 双保险登记：agent/created 覆盖新建 agent；agent/status 幂等补登（覆盖插件晚于 agent 挂载的场景）
    ctx.on('agent/created', (payload: { agent: Agent }) => rememberAgent(payload.agent))
    ctx.on('agent/status', (payload: { agent: Agent }) => rememberAgent(payload.agent))

    ctx.on('session/event', (session: Session, event: SessionEvent): void => {
      // 只在 turn/end 时触发
      if (event.type !== 'turn/end') return

      const agent = agentBySession.get(session)
      if (agent === undefined) {
        // 登记缺失必须可见：静默跳过会让提醒失效且无从排查
        logger.warn('回合末提醒：session 未登记 agent 引用（插件晚于 agent 挂载？），跳过注入')
        return
      }
      if (isChildAgent(agent)) return

      for (const reminder of injectReminders) {
        try {
          if (!shouldDeliver(agent, reminder)) continue
          deliver(agent, reminder)
        } catch (error) {
          logger.warn('回合末提醒 %s 处理失败: %o', reminder.id, error)
        }
      }
    })
  }

  // ── steer 通道：回合即将关闭时经 agent.steer 注入，驱动会多跑一步处理提醒 ──
  if (steerReminders.length > 0) {
    ctx.on('agent/turn-stopping', async (
      { agent, turn, signal }: { agent: Agent; turn: number; signal: AbortSignal },
    ): Promise<void> => {
      try {
        if (isChildAgent(agent)) return
        for (const reminder of steerReminders) {
          if (!shouldDeliver(agent, reminder, turn)) continue
          // 已中止的回合不再注入
          signal.throwIfAborted()
          deliver(agent, reminder, signal)
        }
      } catch (error) {
        // 处理失败不应阻塞对话
        if (!signal.aborted) logger.warn('回合末提醒处理失败: %o', error)
      }
    })
  }
}
