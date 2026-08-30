/**
 * 记忆新鲜度：纯函数年龄换算与警告文本。
 * 模型对原始 ISO 时间戳不敏感，"N days ago" 才能触发过期推理；
 * 负年龄（未来 mtime、时钟回拨）一律钳制为 0。
 *
 * @module memoryAge
 */

const DAY_MS = 86_400_000

/** 距 mtime 的整天数：0=今天、1=昨天、2+ 更早；未来 mtime 钳制为 0。 */
export function memoryAgeDays(mtimeMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - mtimeMs) / DAY_MS))
}

/** 人类可读年龄："today" / "yesterday" / "N days ago"。 */
export function memoryAge(mtimeMs: number, nowMs: number = Date.now()): string {
  const days = memoryAgeDays(mtimeMs, nowMs)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * 过期警告正文；≤1 天返回 ''（对新鲜记忆警告是噪音）。
 * 动机：过期的代码状态记忆（指向已变更代码的 file:line 引用）被当作事实断言时，
 * 引用的存在会让过期论断显得更权威而非更可疑，必须显式打断。
 */
export function memoryFreshnessText(mtimeMs: number, nowMs: number = Date.now()): string {
  const days = memoryAgeDays(mtimeMs, nowMs)
  if (days <= 1) return ''
  return `该记忆已保存 ${days} 天。记忆是时点观察而非实时状态 — 其中关于代码行为或 file:line 的引用可能已过期，作为事实断言前请先与当前代码核对。`
}
