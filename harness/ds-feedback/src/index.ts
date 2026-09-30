/**
 * @demostudio/ds-feedback — DSH 反馈飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"用户反馈规则库"段（order 3100，text 每步重算：
 *   沉淀指引 + active 规则全量 + RULES.md 索引 + 回合末纠正提示 + 会话损失摘要，
 *   apply 后当前会话立即生效）
 * - `ctx.tools.register()` — 规则 2 工具（rule_propose 提案 / rule_apply 落地）+
 *   梯度 3 工具（gradient_propose / gradient_list / gradient_apply，文本梯度候选两段式）
 * - `ctx.on('session/event' | 'tools/result')` — 损失探针（enableLossProbe）：
 *   turn-error / retry / steer / rule_propose 零成本落盘 `.dsh/loss/signals.jsonl`，
 *   并维护同步摘要缓存供规则段渲染健康分块（探针只记录不判定，归因在主 agent）
 * - `ctx.on('agent/status')` — agent 转入空闲防抖后跑回合末关键词预筛（零模型请求，独立水位）：
 *   用户消息行命中纠正关键词 → 在该 agent 的规则段末尾挂"回合末纠正提示"（含原话摘录）
 *   并记 correction_hint 损失信号，由主 agent 下一回合自行判定双条件并走提案-确认制；
 *   未命中则撤下提示。判定与起草全部由主 agent 完成，本插件自身不发任何 LLM 请求。
 *   子 agent（delegationDepth > 0）不检测、不采集。
 *
 * 与 ds-instructions（用户手工目录指令 `.dsh/instructions/`）完全解耦：
 * 分工固定——手工规范进指令目录，用户纠正沉淀进规则库（`.dsh/rules/`），互不读写。
 *
 * @module @demostudio/ds-feedback
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import {
  PLUGIN_NAME,
  RULES_DIR_SEGMENT,
  RULES_INDEX_FILE,
  SECTION_NAME,
  SECTION_ORDER,
  rulesSectionText,
} from './ruleTypes.js'
import type { SuspicionHint } from './ruleTypes.js'
import { renderIndexSync, stripFrontmatter, truncateIndex } from './ruleStore.js'
import { screenTranscript } from './preScreen.js'
import { renderTurnTranscript } from './transcript.js'
import { createRuleTools } from './tools.js'
import { createLossProbe, lossSectionText } from './lossProbe.js'
import type { LossProbeHost } from './lossProbe.js'
import { createGradientTools } from './gradientTools.js'
import type { GradientToolHost } from './gradientTools.js'

export const name = PLUGIN_NAME

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。 */
export const inject = ['tools', 'systemPrompt']

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  /** 总开关：false 时 section/工具/事件监听全部不注册（默认 true）。 */
  enabled?: boolean
  /**
   * 规则目录（绝对路径，或相对 cwd 的路径）。
   * 缺省 = <cwd>/.dsh/rules。编辑器以 dsh-source 为 cwd 拉起内核时，
   * 用此配置把规则库钉到项目根（如 E:/DemoStudio/.dsh/rules）。
   */
  ruleDir?: string
  /** 回合末关键词预筛与纠正提示总开关（独立于主工具与规则段；默认 true）。 */
  autoDetect?: boolean
  /**
   * 损失目录（绝对路径，或相对 cwd 的路径）。缺省 = <cwd>/.dsh/loss。
   * 信号文件 signals.jsonl 与健康分数据源都在这里。
   */
  lossDir?: string
  /**
   * 梯度目录（绝对路径，或相对 cwd 的路径）。缺省 = <cwd>/.dsh/gradient。
   * pending/ 候选与 applied.jsonl 台账都在这里。
   */
  gradientDir?: string
  /**
   * 提醒文案目录（绝对路径，或相对 cwd 的路径）。缺省 = <cwd>/.dsh/reminder。
   * gradient_apply 的 reminder 类别落地目标。
   */
  reminderDir?: string
  /** 损失探针总开关：false 时不订阅事件、不落信号、规则段无损失摘要块（默认 true）。 */
  enableLossProbe?: boolean
  /** 梯度工具总开关：false 时不注册 gradient_propose/list/apply（默认 true）。 */
  enableGradient?: boolean
}

/** Loader 配置 schema：默认值在此声明，代码内另有兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  ruleDir: z.string(),
  autoDetect: z.boolean().default(true),
  lossDir: z.string(),
  gradientDir: z.string(),
  reminderDir: z.string(),
  enableLossProbe: z.boolean().default(true),
  enableGradient: z.boolean().default(true),
})

/** 每个 agent 的回合末预筛状态：水位（已检测到的回合号）、防抖定时器与当前提示。 */
interface DetectState {
  watermark: number
  timer: NodeJS.Timeout | null
  suspicion?: SuspicionHint
}
const detectStateByAgent = new WeakMap<Agent, DetectState>()

/** 空闲后延迟预筛的防抖时长（毫秒）：用户连续追问时不打扰，停下阅读时才检测。 */
const DETECT_DEBOUNCE_MS = 3_000

/** 活跃定时器登记（插件卸载时统一清除，避免 HMR 后僵尸定时器）。 */
const activeTimers = new Set<NodeJS.Timeout>()

/** 子 agent（委托产生的）不做回合末预筛——上下文归属父 agent。 */
function isChildAgent(agent: Agent): boolean {
  const depth = (agent.session.header as { delegationDepth?: number } | undefined)?.delegationDepth
  return typeof depth === 'number' && depth > 0
}

/**
 * 注册反馈规则系统全部贡献。
 * @param ctx - Cordis 上下文（tools/systemPrompt 需在 inject 中声明）。
 * @param config - cordis.yml 配置；未提供时使用内置默认值。
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = {
    enabled: config?.enabled ?? true,
    autoDetect: config?.autoDetect ?? true,
    ruleDir: config?.ruleDir,
    lossDir: config?.lossDir,
    gradientDir: config?.gradientDir,
    reminderDir: config?.reminderDir,
    enableLossProbe: config?.enableLossProbe ?? true,
    enableGradient: config?.enableGradient ?? true,
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  const logger = ctx.logger('ds-feedback')
  // 目录解析：配置显式指定优先（编辑器以 dsh-source 为 cwd 时钉到项目根），否则 <cwd>/.dsh/<段>
  const resolveDir = (configured: string | undefined, segment: string): string =>
    configured !== undefined && configured.trim() !== '' ? resolve(configured.trim()) : resolve(join(projectRoot, segment))
  const rulesDirectory = resolveDir(resolved.ruleDir, RULES_DIR_SEGMENT)
  const lossDirectory = resolveDir(resolved.lossDir, '.dsh/loss')
  const gradientDirectory = resolveDir(resolved.gradientDir, '.dsh/gradient')
  const reminderDirectory = resolveDir(resolved.reminderDir, '.dsh/reminder')

  // ── 损失探针：进程内订阅会话事件流，落盘信号 + 同步摘要缓存（探针只记录不判定） ──
  const probe = resolved.enableLossProbe
    ? createLossProbe({ lossDirectory, logger } satisfies LossProbeHost)
    : undefined
  probe?.register(ctx)

  // ── 常驻规则段（text 同步函数每步重算：指引 + active 全量 + 索引 + 纠正提示 + 损失摘要） ──
  // assembly.agent 把提示隔离到触发预筛的那个 agent；子 agent / 无 agent 装配看不到提示。
  const lossViewFor = (agent: Agent | undefined) => {
    if (probe === undefined || agent === undefined) return undefined
    const id = (agent.session?.header as { id?: unknown } | undefined)?.id
    return typeof id === 'string' ? probe.viewFor(id) : undefined
  }
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (assembly) => {
      const state = assembly.agent !== undefined ? detectStateByAgent.get(assembly.agent) : undefined
      const rules = readActiveRulesSync(rulesDirectory)
      // 索引以磁盘扫描派生为主（保证与 active 规则一致）；RULES.md 文件由 applyRule 维护
      const derived = renderIndexSync(rules)
      const indexText = derived.text !== undefined ? derived.text : readIndexFileSync(rulesDirectory)
      const base = rulesSectionText(rules, indexText, state?.suspicion)
      const loss = lossSectionText(lossViewFor(assembly.agent))
      return loss === undefined ? base : `${base}\n\n${loss}`
    },
  })

  // ── 2 个规则工具（提案-确认制） ──
  for (const tool of createRuleTools({ rulesDirectory, ctx })) {
    ctx.tools.register(tool)
  }

  // ── 3 个梯度工具（文本梯度候选：propose → 用户确认 → apply，台账留痕） ──
  if (resolved.enableGradient) {
    const gradientHost: GradientToolHost = {
      gradientDirectory,
      rulesDirectory,
      reminderDirectory,
      lossViewFor: (sessionId: string) => probe?.viewFor(sessionId),
      logger,
    }
    for (const tool of createGradientTools(gradientHost)) {
      ctx.tools.register(tool)
    }
  }

  // ── 回合末关键词预筛：agent 空闲防抖后渲染增量转录、命中则更新规则段提示（新回合开始则取消） ──
  if (resolved.autoDetect) {
    ctx.on('agent/status', (payload) => {
      const agent = payload.agent
      if (isChildAgent(agent)) {
        logger.debug('ds-feedback: 子 agent 跳过回合末预筛')
        return
      }
      const state = detectStateByAgent.get(agent) ?? { watermark: 0, timer: null }
      detectStateByAgent.set(agent, state)
      if (payload.status === 'running') {
        // 用户回来了：撤销未触发的预筛计划，水位留待下次空闲补检
        if (state.timer !== null) {
          clearTimeout(state.timer)
          activeTimers.delete(state.timer)
          state.timer = null
        }
        return
      }
      if (payload.status !== 'idle' || state.timer !== null) return
      const timer = setTimeout(() => {
        activeTimers.delete(timer)
        state.timer = null
        const { transcript, maxTurn } = renderTurnTranscript(agent.session.snapshotEvents(), { watermark: state.watermark })
        if (maxTurn <= state.watermark || transcript === '') return
        state.watermark = maxTurn
        const excerpts = screenTranscript(transcript)
        state.suspicion = excerpts.length > 0 ? { turn: maxTurn, excerpts } : undefined
        if (excerpts.length > 0) {
          // 预筛命中 = 疑似人工纠正，同步记一条损失信号（correction_hint；判定仍在主 agent）
          probe?.noteExternal(agent.session, 'correction_hint', maxTurn, excerpts[0])
          logger.info('回合 %d 预筛命中疑似纠正，已在规则段挂提示（判定交给主 agent）', maxTurn)
        } else {
          logger.debug('回合 >%d 预筛未命中，提示撤下，水位 → %d', state.watermark, state.watermark)
        }
      }, DETECT_DEBOUNCE_MS)
      state.timer = timer
      activeTimers.add(timer)
    })

    // 卸载时清除所有未触发的预筛定时器（live patch reload 会重挂插件）
    ctx.effect(() => () => {
      for (const timer of activeTimers) clearTimeout(timer)
      activeTimers.clear()
    })
  }
}

/** 同步读取 active 规则（section text provider 是同步接口；规则库小，同步 IO 可接受）。 */
function readActiveRulesSync(rulesDirectory: string): import('./ruleTypes.js').ActiveRule[] {
  try {
    const dirents = readdirSync(rulesDirectory, { withFileTypes: true })
    const rules: import('./ruleTypes.js').ActiveRule[] = []
    for (const entry of dirents) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === RULES_INDEX_FILE) continue
      try {
        const text = readFileSync(join(rulesDirectory, entry.name), 'utf8')
        rules.push({ name: entry.name.slice(0, -3), content: stripFrontmatter(text) })
      } catch {
        // 单个坏文件不拖垮规则段
      }
    }
    return rules.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** 同步读取 RULES.md（不存在/为空返回 undefined）。 */
function readIndexFileSync(rulesDirectory: string): string | undefined {
  try {
    const text = readFileSync(join(rulesDirectory, RULES_INDEX_FILE), 'utf8').trim()
    if (text.length === 0) return undefined
    return truncateIndex(text).text
  } catch {
    return undefined
  }
}
