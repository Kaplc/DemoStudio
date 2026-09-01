/**
 * 经验提炼：完整提炼（extractFromSession）。
 * 用户确认后由 experience_save 工具调用，或由主 agent 自觉调用 experience_save。
 *
 * @module extractExperience
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import {
  EXTRACT_MAX_TOKENS,
  EXTRACT_TIMEOUT_MS,
  EXPERIENCE_INDEX_FILE,
  PLUGIN_NAME,
  normalizeEpisodeName,
} from './experienceTypes.js'
import { saveExperience } from './experienceStore.js'

// ---------------------------------------------------------------------------
// 完整提炼（extractFromSession）
// ---------------------------------------------------------------------------

/** 完整提炼的 system prompt：提炼 episode。 */
export const EXTRACT_SYSTEM_PROMPT = `你在为 DemoStudio（一个对标 UE 架构的 2D 游戏引擎 + Electron 编辑器，TypeScript 全栈）的开发助手维护经验库（做事轨迹，冷通道）。你会拿到一段回合转录（用户消息、助手回复、工具调用）和现有经验索引。

请提炼 1 条 episode：这个任务是怎么做的、什么有效、踩了什么坑、下次怎么办。
- 与现有经验索引重复（同一任务已有 episode 覆盖且无实质新增）时不要输出（宁缺毋滥）。
- 经验是"做事轨迹"，不要写事实/规则（那是记忆系统的职责）。

只输出一个严格 JSON 对象，不要输出任何其他文字：
- 无新增：{"episode": null}
- 有新增：{"episode": {"name": "小写下划线名（如 fix_junction_mount）", "task_type": "任务类型短语（如 build-fix/feature/refactor/debug）", "outcome": "success|partial|failure", "summary": "一句话概述：什么任务、怎么做的", "lessons": "学到什么：有效路径、踩的坑、下次怎么办", "effective_path": "有效落点（可选，没有就省略）"}}`

/** 提炼候选（提炼模型输出，经校验后落盘）。 */
export interface ExtractedEpisode {
  name: string
  task_type: string
  outcome: 'success' | 'partial' | 'failure'
  summary: string
  lessons: string
  effective_path?: string
}

/** 提炼模型输出（严格 JSON）。 */
interface ExtractionOutput {
  episode?: unknown
}

/**
 * 宽容解析提炼输出：截取首个 {...} 块，校验 episode 字段。
 * @returns undefined=输出不合法（视为失败）；null=无新增（成功，不落盘）；
 *          ExtractedEpisode=提炼出一条任务轨迹。
 */
export function parseExtractionOutput(text: string): ExtractedEpisode | null | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: ExtractionOutput
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as ExtractionOutput
  } catch {
    return undefined
  }
  if (parsed.episode === null) return null
  if (parsed.episode === undefined || typeof parsed.episode !== 'object') return undefined
  const raw = parsed.episode as Record<string, unknown>
  if (typeof raw.name !== 'string' || typeof raw.task_type !== 'string'
    || typeof raw.summary !== 'string' || typeof raw.lessons !== 'string'
    || raw.task_type.trim() === '' || raw.summary.trim() === '' || raw.lessons.trim() === '') {
    return undefined
  }
  const outcome = raw.outcome === 'partial' || raw.outcome === 'failure' ? raw.outcome : 'success'
  try {
    return {
      name: normalizeEpisodeName(raw.name),
      task_type: raw.task_type.trim(),
      outcome,
      summary: raw.summary.trim(),
      lessons: raw.lessons.trim(),
      ...(typeof raw.effective_path === 'string' && raw.effective_path.trim() !== ''
        ? { effective_path: raw.effective_path.trim() }
        : {}),
    }
  } catch {
    return undefined
  }
}

/** 一次提炼的执行环境。 */
export interface ExtractOptions {
  /** 提炼模型路由。 */
  provider: string
  model: string
}

export interface ExtractResult {
  /** 是否成功跑完。 */
  ok: boolean
  /** 本次保存的 episode 文件名。 */
  saved: string[]
  /** 其中覆盖（同名改写）的已有 episode。 */
  updated: string[]
}

/**
 * 执行完整提炼：side-query 提炼 episode → 落盘。
 * 任何失败返回 ok:false，绝不抛出。
 */
export async function extractFromSession(
  ctx: Context,
  experienceDirectory: string,
  transcript: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  try {
    // 现有索引供提炼模型去重；索引失败不阻塞提炼
    let manifest = ''
    try {
      manifest = await readFile(join(experienceDirectory, EXPERIENCE_INDEX_FILE), 'utf8')
    } catch {
      manifest = ''
    }
    const framed = `回合转录：\n${transcript}\n\n现有经验索引：\n${manifest.trim() === '' ? '（空）' : manifest}\n\n按系统指令判断并只输出严格 JSON。`
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: framed }],
      source: { kind: 'plugin', plugin: PLUGIN_NAME },
    })]
    const request: GenerateOptions = deepFreeze({
      provider: options.provider,
      model: options.model,
      messages,
      system: EXTRACT_SYSTEM_PROMPT,
      maxTokens: EXTRACT_MAX_TOKENS,
    })
    using callDeadline = deadline(undefined, EXTRACT_TIMEOUT_MS, 'EXPERIENCE_EXTRACT_TIMEOUT')
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(request)) {
      callDeadline.signal.throwIfAborted()
      assembler.push(chunk)
    }
    if (assembler.finish.kind !== 'stop') {
      ctx.logger?.warn(`ds-experience: 提炼模型异常结束（${assembler.finish.kind}），本次跳过`)
      return { ok: false, saved: [], updated: [] }
    }
    const text = assembler.blocks()
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(' ')
    const parsed = parseExtractionOutput(text)
    if (parsed === undefined) {
      ctx.logger?.warn('ds-experience: 提炼输出不是合法 JSON，本次跳过')
      return { ok: false, saved: [], updated: [] }
    }
    if (parsed === null) {
      ctx.logger?.info('ds-experience: 提炼判定无新增经验')
      return { ok: true, saved: [], updated: [] }
    }
    const result = await saveExperience(experienceDirectory, {
      name: parsed.name,
      taskType: parsed.task_type,
      outcome: parsed.outcome,
      summary: parsed.summary,
      lessons: parsed.lessons,
      ...(parsed.effective_path === undefined ? {} : { effectivePath: parsed.effective_path }),
    })
    ctx.logger?.info(`ds-experience: 提炼 episode ${result.fileName}（${result.status}，task_type=${parsed.task_type}，outcome=${parsed.outcome}）`)
    return {
      ok: true,
      saved: [result.fileName],
      updated: result.status === 'updated' ? [result.fileName] : [],
    }
  } catch (error: unknown) {
    ctx.logger?.warn('ds-experience: 提炼失败', error)
    return { ok: false, saved: [], updated: [] }
  }
}
