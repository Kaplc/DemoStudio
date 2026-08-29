/**
 * AI 选择器：扫描记忆清单后用 side-query（小模型）选出与查询最相关的记忆。
 * 走 ctx.llm 的 provider-neutral 流式通道；输出按严格 JSON 解析，
 * 只接受清单内文件名；失败/中止静默返回空数组并 warn（不阻塞主对话）。
 *
 * @module selectMemories
 */

import { readFile } from 'node:fs/promises'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { memoryFreshnessText } from './memoryAge.js'
import { formatMemoryManifest, scanMemoryFiles } from './memoryScan.js'
import type { MemoryHeader } from './memoryScan.js'
import {
  MAX_MEMORY_CONTENT_CHARS,
  MAX_SELECTED,
  PLUGIN_NAME,
  SELECT_MAX_TOKENS,
  SELECT_TIMEOUT_MS,
  parseFrontmatter,
} from './memoryTypes.js'

/** 选择器 system prompt（设计参考 Claude Code 记忆选择器，按本项目语境重写）。 */
const SELECT_SYSTEM_PROMPT = `你从一份持久记忆清单中为 AI agent 挑选对处理当前用户请求有用的记忆。你会拿到用户请求和一份可选记忆清单（文件名 + 类型 + 描述）。

返回对处理该请求明确有用的记忆文件名列表（最多 ${MAX_SELECTED} 个）。只列你确信有帮助的记忆：
- 不确定是否有用的，一律不选，宁缺毋滥。
- 清单中没有明确有用的记忆时，返回空列表是完全正常的。
- 工具用法/API 文档类记忆仅在当前请求明显涉及对应主题时才选；警告、坑、已知问题类记忆则应优先选。`

/** 一次检索的配置。 */
export interface SelectOptions {
  /** 查询文本（通常是当前用户消息）。 */
  query: string
  /** 已注入过的记忆文件名 — 选择器排除，避免重复占用名额。 */
  alreadySurfaced?: ReadonlySet<string>
  /** 选择器模型路由。 */
  selectProvider: string
  selectModel: string
  signal?: AbortSignal
}

/** 选择器输出（严格 JSON）。 */
interface SelectorOutput {
  selected_memories?: unknown
}

/**
 * 检索相关记忆：扫描（排除 alreadySurfaced / MEMORY.md）→ side-query 选择 → 校验映射。
 * 返回选中的记忆头部（≤ MAX_SELECTED），附其 mtime 以便新鲜度标注。
 * 空目录、空清单、选择失败一律返回 []。
 */
export async function findRelevantMemories(
  ctx: Context,
  memoryDirectory: string,
  options: SelectOptions,
): Promise<MemoryHeader[]> {
  const scanned = await scanMemoryFiles(memoryDirectory, options.signal)
  const candidates = scanned.filter(
    memory => options.alreadySurfaced === undefined || !options.alreadySurfaced.has(memory.filename),
  )
  if (candidates.length === 0) return []
  const selectedNames = await selectRelevantMemories(ctx, options.query, candidates, options)
  const byFilename = new Map(candidates.map(memory => [memory.filename, memory]))
  return selectedNames
    .flatMap(name => {
      const memory = byFilename.get(name)
      return memory === undefined ? [] : [memory]
    })
    .slice(0, MAX_SELECTED)
}

/** side-query 调用与输出校验；任何失败返回 []（warn 日志）。 */
async function selectRelevantMemories(
  ctx: Context,
  query: string,
  memories: readonly MemoryHeader[],
  options: SelectOptions,
): Promise<string[]> {
  const validNames = new Set(memories.map(memory => memory.filename))
  const framed = `用户请求：${query}\n\n可选记忆清单：\n${formatMemoryManifest(memories)}\n\n只输出一个 JSON 对象：{"selected_memories": ["文件名", ...]}（最多 ${MAX_SELECTED} 个，可为空数组），不要输出任何其他文字。`
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
  using callDeadline = deadline(options.signal, SELECT_TIMEOUT_MS, 'MEMORY_SELECT_TIMEOUT')
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
      ctx.logger?.warn('dsh-memory: 选择器输出不是合法 JSON，忽略本次检索')
      return []
    }
    return parsed.filter(name => validNames.has(name))
  } catch (error: unknown) {
    if (options.signal?.aborted) return []
    ctx.logger?.warn('dsh-memory: AI 选择器调用失败，本次不注入记忆', error)
    return []
  }
}

/** 宽容解析模型输出：截取首个 {...} 块做 JSON.parse，校验 selected_memories 为字符串数组。 */
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
  if (!Array.isArray(parsed.selected_memories)) return undefined
  return parsed.selected_memories.filter((name): name is string => typeof name === 'string')
}

/** 读取选中记忆的完整正文（限长），组装注入文本（FR-3 / FR-5）。 */
export async function renderSelectedMemories(selected: readonly MemoryHeader[]): Promise<string> {
  const parts: string[] = [
    '以下是持久记忆库中与当前请求相关的记忆。记忆可能过期，使用前与当前状态核对；与当前事实冲突时信当前事实，并更新或删除旧记忆。',
  ]
  for (const memory of selected) {
    let raw: string
    try {
      raw = await readFile(memory.filePath, 'utf8')
    } catch {
      continue
    }
    const { body } = parseFrontmatter(raw)
    const clipped = body.length > MAX_MEMORY_CONTENT_CHARS
      ? `${body.slice(0, MAX_MEMORY_CONTENT_CHARS)}\n[...记忆过长已截断，可用 memory_search 查看完整内容]`
      : body
    const freshness = memoryFreshnessText(memory.mtimeMs)
    parts.push(
      `<memory file="${memory.filename}" type="${memory.type ?? 'unknown'}" saved="${new Date(memory.mtimeMs).toISOString()}">\n${clipped.trim()}\n</memory>${
        freshness === '' ? '' : `\n[新鲜度] ${freshness}`}`,
    )
  }
  return parts.join('\n\n')
}
