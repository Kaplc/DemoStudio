/**
 * 斜杠触发检测器
 * 扫描输入文本，识别触发字符和查询文本
 * 对标 DSH 的 detect.ts
 */

import type { TriggerHit } from './types'

const WORD_CHAR = /[\p{L}\p{N}_]/u
const WHITESPACE = /\s/u

/**
 * 边界检查：触发字符只能在特定位置触发
 * - 文档开头
 * - 空白字符后
 * - 标点符号后
 */
function boundaryOk(draft: string, index: number, char: string): boolean {
  if (index === 0) return true
  const prev = draft.charAt(index - 1)
  if (WHITESPACE.test(prev)) return true
  if (WORD_CHAR.test(prev)) return false

  // URL 中的 '/' 不触发
  if (char === '/') {
    if (prev === '/') return false  // '//' 不触发
    if (prev === ':') return false  // 'https://' 不触发
  }

  return true
}

/**
 * 检测光标位置的触发 token
 * @param draft 完整输入文本
 * @param caret 光标位置
 * @param guard 可用性层级
 * @returns 触发检测结果，无触发时返回 null
 */
export function detectTrigger(
  draft: string,
  caret: number,
  guard?: { tier: 'plain' | 'claimed' | 'frozen' }
): TriggerHit | null {
  if (guard?.tier === 'frozen') return null

  // 从光标位置向前扫描
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i)

    // 遇到空白停止
    if (WHITESPACE.test(ch)) return null

    // 只处理 '/' 触发字符
    if (ch !== '/') continue

    // claimed 模式下 '/' 被抑制
    if (guard?.tier === 'claimed') continue

    // 检查边界
    if (!boundaryOk(draft, i, ch)) continue

    // 计算位置类型
    const hasNonWhitespaceBefore = draft.slice(0, i).trim().length > 0
    const position: 'leading' | 'inline' = hasNonWhitespaceBefore ? 'inline' : 'leading'

    return {
      trigger: ch,
      query: draft.slice(i + 1, caret),
      position,
      span: { start: i, end: caret },
    }
  }

  return null
}

/**
 * 过滤候选命令
 * @param candidates 所有候选命令
 * @param query 查询文本
 * @returns 过滤后的候选命令
 */
export function filterCandidates<T extends { name: string }>(
  candidates: T[],
  query: string
): T[] {
  if (!query) return candidates
  const lowerQuery = query.toLowerCase()
  return candidates.filter(cmd =>
    cmd.name.toLowerCase().includes(lowerQuery)
  )
}
