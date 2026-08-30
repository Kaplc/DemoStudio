import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-index-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function ev(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

/** 带工具调用的任务回合事件流。 */
function taskEvents(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }),
    ev('user/message', createUserMessage({ content: [{ type: 'text', text: '任务' }], source: { kind: 'user' } })),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
    ev('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', id: 'a', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'p', model: 'm' } },
    }),
  ]
}

let llmCalls: number

function fakeCtx(events: SessionEvent[]): { ctx: Context; statusHandlers: Array<(payload: { agent: unknown; status: string }) => void> } {
  llmCalls = 0
  const statusHandlers: Array<(payload: { agent: unknown; status: string }) => void> = []
  const ctx = {
    systemPrompt: { section() {} },
    tools: { register() {} },
    effect() {},
    on(event: string, handler: unknown) {
      if (event === 'agent/status') statusHandlers.push(handler as never)
    },
    llm: {
      async *stream(): AsyncIterable<StreamChunk> {
        llmCalls++
        const text = JSON.stringify({
          is_task: true,
          episode: { name: 'should_not_appear', task_type: 't', outcome: 'success', summary: 's', lessons: 'l' },
        })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    logger: { warn() {}, info() {}, debug() {} },
  } as unknown as Context
  void events
  return { ctx, statusHandlers }
}

const agentWith = (header: Record<string, unknown>) => ({
  session: { header, events: taskEvents() },
  inject: () => {},
}) as never

describe('EXP-10 子 agent 门控', () => {
  it('delegationDepth>0 的 agent 空闲：不提炼、不调 side-query', async () => {
    vi.useFakeTimers()
    const { ctx, statusHandlers } = fakeCtx(taskEvents())
    apply(ctx, { experienceDir: dir })
    expect(statusHandlers).toHaveLength(1)

    statusHandlers[0]!({ agent: agentWith({ delegationDepth: 1 }), status: 'idle' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(llmCalls).toBe(0)
    expect(existsSync(join(dir, 'INDEX.md'))).toBe(false)
  })

  it('顶层 agent 空闲防抖 3s 后正常提炼（对照组）', async () => {
    const { ctx, statusHandlers } = fakeCtx(taskEvents())
    apply(ctx, { experienceDir: dir })
    statusHandlers[0]!({ agent: agentWith({}), status: 'idle' })
    // 防抖 3s 内不触发
    await new Promise(resolve => setTimeout(resolve, 1_000))
    expect(llmCalls).toBe(0)
    // 防抖到期 → side-query → 落盘（等待真实 fs 收尾）
    await vi.waitFor(() => {
      expect(llmCalls).toBe(1)
      expect(existsSync(join(dir, 'should_not_appear.md'))).toBe(true)
    }, { timeout: 5_000, interval: 100 })
  }, 15_000)

  it('running 状态撤销未触发的提炼计划', async () => {
    vi.useFakeTimers()
    const { ctx, statusHandlers } = fakeCtx(taskEvents())
    apply(ctx, { experienceDir: dir })
    statusHandlers[0]!({ agent: agentWith({}), status: 'idle' })
    statusHandlers[0]!({ agent: agentWith({}), status: 'running' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(llmCalls).toBe(0)
  })
})
