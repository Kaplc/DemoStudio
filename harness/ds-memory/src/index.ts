/**
 * @demostudio/ds-memory — DSH 记忆系统插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"记忆指导"段（含 MEMORY.md 索引，仅在有内容时注入）
 * - `ctx.tools.register()` × 4 — memory_write / memory_search / memory_forget / memory_review
 * - `ctx.on('agent/pre-step')` — 每次认领到新用户输入时，AI 选择器检索相关记忆并
 *   以 recall 形式的 plugin 消息注入到用户消息前（进入 enter decision 的消息会被
 *   记为 durable user/message，满足 "Model-visible ⟺ logged"）
 * - `ctx.on('agent/status')` — agent 转入空闲防抖后跑回合末后台提取
 *   （形态二）：side-query 判断本回合是否有值得保存的信息，命中则插件直接落盘；
 *   仅在异常时（覆盖已有记忆/单次保存达上限）向 inbox 注入 notice，常规新建静默；
 *   水位推进，失败下次空闲重试。
 *   子 agent（delegationDepth > 0）不做提取也不做检索注入。
 *
 * @module @demostudio/ds-memory
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractFromSession, shouldNotifySaved } from './extractMemories.js'
import type { ExtractResult } from './extractMemories.js'
import { truncateEntrypoint } from './memoryScan.js'
import {
  DEFAULT_SELECT_MODEL,
  DEFAULT_SELECT_PROVIDER,
  EXTRACT_MAX_PER_PASS,
  MEMORY_ENTRYPOINT,
  PLUGIN_NAME,
  memoryGuideSectionText,
} from './memoryTypes.js'
import { memoryDir } from './paths.js'
import { findRelevantMemories, renderSelectedMemories } from './selectMemories.js'
import { createMemoryTools } from './tools.js'

export const name = '@demostudio/ds-memory'

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。
 * logger 是 Context 内建属性，不走 inject。 */
export const inject = ['tools', 'systemPrompt', 'llm']

/** 记忆指导段在 system prompt 中的排序（工具段之后、结构化输出之前的空档）。 */
const SECTION_NAME = 'memory:guide'
const SECTION_ORDER = 3200

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /** AI 检索选择器模型（默认 deepseek-chat）。 */
  selectModel?: string
  /** AI 检索选择器 provider 路由（默认 deepseek-official）。 */
  selectProvider?: string
  /** 后台提取模型；缺省 = 复用选择器模型（selectModel）。 */
  extractModel?: string
  /** 后台提取 provider 路由；缺省 = 复用选择器路由（selectProvider）。 */
  extractProvider?: string
  /**
   * 记忆目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/memory。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把记忆钉到项目根（如 E:/DemoStudio/.dsh/memory）。
   */
  memoryDir?: string
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  selectModel: z.string().default(DEFAULT_SELECT_MODEL),
  selectProvider: z.string().default(DEFAULT_SELECT_PROVIDER),
  extractModel: z.string(),
  extractProvider: z.string(),
  memoryDir: z.string(),
})

/** 每个 agent 的检索注入状态：已注入过的记忆文件名（避免重复占用选择器名额）。 */
const surfacedByAgent = new WeakMap<Agent, Set<string>>()

/** 每个 agent 的提取状态：水位（已提取到的回合号）、在飞标记与防抖定时器。 */
interface ExtractState {
  watermark: number
  inFlight: boolean
  timer: NodeJS.Timeout | null
}
const extractStateByAgent = new WeakMap<Agent, ExtractState>()

/** 空闲后延迟提取的防抖时长（毫秒）：用户连续追问时不阻塞回合，停下阅读时才提取。 */
const EXTRACT_DEBOUNCE_MS = 3_000

/** 活跃定时器登记（插件卸载时统一清除，避免 HMR 后僵尸定时器）。 */
const activeTimers = new Set<NodeJS.Timeout>()

/** 子 agent（委托产生的）不做检索注入与后台提取——上下文归属父 agent。 */
function isChildAgent(agent: Agent): boolean {
  const depth = (agent.session.header as { delegationDepth?: number } | undefined)?.delegationDepth
  return typeof depth === 'number' && depth > 0
}

/**
 * 注册记忆系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt/llm 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    selectModel: config?.selectModel ?? DEFAULT_SELECT_MODEL,
    selectProvider: config?.selectProvider ?? DEFAULT_SELECT_PROVIDER,
    extractModel: config?.extractModel,
    extractProvider: config?.extractProvider,
    memoryDir: config?.memoryDir,
  }
  // enabled: false — 一切静默，什么都不注册（需求 §4 配置节）
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 记忆目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根），否则 <cwd>/.dsh/memory
  const memoryDirectory = resolved.memoryDir !== undefined && resolved.memoryDir.trim() !== ''
    ? resolve(resolved.memoryDir.trim())
    : memoryDir(projectRoot)

  // ── FR-6：常驻记忆指导段（含 MEMORY.md 索引；索引仅在有内容时注入，300 行/40KB 截断） ──
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => memoryGuideSectionText(readEntrypointSync(memoryDirectory)),
  })

  // ── FR-1：4 个显式记忆工具 ──
  for (const tool of createMemoryTools({
    memoryDirectory,
    ctx,
    selectProvider: resolved.selectProvider,
    selectModel: resolved.selectModel,
  })) {
    ctx.tools.register(tool)
  }

  // ── FR-3：每次认领到新用户输入时注入相关记忆 ──
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (isChildAgent(payload.agent)) return decision
    try {
      // 只对"真正的用户输入"做检索；tool-result / 插件注入的步骤直接放行
      const userMessage = [...decision.messages].reverse()
        .find(message => message.source.kind === 'user')
      if (userMessage === undefined) return decision
      const query = userMessage.content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim()
      if (query.length === 0) return decision

      const surfaced = surfacedByAgent.get(payload.agent) ?? new Set<string>()
      const selected = await findRelevantMemories(ctx, memoryDirectory, {
        query,
        alreadySurfaced: surfaced,
        selectProvider: resolved.selectProvider,
        selectModel: resolved.selectModel,
        signal: payload.signal,
      })
      if (selected.length === 0) return decision

      for (const memory of selected) surfaced.add(memory.filename)
      surfacedByAgent.set(payload.agent, surfaced)
      const text = await renderSelectedMemories(selected)
      const injection = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'recall' },
      })
      // 展开保留 decision 的其余字段（startsRequestSeries 等），把记忆插到用户消息前
      return { ...decision, messages: [injection, ...decision.messages] }
    } catch {
      // 检索/注入失败绝不阻塞对话
      return decision
    }
  })

  // ── 形态二：agent 空闲防抖后跑回合末后台提取（新回合开始则取消，不阻塞交互） ──
  ctx.on('agent/status', (payload) => {
    const agent = payload.agent
    if (isChildAgent(agent)) return
    const state = extractStateByAgent.get(agent) ?? { watermark: 0, inFlight: false, timer: null }
    extractStateByAgent.set(agent, state)
    if (payload.status === 'running') {
      // 用户回来了：撤销未触发的提取计划，水位留待下次空闲补提
      if (state.timer !== null) {
        clearTimeout(state.timer)
        activeTimers.delete(state.timer)
        state.timer = null
      }
      return
    }
    if (payload.status !== 'idle' || state.inFlight || state.timer !== null) return
    const timer = setTimeout(() => {
      activeTimers.delete(timer)
      state.timer = null
      if (state.inFlight) return
      state.inFlight = true
      void (async () => {
        try {
          // 提取模型缺省复用选择器路由（小模型足够做转录判读，且不随主模型波动）；config 可显式覆盖
          const result = await extractFromSession(ctx, agent.session, memoryDirectory, {
            watermark: state.watermark,
            overrideProvider: resolved.extractProvider,
            overrideModel: resolved.extractModel,
            fallbackProvider: resolved.selectProvider,
            fallbackModel: resolved.selectModel,
          })
          if (result.ok) state.watermark = Math.max(state.watermark, result.maxTurn)
          if (result.ok && shouldNotifySaved(result)) {
            notifySaved(agent, result)
          }
        } catch {
          // extractFromSession 内部已兜底；此处防御水位状态本身的意外
        } finally {
          state.inFlight = false
        }
      })()
    }, EXTRACT_DEBOUNCE_MS)
    state.timer = timer
    activeTimers.add(timer)
  })

  // 卸载时清除所有未触发的提取定时器（live patch reload 会重挂插件）
  ctx.effect(() => () => {
    for (const timer of activeTimers) clearTimeout(timer)
    activeTimers.clear()
  })
}

/** 提取保存的异常 notice：覆盖已有记忆或单次保存达上限时才打扰模型，常规新建静默。 */
function notifySaved(agent: Agent, result: ExtractResult): void {
  const parts: string[] = []
  if (result.updated.length > 0) {
    parts.push(`本次提取覆盖了已有记忆：${result.updated.slice(0, 5).join('、')}，原内容已被替换`)
  }
  if (result.saved.length >= EXTRACT_MAX_PER_PASS) {
    parts.push(`单次保存了 ${result.saved.length} 条记忆（达单轮上限）：${result.saved.slice(0, 5).join('、')}`)
  }
  try {
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `[记忆系统] ${parts.join('；')}。如与事实不符，可用 memory_forget 删除、memory_write 覆盖或 memory_review 审查。`,
      }],
      source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'notice', summary: '后台提取异常保存提醒' },
    }))
  } catch {
    // agent 已 disposal：放弃通知
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
