/**
 * 经验提炼：完整提炼（extractFromSession）。
 * 用户确认后由 experience_save 工具调用，或由主 agent 自觉调用 experience_save。
 *
 * @module extractExperience
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  normalizeEpisodeName,
} from './experienceTypes.js'

// ---------------------------------------------------------------------------
// 完整提炼（extractFromSession）
// ---------------------------------------------------------------------------

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
 *
 * 注意：此函数已被禁用，不再调用 LLM。经验保存完全由主 agent 自觉调用 experience_save 工具完成。
 */
export async function extractFromSession(
  _ctx: Context,
  _experienceDirectory: string,
  _transcript: string,
  _options: ExtractOptions,
): Promise<ExtractResult> {
  // 此功能已被禁用，不再调用 LLM
  _ctx.logger?.info('ds-experience: extractFromSession 已被禁用，经验保存由主 agent 自觉调用 experience_save 工具完成')
  return { ok: true, saved: [], updated: [] }
}
