/**
 * 回合末后台提取（形态二）：agent 空闲后由小任务读取本回合转录，
 * 用 side-query 判断是否有值得跨会话记住的信息，命中则由插件直接落盘。
 * 主对话零干扰；无新回合、空转录、调用失败都静默跳过。
 *
 * @module extractMemories
 */

import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { formatMemoryManifest, scanMemoryFiles } from './memoryScan.js'
import type { MemoryHeader } from './memoryScan.js'
import {
  EXTRACT_MAX_PER_PASS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_TIMEOUT_MS,
  MAX_EXTRACT_MESSAGE_CHARS,
  MAX_EXTRACT_TOOL_ARGS_CHARS,
  MAX_EXTRACT_TRANSCRIPT_CHARS,
  PLUGIN_NAME,
  normalizeMemoryName,
  parseMemoryType,
} from './memoryTypes.js'
import type { MemoryType } from './memoryTypes.js'
import { writeMemory } from './memoryStore.js'

/** 提取候选（提取模型输出，经校验后落盘）。 */
export interface ExtractedMemory {
  name: string
  type: MemoryType
  description: string
  content: string
}

/** 提取模型输出（严格 JSON）。 */
interface ExtractionOutput {
  memories?: unknown
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * 从会话事件流渲染指定回合范围（> watermark）的转录。
 * 只保留：真实用户消息、助手文本、工具调用（名称 + 截断参数）；
 * 插件注入、工具结果、chunk 等一律跳过。总长超过上限即截断并标注。
 * @returns 转录文本与本次扫描看到的最大回合号（无新内容时 maxTurn = watermark）。
 */
export function renderTurnTranscript(
  events: readonly SessionEvent[],
  watermark: number,
): { transcript: string; maxTurn: number } {
  const parts: string[] = []
  let total = 0
  let currentTurn = 0
  let maxTurn = watermark
  let clipped = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      currentTurn = event.data.turn
      if (currentTurn > maxTurn) maxTurn = currentTurn
      continue
    }
    if (currentTurn <= watermark) continue
    let line: string | undefined
    if (event.type === 'user/message') {
      // 只取真实用户输入；插件注入（recall/notice）与工具结果消息不计入提取语料
      if (event.data.source.kind !== 'user') continue
      line = `[用户] ${clip(textOf(event.data.content), MAX_EXTRACT_MESSAGE_CHARS)}`
    } else if (event.type === 'assistant/message') {
      line = `[助手] ${clip(textOf(event.data.message.content), MAX_EXTRACT_MESSAGE_CHARS)}`
    } else if (event.type === 'tool/call') {
      line = `[调用工具 ${event.data.name}] ${clip(event.data.arguments, MAX_EXTRACT_TOOL_ARGS_CHARS)}`
    } else {
      continue
    }
    if (total + line.length > MAX_EXTRACT_TRANSCRIPT_CHARS) {
      clipped = true
      break
    }
    parts.push(line)
    total += line.length
  }
  if (parts.length === 0) return { transcript: '', maxTurn }
  return {
    transcript: parts.join('\n') + (clipped ? '\n[...转录过长已截断]' : ''),
    maxTurn,
  }
}

/** 宽容解析提取输出：截取首个 {...} 块，逐条校验（非法名/类型/空字段丢弃），上限 {@link EXTRACT_MAX_PER_PASS}。 */
export function parseExtractionOutput(text: string): ExtractedMemory[] | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: ExtractionOutput
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as ExtractionOutput
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed.memories)) return undefined
  const extracted: ExtractedMemory[] = []
  for (const raw of parsed.memories) {
    if (extracted.length >= EXTRACT_MAX_PER_PASS) break
    if (raw === null || typeof raw !== 'object') continue
    const candidate = raw as { name?: unknown; type?: unknown; description?: unknown; content?: unknown }
    if (typeof candidate.name !== 'string' || typeof candidate.description !== 'string'
      || typeof candidate.content !== 'string' || candidate.description.trim() === ''
      || candidate.content.trim() === '') continue
    const type = parseMemoryType(candidate.type)
    if (type === undefined) continue
    try {
      extracted.push({
        name: normalizeMemoryName(candidate.name),
        type,
        description: candidate.description.trim(),
        content: candidate.content.trim(),
      })
    } catch {
      // 名字不合法：丢弃该条
    }
  }
  return extracted
}

/** 一次提取的执行环境。 */
export interface ExtractOptions {
  /** 已提取到的回合号（含）；本次只处理 > watermark 的回合。 */
  watermark: number
  /** 提取模型路由；undefined 时回退 selectProvider/selectModel。 */
  overrideProvider?: string
  overrideModel?: string
  fallbackProvider: string
  fallbackModel: string
}

export interface ExtractResult {
  /** 是否成功跑完（失败不推进水位）。 */
  ok: boolean
  /** 本次扫描到的最大回合号（成功时即新水位）。 */
  maxTurn: number
  /** 本次保存的记忆文件名。 */
  saved: string[]
  /** 其中覆盖（去重改写）的已有记忆文件名——保存 notice 的异常信号之一。 */
  updated: string[]
}

/**
 * 保存 notice 门控：常规新建静默，仅异常情况打扰模型——
 * 覆盖了已有记忆（原内容被替换），或单次保存数达到单轮上限（提取在倾倒）。
 */
export function shouldNotifySaved(result: Pick<ExtractResult, 'saved' | 'updated'>): boolean {
  return result.updated.length > 0 || result.saved.length >= EXTRACT_MAX_PER_PASS
}

/**
 * 执行一次回合末提取：渲染转录 → side-query 判断 → 落盘 → 注入 notice。
 * 任何失败返回 ok:false（水位不推进，下次空闲重试），绝不抛出。
 */
export async function extractFromSession(
  ctx: Context,
  session: Session,
  memoryDirectory: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const { transcript, maxTurn } = renderTurnTranscript(session.events, options.watermark)
  if (maxTurn <= options.watermark || transcript === '') {
    return { ok: true, maxTurn: Math.max(maxTurn, options.watermark), saved: [], updated: [] }
  }
  const provider = options.overrideProvider ?? options.fallbackProvider
  const model = options.overrideModel ?? options.fallbackModel
  try {
    // 现有清单供提取模型去重；清单失败不阻塞提取（退化后由 store 的写入去重兜底）
    let manifest = ''
    try {
      const headers: MemoryHeader[] = await scanMemoryFiles(memoryDirectory)
      manifest = formatMemoryManifest(headers)
    } catch {
      manifest = ''
    }
    const framed = `回合转录：\n${transcript}\n\n现有记忆清单：\n${manifest === '' ? '（空）' : manifest}\n\n按系统指令判断并只输出严格 JSON。`
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: framed }],
      source: { kind: 'plugin', plugin: PLUGIN_NAME },
    })]
    const request: GenerateOptions = deepFreeze({
      provider,
      model,
      messages,
      system: EXTRACT_SYSTEM_PROMPT,
      maxTokens: EXTRACT_MAX_TOKENS,
    })
    using callDeadline = deadline(undefined, EXTRACT_TIMEOUT_MS, 'MEMORY_EXTRACT_TIMEOUT')
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(request)) {
      callDeadline.signal.throwIfAborted()
      assembler.push(chunk)
    }
    if (assembler.finish.kind !== 'stop') {
      ctx.logger?.warn(`ds-memory: 提取模型异常结束（${assembler.finish.kind}），本次跳过`)
      return { ok: false, maxTurn: options.watermark, saved: [], updated: [] }
    }
    const text = assembler.blocks()
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(' ')
    const parsed = parseExtractionOutput(text)
    if (parsed === undefined) {
      ctx.logger?.warn('ds-memory: 提取输出不是合法 JSON，本次跳过')
      return { ok: false, maxTurn: options.watermark, saved: [], updated: [] }
    }
    const saved: string[] = []
    const updated: string[] = []
    for (const memory of parsed) {
      try {
        const result = await writeMemory(memoryDirectory, {
          name: memory.name,
          content: memory.content,
          type: memory.type,
          description: memory.description,
        })
        saved.push(result.fileName)
        if (result.status === 'updated') updated.push(result.fileName)
      } catch (error: unknown) {
        ctx.logger?.warn('ds-memory: 提取记忆落盘失败', error)
      }
    }
    return { ok: true, maxTurn, saved, updated }
  } catch (error: unknown) {
    ctx.logger?.warn('ds-memory: 后台提取失败，下次空闲重试', error)
    return { ok: false, maxTurn: options.watermark, saved: [], updated: [] }
  }
}
