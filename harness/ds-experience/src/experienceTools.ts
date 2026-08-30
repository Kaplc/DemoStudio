/**
 * 经验库工具：experience_save / experience_search。
 * save 落盘 episode + INDEX.md 索引；search 复刻 ds-memory selectMemories 模式
 * （AI 选择器 side-query 选最多 3 条）按需冷检索。
 *
 * @module experienceTools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import {
  EPISODE_OUTCOMES,
  MAX_SELECTED,
  PLUGIN_NAME,
  SELECT_MAX_TOKENS,
  SELECT_TIMEOUT_MS,
} from './experienceTypes.js'
import type { EpisodeOutcome } from './experienceTypes.js'
import {
  formatEpisodeManifest,
  readAllEpisodes,
  saveExperience,
} from './experienceStore.js'
import type { EpisodeRecord } from './experienceStore.js'

/** 工具运行所需宿主环境（由 index.ts 装配时闭包注入）。 */
export interface ExperienceToolHost {
  /** 解析后的经验目录（默认 <cwd>/.dsh/experience，可由配置 experienceDir 覆盖）。 */
  experienceDirectory: string
  /** Cordis 上下文：AI 选择器走 ctx.llm。 */
  ctx: Context
  /** 选择器模型路由。 */
  selectProvider: string
  selectModel: string
}

// ---------------------------------------------------------------------------
// experience_save
// ---------------------------------------------------------------------------

/** experience_save：落盘一条 episode（同名覆盖，不产生副本）。 */
export function createExperienceSaveTool(host: Pick<ExperienceToolHost, 'experienceDirectory' | 'ctx'>) {
  return defineTool({
    name: 'experience_save',
    description: '把一次完整任务的做事轨迹沉淀为经验（episode）：怎么做的、什么有效、踩了什么坑。经验是冷通道按需检索，绝不替代 memory_write（事实/规则进记忆，做事轨迹进经验）。同名 episode 会被覆盖更新。',
    parameters: {
      name: { type: 'string', required: true, description: '经验名，语义化小写下划线（如 fix_junction_mount）' },
      task_type: { type: 'string', required: true, description: '任务类型短语（如 build-fix / feature / refactor / debug）' },
      outcome: { type: 'string', enum: EPISODE_OUTCOMES, required: true, description: '任务结果：success / partial / failure' },
      summary: { type: 'string', required: true, description: '一句话概述：这是个什么任务、怎么做的' },
      lessons: { type: 'string', required: true, description: '学到什么：有效路径、踩的坑、下次怎么办' },
      effective_path: { type: 'string', description: '有效的落点（文件/目录/命令），可选' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['created', 'updated'], required: true },
          file: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'created'
          ? `已保存经验 ${value.file} 并更新 INDEX.md 索引。`
          : `已覆盖更新已有经验 ${value.file}（同名去重），索引已同步。`,
      }],
    },
    async execute(args) {
      const result = await saveExperience(host.experienceDirectory, {
        name: args.name,
        taskType: args.task_type,
        outcome: args.outcome,
        summary: args.summary,
        lessons: args.lessons,
        ...(args.effective_path === undefined ? {} : { effectivePath: args.effective_path }),
      })
      host.ctx.logger?.info(`ds-experience: experience_save ${result.fileName}（${result.status}）`)
      return { status: result.status, file: result.fileName }
    },
  })
}

// ---------------------------------------------------------------------------
// experience_search（AI 选择器，复刻 ds-memory selectMemories 模式）
// ---------------------------------------------------------------------------

const SELECT_SYSTEM_PROMPT = `你从一份经验库清单中为 AI agent 挑选对处理当前请求有用的经验条目。你会拿到当前请求和一份可选经验清单（文件名 | 任务类型 | 结果 | 日期 | 概述）。

返回对该请求明确有用的经验文件名列表（最多 ${MAX_SELECTED} 个）。只列你确信有帮助的：
- 不确定是否有用的，一律不选，宁缺毋滥。
- 清单中没有明确有用的经验时，返回空列表是完全正常的。`

/** 选择器输出（严格 JSON）。 */
interface SelectorOutput {
  selected_episodes?: unknown
}

/** 检索命中（含正文提取）。 */
export interface ExperienceMatch {
  name: string
  task_type: string
  outcome: string
  summary: string
  lessons: string
}

/** 一次检索的配置。 */
export interface SearchOptions {
  query: string
  selectProvider: string
  selectModel: string
  signal?: AbortSignal
}

/**
 * 检索相关经验：扫描清单 → side-query 选择（≤ MAX_SELECTED）→ 回读正文提取。
 * 空库、选择失败一律返回 []（不阻塞主对话）。
 */
export async function findRelevantEpisodes(
  ctx: Context,
  experienceDirectory: string,
  options: SearchOptions,
): Promise<ExperienceMatch[]> {
  const episodes = await readAllEpisodes(experienceDirectory)
  if (episodes.length === 0) {
    ctx.logger?.debug('ds-experience: 经验库为空，跳过检索')
    return []
  }
  const selectedNames = await selectRelevantEpisodes(ctx, options.query, episodes, options)
  ctx.logger?.info(`ds-experience: experience_search "${options.query}" → 清单 ${episodes.length} 条，选中 ${selectedNames.length} 条`)
  const byFileName = new Map(episodes.map(episode => [episode.fileName, episode]))
  return selectedNames
    .flatMap(name => {
      const episode = byFileName.get(name)
      return episode === undefined ? [] : [toMatch(episode)]
    })
    .slice(0, MAX_SELECTED)
}

/** episode 记录 → 检索命中形态（Summary/Lessons 从正文小节提取）。 */
function toMatch(episode: EpisodeRecord): ExperienceMatch {
  return {
    name: episode.fileName.replace(/\.md$/, ''),
    task_type: episode.taskType ?? 'unknown',
    outcome: episode.outcome ?? 'unknown',
    summary: extractSection(episode.body, 'Summary') ?? '',
    lessons: extractSection(episode.body, 'Lessons') ?? '',
  }
}

function extractSection(body: string, title: string): string | undefined {
  const match = body.match(new RegExp(`##\\s*${title}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`))
  const text = match?.[1]?.trim()
  return text === undefined || text === '' ? undefined : text
}

/** side-query 调用与输出校验；任何失败返回 []（warn 日志）。 */
async function selectRelevantEpisodes(
  ctx: Context,
  query: string,
  episodes: readonly EpisodeRecord[],
  options: SearchOptions,
): Promise<string[]> {
  const validNames = new Set(episodes.map(episode => episode.fileName))
  const framed = `当前请求：${query}\n\n可选经验清单：\n${formatEpisodeManifest(episodes)}\n\n只输出一个 JSON 对象：{"selected_episodes": ["文件名", ...]}（最多 ${MAX_SELECTED} 个，可为空数组），不要输出任何其他文字。`
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: framed }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME },
  })]
  const request: GenerateOptions = deepFreeze({
    provider: options.selectProvider,
    model: options.selectModel,
    messages,
    system: SELECT_SYSTEM_PROMPT,
    maxTokens: SELECT_MAX_TOKENS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  using callDeadline = deadline(options.signal, SELECT_TIMEOUT_MS, 'EXPERIENCE_SELECT_TIMEOUT')
  try {
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(request)) {
      callDeadline.signal.throwIfAborted()
      assembler.push(chunk)
    }
    callDeadline.signal.throwIfAborted()
    if (assembler.finish.kind !== 'stop') return []
    const text = assembler.blocks()
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(' ')
    const parsed = parseSelectorOutput(text)
    if (parsed === undefined) {
      ctx.logger?.warn('ds-experience: 选择器输出不是合法 JSON，忽略本次检索')
      return []
    }
    return parsed.filter(name => validNames.has(name))
  } catch (error: unknown) {
    if (options.signal?.aborted) return []
    ctx.logger?.warn('ds-experience: AI 选择器调用失败，本次不返回经验', error)
    return []
  }
}

/** 宽容解析模型输出：截取首个 {...} 块做 JSON.parse，校验 selected_episodes 为字符串数组。 */
export function parseSelectorOutput(text: string): string[] | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: SelectorOutput
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as SelectorOutput
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed.selected_episodes)) return undefined
  return parsed.selected_episodes.filter((name): name is string => typeof name === 'string')
}

/** experience_search：AI 选择器按需冷检索。 */
export function createExperienceSearchTool(host: ExperienceToolHost) {
  return defineTool({
    name: 'experience_search',
    description: '按需检索经验库：AI 选择器从经验清单中选出与 query 最相关的做事轨迹（最多 3 条），返回概述/教训/结果。做同类任务前怀疑有相似经验时使用。',
    parameters: {
      query: { type: 'string', required: true, description: '检索意图的自然语言描述' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                task_type: { type: 'string' },
                outcome: { type: 'string' },
                summary: { type: 'string' },
                lessons: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? `经验库中没有与「${value.query}」相关的经验。`
          : `检索到 ${value.count} 条相关经验：\n${value.matches.map(match => `- ${match.name} [${match.task_type}/${match.outcome}] ${match.summary}`).join('\n')}\n\n完整 Lessons 见结果 JSON。`,
      }],
    },
    async execute(args, exec) {
      const matches = await findRelevantEpisodes(host.ctx, host.experienceDirectory, {
        query: args.query,
        selectProvider: host.selectProvider,
        selectModel: host.selectModel,
        signal: exec.signal,
      })
      return { query: args.query, count: matches.length, matches }
    },
  })
}

/** outcome 的字符串收窄（execute 入参来自 schema enum，恒为合法值）。 */
export function asOutcome(value: string): EpisodeOutcome {
  return (EPISODE_OUTCOMES as readonly string[]).includes(value) ? value as EpisodeOutcome : 'success'
}

/** 创建 2 个经验库工具。 */
export function createExperienceTools(host: ExperienceToolHost) {
  return [
    createExperienceSaveTool(host),
    createExperienceSearchTool(host),
  ]
}
