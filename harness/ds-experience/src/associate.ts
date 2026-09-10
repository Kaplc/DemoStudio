/**
 * 经验自动联想（prefix 路径召回）——与 ds-memory 的记忆联想同构，冷通道变半热：
 *
 * - 只跟踪读取类工具（read/read_image）的成功结果（tools/pre-execute 登记 →
 *   tools/result 确认，嵌套调用向 parent 汇总，失败/取消整体丢弃）；
 * - 被读文件相对项目根的路径做**段级前缀匹配**（src/engine 不命中 src/engine2），
 *   求值经验 frontmatter 声明的 `prefix:` 表达式：支持代码风格 `||`（任一路径
 *   命中即触发）与 `&&`（会话中全部前缀被读过才触发，可跨多次读取累计，
 *   `&&` 优先级高于 `||`，与代码语义一致）；
 * - agent/pre-step 时把命中经验的**全文**（Summary/Lessons/Effective Path）作为
 *   user message 注入下一次模型请求，source.kind='plugin'（history_read 会过滤）；
 * - 去重：同一 Agent 会话内同一条经验只注入一次（WeakMap，随 Agent 回收）；
 * - 只服务主 agent（delegationDepth=0）；子 agent 上下文归属父 agent，不注入；
 * - 纯 frontmatter + 正文文件读取（readAllEpisodes）+ 内存 TTL 缓存，零 LLM 调用。
 *
 * 说明（对齐 experienceGuideSectionText 的措辞）：
 * 注入的是整篇正文——因此写经验时声明 prefix 的正文必须精炼。
 *
 * @module associate
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { MAX_EPISODE_CONTENT_CHARS, parsePrefixExpr } from './experienceTypes.js'
import { readAllEpisodes } from './experienceStore.js'
import type { EpisodeRecord } from './experienceStore.js'

/** 默认跟踪的"读取文件"工具（与 ds-instructions / ds-memory 一致；write/edit 不触发联想）。 */
export const DEFAULT_ASSOCIATE_TOOLS: readonly string[] = ['read', 'read_image']

/** 单次联想注入的总字符预算（防经验库膨胀后注入爆炸）。 */
export const MAX_ASSOCIATE_TOTAL_CHARS = 32_000

/** 经验清单扫描结果的 TTL（毫秒）：联想频次低，无需更细的失效。 */
const SCAN_TTL_MS = 5_000

/** 成功执行后会使经验库变化的工具（结果确认成功后使扫描缓存失效）。 */
const EXPERIENCE_MUTATOR_TOOLS: ReadonlySet<string> = new Set(['experience_save'])

const isWindows = process.platform === 'win32'

/** 平台一致的路径段比较键：win32 忽略大小写。 */
export function pathCompareKey(value: string): string {
  return isWindows ? value.toLowerCase() : value
}

/** 按平台分隔符拆路径段，丢弃空段与根段。 */
function splitPathSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(segment => segment.length > 0)
}

/** 判断是否为子 agent（delegationDepth > 0）：子 agent 上下文归属父 agent。 */
export function isChildAgent(agent: Agent | undefined): boolean {
  const depth = (agent?.session.header as { delegationDepth?: number } | undefined)?.delegationDepth
  return typeof depth === 'number' && depth > 0
}

/**
 * 把工具参数里的被读路径规范化为项目根相对路径；越界/非法返回 undefined。
 * 相对路径按项目根解析；绝对路径需落在项目根内（containment 校验）。
 */
export function normalizeRelPath(projectRoot: string, rawPath: unknown): string | undefined {
  if (typeof rawPath !== 'string') return undefined
  const trimmed = rawPath.trim()
  if (trimmed.length === 0) return undefined
  const absolute = resolve(projectRoot, trimmed)
  const rel = relative(projectRoot, absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return rel === '' ? '' : undefined
  return rel
}

/**
 * 段级前缀匹配：prefix 的每一段按序等于被读路径的对应段。
 * `prefix: /`（或空段数组）为全局映射，匹配任意路径；
 * 空字符串/未声明不匹配（undefined 前缀由调用方过滤）。
 */
export function matchExperiencePrefix(relPath: string, prefix: string | undefined): boolean {
  if (prefix === undefined) return false
  const normalized = prefix.trim()
  if (normalized.length === 0) return false
  const segments = splitPathSegments(normalized)
  if (segments.some(segment => segment === '.' || segment === '..')) return false
  const relSegments = splitPathSegments(relPath)
  if (segments.length === 0) return true // `prefix: /` 全局
  if (relSegments.length < segments.length) return false
  return segments.every((segment, index) =>
    pathCompareKey(relSegments[index]!) === pathCompareKey(segment),
  )
}

/** 单条经验 prefix 表达式（DNF）的一次路径求值结果。 */
export interface PrefixGroupEval {
  /** 是否有 OR 组在本次路径后全部满足（单前缀 = 单项单组，读一次即满足）。 */
  triggered: boolean
  /** 未满足组的剩余未匹配项（已剔除本次满足的组）；未触发时作为 AND 累计进度。 */
  remaining: string[][]
}

/**
 * 对 prefix 表达式的 DNF 组应用一次被读路径（纯函数）：
 * 任一组全部项命中即 triggered；`&&` 语义靠跨调用累计实现——
 * 未触发的组返回剩余项，调用方保存进度，后续读取继续削减，集齐即触发。
 */
export function evalPrefixGroups(groups: readonly (readonly string[])[], relPath: string): PrefixGroupEval {
  let triggered = false
  const remaining: string[][] = []
  for (const group of groups) {
    const rest = group.filter(term => !matchExperiencePrefix(relPath, term))
    if (rest.length === 0) triggered = true
    else remaining.push(rest)
  }
  return { triggered, remaining }
}

/** 联想消息组装结果。 */
export interface AssociateComposeResult {
  /** 注入用的完整消息文本（无可注入条目时为 ''）。 */
  text: string
  /** 实际装入消息的经验文件名（预算内，按传入顺序截断）。 */
  included: string[]
  /** 因预算截断未装入的数量。 */
  omitted: number
}

/** 单条经验正文的注入截断（8000 字符上限）。 */
function clipContent(content: string): string {
  return content.length > MAX_EPISODE_CONTENT_CHARS
    ? `${content.slice(0, MAX_EPISODE_CONTENT_CHARS)}\n[...内容过长已截断]`
    : content
}

/** 单条命中经验的组装输入（纯数据）。 */
export interface AssociateHitInput {
  fileName: string
  taskType?: string
  outcome?: string
  date?: string
  prefix?: string
  content: string
}

/**
 * 组装"自动联想经验"注入文本（纯函数，便于单测）。
 * @param hits - 命中经验，调用方需按传入顺序装入（排序由调用方决定）。
 * @param triggerPath - 触发联想的被读路径（项目根相对，仅展示）。
 * @param maxTotalChars - 总字符预算。
 */
export function composeExperienceAssociateMessage(
  hits: readonly AssociateHitInput[],
  triggerPath: string,
  maxTotalChars: number = MAX_ASSOCIATE_TOTAL_CHARS,
): AssociateComposeResult {
  const blocks: string[] = []
  const included: string[] = []
  let total = 0
  let omitted = 0
  for (const hit of hits) {
    const body = clipContent(hit.content.trim())
    const tag = `${hit.taskType ?? 'unknown'}/${hit.outcome ?? 'unknown'}`
    const meta = [hit.date, hit.prefix === undefined ? undefined : `prefix ${hit.prefix}`]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' · ')
    const metaTag = meta === '' ? '' : `（${meta}）`
    const header = `### ${hit.fileName} [${tag}]${metaTag}`
    const block = body === '' ? header : `${header}\n\n${body}`
    const nextTotal = total + block.length + 1 // +1 段间换行
    if (nextTotal > maxTotalChars) {
      omitted += 1
      continue
    }
    blocks.push(block)
    included.push(hit.fileName)
    total = nextTotal
  }
  if (blocks.length === 0) return { text: '', included, omitted }
  const lines = [
    `## 自动联想经验（读取 \`${triggerPath}\` 触发）`,
    '',
    '以下经验在 frontmatter 声明了匹配当前读取路径的 prefix，全文已自动加载（同一会话内不重复注入）：',
    '',
    blocks.join('\n\n'),
    '',
    '> 经验是做事轨迹：引用其中的 file:line / 命令前先与当前代码核对；发现更优路线时用同名 experience_save 覆盖更新，不要丢旧 lessons 里的坑。',
  ]
  if (omitted > 0) {
    lines.push('', `[预算：其余 ${omitted} 条匹配经验超出单次注入字符上限未加载；需要时可用 experience_search 按文件名检索。]`)
  }
  return { text: lines.join('\n'), included, omitted }
}

/** 联想器运行参数。 */
export interface AssociatorOptions {
  /** 经验目录（绝对路径）。 */
  experienceDirectory: string
  /** 项目根（绝对路径）：被读路径 containment 与前缀匹配的基准。 */
  projectRoot: string
  /** 触发联想的工具名集合（默认 read/read_image）。 */
  trackedTools?: readonly string[]
  /** 单次注入总字符预算（默认 {@link MAX_ASSOCIATE_TOTAL_CHARS}）。 */
  maxTotalChars?: number
}

/**
 * 创建并注册经验联想器。事件监听随 ctx 生命周期卸载；无定时器/外部句柄。
 * @returns 注销函数（幂等，供显式卸载或测试清理）。
 */
export function registerExperienceAssociator(ctx: Context, options: AssociatorOptions): () => void {
  const logger = ctx.logger('ds-experience:associate')
  const trackedTools = new Set(
    (options.trackedTools ?? DEFAULT_ASSOCIATE_TOOLS)
      .filter((name): name is string => typeof name === 'string' && name.trim() !== ''),
  )

  // ── 经验清单（prefix/正文）扫描缓存：TTL + experience_save 成功后强制失效 ──
  let episodesCache: { at: number; episodes: EpisodeRecord[] } | undefined
  const invalidateEpisodes = (): void => {
    episodesCache = undefined
  }
  const loadEpisodes = async (): Promise<EpisodeRecord[]> => {
    const now = Date.now()
    if (episodesCache !== undefined && now - episodesCache.at < SCAN_TTL_MS) {
      return episodesCache.episodes
    }
    const episodes = await readAllEpisodes(options.experienceDirectory)
    episodesCache = { at: now, episodes }
    return episodes
  }

  /** 主 agent 的待注入经验（fileName → 触发路径，仅首触发展示用）。 */
  const pendingHits = new WeakMap<Agent, Map<string, { triggerPath: string; prefix: string }>>()
  /** 主 agent 的已注入经验文件名集合（去重：同会话同经验只注入一次）。 */
  const injectedByAgent = new WeakMap<Agent, Set<string>>()
  /** AND 组的会话累计进度：fileName → 尚未集齐的 DNF 组（每组为剩余未命中项）。 */
  const andProgress = new WeakMap<Agent, Map<string, string[][]>>()

  // ── tools/pre-execute：登记候选被读路径（result 成功才确认；嵌套向 parent 汇总） ──
  const executionCandidates = new Map<ToolExecutionToken, string[]>()
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next) => {
    const decision = await next()
    if (typeof exec.arguments === 'object' && exec.arguments !== null) {
      const raw = (exec.arguments as Record<string, unknown>)['file_path']
      if (typeof raw === 'string' && raw.trim() !== '') {
        const list = executionCandidates.get(exec.token) ?? []
        list.push(raw)
        executionCandidates.set(exec.token, list)
      }
    }
    return decision
  })

  // ── tools/result：确认成功读取 → 前缀匹配 → 记入 pending，pre-step 统一注入 ──
  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    try {
      const ownCandidates = executionCandidates.get(exec.token) ?? []
      executionCandidates.delete(exec.token)
      const ok = !result.isError && exec.agent !== undefined && !exec.signal.aborted
      const candidates = ok ? ownCandidates : []
      if (exec.parent !== undefined) {
        // 嵌套调用：只向 parent 汇总，等外层最终结果（失败整体丢弃）
        if (ok && candidates.length > 0) {
          const buffered = executionCandidates.get(exec.parent) ?? []
          buffered.push(...candidates)
          executionCandidates.set(exec.parent, buffered)
        }
        return
      }
      if (!ok || exec.agent === undefined) return
      // 只跟踪"读取文件"类工具（read/read_image 等，write/edit 不触发联想）
      if (!trackedTools.has(exec.name)) return
      // 经验库变更工具成功 → 缓存失效
      if (EXPERIENCE_MUTATOR_TOOLS.has(exec.name)) invalidateEpisodes()
      if (isChildAgent(exec.agent)) return
      void projectHits(exec.agent, candidates)
    } catch (error) {
      logger.warn('associate tools/result failed: %o', error)
    }
  })

  const projectHits = async (agent: Agent, rawPaths: readonly string[]): Promise<void> => {
    try {
      const episodes = await loadEpisodes()
      const candidates = episodes.filter(episode => parsePrefixExpr(episode.prefix ?? '') !== undefined)
      if (candidates.length === 0) return
      const injected = injectedByAgent.get(agent)
      for (const rawPath of rawPaths) {
        const relPath = normalizeRelPath(options.projectRoot, rawPath)
        if (relPath === undefined) continue
        for (const episode of candidates) {
          if (injected?.has(episode.fileName)) continue // 本会话已注入过，不再累计/触发
          const groups = parsePrefixExpr(episode.prefix!)!
          const progressMap = andProgress.get(agent)
          const remaining = progressMap?.get(episode.fileName) ?? groups.map(group => [...group])
          const evaluation = evalPrefixGroups(remaining, relPath)
          if (evaluation.triggered) {
            progressMap?.delete(episode.fileName)
            let pending = pendingHits.get(agent)
            if (pending === undefined) {
              pending = new Map()
              pendingHits.set(agent, pending)
            }
            if (!pending.has(episode.fileName)) {
              pending.set(episode.fileName, { triggerPath: relPath, prefix: episode.prefix! })
            }
          } else {
            // AND 组未集齐：保存剩余进度，等后续读取继续削减（可跨多次读取累计，顺序不限）
            if (progressMap === undefined) {
              andProgress.set(agent, new Map())
            }
            andProgress.get(agent)!.set(episode.fileName, evaluation.remaining)
          }
        }
      }
    } catch (error) {
      logger.warn('associate prefix match failed: %o', error)
    }
  }

  // ── agent/pre-step：把 pending 命中的经验全文注入下一次模型请求 ──
  ctx.on('agent/pre-step', async (
    { agent, step, signal }: { agent: Agent; step: number; signal?: AbortSignal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    try {
      if (decision.kind === 'reject') return decision
      if (isChildAgent(agent)) return decision
      const pending = pendingHits.get(agent)
      if (pending === undefined || pending.size === 0) return decision
      // 第一步无实际消息（如 reject 之外的空批次）：保持 pending，等下一次 pre-step
      if (step === 1 && decision.messages.length === 0) return decision

      const injected = injectedByAgent.get(agent) ?? new Set<string>()
      const toLoad = [...pending.entries()].filter(([fileName]) => !injected.has(fileName))
      if (toLoad.length === 0) {
        pendingHits.delete(agent)
        return decision
      }
      const fileNameSet = new Set(toLoad.map(([fileName]) => fileName))
      const records = (await loadEpisodes())
        .filter(episode => fileNameSet.has(episode.fileName))
      if (records.length === 0) {
        pendingHits.delete(agent)
        return decision
      }
      const trigger = toLoad.find(([fileName]) => records.some(record => record.fileName === fileName))?.[1]?.triggerPath ?? ''
      const hits = records.map(record => ({
        fileName: record.fileName,
        taskType: record.taskType,
        outcome: record.outcome,
        date: record.date,
        prefix: record.prefix ?? pending.get(record.fileName)?.prefix,
        content: record.body,
      }))
      const composed = composeExperienceAssociateMessage(hits, trigger, options.maxTotalChars ?? MAX_ASSOCIATE_TOTAL_CHARS)
      if (composed.text === '') {
        pendingHits.delete(agent)
        return decision
      }
      signal?.throwIfAborted()
      const message = createUserMessage({
        content: [{ type: 'text', text: composed.text }],
        source: {
          kind: 'plugin',
          plugin: '@demostudio/ds-experience',
          form: 'recall',
          summary: `自动联想经验 ${composed.included.length} 条`,
        },
      })
      for (const fileName of composed.included) injected.add(fileName)
      injectedByAgent.set(agent, injected)
      // 只清掉已装入的经验；因预算截断未装入的留待下次触发（预算外自然不再命中也接受）
      pendingHits.delete(agent)
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      if (!signal?.aborted) logger.warn('associate pre-step compose failed: %o', error)
      return decision
    }
  })

  return () => {
    executionCandidates.clear()
    // 监听器随 ctx 卸载自动清理；WeakMap 无外部句柄，随对象回收
  }
}

/** 便捷工具：根据经验目录推导项目根（<root>/.dsh/experience 形态 → <root>）。 */
export function deriveExperienceProjectRoot(experienceDirectory: string): string | undefined {
  const segments = splitPathSegments(experienceDirectory)
  // E:/DemoStudio/.dsh/experience → 去掉末尾 experience 与 .dsh 两段
  if (
    segments.length >= 2
    && segments[segments.length - 1] === 'experience'
    && segments[segments.length - 2] === '.dsh'
  ) {
    return resolve(experienceDirectory, '..', '..')
  }
  return undefined
}
