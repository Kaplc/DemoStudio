/**
 * @demostudio/ds-feedback — DSH 反馈飞轮插件入口。
 *
 * 注册即副作用，全部贡献挂在插件 fiber 上（卸载自动回滚）：
 * - `ctx.systemPrompt.section()` — 常驻"用户反馈规则库"段（order 3100，text 每步重算：
 *   沉淀指引 + active 规则全量 + RULES.md 索引 + 回合末纠正提示，apply 后当前会话立即生效）
 * - `ctx.tools.register()` × 2 — rule_propose（提案，写入 pending/ 待确认）/
 *   rule_apply（用户确认后落地 active）
 * - `ctx.on('agent/status')` — agent 转入空闲防抖后跑回合末关键词预筛（零模型请求，独立水位）：
 *   用户消息行命中纠正关键词 → 在该 agent 的规则段末尾挂"回合末纠正提示"（含原话摘录），
 *   由主 agent 下一回合自行判定双条件并走 rule_propose 提案-确认制；未命中则撤下提示。
 *   判定与起草全部由主 agent 完成，本插件自身不发任何 LLM 请求。
 *   子 agent（delegationDepth > 0）不检测。
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
}

/** Loader 配置 schema：默认值在此声明，代码内另有兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  ruleDir: z.string(),
  autoDetect: z.boolean().default(true),
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
  }
  // enabled: false — 一切静默，什么都不注册
  if (!resolved.enabled) return

  const projectRoot = process.cwd()
  // 规则目录：配置显式指定优先（编辑器以 dsh-source 为 cwd 时钉到项目根），否则 <cwd>/.dsh/rules
  const rulesDirectory = resolved.ruleDir !== undefined && resolved.ruleDir.trim() !== ''
    ? resolve(resolved.ruleDir.trim())
    : resolve(join(projectRoot, RULES_DIR_SEGMENT))

  // ── 常驻规则段（text 同步函数每步重算：指引 + active 全量 + 索引 + 纠正提示） ──
  // assembly.agent 把提示隔离到触发预筛的那个 agent；子 agent / 无 agent 装配看不到提示。
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (assembly) => {
      const state = assembly.agent !== undefined ? detectStateByAgent.get(assembly.agent) : undefined
      const rules = readActiveRulesSync(rulesDirectory)
      // 索引以磁盘扫描派生为主（保证与 active 规则一致）；RULES.md 文件由 applyRule 维护
      const derived = renderIndexSync(rules)
      const indexText = derived.text !== undefined ? derived.text : readIndexFileSync(rulesDirectory)
      return rulesSectionText(rules, indexText, state?.suspicion)
    },
  })

  // ── 2 个规则工具（提案-确认制） ──
  for (const tool of createRuleTools({ rulesDirectory, ctx })) {
    ctx.tools.register(tool)
  }

  // ── 回合末关键词预筛：agent 空闲防抖后渲染增量转录、命中则更新规则段提示（新回合开始则取消） ──
  if (resolved.autoDetect) {
    ctx.on('agent/status', (payload) => {
      const agent = payload.agent
      if (isChildAgent(agent)) {
        ctx.logger?.debug('ds-feedback: 子 agent 跳过回合末预筛')
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
        const { transcript, maxTurn } = renderTurnTranscript(agent.session.events, { watermark: state.watermark })
        if (maxTurn <= state.watermark || transcript === '') return
        state.watermark = maxTurn
        const excerpts = screenTranscript(transcript)
        state.suspicion = excerpts.length > 0 ? { turn: maxTurn, excerpts } : undefined
        if (excerpts.length > 0) {
          ctx.logger?.info(`ds-feedback: 回合 ${maxTurn} 预筛命中疑似纠正，已在规则段挂提示（判定交给主 agent）`)
        } else {
          ctx.logger?.debug(`ds-feedback: 回合 >${state.watermark} 预筛未命中，提示撤下，水位 → ${state.watermark}`)
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
