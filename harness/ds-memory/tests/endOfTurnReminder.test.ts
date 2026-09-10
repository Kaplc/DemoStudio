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

type ReminderAgent = Agent & { steer: ReturnType<typeof vi.fn> }
type TurnStoppingPayload = { agent: Agent; turn: number; signal: AbortSignal }
type TurnStoppingHandler = (payload: TurnStoppingPayload) => Promise<void>
type PreStepPayload = { agent: Agent; turn: number }
type PreStepHandler = (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>
type ToolResultPayload = { name: string; agent?: Agent }
type ToolResultHandler = (exec: ToolResultPayload, result: { isError: boolean }) => void

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

/** 主 agent 桩（带 steer 间谍）；delegationDepth > 0 表示子 agent。 */
function makeAgent(delegationDepth = 0): ReminderAgent {
  return {
    session: { header: { delegationDepth } },
    steer: vi.fn(),
  } as unknown as ReminderAgent
}

/** 未中止的回合信号（handler 会 throwIfAborted）。 */
function liveSignal(): AbortSignal {
  return new AbortController().signal
}

/** 已中止的回合信号。 */
function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

function continueDecision(): PreStepDecision {
  return { kind: 'continue', messages: [] } as unknown as PreStepDecision
}

async function makeMemoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-memory-reminder-'))
  createdDirs.push(dir)
  return dir
}

/** 装配插件并取出提醒相关监听器（联想关闭，隔离本组用例）。 */
async function applyWithReminder(config: Record<string, unknown> = {}) {
  const dir = await makeMemoryDir()
  const { ctx, handlers, logger } = makeCtx()
  apply(ctx, { memoryDir: dir, enableAutoAssociate: false, ...config })
  const turnStopping = handlers.get('agent/turn-stopping')?.[0] as TurnStoppingHandler | undefined
  expect(turnStopping).toBeDefined()
  const preStep = handlers.get('agent/pre-step')?.[0] as PreStepHandler | undefined
  expect(preStep).toBeDefined()
  const toolResult = handlers.get('tools/result')?.[0] as ToolResultHandler | undefined
  expect(toolResult).toBeDefined()
  return {
    turnStopping: turnStopping!,
    preStep: preStep!,
    toolResult: toolResult!,
    handlers,
    logger,
  }
}

/** 走一遍"回合内保存成功"：pre-step 记回合号 → tools/result 记保存成功。 */
async function saveInTurn(
  preStep: PreStepHandler,
  toolResult: ToolResultHandler,
  agent: Agent,
  turn: number,
  toolName: string,
  isError = false,
): Promise<void> {
  await preStep({ agent, turn }, async () => continueDecision())
  toolResult({ name: toolName, agent }, { isError })
}

/** steer 收到的第一条消息（无则抛出，便于断言）。 */
function steeredMessage(agent: ReminderAgent): { content: Array<{ text: string }>; source: Record<string, string> } {
  const call = agent.steer.mock.calls[0]
  if (call === undefined) throw new Error('steer 未被调用')
  return call[0] as { content: Array<{ text: string }>; source: Record<string, string> }
}

describe('回合末记忆提醒（agent/turn-stopping + steer）', () => {
  it('本回合未保存：注入提醒（文本含标题、source 为 plugin notice）且 info 有日志', async () => {
    const { turnStopping, logger } = await applyWithReminder()
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
    const message = steeredMessage(agent)
    expect(message.content[0]!.text).toContain('回合末记忆提醒')
    expect(message.source).toEqual({
      kind: 'plugin',
      plugin: '@demostudio/ds-memory',
      form: 'notice',
      summary: '回合末记忆提醒',
    })
    expect(logger.info).toHaveBeenCalledWith('已注入回合末记忆提醒')
  })

  it('60s 冷却内同一 agent 的下一个回合不重复注入', async () => {
    const { turnStopping } = await applyWithReminder()
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })
    await turnStopping({ agent, turn: 2, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('冷却按 agent 隔离：另一个 agent 不受影响', async () => {
    const { turnStopping } = await applyWithReminder()
    const first = makeAgent()
    const second = makeAgent()

    await turnStopping({ agent: first, turn: 1, signal: liveSignal() })
    await turnStopping({ agent: second, turn: 1, signal: liveSignal() })

    expect(first.steer).toHaveBeenCalledTimes(1)
    expect(second.steer).toHaveBeenCalledTimes(1)
  })

  it('子 agent（delegationDepth>0）不注入', async () => {
    const { turnStopping } = await applyWithReminder()
    const agent = makeAgent(1)

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
  })

  it('signal 已中止：不注入也不记 warn', async () => {
    const { turnStopping, logger } = await applyWithReminder()
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: abortedSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('steer 抛错：记 warn 且不向外抛（不阻塞对话）', async () => {
    const { turnStopping, logger } = await applyWithReminder()
    const agent = makeAgent()
    agent.steer.mockImplementation(() => {
      throw new Error('steer failed')
    })

    await expect(turnStopping({ agent, turn: 1, signal: liveSignal() })).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('enableEndOfTurnReminder=false：提醒相关监听全部不注册', async () => {
    const dir = await makeMemoryDir()
    const { ctx, handlers } = makeCtx()
    apply(ctx, { memoryDir: dir, enableAutoAssociate: false, enableEndOfTurnReminder: false })

    expect(handlers.has('agent/turn-stopping')).toBe(false)
    expect(handlers.has('agent/pre-step')).toBe(false)
    expect(handlers.has('tools/result')).toBe(false)
  })
})

describe('回合末记忆提醒：本回合已保存过则跳过', () => {
  it('本回合 memory_write 成功：跳过提醒并记 info 日志', async () => {
    const { turnStopping, preStep, toolResult, logger } = await applyWithReminder()
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 7, 'memory_write')

    await turnStopping({ agent, turn: 7, signal: liveSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('回合 %d 内已成功调用 %s，回合末不再提醒', 7, 'memory_write')
    expect(logger.info).toHaveBeenCalledWith('回合 %d 已保存过记忆，跳过回合末提醒', 7)
  })

  it('本回合 experience_save 成功：不再抑制提醒（各自只看自己——双写场景下只存了经验仍可能漏存记忆）', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 3, 'experience_save')

    await turnStopping({ agent, turn: 3, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('保存发生在更早的回合：本回合仍提醒', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 1, 'memory_write')
    await preStep({ agent, turn: 2 }, async () => continueDecision())

    await turnStopping({ agent, turn: 2, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('保存类工具失败（isError）：不算已保存，仍提醒', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 5, 'memory_write', true)

    await turnStopping({ agent, turn: 5, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('非保存类工具（memory_search）不计入已保存', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 5, 'memory_search')

    await turnStopping({ agent, turn: 5, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('tools/result 缺 agent：不登记，仍提醒', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    await preStep({ agent, turn: 4 }, async () => continueDecision())
    toolResult({ name: 'memory_write' }, { isError: false })

    await turnStopping({ agent, turn: 4, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('未观测到回合号（无 pre-step）：不登记，仍提醒', async () => {
    const { turnStopping, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    toolResult({ name: 'memory_write', agent }, { isError: false })

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('其它 agent 的保存不影响本 agent 的提醒', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const saver = makeAgent()
    const other = makeAgent()
    await saveInTurn(preStep, toolResult, saver, 2, 'memory_write')

    await turnStopping({ agent: other, turn: 2, signal: liveSignal() })

    expect(saver.steer).not.toHaveBeenCalled()
    expect(other.steer).toHaveBeenCalledTimes(1)
  })

  it('reminderSkipTools: [] 关闭判定：保存后仍提醒', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder({ reminderSkipTools: [] })
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 6, 'memory_write')

    await turnStopping({ agent, turn: 6, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('reminderSkipTools 自定义：替换默认清单（memory_write 不再跳过、memory_forget 改为跳过）', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder({ reminderSkipTools: ['memory_forget'] })
    const writer = makeAgent()
    const forgetter = makeAgent()
    await saveInTurn(preStep, toolResult, writer, 8, 'memory_write')
    await saveInTurn(preStep, toolResult, forgetter, 8, 'memory_forget')

    await turnStopping({ agent: writer, turn: 8, signal: liveSignal() })
    await turnStopping({ agent: forgetter, turn: 8, signal: liveSignal() })

    expect(writer.steer).toHaveBeenCalledTimes(1)
    expect(forgetter.steer).not.toHaveBeenCalled()
  })
})

describe('回合号登记（agent/pre-step）', () => {
  it('原样透传下游决策并调用 next()', async () => {
    const { preStep } = await applyWithReminder()
    const agent = makeAgent()
    const decision = continueDecision()
    const next = vi.fn(async () => decision)

    const returned = await preStep({ agent, turn: 11 }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(returned).toBe(decision)
  })

  it('记录回合号：同回合后续保存才算"本回合已保存"（step 与回合号解耦）', async () => {
    const { turnStopping, preStep, toolResult } = await applyWithReminder()
    const agent = makeAgent()
    // 回合 1 保存 → 回合 1 跳过；回合 2 未保存 → 提醒（同时覆盖冷却窗口外的路径）
    await saveInTurn(preStep, toolResult, agent, 1, 'memory_write')
    await turnStopping({ agent, turn: 1, signal: liveSignal() })
    await preStep({ agent, turn: 2 }, async () => continueDecision())
    await turnStopping({ agent, turn: 2, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
    expect(steeredMessage(agent).content[0]!.text).toContain('回合末记忆提醒')
  })
})
