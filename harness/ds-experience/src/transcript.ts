/**
 * 会话转录渲染：从会话事件流渲染任务转录（真实用户消息 + 助手文本 + 工具调用）。
 * 与 ds-memory renderTurnTranscript 同语义：插件注入、工具结果、chunk 等一律跳过。
 * history_read（全量回放）与回合末自动提炼（水位增量）共用。
 *
 * @module transcript
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_MESSAGE_CHARS,
  MAX_TRANSCRIPT_TOOL_ARGS_CHARS,
} from './experienceTypes.js'

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

/** 渲染选项。 */
export interface TranscriptOptions {
  /** 已渲染到的回合号（含）；只渲染 > watermark 的回合。history_read 传 0。 */
  watermark?: number
  /** 总字符上限；缺省 DEFAULT_TRANSCRIPT_CHARS。 */
  maxChars?: number
}

/**
 * 从会话事件流渲染任务转录。
 * @returns 转录文本与本次扫描看到的最大回合号（无新内容时 maxTurn = watermark）。
 */
export function renderTurnTranscript(
  events: readonly SessionEvent[],
  options: TranscriptOptions = {},
): { transcript: string; maxTurn: number } {
  const watermark = options.watermark ?? 0
  const maxChars = options.maxChars ?? DEFAULT_TRANSCRIPT_CHARS
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
      // 只取真实用户输入；插件注入（recall/notice）与工具结果消息不计入转录
      if (event.data.source.kind !== 'user') continue
      line = `[用户] ${clip(textOf(event.data.content), MAX_TRANSCRIPT_MESSAGE_CHARS)}`
    } else if (event.type === 'assistant/message') {
      line = `[助手] ${clip(textOf(event.data.message.content), MAX_TRANSCRIPT_MESSAGE_CHARS)}`
    } else if (event.type === 'tool/call') {
      line = `[调用工具 ${event.data.name}] ${clip(event.data.arguments, MAX_TRANSCRIPT_TOOL_ARGS_CHARS)}`
    } else {
      continue
    }
    if (total + line.length > maxChars) {
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

/** 类型再导出（extractExperience 复用 Message 形态）。 */
export type { Message }
