/**
 * 经验库工具：experience_save / experience_search。
 * save 落盘 episode + INDEX.md 索引；search 按文件名直接读取。
 * 经验保存与检索完全由主 agent 自觉调用工具完成，不走 LLM。
 *
 * @module experienceTools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import {
  EPISODE_OUTCOMES,
  normalizeEpisodeName,
  normalizeTriggerFiles,
} from './experienceTypes.js'
import type { EpisodeOutcome } from './experienceTypes.js'
import {
  readAllEpisodes,
  saveExperience,
} from './experienceStore.js'
import type { EpisodeRecord } from './experienceStore.js'

/** 工具运行所需宿主环境（由 index.ts 装配时闭包注入）。 */
export interface ExperienceToolHost {
  /** 解析后的经验目录（默认 <cwd>/.dsh/experience，可由配置 experienceDir 覆盖）。 */
  experienceDirectory: string
  /** Cordis 上下文：日志走 ctx.logger。 */
  ctx: Context
}

// ---------------------------------------------------------------------------
// experience_save
// ---------------------------------------------------------------------------

/** experience_save：落盘一条 episode（同名覆盖，不产生副本）。 */
export function createExperienceSaveTool(host: Pick<ExperienceToolHost, 'experienceDirectory' | 'ctx'>) {
  return defineTool({
    name: 'experience_save',
    description: '把一次完整任务的做事轨迹沉淀为经验（episode）：怎么做的、什么有效、踩了什么坑。绝不替代 memory_write（事实/规则进记忆，做事轨迹进经验）。同名 episode 会被覆盖更新。prefix 必填：声明联想触发的文件数组，会话中读到列表中的文件时本条经验全文自动注入；无联想或更新时保持原样填 hold。',
    parameters: {
      name: { type: 'string', required: true, description: '经验名，语义化小写下划线（如 fix_junction_mount）' },
      task_type: { type: 'string', required: true, description: '任务类型短语（如 build-fix / feature / refactor / debug）' },
      outcome: { type: 'string', enum: EPISODE_OUTCOMES, required: true, description: '任务结果：success / partial / failure' },
      summary: { type: 'string', required: true, description: '一句话概述：这是个什么任务、怎么做的' },
      lessons: { type: 'string', required: true, description: '学到什么：有效路径、踩的坑、下次怎么办' },
      effective_path: { type: 'string', description: '有效的落点（文件/目录/命令），可选' },
      prefix: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: '联想触发文件列表（必填）：项目根相对的**具体文件路径**数组，如 ["harness/ds-memory/src/associate.ts", "src/engine/foo.ts"]。会话中读到列表中的任一文件时本条经验自动注入。只按具体文件精确匹配，不支持目录/通配符/&&/|| 表达式。无联想、或更新同名经验时保持已有联想不变，填 hold',
      },
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
      // prefix 必填；`hold`（大小写不敏感，容忍空数组/缺省/空白条目）= 无联想/更新时保持原样
      // ——不落 frontmatter；含换行条目由 normalizeTriggerFiles 抛错（frontmatter 单行约束）
      const declared = normalizeTriggerFiles(args.prefix)
      const hold = declared === undefined
        || (declared.length === 1 && declared[0]!.toLowerCase() === 'hold')
      let prefix: string[] | undefined
      if (hold) {
        // 更新同名 episode 时保持已有联想；新建则无联想
        const fileName = normalizeEpisodeName(args.name)
        const existing = (await readAllEpisodes(host.experienceDirectory))
          .find(episode => episode.fileName === fileName)
        prefix = existing?.prefix
      } else {
        prefix = declared
      }
      const result = await saveExperience(host.experienceDirectory, {
        name: args.name,
        taskType: args.task_type,
        outcome: args.outcome,
        summary: args.summary,
        lessons: args.lessons,
        ...(args.effective_path === undefined ? {} : { effectivePath: args.effective_path }),
        ...(prefix === undefined ? {} : { prefix }),
      })
      host.ctx.logger?.info(`ds-experience: experience_save ${result.fileName}（${result.status}）`)
      return { status: result.status, file: result.fileName }
    },
  })
}

// ---------------------------------------------------------------------------
// experience_search（纯文件读取，不走 LLM）
// ---------------------------------------------------------------------------

/** 检索命中。 */
export interface ExperienceMatch {
  name: string
  task_type: string
  outcome: string
  date?: string
  summary: string
  lessons: string
}

/** episode 记录 → 检索命中形态。可选字段缺失时整个省略键（lossless JSON 禁止显式 undefined）。 */
function toMatch(episode: EpisodeRecord): ExperienceMatch {
  return {
    name: episode.fileName.replace(/\.md$/, ''),
    task_type: episode.taskType ?? 'unknown',
    outcome: episode.outcome ?? 'unknown',
    ...(episode.date !== undefined ? { date: episode.date } : {}),
    summary: extractSection(episode.body, 'Summary') ?? '',
    lessons: extractSection(episode.body, 'Lessons') ?? '',
  }
}

function extractSection(body: string, title: string): string | undefined {
  const match = body.match(new RegExp(`##\\s*${title}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`))
  const text = match?.[1]?.trim()
  return text === undefined || text === '' ? undefined : text
}

/** experience_search：按文件名直接读取经验文件。 */
export function createExperienceSearchTool(host: ExperienceToolHost) {
  return defineTool({
    name: 'experience_search',
    description: '按文件名读取经验文件内容。传入 INDEX.md 索引中的文件名（如 ["fix_junction_mount", "create_plugin"]），返回对应经验的完整内容。空数组时返回全部经验的摘要列表（不含正文）。',
    parameters: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: '要读取的经验名列表（不含 .md 后缀，如 ["fix_junction_mount"]）。空数组或省略时返回全部经验摘要。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
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
                date: { type: 'string' },
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
          ? '经验库中没有匹配的经验。'
          : `返回 ${value.count} 条经验：\n${value.matches.map(m => `- ${m.name} [${m.task_type}/${m.outcome}] ${m.summary}`).join('\n')}\n\n完整 Lessons 见结果 JSON。`,
      }],
    },
    async execute(args) {
      const all = await readAllEpisodes(host.experienceDirectory)
      const names = args.names ?? []
      if (names.length === 0) {
        // 空数组：返回全部摘要（不含正文）
        return {
          count: all.length,
          matches: all.map(record => toMatch(record)),
        }
      }
      // 有指定名称：精确匹配返回完整内容
      const wanted = new Set(names.map(n => n.endsWith('.md') ? n : `${n}.md`))
      const matches = all
        .filter(record => wanted.has(record.fileName))
        .map(record => toMatch(record))
      return { count: matches.length, matches }
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
