/**
 * 损失信号存储：JSONL 追加 + 过滤读取 + 聚合摘要 + 会话健康分。
 *
 * 设计要点：
 * - **探针只记录不判定**（harness_no_llm_design）：信号由事件监听器零成本落盘，
 *   归因与是否产出梯度候选由主 agent 回合末复盘完成。
 * - 单文件 JSONL（`.dsh/loss/signals.jsonl`）追加写；超 2MB 压缩保留最近 1000 行。
 * - 健康分是**纯派生值**：`max(0, 100 − Σweight)`，窗口过滤由调用方完成；
 *   不落盘、不反写信号文件。
 *
 * @module lossStore
 */

import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 损失目录段（相对项目根），随 git 跟踪（与 .dsh/rules 同一跟踪决策）。 */
export const LOSS_DIR_SEGMENT = '.dsh/loss'

/** 信号文件名（损失目录内，JSONL）。 */
export const SIGNALS_FILE = 'signals.jsonl'

/** 损失信号类别。 */
export type LossSignalKind =
  | 'turn_error' // 回合异常结束（模型/网络/工具失败）
  | 'turn_aborted' // 回合被中止
  | 'retry' // 回合重试
  | 'steer_interrupt' // steer 打断（用户在运行中改向）
  | 'edit_resend' // 用户撤回编辑重发
  | 'correction_hint' // 纠正关键词预筛命中（疑似人工纠正）
  | 'rule_propose' // 显式规则提案（强信号：确属纠正）

/** 各类信号的默认权重（健康分扣减分值；梯度归因时的优先级参考）。 */
export const DEFAULT_WEIGHTS: Readonly<Record<LossSignalKind, number>> = {
  turn_error: 8,
  turn_aborted: 4,
  retry: 5,
  steer_interrupt: 3,
  edit_resend: 3,
  correction_hint: 3,
  rule_propose: 5,
}

/** 信号摘录字符上限。 */
export const MAX_EXCERPT_CHARS = 160

/** 信号文件压缩触发阈值（字节）。 */
export const MAX_SIGNALS_BYTES = 2_000_000

/** 压缩后保留的最近行数。 */
export const COMPACTION_KEEP_LINES = 1000

/** 一条损失信号（落盘行与读取结构同形）。 */
export interface LossSignal {
  /** 信号时间（epoch 毫秒）。 */
  ts: number
  /** 会话 id（无 id 时填 'unknown'）。 */
  sessionId: string
  /** 回合号（无法观测时填 0）。 */
  turn: number
  /** 信号类别。 */
  kind: LossSignalKind
  /** 权重（缺省取 DEFAULT_WEIGHTS[kind]）。 */
  weight: number
  /** 原话/事件摘录（可选；落盘时缺省键省略）。 */
  excerpt?: string
}

/** 裁掉摘录超长部分。 */
function clipExcerpt(excerpt: string | undefined): string | undefined {
  const trimmed = excerpt?.trim() ?? ''
  if (trimmed === '') return undefined
  return trimmed.length <= MAX_EXCERPT_CHARS ? trimmed : `${trimmed.slice(0, MAX_EXCERPT_CHARS - 1)}…`
}

/** 信号 → JSONL 行（excerpt 缺省时键省略，不用 undefined 值）。 */
export function renderSignalLine(signal: LossSignal): string {
  const excerpt = clipExcerpt(signal.excerpt)
  return JSON.stringify({
    ts: signal.ts,
    sessionId: signal.sessionId,
    turn: signal.turn,
    kind: signal.kind,
    weight: signal.weight,
    ...(excerpt === undefined ? {} : { excerpt }),
  })
}

/** 解析一行 JSONL；坏行返回 undefined（单行损坏不拖垮全量读取）。 */
export function parseSignalLine(line: string): LossSignal | undefined {
  const text = line.trim()
  if (text === '') return undefined
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (typeof raw.ts !== 'number' || typeof raw.kind !== 'string') return undefined
    const kind = raw.kind as LossSignalKind
    const weight = typeof raw.weight === 'number' ? raw.weight : DEFAULT_WEIGHTS[kind]
    if (weight === undefined) return undefined
    const sessionId = typeof raw.sessionId === 'string' && raw.sessionId !== '' ? raw.sessionId : 'unknown'
    return {
      ts: raw.ts,
      sessionId,
      turn: typeof raw.turn === 'number' ? raw.turn : 0,
      kind,
      weight,
      ...(typeof raw.excerpt === 'string' && raw.excerpt !== '' ? { excerpt: raw.excerpt } : {}),
    }
  } catch {
    return undefined
  }
}

function signalsFilePath(lossDirectory: string): string {
  return join(lossDirectory, SIGNALS_FILE)
}

/** 进程内写队列：串行化同进程的信号追加（保序 + 防并发 read-modify-write 竞态）。 */
let writeQueue: Promise<unknown> = Promise.resolve()

/** 追加一条信号；写前做同信号去重（同会话+同回合+同类别+同摘录 且间隔 <1s 视为重复写入）。 */
export function appendSignal(lossDirectory: string, input: Omit<LossSignal, 'weight'> & { weight?: number }): Promise<'appended' | 'deduped'> {
  const next = writeQueue.then(() => appendSignalInner(lossDirectory, input))
  // 队列吞掉错误避免断链（错误仍向调用方传播）
  writeQueue = next.catch(() => undefined)
  return next
}

async function appendSignalInner(lossDirectory: string, input: Omit<LossSignal, 'weight'> & { weight?: number }): Promise<'appended' | 'deduped'> {
  const weight = input.weight ?? DEFAULT_WEIGHTS[input.kind]
  const signal: LossSignal = {
    ts: input.ts,
    sessionId: input.sessionId,
    turn: input.turn,
    kind: input.kind,
    weight,
    ...(clipExcerpt(input.excerpt) === undefined ? {} : { excerpt: clipExcerpt(input.excerpt) }),
  }
  await mkdir(lossDirectory, { recursive: true })
  const filePath = signalsFilePath(lossDirectory)
  let lastLine = ''
  try {
    const existing = await readFile(filePath, 'utf8')
    const lines = existing.split('\n')
    lastLine = lines[lines.length - 2] ?? lines[lines.length - 1] ?? ''
    // 压缩检查：超阈值时重写保留最近 COMPACTION_KEEP_LINES 行
    if (Buffer.byteLength(existing, 'utf8') > MAX_SIGNALS_BYTES) {
      const kept = lines.filter(line => line.trim() !== '').slice(-COMPACTION_KEEP_LINES)
      await writeFile(filePath, `${kept.join('\n')}\n`, 'utf8')
    }
  } catch {
    // 文件不存在：首条信号
  }
  const previous = parseSignalLine(lastLine)
  if (
    previous !== undefined &&
    previous.sessionId === signal.sessionId &&
    previous.turn === signal.turn &&
    previous.kind === signal.kind &&
    previous.excerpt === signal.excerpt &&
    Math.abs(previous.ts - signal.ts) < 1_000
  ) {
    return 'deduped'
  }
  await appendFile(filePath, `${renderSignalLine(signal)}\n`, 'utf8')
  return 'appended'
}

/** 读取选项。 */
export interface ReadSignalsOptions {
  /** 只取该会话的信号。 */
  sessionId?: string
  /** 只取该时间戳之后的信号（含边界）。 */
  sinceTs?: number
}

/** 读取信号（坏行跳过；文件不存在返回 []）。 */
export async function readSignals(lossDirectory: string, options: ReadSignalsOptions = {}): Promise<LossSignal[]> {
  let text: string
  try {
    text = await readFile(signalsFilePath(lossDirectory), 'utf8')
  } catch {
    return []
  }
  const signals: LossSignal[] = []
  for (const line of text.split('\n')) {
    const signal = parseSignalLine(line)
    if (signal === undefined) continue
    if (options.sessionId !== undefined && signal.sessionId !== options.sessionId) continue
    if (options.sinceTs !== undefined && signal.ts < options.sinceTs) continue
    signals.push(signal)
  }
  return signals
}

/** 信号文件大小（字节；不存在返回 0）。 */
export async function signalsFileSize(lossDirectory: string): Promise<number> {
  try {
    return (await stat(signalsFilePath(lossDirectory))).size
  } catch {
    return 0
  }
}

/** 按类别计数的摘要。 */
export interface LossSummary {
  /** 总信号数。 */
  total: number
  /** 总扣减权重。 */
  totalWeight: number
  /** 各类别计数（只含有信号的类别）。 */
  byKind: Partial<Record<LossSignalKind, number>>
}

/** 聚合摘要（输入通常来自 readSignals 的窗口过滤结果）。 */
export function summarizeSignals(signals: readonly LossSignal[]): LossSummary {
  const byKind: Partial<Record<LossSignalKind, number>> = {}
  let totalWeight = 0
  for (const signal of signals) {
    byKind[signal.kind] = (byKind[signal.kind] ?? 0) + 1
    totalWeight += signal.weight
  }
  return { total: signals.length, totalWeight, byKind }
}

/**
 * 会话健康分：`max(0, 100 − Σweight)`。
 * 纯派生值——同一份信号任何消费方（插件/编辑器面板）计算结果一致。
 */
export function healthScore(signals: readonly LossSignal[]): number {
  let penalty = 0
  for (const signal of signals) penalty += signal.weight
  return Math.max(0, 100 - penalty)
}
