import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendSignal,
  readSignals,
  summarizeSignals,
  healthScore,
  renderSignalLine,
  parseSignalLine,
  signalsFileSize,
  DEFAULT_WEIGHTS,
  MAX_SIGNALS_BYTES,
} from '../src/lossStore.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-loss-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const base = (overrides: Partial<{ ts: number; sessionId: string; turn: number; kind: string; excerpt: string; weight: number }> = {}) => ({
  ts: 1_760_000_000_000,
  sessionId: 'sess-a',
  turn: 3,
  kind: 'turn_error',
  ...overrides,
} as Parameters<typeof appendSignal>[1])

describe('lossStore', () => {
  it('追加信号并读回（excerpt 缺省键省略）', async () => {
    const result = await appendSignal(dir, base())
    expect(result).toBe('appended')
    const withExcerpt = await appendSignal(dir, base({ ts: 1_760_000_000_001, turn: 4, excerpt: '  连接超时  ' }))
    expect(withExcerpt).toBe('appended')
    const signals = await readSignals(dir)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toEqual({ ts: 1_760_000_000_000, sessionId: 'sess-a', turn: 3, kind: 'turn_error', weight: DEFAULT_WEIGHTS.turn_error })
    expect('excerpt' in signals[0]).toBe(false)
    expect(signals[1].excerpt).toBe('连接超时')
  })

  it('权重缺省取 DEFAULT_WEIGHTS，显式覆盖生效', async () => {
    await appendSignal(dir, base({ kind: 'correction_hint' }))
    await appendSignal(dir, base({ kind: 'correction_hint', weight: 9, ts: 1_760_000_000_002, turn: 5 }))
    const signals = await readSignals(dir)
    expect(signals[0].weight).toBe(DEFAULT_WEIGHTS.correction_hint)
    expect(signals[1].weight).toBe(9)
  })

  it('同信号 1 秒内重复写入去重', async () => {
    const first = await appendSignal(dir, base({ excerpt: 'boom' }))
    const second = await appendSignal(dir, base({ excerpt: 'boom', ts: 1_760_000_000_500 }))
    expect(first).toBe('appended')
    expect(second).toBe('deduped')
    expect(await readSignals(dir)).toHaveLength(1)
  })

  it('按 sessionId 与 sinceTs 过滤', async () => {
    await appendSignal(dir, base())
    await appendSignal(dir, base({ sessionId: 'sess-b', turn: 1 }))
    await appendSignal(dir, base({ ts: 1_760_000_100_000, turn: 9 }))
    const onlyA = await readSignals(dir, { sessionId: 'sess-a' })
    expect(onlyA).toHaveLength(2)
    const recent = await readSignals(dir, { sinceTs: 1_760_000_100_000 })
    expect(recent).toHaveLength(1)
    expect(recent[0]?.turn).toBe(9)
  })

  it('坏行跳过不抛错', async () => {
    await appendSignal(dir, base())
    const file = join(dir, 'signals.jsonl')
    const existing = await readFile(file, 'utf8')
    await writeFile(file, `{broken json\n${existing}`, 'utf8')
    expect(await readSignals(dir)).toHaveLength(1)
    expect(parseSignalLine('')).toBeUndefined()
    expect(parseSignalLine('{"ts":"x","kind":"retry"}')).toBeUndefined()
    expect(parseSignalLine('{"ts":1,"kind":"unknown_kind"}')).toBeUndefined()
  })

  it('健康分：100 起步、按权重扣减、下限 0', () => {
    expect(healthScore([])).toBe(100)
    expect(healthScore([{ ts: 1, sessionId: 's', turn: 1, kind: 'retry', weight: 5 }])).toBe(95)
    const heavy = Array.from({ length: 30 }, (_, i) => ({ ts: i, sessionId: 's', turn: i, kind: 'turn_error' as const, weight: 8 }))
    expect(healthScore(heavy)).toBe(0)
  })

  it('摘要按类别计数', () => {
    const summary = summarizeSignals([
      { ts: 1, sessionId: 's', turn: 1, kind: 'retry', weight: 5 },
      { ts: 2, sessionId: 's', turn: 2, kind: 'retry', weight: 5 },
      { ts: 3, sessionId: 's', turn: 3, kind: 'turn_error', weight: 8 },
    ])
    expect(summary.total).toBe(3)
    expect(summary.totalWeight).toBe(18)
    expect(summary.byKind).toEqual({ retry: 2, turn_error: 1 })
  })

  it('render/parse 无损往返且 excerpt 缺省无 undefined 键', () => {
    const line = renderSignalLine({ ts: 1, sessionId: 's', turn: 2, kind: 'retry', weight: 5 })
    expect(line).not.toContain('undefined')
    const parsed = parseSignalLine(line)
    expect(parsed).toEqual({ ts: 1, sessionId: 's', turn: 2, kind: 'retry', weight: 5 })
    expect(JSON.parse(JSON.stringify(parsed))).toStrictEqual(parsed)
  })

  it('超 2MB 压缩保留最近 1000 行', async () => {
    const pad = 'x'.repeat(200)
    const lines = Array.from({ length: 12_000 }, (_, i) => `${JSON.stringify({ ts: i, sessionId: 's', turn: i, kind: 'retry', weight: 1, excerpt: pad })}`)
    await writeFile(join(dir, 'signals.jsonl'), lines.join('\n'), 'utf8')
    const before = await stat(join(dir, 'signals.jsonl'))
    expect(before.size).toBeGreaterThan(MAX_SIGNALS_BYTES)
    await appendSignal(dir, base({ ts: 99_999_999, turn: 999 }))
    const after = await stat(join(dir, 'signals.jsonl'))
    expect(after.size).toBeLessThan(MAX_SIGNALS_BYTES)
    const signals = await readSignals(dir)
    expect(signals).toHaveLength(1001)
    expect(signals[signals.length - 1]?.turn).toBe(999)
    expect(await signalsFileSize(dir)).toBe(after.size)
  })
})
