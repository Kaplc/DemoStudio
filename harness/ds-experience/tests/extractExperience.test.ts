import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractFromSession, parseExtractionOutput } from '../src/extractExperience.js'
import { saveExperience } from '../src/experienceStore.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-extract-'))
  await mkdir(dir, { recursive: true })
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

/** 带工具调用的任务回合。 */
function taskEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }),
    userMsg('把 ds-experience 插件建出来'),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"path":"x.ts"}' }),
    ev('tool/result', { turn: 1, step: 1, message: {} }),
    assistantMsg(1, '插件已完成并挂载'),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/** 纯问答回合（无工具调用）。 */
function chatEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }),
    userMsg('vitest 是什么？'),
    assistantMsg(1, '是一个单测框架。'),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

const session = (events: SessionEvent[]): Session => ({ events }) as unknown as Session

/** 单轮流式 mock。 */
function streamOf(text: string, finishKind: 'stop' | 'length' = 'stop'): (request: GenerateOptions) => AsyncIterable<StreamChunk> {
  return async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: finishKind } }
  }
}

function mockCtx(stream: (request: GenerateOptions) => AsyncIterable<StreamChunk>): Context {
  const warnings: unknown[][] = []
  return {
    llm: { stream },
    logger: { warn: (...args: unknown[]) => warnings.push(args), info() {}, debug() {} },
  } as unknown as Context
}

const EPISODE_JSON = JSON.stringify({
  is_task: true,
  episode: {
    name: 'build_ds_experience_plugin',
    task_type: 'feature',
    outcome: 'success',
    summary: '新建 ds-experience 插件并 junction 挂载',
    lessons: 'defineTool 必须走规范 schema；junction 用 PowerShell',
    effective_path: 'harness/ds-experience',
  },
})

const baseOptions = { watermark: 0, fallbackProvider: 'p', fallbackModel: 'm' }

describe('EXP-08 自动提炼判定', () => {
  it('无工具调用的纯问答：不产出 episode，水位照常推进', async () => {
    const ctx = mockCtx(streamOf(EPISODE_JSON))
    const result = await extractFromSession(ctx, session(chatEvents()), dir, baseOptions)
    expect(result.ok).toBe(true)
    expect(result.saved).toEqual([])
    expect(result.maxTurn).toBe(1) // 水位推进
    expect(existsSync(join(dir, 'INDEX.md'))).toBe(false)
  })
  it('有工具调用且模型判定非任务：不落盘，水位照常推进', async () => {
    const ctx = mockCtx(streamOf('{"is_task": false}'))
    const result = await extractFromSession(ctx, session(taskEvents()), dir, baseOptions)
    expect(result.ok).toBe(true)
    expect(result.saved).toEqual([])
    expect(result.maxTurn).toBe(1)
  })
  it('有工具调用且判定为任务：提炼 1 条 episode 落盘', async () => {
    const ctx = mockCtx(streamOf(EPISODE_JSON))
    const result = await extractFromSession(ctx, session(taskEvents()), dir, baseOptions)
    expect(result.ok).toBe(true)
    expect(result.saved).toEqual(['build_ds_experience_plugin.md'])
    expect(result.updated).toEqual([])
    const file = await readFile(join(dir, 'build_ds_experience_plugin.md'), 'utf8')
    expect(file).toContain('task_type: feature')
    expect(file).toContain('outcome: success')
  })
  it('水位增量：只对 > watermark 的回合提炼（EXP-12 语义）', async () => {
    const ctx = mockCtx(streamOf(EPISODE_JSON))
    const result = await extractFromSession(ctx, session(taskEvents()), dir, { ...baseOptions, watermark: 1 })
    expect(result.ok).toBe(true)
    expect(result.maxTurn).toBe(1)
    expect(result.saved).toEqual([])
  })
})

describe('EXP-09 提炼失败路径', () => {
  it('side-query 返回非法 JSON：ok:false、水位不推进、不抛出', async () => {
    const ctx = mockCtx(streamOf('抱歉，我无法输出 JSON'))
    const result = await extractFromSession(ctx, session(taskEvents()), dir, baseOptions)
    expect(result.ok).toBe(false)
    expect(result.maxTurn).toBe(0) // 水位保持 → 下次空闲重试
    expect(result.saved).toEqual([])
  })
  it('模型异常结束（非 stop）：ok:false、水位不推进', async () => {
    const ctx = mockCtx(streamOf(EPISODE_JSON, 'length'))
    const result = await extractFromSession(ctx, session(taskEvents()), dir, baseOptions)
    expect(result.ok).toBe(false)
    expect(result.maxTurn).toBe(0)
  })
  it('提炼成功但覆盖已有 episode：updated 透出（notice 信号）', async () => {
    await saveExperience(dir, {
      name: 'build_ds_experience_plugin', taskType: 'feature', outcome: 'success',
      summary: '旧版', lessons: '旧',
    })
    const ctx = mockCtx(streamOf(EPISODE_JSON))
    const result = await extractFromSession(ctx, session(taskEvents()), dir, baseOptions)
    expect(result.ok).toBe(true)
    expect(result.saved).toEqual(['build_ds_experience_plugin.md'])
    expect(result.updated).toEqual(['build_ds_experience_plugin.md'])
  })
})

describe('parseExtractionOutput', () => {
  it('is_task:false → null（成功，不落盘）', () => {
    expect(parseExtractionOutput('{"is_task": false}')).toBeNull()
  })
  it('合法 episode 逐字段校验并规范化', () => {
    const parsed = parseExtractionOutput(`前言 ${EPISODE_JSON} 后记`)
    expect(parsed).not.toBeNull()
    expect(parsed).toMatchObject({ name: 'build_ds_experience_plugin.md', outcome: 'success' })
  })
  it('缺字段/坏名/未知 outcome 兜底', () => {
    expect(parseExtractionOutput('{"is_task": true, "episode": {"name": "Bad Name"}}')).toBeUndefined()
    expect(parseExtractionOutput('{"is_task": true}')).toBeUndefined()
    const lenient = parseExtractionOutput(JSON.stringify({
      is_task: true,
      episode: { name: 'ok_name', task_type: 'debug', outcome: 'weird', summary: 's', lessons: 'l' },
    }))
    expect(lenient).not.toBeNull()
    expect(lenient!.outcome).toBe('success') // 未知 outcome 宽容降级
  })
  it('完全不是 JSON → undefined（失败重试）', () => {
    expect(parseExtractionOutput('好的')).toBeUndefined()
    expect(parseExtractionOutput('')).toBeUndefined()
  })
})
