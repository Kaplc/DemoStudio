import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// 桩件：最小 ctx（只捕获 ctx.on 与 logger）、带 steer/inject 间谍的 agent
// ─────────────────────────────────────────────────────────────────────────────

type AnyHandler = (...args: never[]) => unknown
type TurnStoppingHandler = (payload: { agent: Agent; turn: number; signal: AbortSignal }) => Promise<void>
type PreStepHandler = (
  payload: { agent: Agent; turn: number },
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>
type ToolResultHandler = (exec: { name: string; agent?: Agent }, result: { isError: boolean }) => undefined
type SessionEventHandler = (session: Session, event: SessionEvent) => void

interface NoticeMessage {
  content: Array<{ type: string; text?: string }>
  source: { kind: string; plugin: string; form: string; summary: string }
}
type ReminderAgent = Agent & { steer: ReturnType<typeof vi.fn>; inject: ReturnType<typeof vi.fn> }
type TestLogger = { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

function makeCtx(): { ctx: Context; handlers: Map<string, AnyHandler[]>; logger: TestLogger } {
  const handlers = new Map<string, AnyHandler[]>()
  const logger: TestLogger = { info: vi.fn(), warn: vi.fn() }
  const ctx = {
    logger: vi.fn(() => logger),
    on: (event: string, handler: AnyHandler) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
  } as unknown as Context
  return { ctx, handlers, logger }
}

/** 主 agent 桩（带 steer/inject 间谍）；delegationDepth > 0 表示子 agent。 */
function makeAgent(delegationDepth = 0): ReminderAgent {
  return {
    session: { header: { delegationDepth } },
    steer: vi.fn(),
    inject: vi.fn(),
  } as unknown as ReminderAgent
}

function liveSignal(): AbortSignal {
  return new AbortController().signal
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

function turnEndEvent(): SessionEvent {
  return { type: 'turn/end', data: {}, seq: 0, time: 0 } as unknown as SessionEvent
}

function getHandler<T>(handlers: Map<string, AnyHandler[]>, event: string, index = 0): T {
  const handler = handlers.get(event)?.[index]
  if (handler === undefined) throw new Error(`事件 ${event} 未注册监听`)
  return handler as T
}

function messageText(message: NoticeMessage | undefined): string {
  if (message === undefined) throw new Error('未捕获到注入消息')
  return message.content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')
}

/** 从 steer 间谍取指定序号的消息（默认第一条）。 */
function steeredMessage(agent: ReminderAgent, index = 0): NoticeMessage {
  const call = agent.steer.mock.calls[index]
  if (call === undefined) throw new Error(`steer 第 ${index + 1} 次未被调用`)
  return call[0] as NoticeMessage
}

/** 从 inject 间谍取第一条消息。 */
function injectedMessage(agent: ReminderAgent): NoticeMessage {
  const call = agent.inject.mock.calls[0]
  if (call === undefined) throw new Error('inject 未被调用')
  return call[0] as NoticeMessage
}

// ─────────────────────────────────────────────────────────────────────────────
// 提醒目录桩：默认两条提醒的文本文件（内容与真实 .dsh/reminder/*.md 解耦）
// ─────────────────────────────────────────────────────────────────────────────

let reminderDir: string
const createdDirs: string[] = []
const MEMORY_TEXT = '记忆提醒：检查本回合是否需要 memory_write。'
const EXPERIENCE_TEXT = '经验提醒：检查本回合是否需要 experience_save。'

beforeAll(async () => {
  reminderDir = await mkdtemp(join(tmpdir(), 'ds-reminder-'))
  createdDirs.push(reminderDir)
  await seedFile('memory-end-of-turn.md', `${MEMORY_TEXT}\n`)
  await seedFile('experience-end-of-turn.md', `${EXPERIENCE_TEXT}\n`)
})

afterAll(async () => {
  for (const dir of createdDirs) await rm(dir, { recursive: true, force: true })
})

afterEach(() => {
  vi.useRealTimers()
})

async function seedFile(name: string, content: string): Promise<void> {
  await writeFile(join(reminderDir, name), content, 'utf8')
}

/** 装配插件（缺省 = 两条默认提醒，文本来自桩目录）。 */
function setupPlugin(config: Record<string, unknown> = {}): {
  handlers: Map<string, AnyHandler[]>
  logger: TestLogger
} {
  const { ctx, handlers, logger } = makeCtx()
  apply(ctx, { reminderDir, ...config } as never)
  return { handlers, logger }
}

/** 走一遍"回合内保存成功"：pre-step 记回合号 → tools/result 登记保存成功。 */
async function saveInTurn(
  preStep: PreStepHandler,
  toolResult: ToolResultHandler,
  agent: Agent,
  turn: number,
  toolName: string,
  isError = false,
): Promise<void> {
  await preStep({ agent, turn }, async () => ({ kind: 'continue', messages: [] }) as unknown as PreStepDecision)
  toolResult({ name: toolName, agent }, { isError })
}

// ─────────────────────────────────────────────────────────────────────────────
// 装配与配置面
// ─────────────────────────────────────────────────────────────────────────────

describe('装配与配置面', () => {
  it('默认配置：两条默认提醒 → 双通道 + 跳过判定 + session 登记监听全部注册', () => {
    const { handlers } = setupPlugin()
    expect(handlers.has('agent/turn-stopping')).toBe(true)
    expect(handlers.has('session/event')).toBe(true)
    expect(handlers.has('agent/created')).toBe(true)
    expect(handlers.has('agent/status')).toBe(true)
    expect(handlers.has('agent/pre-step')).toBe(true)
    expect(handlers.has('tools/result')).toBe(true)
  })

  it('enabled: false — 一切静默，什么都不注册', () => {
    const { handlers } = setupPlugin({ enabled: false })
    expect(handlers.size).toBe(0)
  })

  it('reminders 显式空数组 = 没有提醒：不注册任何监听并记 info', () => {
    const { handlers, logger } = setupPlugin({ reminders: [] })
    expect(handlers.size).toBe(0)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('没有启用中的回合末提醒'),
      expect.anything(),
    )
  })

  it('只有 steer 条：不注册 session/event 与 session 登记监听', () => {
    const { handlers } = setupPlugin({
      reminders: [{ id: 'only-steer', file: 'memory-end-of-turn.md', channel: 'steer', skipTools: [] }],
    })
    expect(handlers.has('agent/turn-stopping')).toBe(true)
    expect(handlers.has('session/event')).toBe(false)
    expect(handlers.has('agent/created')).toBe(false)
    expect(handlers.has('agent/status')).toBe(false)
  })

  it('只有 inject 条（带 skipTools）：注册 session 登记与跳过判定，不注册 turn-stopping', () => {
    const { handlers } = setupPlugin({
      reminders: [{ id: 'only-inject', file: 'experience-end-of-turn.md', channel: 'inject', skipTools: ['experience_save'] }],
    })
    expect(handlers.has('session/event')).toBe(true)
    expect(handlers.has('agent/created')).toBe(true)
    expect(handlers.has('agent/status')).toBe(true)
    expect(handlers.has('agent/pre-step')).toBe(true)
    expect(handlers.has('tools/result')).toBe(true)
    expect(handlers.has('agent/turn-stopping')).toBe(false)
  })

  it('所有提醒 skipTools 为空：不注册跳过判定监听（pre-step/tools-result）', () => {
    const { handlers } = setupPlugin({
      reminders: [
        { id: 'a', file: 'memory-end-of-turn.md', channel: 'steer', skipTools: [] },
        { id: 'b', file: 'experience-end-of-turn.md', channel: 'inject', skipTools: [] },
      ],
    })
    expect(handlers.has('agent/pre-step')).toBe(false)
    expect(handlers.has('tools/result')).toBe(false)
    expect(handlers.has('agent/turn-stopping')).toBe(true)
    expect(handlers.has('session/event')).toBe(true)
  })

  it('无效条目逐个丢弃并记 warn：缺 id / 坏 channel / 无文本来源', () => {
    const { handlers, logger } = setupPlugin({
      reminders: [
        { text: '缺 id', channel: 'steer' },
        { id: 'bad-channel', text: '通道写错', channel: 'hook' },
        { id: 'no-text', channel: 'steer' },
      ],
    })
    expect(handlers.size).toBe(0)
    expect(logger.warn).toHaveBeenCalledTimes(3)
  })

  it('单条 enabled: false — 该条不生效（只配一条时等于没有提醒）', () => {
    const { handlers, logger } = setupPlugin({
      reminders: [{ id: 'off', text: '被关闭', channel: 'steer', enabled: false }],
    })
    expect(handlers.size).toBe(0)
    expect(logger.info).toHaveBeenCalledWith('提醒 %s 已通过 enabled=false 关闭', 'off')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// steer 通道（默认记忆提醒）：turn-stopping + agent.steer
// ─────────────────────────────────────────────────────────────────────────────

describe('steer 通道（默认记忆提醒）', () => {
  it('本回合未保存：读取文本文件注入，source 契约正确', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
    expect(messageText(steeredMessage(agent))).toBe(MEMORY_TEXT)
    expect(steeredMessage(agent).source).toEqual({
      kind: 'plugin',
      plugin: '@demostudio/ds-reminder',
      form: 'notice',
      summary: '回合末记忆提醒',
    })
  })

  it('60s 冷却内同一 agent 的下一个回合不重复注入', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })
    await turnStopping({ agent, turn: 2, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('冷却按 agent 隔离：另一个 agent 不受影响', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const first = makeAgent()
    const second = makeAgent()

    await turnStopping({ agent: first, turn: 1, signal: liveSignal() })
    await turnStopping({ agent: second, turn: 1, signal: liveSignal() })

    expect(first.steer).toHaveBeenCalledTimes(1)
    expect(second.steer).toHaveBeenCalledTimes(1)
  })

  it('子 agent（delegationDepth>0）不注入', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent(1)

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
  })

  it('signal 已中止：不注入也不记 warn', async () => {
    const { handlers, logger } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: abortedSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('steer 抛错：记 warn 且不向外抛（不阻塞对话）', async () => {
    const { handlers, logger } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()
    agent.steer.mockImplementation(() => {
      throw new Error('steer failed')
    })

    await expect(turnStopping({ agent, turn: 1, signal: liveSignal() })).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('本回合 memory_write 成功：跳过提醒并记 info 日志', async () => {
    const { handlers, logger } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 7, 'memory_write')

    await turnStopping({ agent, turn: 7, signal: liveSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('提醒 %s：回合 %d 已成功调用 %s，跳过', 'memory-end-of-turn', 7, 'memory_write')
  })

  it('本回合 experience_save 成功：不抑制记忆提醒（各自只看自己）', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 3, 'experience_save')

    await turnStopping({ agent, turn: 3, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('保存发生在更早的回合：本回合仍提醒', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 1, 'memory_write')
    await preStep({ agent, turn: 2 }, async () => ({ kind: 'continue', messages: [] }) as unknown as PreStepDecision)

    await turnStopping({ agent, turn: 2, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('保存类工具失败（isError）：不算已保存，仍提醒', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 5, 'memory_write', true)

    await turnStopping({ agent, turn: 5, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('非保存类工具不计入已保存', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 5, 'memory_search')

    await turnStopping({ agent, turn: 5, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('未观测到回合号（无 pre-step）：fail-open 仍提醒', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    toolResult({ name: 'memory_write', agent }, { isError: false })

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('tools/result 缺 agent：不登记，仍提醒', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await preStep({ agent, turn: 4 }, async () => ({ kind: 'continue', messages: [] }) as unknown as PreStepDecision)
    toolResult({ name: 'memory_write' }, { isError: false })

    await turnStopping({ agent, turn: 4, signal: liveSignal() })

    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('其它 agent 的保存不影响本 agent 的提醒', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const saver = makeAgent()
    const other = makeAgent()
    await saveInTurn(preStep, toolResult, saver, 2, 'memory_write')

    await turnStopping({ agent: other, turn: 2, signal: liveSignal() })

    expect(saver.steer).not.toHaveBeenCalled()
    expect(other.steer).toHaveBeenCalledTimes(1)
  })

  it('自定义 skipTools：替换默认清单（memory_write 不再跳过、memory_forget 改为跳过）', async () => {
    const { handlers } = setupPlugin({
      reminders: [{ id: 'mem', file: 'memory-end-of-turn.md', channel: 'steer', skipTools: ['memory_forget'], summary: '记忆' }],
    })
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const writer = makeAgent()
    const forgetter = makeAgent()
    await saveInTurn(preStep, toolResult, writer, 8, 'memory_write')
    await saveInTurn(preStep, toolResult, forgetter, 8, 'memory_forget')

    await turnStopping({ agent: writer, turn: 8, signal: liveSignal() })
    await turnStopping({ agent: forgetter, turn: 8, signal: liveSignal() })

    expect(writer.steer).toHaveBeenCalledTimes(1)
    expect(forgetter.steer).not.toHaveBeenCalled()
  })

  it('agent/pre-step 原样透传下游决策（waterfall 不 veto）', async () => {
    const { handlers } = setupPlugin()
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const agent = makeAgent()
    const decision = { kind: 'continue', messages: [] } as unknown as PreStepDecision
    const next = vi.fn(async () => decision)

    const returned = await preStep({ agent, turn: 11 }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(returned).toBe(decision)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// inject 通道（默认经验提醒）：turn/end + agent.inject
// ─────────────────────────────────────────────────────────────────────────────

describe('inject 通道（默认经验提醒）', () => {
  interface Setup {
    handlers: Map<string, AnyHandler[]>
    sessionEvent: SessionEventHandler
    preStep: PreStepHandler
    toolResult: ToolResultHandler
    logger: TestLogger
  }

  function setupInject(): Setup {
    const { handlers, logger } = setupPlugin()
    return {
      handlers,
      sessionEvent: getHandler<SessionEventHandler>(handlers, 'session/event'),
      preStep: getHandler<PreStepHandler>(handlers, 'agent/pre-step'),
      toolResult: getHandler<ToolResultHandler>(handlers, 'tools/result'),
      logger,
    }
  }

  /** 经 agent/status 事件登记 agent（生产链路：agent/created + agent/status 双保险）。 */
  function registerAgent(setup: Setup, agent: ReminderAgent): Session {
    getHandler<(payload: { agent: Agent }) => void>(setup.handlers, 'agent/status')({ agent })
    return agent.session as unknown as Session
  }

  it('turn/end 注入：读取文本文件、source 契约正确', () => {
    const setup = setupInject()
    const agent = makeAgent()
    const session = registerAgent(setup, agent)

    setup.sessionEvent(session, turnEndEvent())

    expect(agent.inject).toHaveBeenCalledTimes(1)
    expect(messageText(injectedMessage(agent))).toBe(EXPERIENCE_TEXT)
    expect(injectedMessage(agent).source).toEqual({
      kind: 'plugin',
      plugin: '@demostudio/ds-reminder',
      form: 'notice',
      summary: '回合末经验提醒',
    })
  })

  it('60 秒冷却按 agent 记：冷却内不重复注入，冷却过期后再注入', () => {
    vi.useFakeTimers()
    const setup = setupInject()
    const agent = makeAgent()
    const session = registerAgent(setup, agent)

    setup.sessionEvent(session, turnEndEvent())
    vi.advanceTimersByTime(30_000)
    setup.sessionEvent(session, turnEndEvent())
    expect(agent.inject).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(31_000)
    setup.sessionEvent(session, turnEndEvent())
    expect(agent.inject).toHaveBeenCalledTimes(2)
  })

  it('未登记 session：warn 可见（不静默跳过），不注入', () => {
    const setup = setupInject()
    const warnCount = setup.logger.warn.mock.calls.length

    setup.sessionEvent({ header: {} } as unknown as Session, turnEndEvent())

    expect(setup.logger.warn.mock.calls.length).toBeGreaterThan(warnCount)
  })

  it('子 agent 不注入；非 turn/end 不触发', () => {
    const setup = setupInject()
    const child = makeAgent(1)
    const childSession = registerAgent(setup, child)
    setup.sessionEvent(childSession, turnEndEvent())
    expect(child.inject).not.toHaveBeenCalled()

    const main = makeAgent()
    const mainSession = registerAgent(setup, main)
    setup.sessionEvent(mainSession, { type: 'turn/start', data: {}, seq: 0, time: 0 } as unknown as SessionEvent)
    expect(main.inject).not.toHaveBeenCalled()
  })

  it('本回合 experience_save 成功：跳过；memory_write 不抑制（各自只看自己）', async () => {
    const setup = setupInject()
    const agent = makeAgent()
    const session = registerAgent(setup, agent)
    await saveInTurn(setup.preStep, setup.toolResult, agent, 3, 'experience_save')
    setup.sessionEvent(session, turnEndEvent())
    expect(agent.inject).not.toHaveBeenCalled()

    const other = makeAgent()
    const otherSession = registerAgent(setup, other)
    await saveInTurn(setup.preStep, setup.toolResult, other, 3, 'memory_write')
    setup.sessionEvent(otherSession, turnEndEvent())
    expect(other.inject).toHaveBeenCalledTimes(1)
  })

  it('保存失败（isError）/ 更早回合保存 / 未观测回合号：仍提醒（fail-open）', async () => {
    const setup = setupInject()
    const failed = makeAgent()
    registerAgent(setup, failed)
    await saveInTurn(setup.preStep, setup.toolResult, failed, 5, 'experience_save', true)
    setup.sessionEvent(failed.session as unknown as Session, turnEndEvent())
    expect(failed.inject).toHaveBeenCalledTimes(1)

    const earlier = makeAgent()
    registerAgent(setup, earlier)
    await saveInTurn(setup.preStep, setup.toolResult, earlier, 3, 'experience_save')
    await setup.preStep({ agent: earlier, turn: 4 }, async () => ({ kind: 'continue', messages: [] }) as unknown as PreStepDecision)
    setup.sessionEvent(earlier.session as unknown as Session, turnEndEvent())
    expect(earlier.inject).toHaveBeenCalledTimes(1)

    const untracked = makeAgent()
    registerAgent(setup, untracked)
    setup.toolResult({ name: 'experience_save', agent: untracked }, { isError: false })
    setup.sessionEvent(untracked.session as unknown as Session, turnEndEvent())
    expect(untracked.inject).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 跨通道独立性与文本文件读取
// ─────────────────────────────────────────────────────────────────────────────

describe('跨通道独立性与文本文件读取', () => {
  it('双写回合（memory_write + experience_save 都成功）：两条默认提醒都跳过', async () => {
    const { handlers } = setupPlugin()
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const sessionEvent = getHandler<SessionEventHandler>(handlers, 'session/event')
    const preStep = getHandler<PreStepHandler>(handlers, 'agent/pre-step')
    const toolResult = getHandler<ToolResultHandler>(handlers, 'tools/result')
    const agent = makeAgent()
    await saveInTurn(preStep, toolResult, agent, 7, 'memory_write')
    await saveInTurn(preStep, toolResult, agent, 7, 'experience_save')

    await turnStopping({ agent, turn: 7, signal: liveSignal() })
    sessionEvent(agent.session as unknown as Session, turnEndEvent())

    expect(agent.steer).not.toHaveBeenCalled()
    expect(agent.inject).not.toHaveBeenCalled()
  })

  it('file 读取失败时回退内联 text', async () => {
    const { handlers } = setupPlugin({
      reminders: [{ id: 'fallback', file: 'missing.md', text: '内联回退文本', channel: 'steer', skipTools: [] }],
    })
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(messageText(steeredMessage(agent))).toBe('内联回退文本')
  })

  it('file 读取失败且无回退：不注入 + warn；冷却水位不消耗，文件恢复后下轮照常注入', async () => {
    const { handlers, logger } = setupPlugin({
      reminders: [{ id: 'nofb', file: 'late.md', channel: 'steer', skipTools: [] }],
    })
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })
    expect(agent.steer).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()

    await seedFile('late.md', '恢复后的文本')
    await turnStopping({ agent, turn: 2, signal: liveSignal() })
    expect(agent.steer).toHaveBeenCalledTimes(1)
    expect(messageText(steeredMessage(agent))).toBe('恢复后的文本')
  })

  it('文本文件热更新：改文件后（冷却过期）下一轮注入新内容，无需重启', async () => {
    vi.useFakeTimers()
    const { handlers } = setupPlugin({
      reminders: [{ id: 'hot', file: 'hot.md', channel: 'steer', skipTools: [] }],
    })
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()
    await seedFile('hot.md', '第一版文案')

    await turnStopping({ agent, turn: 1, signal: liveSignal() })
    expect(messageText(steeredMessage(agent))).toBe('第一版文案')

    vi.advanceTimersByTime(61_000)
    await seedFile('hot.md', '第二版文案')
    await turnStopping({ agent, turn: 2, signal: liveSignal() })
    expect(agent.steer).toHaveBeenCalledTimes(2)
    expect(messageText(steeredMessage(agent, 1))).toBe('第二版文案')
  })

  it('空文件且无内联回退：warn 不注入', async () => {
    await seedFile('empty.md', '   \n')
    const { handlers, logger } = setupPlugin({
      reminders: [{ id: 'empty', file: 'empty.md', channel: 'steer', skipTools: [] }],
    })
    const turnStopping = getHandler<TurnStoppingHandler>(handlers, 'agent/turn-stopping')
    const agent = makeAgent()

    await turnStopping({ agent, turn: 1, signal: liveSignal() })

    expect(agent.steer).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })
})
