import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'

let dir: string
let nestedDir: string // <root>/.dsh/experience 形态（联想项目根可推导）

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-index-'))
  nestedDir = join(dir, '.dsh', 'experience')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function ev(type: string): SessionEvent {
  return { type, data: {}, seq: 0, time: 0 } as unknown as SessionEvent
}

type AnyHandler = (...args: never[]) => unknown

interface Injected {
  /** createUserMessage 的 content：分块数组（text 块含正文）。 */
  content: Array<{ type: string; text?: string }>
  source?: { kind: string; plugin: string; form: string; summary: string }
}

/** 抽取注入消息的纯文本（拼接全部 text 块）。 */
function injectedText(message: Injected): string {
  return message.content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')
}

interface TestSetup {
  ctx: Context
  sections: Array<{ name: string; order: number; text: () => string | undefined }>
  registeredTools: string[]
  handlers: Map<string, AnyHandler[]>
  warns: unknown[][]
  injected: Injected[]
}

function fakeCtx(): TestSetup {
  const sections: TestSetup['sections'] = []
  const registeredTools: string[] = []
  const handlers = new Map<string, AnyHandler[]>()
  const warns: unknown[][] = []
  const injected: Injected[] = []
  const sessionAgents: unknown[] = []
  void sessionAgents
  const ctx = {
    systemPrompt: {
      section(section: { name: string; order: number; text: () => string | undefined }) {
        sections.push(section)
      },
    },
    tools: {
      register(tool: { name: string }) {
        registeredTools.push(tool.name)
      },
    },
    sessionQuery: {},
    on(event: string, handler: AnyHandler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    logger(name: string) {
      void name
      return {
        warn: (...args: unknown[]) => warns.push(args),
        info: () => {},
        debug: () => {},
      }
    },
  } as unknown as Context
  return { ctx, sections, registeredTools, handlers, warns, injected }
}

/** 构造 agent 并经 agent/status 事件登记（生产链路：agent/created + agent/status 双保险）。 */
function registerAgent(
  setup: TestSetup,
  injections: Injected[],
  header: Record<string, unknown> = {},
): { session: Session; agent: Record<string, unknown> } {
  const session = { header } as unknown as Session
  const agent: Record<string, unknown> = {
    session,
    inject: (message: Injected) => injections.push(message),
  }
  setup.handlers.get('agent/status')![0]({ agent } as never)
  return { session, agent }
}

describe('apply 注册冒烟', () => {
  it('注册 1 个指导段 + 4 个工具', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    expect(setup.sections).toHaveLength(1)
    expect(setup.sections[0]!.name).toBe('experience:guide')
    expect(setup.registeredTools.sort()).toEqual([
      'experience_save', 'experience_search', 'history_read', 'history_search',
    ])
  })

  it('enabled: false — 什么都不注册', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { enabled: false, experienceDir: dir })
    expect(setup.sections).toHaveLength(0)
    expect(setup.registeredTools).toHaveLength(0)
    expect(setup.handlers.size).toBe(0)
  })
})

describe('回合末经验提醒', () => {
  it('turn/end 注入提醒，来源与内容正确', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    expect(setup.handlers.get('session/event')).toHaveLength(1)
    const injected: Injected[] = []
    const { session } = registerAgent(setup, injected)
    setup.handlers.get('session/event')![0](session, ev('turn/end') as never)
    expect(injected).toHaveLength(1)
    const source = injected[0]!.source as { kind: string; plugin: string; form: string; summary: string }
    expect(source).toMatchObject({
      kind: 'plugin', plugin: '@demostudio/ds-experience', form: 'notice',
    })
    const text = injectedText(injected[0]!)
    expect(text).toContain('回合末经验提醒')
    expect(text).toContain('experience_save')
    expect(text).toContain('prefix 必填')
  })

  it('60 秒冷却按 agent 记：冷却内第二次 turn/end 不重复注入', () => {
    vi.useFakeTimers()
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    const injected: Injected[] = []
    const { session } = registerAgent(setup, injected)
    const handler = setup.handlers.get('session/event')![0]
    handler(session, ev('turn/end') as never)
    vi.advanceTimersByTime(30_000)
    handler(session, ev('turn/end') as never)
    expect(injected).toHaveLength(1)
    vi.advanceTimersByTime(31_000)
    handler(session, ev('turn/end') as never)
    expect(injected).toHaveLength(2)
  })

  it('未登记 session 走可见 warn；子 agent 不注入；非 turn/end 不触发', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    const handler = setup.handlers.get('session/event')![0]
    // session 未登记 agent：warn 可见（不静默跳过），不注入
    const warnCount = setup.warns.length
    handler({ header: {} } as unknown as Session, ev('turn/end') as never)
    expect(setup.warns.length).toBeGreaterThan(warnCount)
    // 子 agent（delegationDepth>0）：不注入
    const childInjected: Injected[] = []
    const child = registerAgent(setup, childInjected, { delegationDepth: 1 })
    handler(child.session, ev('turn/end') as never)
    expect(childInjected).toHaveLength(0)
    // 已登记的主 agent + 非 turn/end：不注入
    const injected: Injected[] = []
    const main = registerAgent(setup, injected)
    handler(main.session, ev('turn/start') as never)
    expect(injected).toHaveLength(0)
  })

  it('enableEndOfTurnReminder: false — 不注册提醒监听（session/event + 跳过判定的 pre-step/tools-result）', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir, enableEndOfTurnReminder: false })
    expect(setup.handlers.get('session/event')).toBeUndefined()
    // experienceDir 非标准形态时联想不注册监听，这里的 agent/pre-step、tools/result 全部来自提醒跳过判定
    expect(setup.handlers.get('agent/pre-step')).toBeUndefined()
    expect(setup.handlers.get('tools/result')).toBeUndefined()
  })
})

describe('回合末经验提醒：本回合已 experience_save 则跳过', () => {
  type PreStepHandler = (
    payload: { agent: Record<string, unknown>; turn: number },
    next: () => Promise<Record<string, unknown>>,
  ) => Promise<unknown>
  type ToolResultHandler = (
    exec: { name: string; agent?: Record<string, unknown> },
    result: { isError: boolean },
  ) => unknown

  interface SkipSetup {
    setup: TestSetup
    preStep: PreStepHandler
    toolResult: ToolResultHandler
  }

  /** 装配插件并取出跳过判定监听器（experienceDir 非标准形态 → 联想不注册，监听器全部来自提醒块）。 */
  function setupWithSkip(): SkipSetup {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir })
    const preStep = setup.handlers.get('agent/pre-step')!.at(-1) as PreStepHandler
    const toolResult = setup.handlers.get('tools/result')!.at(-1) as ToolResultHandler
    expect(preStep).toBeDefined()
    expect(toolResult).toBeDefined()
    return { setup, preStep, toolResult }
  }

  /** 走一遍"回合内保存成功"：pre-step 记回合号 → tools/result 记保存成功。 */
  async function saveInTurn(
    preStep: PreStepHandler,
    toolResult: ToolResultHandler,
    agent: Record<string, unknown>,
    turn: number,
    toolName: string,
    isError = false,
  ): Promise<void> {
    await preStep({ agent, turn }, async () => ({ kind: 'continue', messages: [] }))
    toolResult({ name: toolName, agent }, { isError })
  }

  function fireTurnEnd(setup: TestSetup, session: Session): void {
    setup.handlers.get('session/event')![0](session, ev('turn/end') as never)
  }

  it('本回合 experience_save 成功：跳过提醒', async () => {
    const { setup, preStep, toolResult } = setupWithSkip()
    const injected: Injected[] = []
    const { session, agent } = registerAgent(setup, injected)
    await saveInTurn(preStep, toolResult, agent, 3, 'experience_save')

    fireTurnEnd(setup, session)

    expect(injected).toHaveLength(0)
  })

  it('本回合只保存了记忆（memory_write）：经验提醒照常注入（各自只看自己）', async () => {
    const { setup, preStep, toolResult } = setupWithSkip()
    const injected: Injected[] = []
    const { session, agent } = registerAgent(setup, injected)
    await saveInTurn(preStep, toolResult, agent, 3, 'memory_write')

    fireTurnEnd(setup, session)

    expect(injected).toHaveLength(1)
  })

  it('保存在更早的回合：本回合仍提醒', async () => {
    const { setup, preStep, toolResult } = setupWithSkip()
    const injected: Injected[] = []
    const { session, agent } = registerAgent(setup, injected)
    await saveInTurn(preStep, toolResult, agent, 3, 'experience_save')
    await preStep({ agent, turn: 4 }, async () => ({ kind: 'continue', messages: [] }))

    fireTurnEnd(setup, session)

    expect(injected).toHaveLength(1)
  })

  it('保存失败（isError）：不算已保存，仍提醒', async () => {
    const { setup, preStep, toolResult } = setupWithSkip()
    const injected: Injected[] = []
    const { session, agent } = registerAgent(setup, injected)
    await saveInTurn(preStep, toolResult, agent, 5, 'experience_save', true)

    fireTurnEnd(setup, session)

    expect(injected).toHaveLength(1)
  })

  it('未观测到回合号（无 pre-step）：不登记，仍提醒（fail-open）', () => {
    const { setup, toolResult } = setupWithSkip()
    const injected: Injected[] = []
    const { session, agent } = registerAgent(setup, injected)
    toolResult({ name: 'experience_save', agent }, { isError: false })

    fireTurnEnd(setup, session)

    expect(injected).toHaveLength(1)
  })

  it('reminderSkipTools: [] 关闭判定：保存后仍提醒', async () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir, reminderSkipTools: [] })
    const preStep = setup.handlers.get('agent/pre-step')!.at(-1) as PreStepHandler
    const toolResult = setup.handlers.get('tools/result')!.at(-1) as ToolResultHandler
    const injected: Injected[] = []
    const { session, agent } = registerAgent(setup, injected)
    await saveInTurn(preStep, toolResult, agent, 6, 'experience_save')

    fireTurnEnd(setup, session)

    expect(injected).toHaveLength(1)
  })

  it('agent/pre-step 原样透传下游决策（waterfall 不 veto）', async () => {
    const { setup, preStep } = setupWithSkip()
    const injected: Injected[] = []
    const { agent } = registerAgent(setup, injected)
    const decision = { kind: 'continue', messages: [] }
    const next = vi.fn(async () => decision)

    const returned = await preStep({ agent, turn: 11 }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(returned).toBe(decision)
  })
})

describe('prefix 自动联想装配', () => {
  it('<root>/.dsh/experience 形态启用联想（注册 tools/pre-execute 等监听）', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: nestedDir })
    expect(setup.handlers.get('tools/pre-execute')).toHaveLength(1)
    // tools/result、agent/pre-step 各 2 个：联想器 + 回合末提醒的"已保存"跳过判定（各自独立注册）
    expect(setup.handlers.get('tools/result')).toHaveLength(2)
    expect(setup.handlers.get('agent/pre-step')).toHaveLength(2)
  })

  it('非标准目录形态：联想停用并 warn，不抛出', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: join(dir, 'somewhere-else') })
    expect(setup.handlers.get('tools/pre-execute')).toBeUndefined()
    expect(setup.warns.length).toBeGreaterThan(0)
  })

  it('enableAutoAssociate: false — 不注册联想监听', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: nestedDir, enableAutoAssociate: false })
    expect(setup.handlers.get('tools/pre-execute')).toBeUndefined()
  })
})
