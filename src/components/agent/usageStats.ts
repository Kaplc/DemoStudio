/**
 * 使用统计纯函数模块 —— Agent 面板 Token 消耗统计的数据聚合层。
 *
 * 数据源：session.list 行内投影（tokenUsage / sessionStats，零日志加载）。
 * 每个会话的全部用量按其「活跃日」（updatedAt 的本地日期）归属到天：
 * DSH 投影只提供整日志累计值，按事件逐条分桶需全量拉历史（278+ 会话不可承受），
 * 会话粒度归属是编辑器侧的确定性近似（面板上有口径说明）。
 *
 * 本模块保持框架无关（不 import React），供 UsageStatsPanel 与 vitest 直接消费。
 */
import type { SessionTokenUsage, SessionUsageEntry } from '../../types/agent'

/** 单日用量点（dateKey = 本地 YYYY-MM-DD） */
export interface DailyUsagePoint {
  dateKey: string
  /** 输入侧：未缓存输入 + cache 读 + cache 写 */
  input: number
  /** 输出侧：provider 输出（含 reasoning） */
  output: number
  total: number
  /** 当日活跃会话数 */
  sessions: number
}

/** 全量聚合（统计行数据） */
export interface UsageTotals {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  sessions: number
  turns: number
  /** 模型墙钟累计 ms */
  llmMs: number
}

/** 热力图单元格 */
export interface HeatmapCell {
  dateKey: string
  total: number
  /** 0=无数据 1-4=强度档位；future=未来日期（不渲染强度） */
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

/** 热力图（列=周，行=周一~周日） */
export interface HeatmapGrid {
  columns: HeatmapCell[][]
  /** 底部月份标签：col 列首日的月份与上一列不同时标注 */
  monthLabels: Array<{ col: number; label: string }>
  maxDayTotal: number
}

/** 四桶合计 token（DSH usageTokens 同口径：prompt 侧 + 输出） */
export function totalTokensOf(usage: SessionTokenUsage): number {
  return (usage.uncachedInputTokens ?? 0)
    + (usage.outputTokens ?? 0)
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
}

/** 输入侧 token（未缓存输入 + cache 流量） */
export function inputSideTokensOf(usage: SessionTokenUsage): number {
  return (usage.uncachedInputTokens ?? 0)
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
}

/** 本地日期键 YYYY-MM-DD（ts 缺失返回 null） */
export function dateKeyOf(ts: number | undefined): string | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 全量聚合：累计 token / 会话数 / 回合数 / 模型时长 */
export function aggregateUsage(entries: SessionUsageEntry[]): UsageTotals {
  const totals: UsageTotals = { totalTokens: 0, inputTokens: 0, outputTokens: 0, sessions: 0, turns: 0, llmMs: 0 }
  for (const e of entries) {
    totals.totalTokens += totalTokensOf(e.usage)
    totals.inputTokens += inputSideTokensOf(e.usage)
    totals.outputTokens += e.usage.outputTokens ?? 0
    totals.sessions += 1
    totals.turns += e.stats?.turns ?? 0
    totals.llmMs += e.stats?.llmMs ?? 0
  }
  return totals
}

/** 会话条目 → 按日分桶（从最早活跃日到 today 的连续序列，无条目返回 []） */
export function buildDailyUsage(entries: SessionUsageEntry[], todayTs: number): DailyUsagePoint[] {
  const byDay = new Map<string, DailyUsagePoint>()
  for (const e of entries) {
    const key = dateKeyOf(e.updatedAt)
    if (!key) continue
    let point = byDay.get(key)
    if (!point) {
      point = { dateKey: key, input: 0, output: 0, total: 0, sessions: 0 }
      byDay.set(key, point)
    }
    point.input += inputSideTokensOf(e.usage)
    point.output += e.usage.outputTokens ?? 0
    point.total += totalTokensOf(e.usage)
    point.sessions += 1
  }
  if (byDay.size === 0) return []
  // 连续日序列：从今天回溯到最早活跃日（YYYY-MM-DD 键可安全按字典序比较）
  const earliest = earliestKey(byDay)
  const today = new Date(todayTs)
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const result: DailyUsagePoint[] = []
  for (;;) {
    const key = dateKeyOf(cursor.getTime())!
    result.push(byDay.get(key) ?? { dateKey: key, input: 0, output: 0, total: 0, sessions: 0 })
    if (key <= earliest) break
    cursor.setDate(cursor.getDate() - 1)
    if (result.length > 3660) break // 10 年兜底
  }
  return result.reverse()
}

function earliestKey(byDay: Map<string, DailyUsagePoint>): string {
  let earliest = ''
  for (const key of byDay.keys()) {
    if (!earliest || key < earliest) earliest = key
  }
  return earliest
}

/** 连续活跃天数：current 从今天往回数（今天未活跃则从昨天起算，宽限 1 天）；longest 为窗口内最长连击 */
export function computeStreaks(points: DailyUsagePoint[]): { currentStreak: number; longestStreak: number } {
  const active = points.map(p => p.total > 0)
  const n = active.length
  if (n === 0) return { currentStreak: 0, longestStreak: 0 }
  // current：末位是今天。今天活跃 → 从末位起算；今天不活跃 → 跳过今天从昨天起算
  let currentStreak = 0
  let idx = n - 1
  if (!active[idx]) idx -= 1
  while (idx >= 0 && active[idx]) {
    currentStreak += 1
    idx -= 1
  }
  // longest：全窗口最长连续 true 段
  let longestStreak = 0
  let run = 0
  for (const a of active) {
    if (a) {
      run += 1
      if (run > longestStreak) longestStreak = run
    } else {
      run = 0
    }
  }
  return { currentStreak, longestStreak }
}

/** 强度档位：按单日最大值的四分位相对分档 */
export function heatmapLevel(total: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0 || max <= 0) return 0
  const r = total / max
  if (r < 0.25) return 1
  if (r < 0.5) return 2
  if (r < 0.75) return 3
  return 4
}

/** 近 weeks 周热力图（列=周，行=周一~周日；末列为本周，未来日期置 future） */
export function buildHeatmap(entries: SessionUsageEntry[], todayTs: number, weeks = 17): HeatmapGrid {
  const byDay = new Map<string, number>()
  let maxDayTotal = 0
  for (const e of entries) {
    const key = dateKeyOf(e.updatedAt)
    if (!key) continue
    const t = totalTokensOf(e.usage)
    const next = (byDay.get(key) ?? 0) + t
    byDay.set(key, next)
    if (next > maxDayTotal) maxDayTotal = next
  }
  // 起点 = 今天所在周往前推 (weeks-1) 周的周一
  const today = new Date(todayTs)
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const weekdayMon = (todayMid.getDay() + 6) % 7 // 周一=0
  const start = new Date(todayMid)
  start.setDate(start.getDate() - weekdayMon - (weeks - 1) * 7)
  const columns: HeatmapCell[][] = []
  const monthLabels: Array<{ col: number; label: string }> = []
  let prevMonth = -1
  for (let w = 0; w < weeks; w++) {
    const col: HeatmapCell[] = []
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(start)
      cellDate.setDate(start.getDate() + w * 7 + d)
      const key = dateKeyOf(cellDate.getTime())!
      const future = cellDate.getTime() > todayMid.getTime()
      const total = byDay.get(key) ?? 0
      col.push({ dateKey: key, total, level: future ? 0 : heatmapLevel(total, maxDayTotal), future })
    }
    // 月份标签：该列首日月份与上一列不同时标注（跳过首列首日为上月尾巴的正常情况：
    // 以列首日为准，首列不标）
    const firstDay = new Date(start)
    firstDay.setDate(start.getDate() + w * 7)
    const m = firstDay.getMonth()
    if (w > 0 && m !== prevMonth) monthLabels.push({ col: w, label: `${m + 1}月` })
    prevMonth = m
    columns.push(col)
  }
  return { columns, monthLabels, maxDayTotal }
}

/** 近 days 天趋势序列（零填充；末位=今天） */
export function buildTrendSeries(entries: SessionUsageEntry[], todayTs: number, days: number): DailyUsagePoint[] {
  const daily = buildDailyUsage(entries, todayTs)
  const byDay = new Map(daily.map(p => [p.dateKey, p]))
  const today = new Date(todayTs)
  const result: DailyUsagePoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    d.setDate(d.getDate() - i)
    const key = dateKeyOf(d.getTime())!
    result.push(byDay.get(key) ?? { dateKey: key, input: 0, output: 0, total: 0, sessions: 0 })
  }
  return result
}

/** 折线 SVG path（viewBox 100×40 纵向自适应；max<=0 时平线贴底） */
export function linePath(values: number[], maxValue: number): string {
  const n = values.length
  if (n === 0) return ''
  if (n === 1) return 'M0,38 L100,38'
  const toY = (v: number): number => {
    if (maxValue <= 0) return 38
    return 40 - 2 - (v / maxValue) * 36
  }
  return values
    .map((v, i) => {
      const x = (i / (n - 1)) * 100
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${toY(v).toFixed(2)}`
    })
    .join(' ')
}

/** token 数中文格式化：≥1亿 → x.x亿；≥1万 → x.x万；其余原值（对齐参考稿口径） */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const trim = (v: number): string => {
    const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (n >= 1e8) return `${trim(n / 1e8)}亿`
  if (n >= 1e4) return `${trim(n / 1e4)}万`
  return Math.round(n).toString()
}

/** 墙钟时长格式化：x小时x分钟 / x分钟 / x秒 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 秒'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec} 秒`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) return `${totalMin} 分钟`
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
}
