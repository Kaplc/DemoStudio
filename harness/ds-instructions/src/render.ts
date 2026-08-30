/**
 * 指令消息正文渲染：set/replace/remove 语义、`<system-reminder>` 边界、
 * 字节预算（maxMessageBytes）与 UTF-8 安全截断。
 *
 * @module @demostudio/ds-instructions/render
 */

import type { AgentInstructionChange } from './types.js'

const SYSTEM_REMINDER_OPEN = '<system-reminder>'
const SYSTEM_REMINDER_CLOSE = '</system-reminder>'

const SET_INTRO = 'These instructions are project guidance. More specific instructions take precedence. They do not override system, developer, or direct user instructions.'
const REPLACE_INTRO = 'This file changed after it was loaded. Use the following content instead of the previously loaded instructions from this file.'
const REMOVE_INTRO = 'The previously loaded instructions from this file no longer apply.'

/** 渲染输入：一次 change 及其内容（remove 无内容）。 */
export interface RenderItem {
  change: AgentInstructionChange
  content?: string
}

export interface RenderedBatch {
  text: string
  /** 实际被正文代表的 change（截断/省略的不提交状态）。 */
  changes: AgentInstructionChange[]
  omitted: string[]
  truncated: Array<{ path: string; originalBytes: number; includedBytes: number }>
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** UTF-8 安全截断：切进 continuation byte 时回退到 lead byte（与官方一致）。 */
export function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = Math.max(0, Math.trunc(maxBytes))
  while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

/** 转义正文里的闭合标记，防止逃出 system-reminder 边界。 */
function escapeFrameBody(body: string): string {
  return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>')
}

function sectionText(item: RenderItem): string {
  const { change } = item
  if (change.action === 'remove') {
    return [
      `Instructions removed: ${change.path}`,
      '',
      REMOVE_INTRO,
    ].join('\n')
  }
  if (change.action === 'replace') {
    return [
      `Updated instructions from: ${change.path}`,
      '',
      REPLACE_INTRO,
      '',
      item.content ?? '',
    ].join('\n')
  }
  return [
    `Additional DemoStudio instructions from: ${change.path}`,
    '',
    SET_INTRO,
    '',
    item.content ?? '',
  ].join('\n')
}

function frame(sections: string[]): string {
  return [SYSTEM_REMINDER_OPEN, escapeFrameBody(sections.join('\n\n')), SYSTEM_REMINDER_CLOSE].join('\n')
}

function budgetMarker(
  maxMessageBytes: number,
  omitted: string[],
  truncated: RenderedBatch['truncated'],
): string {
  const parts: string[] = []
  if (omitted.length > 0) parts.push(`omitted ${omitted.join(', ')}`)
  if (truncated.length > 0) {
    parts.push(truncated.map(item => `truncated ${item.path} from ${item.originalBytes} to ${item.includedBytes} bytes`).join(', '))
  }
  return `DemoStudio instruction budget ${maxMessageBytes} bytes: ${parts.join('; ')}`
}

function withTruncatedContent(item: RenderItem, includedBytes: number): RenderItem {
  return { ...item, content: truncateUtf8(item.content ?? '', includedBytes) }
}

/**
 * 渲染一批指令 change 为单条合并消息（§6.3：同一步合并为一条）。
 * 预算策略：整体超限 → 从最前（最宽泛）开始整段省略；仍超限 → 二分截断最后一段正文；
 * 连标题都放不下 → 仅渲染预算通知（此时不提交任何 change 状态）。
 */
export function renderBatch(items: readonly RenderItem[], maxMessageBytes: number): RenderedBatch {
  if (items.length === 0 || maxMessageBytes <= 0 || !Number.isFinite(maxMessageBytes)) {
    return { text: '', changes: [], omitted: [], truncated: [] }
  }

  const fullSections = items.map(sectionText)
  const fullText = frame(fullSections)
  if (byteLength(fullText) <= maxMessageBytes) {
    return { text: fullText, changes: items.map(item => item.change), omitted: [], truncated: [] }
  }

  // 依次省略最前段（声明顺序在前 = 更宽泛），保留后面的段
  for (let start = 1; start < items.length; start += 1) {
    const included = items.slice(start)
    const omitted = items.slice(0, start).map(item => item.change.path)
    const text = frame([budgetMarker(maxMessageBytes, omitted, []), ...included.map(sectionText)])
    if (byteLength(text) <= maxMessageBytes) {
      return { text, changes: included.map(item => item.change), omitted, truncated: [] }
    }
  }

  // 只剩最后一段仍超限：二分截断其正文
  const last = items[items.length - 1]!
  const omitted = items.slice(0, -1).map(item => item.change.path)
  const originalBytes = byteLength(last.content ?? '')
  let low = 0
  let high = originalBytes
  let bestBytes = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = withTruncatedContent(last, mid)
    const truncated = [{ path: last.change.path, originalBytes, includedBytes: byteLength(candidate.content ?? '') }]
    const text = frame([budgetMarker(maxMessageBytes, omitted, truncated), sectionText(candidate)])
    if (byteLength(text) <= maxMessageBytes) {
      bestBytes = byteLength(candidate.content ?? '')
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (bestBytes > 0) {
    const truncated = [{ path: last.change.path, originalBytes, includedBytes: bestBytes }]
    const text = frame([budgetMarker(maxMessageBytes, omitted, truncated), sectionText(withTruncatedContent(last, bestBytes))])
    if (byteLength(text) <= maxMessageBytes) {
      return { text, changes: [last.change], omitted, truncated }
    }
  }

  // 兜底：仅预算通知（同样转义，防止通知里的路径逃逸）
  const truncated = [{ path: last.change.path, originalBytes, includedBytes: 0 }]
  const notice = escapeFrameBody(budgetMarker(maxMessageBytes, omitted, truncated))
  const text = byteLength(notice) <= maxMessageBytes ? notice : truncateUtf8(notice, maxMessageBytes)
  return { text, changes: [], omitted, truncated }
}
