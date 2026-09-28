/**
 * 损失信号与梯度候选的纯解析/聚合层（编辑器侧）
 *
 * 数据源都是 `.dsh/` 下的本地文件，经 electronAPI.readTextFile/listDirFiles 读入，
 * 本模块只做纯文本 → 结构化的解析与健康分计算（与内核 ds-feedback 的 lossStore
 * 同公式：健康分 = max(0, 100 − Σweight)，两侧实现各自持有副本互不依赖）。
 *
 * @module lossSignals
 */

/** 一条损失信号（signals.jsonl 行，与内核 lossStore 落盘格式同构） */
export interface LossSignalEntry {
  ts: number
  sessionId: string
  turn: number
  kind: string
  weight: number
  excerpt?: string
}

/** 解析 signals.jsonl 文本（坏行跳过；文件缺失/空文本返回 []） */
export function parseSignalsFile(text: string | null | undefined): LossSignalEntry[] {
  if (!text) return []
  const signals: LossSignalEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof raw.ts !== 'number' || typeof raw.kind !== 'string') continue
      signals.push({
        ts: raw.ts,
        sessionId: typeof raw.sessionId === 'string' && raw.sessionId !== '' ? raw.sessionId : 'unknown',
        turn: typeof raw.turn === 'number' ? raw.turn : 0,
        kind: raw.kind,
        weight: typeof raw.weight === 'number' ? raw.weight : 0,
        ...(typeof raw.excerpt === 'string' && raw.excerpt !== '' ? { excerpt: raw.excerpt } : {}),
      })
    } catch {
      // 单行损坏不拖垮全量
    }
  }
  return signals
}

/**
 * 从 signals 文本计算每会话健康分：`max(0, 100 − Σweight)`（全会话历史，无时间窗）。
 * 无信号的会话不出现在结果里（面板侧"无徽标 = 无损失记录"）。
 */
export function computeHealthScores(text: string | null | undefined): Record<string, number> {
  const penalty = new Map<string, number>()
  for (const signal of parseSignalsFile(text)) {
    penalty.set(signal.sessionId, (penalty.get(signal.sessionId) ?? 0) + signal.weight)
  }
  const scores: Record<string, number> = {}
  for (const [sessionId, total] of penalty) {
    scores[sessionId] = Math.max(0, 100 - total)
  }
  return scores
}

/** 一条梯度候选（pending/*.proposed.md 解析结果） */
export interface GradientProposalEntry {
  name: string
  kind: string
  target: string
  delta: string
  evidence: string
  date: string
}

/**
 * 解析梯度候选文件全文（frontmatter 五键 + delta 正文）。
 * 解析失败返回 undefined（调用方按坏文件计数展示，不阻塞列表）。
 */
export function parseGradientProposalText(text: string | null | undefined): GradientProposalEntry | undefined {
  if (!text || !text.startsWith('---')) return undefined
  const lineBreak = text.indexOf('\n')
  const end = text.indexOf('\n---', lineBreak)
  if (lineBreak < 0 || end < 0) return undefined
  const fields: Record<string, string> = {}
  for (const line of text.slice(lineBreak + 1, end).split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0) fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
  }
  const name = fields['name'] ?? ''
  const kind = fields['kind'] ?? ''
  const delta = text.slice(end + 4).replace(/^\n+/, '').trim()
  if (name === '' || kind === '' || delta === '') return undefined
  return {
    name,
    kind,
    target: fields['target'] ?? '',
    delta,
    evidence: fields['evidence'] ?? '',
    date: fields['date'] ?? '',
  }
}

/** 一条梯度应用台账（applied.jsonl 行） */
export interface GradientLedgerRow {
  ts: number
  name: string
  kind: string
  target: string
  action: string
  deltaPreview: string
}

/** 解析台账 JSONL 文本（坏行跳过；返回按时间升序的原序） */
export function parseGradientLedgerText(text: string | null | undefined): GradientLedgerRow[] {
  if (!text) return []
  const rows: GradientLedgerRow[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof raw.ts !== 'number' || typeof raw.name !== 'string') continue
      rows.push({
        ts: raw.ts,
        name: raw.name,
        kind: typeof raw.kind === 'string' ? raw.kind : '',
        target: typeof raw.target === 'string' ? raw.target : '',
        action: typeof raw.action === 'string' ? raw.action : '',
        deltaPreview: typeof raw.deltaPreview === 'string' ? raw.deltaPreview : '',
      })
    } catch {
      // 单行损坏不拖垮全量
    }
  }
  return rows
}
