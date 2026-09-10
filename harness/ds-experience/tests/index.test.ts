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
): { session: Session } {
  const session = { header } as unknown as Session
  const agent = {
    session,
    inject: (message: Injected) => injections.push(message),
  }
  setup.handlers.get('agent/status')![0]({ agent } as never)
  return { session }
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

  it('enableEndOfTurnReminder: false — 不注册提醒监听', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: dir, enableEndOfTurnReminder: false })
    expect(setup.handlers.get('session/event')).toBeUndefined()
  })
})

describe('prefix 自动联想装配', () => {
  it('<root>/.dsh/experience 形态启用联想（注册 tools/pre-execute 等监听）', () => {
    const setup = fakeCtx()
    apply(setup.ctx, { experienceDir: nestedDir })
    expect(setup.handlers.get('tools/pre-execute')).toHaveLength(1)
    expect(setup.handlers.get('tools/result')).toHaveLength(1)
    expect(setup.handlers.get('agent/pre-step')).toHaveLength(1)
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
