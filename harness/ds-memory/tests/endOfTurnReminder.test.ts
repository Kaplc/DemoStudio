import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

const createdDirs: string[] = []
afterAll(async () => {
  for (const dir of createdDirs) await rm(dir, { recursive: true, force: true })
})

type PreStepPayload = { agent: Agent; step: number; signal?: AbortSignal }
type PreStepHandler = (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

/** 最小 ctx 桩：捕获 ctx.on 注册的监听器与 logger 输出。 */
function makeCtx() {
  const handlers = new Map<string, Array<(...args: never[]) => unknown>>()
  const logger = { info: vi.fn(), warn: vi.fn() }
  const on = vi.fn((name: string, handler: (...args: never[]) => unknown) => {
    const list = handlers.get(name) ?? []
    list.push(handler)
    handlers.set(name, list)
    return () => {}
  })
  const ctx = {
    logger: vi.fn(() => logger),
    systemPrompt: { section: vi.fn() },
    tools: { register: vi.fn() },
    on,
  } as unknown as Context
  return { ctx, handlers, logger }
}

function makeAgent(delegationDepth = 0): Agent {
  return { session: { header: { delegationDepth } } } as unknown as Agent
}

/** 非拒绝决策桩：可携带既有 messages，handler 应在其后追加。 */
function continueDecision(messages: unknown[] = []): PreStepDecision {
  return { kind: 'continue', messages } as unknown as PreStepDecision
}

async function makeMemoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-memory-reminder-'))
  createdDirs.push(dir)
  return dir
}

async function applyWithReminder() {
  const dir = await makeMemoryDir()
  const { ctx, handlers, logger } = makeCtx()
  apply(ctx, { memoryDir: dir, enableAutoAssociate: false })
  const handler = handlers.get('agent/pre-step')?.[0] as PreStepHandler | undefined
  expect(handler).toBeDefined()
  return { handler: handler!, logger }
}

describe('回合末记忆提醒（agent/pre-step 新回合第一步注入）', () => {
  it('step=1 主 agent：追加提醒消息（文本含标题、source 为 plugin notice）且 info 有日志', async () => {
    const { handler, logger } = await applyWithReminder()
    const decision = await handler({ agent: makeAgent(), step: 1 }, async () => continueDecision())

    expect(decision.kind).not.toBe('reject')
    const messages = (decision as { messages: Array<{ content: Array<{ text: string }>; source: Record<string, string> }> }).messages
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content[0]!.text).toContain('回合末记忆提醒')
    expect(messages[0]!.source).toEqual({
      kind: 'plugin',
      plugin: '@demostudio/ds-memory',
      form: 'notice',
      summary: '回合末记忆提醒',
    })
    expect(logger.info).toHaveBeenCalledWith('已注入回合末记忆提醒')
  })

  it('step=2（同回合后续步）不注入', async () => {
    const { handler } = await applyWithReminder()
    const decision = await handler({ agent: makeAgent(), step: 2 }, async () => continueDecision())
    expect((decision as { messages: unknown[] }).messages).toHaveLength(0)
  })

  it('60s 冷却内下一个回合的 step=1 不重复注入', async () => {
    const { handler } = await applyWithReminder()
    const agent = makeAgent()
    await handler({ agent, step: 1 }, async () => continueDecision())
    const second = await handler({ agent, step: 1 }, async () => continueDecision())
    expect((second as { messages: unknown[] }).messages).toHaveLength(0)
  })

  it('子 agent（delegationDepth>0）不注入', async () => {
    const { handler } = await applyWithReminder()
    const decision = await handler({ agent: makeAgent(1), step: 1 }, async () => continueDecision())
    expect((decision as { messages: unknown[] }).messages).toHaveLength(0)
  })

  it('reject 决策原样返回且不占冷却（后续 step=1 仍注入）', async () => {
    const { handler } = await applyWithReminder()
    const rejected = { kind: 'reject', reason: 'test' } as unknown as PreStepDecision
    const returned = await handler({ agent: makeAgent(), step: 1 }, async () => rejected)
    expect(returned).toBe(rejected)

    const decision = await handler({ agent: makeAgent(), step: 1 }, async () => continueDecision())
    expect((decision as { messages: unknown[] }).messages).toHaveLength(1)
  })

  it('enableEndOfTurnReminder=false 不注册提醒监听', async () => {
    const dir = await makeMemoryDir()
    const { ctx, handlers } = makeCtx()
    apply(ctx, { memoryDir: dir, enableAutoAssociate: false, enableEndOfTurnReminder: false })
    expect(handlers.has('agent/pre-step')).toBe(false)
  })
})
