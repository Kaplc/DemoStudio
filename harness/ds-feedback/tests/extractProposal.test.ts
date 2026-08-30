import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CORRECTION_HINT_PATTERN, diagnoseFromSession, parseDiagnoseOutput } from '../src/extractProposal.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-extract-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ev(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

const userMsg = (text: string) => ev('user/message', createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
}))

const assistantMsg = (turn: number, text: string) => ev('assistant/message', {
  turn, step: 1,
  message: { role: 'assistant', id: 'a', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
})

/** 带纠正的任务回合（用户否定做法并给出正确做法）。 */
function correctionEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }),
    userMsg('不对，移动判定必须服务端权威，别在客户端算位置，改掉'),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"path":"movement.ts"}' }),
    assistantMsg(1, '已改为服务端权威判定。'),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/** 无纠正的普通任务回合。 */
function normalTaskEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }),
    userMsg('把鱼塘场景的背景色改成深蓝'),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"path":"scene.json"}' }),
    assistantMsg(1, '已改好。'),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

const session = (events: SessionEvent[]): Session => ({ events }) as unknown as Session

/** 单轮流式 mock（带调用计数）。 */
function streamOf(text: string, finishKind: 'stop' | 'length' = 'stop') {
  let calls = 0
  const stream = async function* () {
    calls += 1
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: finishKind } }
  }
  return { stream: stream as unknown as (request: GenerateOptions) => AsyncIterable<StreamChunk>, calls: () => calls }
}

function mockCtx(stream: (request: GenerateOptions) => AsyncIterable<StreamChunk>): Context {
  return {
    llm: { stream },
    logger: { warn() {}, info() {}, debug() {} },
  } as unknown as Context
}

const PROPOSE_JSON = JSON.stringify({
  correction: true,
  necessary: true,
  rule: {
    name: 'server_authoritative_movement',
    content: '移动判定一律服务端权威，客户端只做表现插值。',
    reason: '用户纠正：客户端算位置会与服务器状态漂移',
  },
})

const baseOptions = { watermark: 0, fallbackProvider: 'p', fallbackModel: 'm' }

describe('回合末纠正检测（双条件：人工纠正 + 任务必要条件）', () => {
  it('预筛：用户消息无纠正关键词 → 不发 side-query，水位照常推进', async () => {
    const { stream, calls } = streamOf(PROPOSE_JSON)
    const result = await diagnoseFromSession(mockCtx(stream), session(normalTaskEvents()), dir, baseOptions)
    expect(calls()).toBe(0)
    expect(result).toEqual({ ok: true, maxTurn: 1, proposed: [] })
    expect(existsSync(join(dir, 'pending'))).toBe(false)
  })

  it('预筛：转录中无用户消息行（纯助手）→ 不发 side-query', async () => {
    const { stream, calls } = streamOf(PROPOSE_JSON)
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }),
      assistantMsg(1, '自己补一句。'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const result = await diagnoseFromSession(mockCtx(stream), session(events), dir, baseOptions)
    expect(calls()).toBe(0)
    expect(result.ok).toBe(true)
  })

  it('判定无纠正（correction: false）→ 不提案，水位推进', async () => {
    const { stream, calls } = streamOf('{"correction": false}')
    const result = await diagnoseFromSession(mockCtx(stream), session(correctionEvents()), dir, baseOptions)
    expect(calls()).toBe(1)
    expect(result).toEqual({ ok: true, maxTurn: 1, proposed: [] })
  })

  it('纠正但非必要条件（necessary: false）→ 不提案，水位推进', async () => {
    const { stream } = streamOf('{"correction": true, "necessary": false}')
    const result = await diagnoseFromSession(mockCtx(stream), session(correctionEvents()), dir, baseOptions)
    expect(result).toEqual({ ok: true, maxTurn: 1, proposed: [] })
  })

  it('双条件成立 → pending 提案落盘（frontmatter + 正文），水位推进', async () => {
    const { stream } = streamOf(PROPOSE_JSON)
    const result = await diagnoseFromSession(mockCtx(stream), session(correctionEvents()), dir, baseOptions)
    expect(result).toEqual({ ok: true, maxTurn: 1, proposed: ['pending/server_authoritative_movement.proposed.md'] })
    const text = await readFile(join(dir, 'pending', 'server_authoritative_movement.proposed.md'), 'utf8')
    expect(text).toContain('name: server_authoritative_movement')
    expect(text).toContain('移动判定一律服务端权威')
    expect(text).toMatch(/date: \d{4}-\d{2}-\d{2}/)
  })

  it('判定输出非法 JSON → ok:false，水位不推进（下次空闲重试）', async () => {
    const { stream } = streamOf('抱歉，我无法输出 JSON')
    const result = await diagnoseFromSession(mockCtx(stream), session(correctionEvents()), dir, baseOptions)
    expect(result.ok).toBe(false)
    expect(result.maxTurn).toBe(0)
  })

  it('判定模型异常结束（length）→ ok:false，水位不推进', async () => {
    const { stream } = streamOf(PROPOSE_JSON, 'length')
    const result = await diagnoseFromSession(mockCtx(stream), session(correctionEvents()), dir, baseOptions)
    expect(result.ok).toBe(false)
    expect(result.maxTurn).toBe(0)
  })

  it('水位增量：已检过的回合不重判', async () => {
    const { stream, calls } = streamOf('{"correction": false}')
    const ctx = mockCtx(stream)
    const first = await diagnoseFromSession(ctx, session(correctionEvents()), dir, { ...baseOptions, watermark: 0 })
    expect(first.maxTurn).toBe(1)
    const second = await diagnoseFromSession(ctx, session(correctionEvents()), dir, { ...baseOptions, watermark: 1 })
    expect(second).toEqual({ ok: true, maxTurn: 1, proposed: [] })
    expect(calls()).toBe(1) // 第二次无新回合，未发 side-query
  })
})

describe('parseDiagnoseOutput 解析', () => {
  it('缺 rule / 空字段 / 非法规则名 → invalid（视为失败重试）', () => {
    expect(parseDiagnoseOutput('{"correction": true, "necessary": true}').kind).toBe('invalid')
    expect(parseDiagnoseOutput('{"correction": true, "necessary": true, "rule": null}').kind).toBe('invalid')
    expect(parseDiagnoseOutput('{"correction": true, "necessary": true, "rule": {"name": "Bad_Name", "content": "c", "reason": "r"}}').kind).toBe('invalid')
    expect(parseDiagnoseOutput('{"correction": true, "necessary": true, "rule": {"name": "ok_name", "content": "  ", "reason": "r"}}').kind).toBe('invalid')
  })
  it('correction 字段缺失 → invalid；correction:false → no_correction', () => {
    expect(parseDiagnoseOutput('{"necessary": true}').kind).toBe('invalid')
    expect(parseDiagnoseOutput('{"correction": false}').kind).toBe('no_correction')
  })
  it('双条件成立 → propose 且规则名规范化', () => {
    const verdict = parseDiagnoseOutput(PROPOSE_JSON)
    expect(verdict).toMatchObject({ kind: 'propose', name: 'server_authoritative_movement' })
  })
})

describe('CORRECTION_HINT_PATTERN 预筛', () => {
  it('典型纠正命中；普通指令不命中', () => {
    expect(CORRECTION_HINT_PATTERN.test('不对，应该用 per-World 物理')).toBe(true)
    expect(CORRECTION_HINT_PATTERN.test('别用全局单例，改掉')).toBe(true)
    expect(CORRECTION_HINT_PATTERN.test('记规则：以后都走服务端')).toBe(true)
    expect(CORRECTION_HINT_PATTERN.test('把背景色改成深蓝')).toBe(false)
    expect(CORRECTION_HINT_PATTERN.test('新建一个炮台配置表')).toBe(false)
  })
})
