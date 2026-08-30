/**
 * @demostudio/ds-experience — DSH 行为飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"经验库指导"段（order 3000；含 INDEX.md 索引，
 *   仅在有内容时注入；分工声明：记忆=事实与规则热通道，经验=做事轨迹冷通道）
 * - `ctx.tools.register()` × 4 — history_search / history_read（包装 ctx.sessionQuery）/
 *   experience_save / experience_search（AI 选择器冷检索）
 * - `ctx.on('agent/status')` — agent 转入空闲防抖后跑回合末自动提炼（独立水位）：
 *   side-query 判断本回合是否构成一次任务（有工具调用），是则提炼 1 条 episode 落盘；
 *   仅覆盖已有 episode 时向 inbox 注入 notice，常规新建静默；水位推进，失败下次空闲重试。
 *   子 agent（delegationDepth > 0）不提炼。
 *
 * @module @demostudio/ds-experience
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractFromSession } from './extractExperience.js'
import type { ExtractResult } from './extractExperience.js'
import {
  DEFAULT_SELECT_MODEL,
  DEFAULT_SELECT_PROVIDER,
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
export const inject = ['tools', 'systemPrompt', 'llm', 'sessionQuery']

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时所有 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /** AI 检索选择器模型（默认 deepseek-chat）。 */
  selectModel?: string
  /** AI 检索选择器 provider 路由（默认 deepseek-official）。 */
  selectProvider?: string
  /** 后台提炼模型；缺省 = 复用选择器模型（selectModel）。 */
  extractModel?: string
  /** 后台提炼 provider 路由；缺省 = 复用选择器路由（selectProvider）。 */
  extractProvider?: string
  /**
   * 经验目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/experience。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把经验库钉到项目根（如 E:/DemoStudio/.dsh/experience）。
   */
  experienceDir?: string
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  selectModel: z.string().default(DEFAULT_SELECT_MODEL),
  selectProvider: z.string().default(DEFAULT_SELECT_PROVIDER),
  extractModel: z.string(),
  extractProvider: z.string(),
  experienceDir: z.string(),
})

/** 每个 agent 的提炼状态：水位（已提炼到的回合号）、在飞标记与防抖定时器。 */
interface ExtractState {
  watermark: number
  inFlight: boolean
  timer: NodeJS.Timeout | null
}
const extractStateByAgent = new WeakMap<Agent, ExtractState>()

/** 空闲后延迟提炼的防抖时长（毫秒）：用户连续追问时不阻塞回合，停下阅读时才提炼。 */
const EXTRACT_DEBOUNCE_MS = 3_000

/** 活跃定时器登记（插件卸载时统一清除，避免 HMR 后僵尸定时器）。 */
const activeTimers = new Set<NodeJS.Timeout>()

/** 子 agent（委托产生的）不做检索与后台提炼——上下文归属父 agent。 */
function isChildAgent(agent: Agent): boolean {
  const depth = (agent.session.header as { delegationDepth?: number } | undefined)?.delegationDepth
  return typeof depth === 'number' && depth > 0
}

/**
 * 注册经验系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt/llm/sessionQuery 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    selectModel: config?.selectModel ?? DEFAULT_SELECT_MODEL,
    selectProvider: config?.selectProvider ?? DEFAULT_SELECT_PROVIDER,
    extractModel: config?.extractModel,
    extractProvider: config?.extractProvider,
    experienceDir: config?.experienceDir,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 经验目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 拉起内核时钉到项目根）
  const experienceDirectory = resolved.experienceDir !== undefined && resolved.experienceDir.trim() !== ''
    ? resolve(resolved.experienceDir.trim())
    : resolve(join(projectRoot, EXPERIENCE_DIR_SEGMENT))

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
    selectProvider: resolved.selectProvider,
    selectModel: resolved.selectModel,
  })) {
    ctx.tools.register(tool)
  }

  // ── 回合末自动提炼：agent 空闲防抖后 side-query 判定并落盘（新回合开始则取消） ──
  ctx.on('agent/status', (payload) => {
    const agent = payload.agent
    if (isChildAgent(agent)) {
      ctx.logger?.debug('ds-experience: 子 agent 跳过提炼')
      return
    }
    const state = extractStateByAgent.get(agent) ?? { watermark: 0, inFlight: false, timer: null }
    extractStateByAgent.set(agent, state)
    if (payload.status === 'running') {
      // 用户回来了：撤销未触发的提炼计划，水位留待下次空闲补提
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
      ctx.logger?.debug(`ds-experience: 空闲提炼开始（水位 ${state.watermark}）`)
      void (async () => {
        try {
          // 提炼模型缺省复用选择器路由（小模型足够做转录判读）；config 可显式覆盖
          const result = await extractFromSession(ctx, agent.session, experienceDirectory, {
            watermark: state.watermark,
            overrideProvider: resolved.extractProvider,
            overrideModel: resolved.extractModel,
            fallbackProvider: resolved.selectProvider,
            fallbackModel: resolved.selectModel,
          })
          if (result.ok) {
            state.watermark = Math.max(state.watermark, result.maxTurn)
            if (result.saved.length > 0) {
              ctx.logger?.info(`ds-experience: 提炼落盘 ${result.saved.join('、')}（${result.updated.length > 0 ? '覆盖更新' : '新建'}），水位 → ${state.watermark}`)
            } else {
              ctx.logger?.debug(`ds-experience: 本回合无新经验，水位 → ${state.watermark}`)
            }
          } else {
            ctx.logger?.warn(`ds-experience: 提炼失败，水位保持 ${state.watermark}，下次空闲重试`)
          }
          if (result.ok) notifyIfOverwrite(agent, result)
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

  // 卸载时清除所有未触发的提炼定时器（live patch reload 会重挂插件）
  ctx.effect(() => () => {
    for (const timer of activeTimers) clearTimeout(timer)
    activeTimers.clear()
  })
}

/** 覆盖已有 episode 时才打扰模型（EXP-13）；常规新建静默。 */
function notifyIfOverwrite(agent: Agent, result: ExtractResult): void {
  if (result.updated.length === 0) return
  try {
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `[经验库] 本次自动提炼覆盖了已有 episode：${result.updated.slice(0, 5).join('、')}，原内容已被替换。如与预期不符，可用 experience_save 以不同 name 另存。`,
      }],
      source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'notice', summary: '后台提炼覆盖已有经验提醒' },
    }))
  } catch {
    // agent 已 disposal：放弃通知
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
