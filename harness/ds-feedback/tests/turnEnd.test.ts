import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-turn-end-'))
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
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
function correctionTurn(): SessionEvent[] {
  return [
    ev('turn/start', { turn: 1 }),
    userMsg('不对，移动判定必须服务端权威，别在客户端算位置，改掉'),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"path":"movement.ts"}' }),
    assistantMsg(1, '已改为服务端权威判定。'),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/** 无纠正的普通任务回合。 */
function plainTurn(turn: number): SessionEvent[] {
  return [
    ev('turn/start', { turn }),
    userMsg('把鱼塘场景的背景色改成深蓝'),
    assistantMsg(turn, '已改好。'),
    ev('turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

const makeAgent = (events: SessionEvent[], delegationDepth?: number): Agent =>
  ({
    session: {
      header: delegationDepth === undefined ? {} : { delegationDepth },
      events,
    },
  }) as unknown as Agent

interface StatusHandler {
  (payload: { agent: Agent; status: string }): void
}

/** 最小 Cordis ctx 桩：捕获规则段与 agent/status 监听。 */
function install(autoDetect = true): {
  sections: Array<{ name: string; order: number; text: (assembly: { agent?: Agent }) => string }>
  statusHandlers: StatusHandler[]
} {
  const sections: Array<{ name: string; order: number; text: (assembly: { agent?: Agent }) => string }> = []
  const statusHandlers: StatusHandler[] = []
  const ctx = {
    on: (name: string, handler: StatusHandler) => {
      if (name === 'agent/status') statusHandlers.push(handler)
    },
    systemPrompt: {
      section: (section: { name: string; order: number; text: (assembly: { agent?: Agent }) => string }) => {
        sections.push(section)
        return () => {}
      },
    },
    tools: { register: () => {} },
    effect: (fn: () => () => void) => fn(),
  } as unknown as Context
  apply(ctx, { ruleDir: dir, autoDetect })
  return { sections, statusHandlers }
}

const idle = (handlers: StatusHandler[], agent: Agent) =>
  handlers.forEach(handler => handler({ agent, status: 'idle' }))
const running = (handlers: StatusHandler[], agent: Agent) =>
  handlers.forEach(handler => handler({ agent, status: 'running' }))
const settle = () => vi.advanceTimersByTimeAsync(3_000)
const sectionText = (
  sections: Array<{ text: (assembly: { agent?: Agent }) => string }>,
  agent?: Agent,
) => sections[0]!.text(agent === undefined ? {} : { agent })

describe('回合末预筛接线（apply）', () => {
  it('命中回合后规则段挂提示，下一回合未命中自动撤下', async () => {
    const { sections, statusHandlers } = install()
    const events = [...correctionTurn()]
    const agent = makeAgent(events)

    idle(statusHandlers, agent)
    await settle()
    const hinted = sectionText(sections, agent)
    expect(hinted).toContain('# 用户反馈规则库')
    expect(hinted).toContain('## ⚠ 回合末纠正提示（1 号回合，待判定）')
    expect(hinted).toContain('别在客户端算位置')

    events.push(...plainTurn(2))
    idle(statusHandlers, agent)
    await settle()
    expect(sectionText(sections, agent)).not.toContain('## ⚠ 回合末纠正提示')
  })

  it('普通回合不挂提示，规则段本体照常渲染', async () => {
    const { sections, statusHandlers } = install()
    const agent = makeAgent(plainTurn(1))
    idle(statusHandlers, agent)
    await settle()
    const text = sectionText(sections, agent)
    expect(text).toContain('# 用户反馈规则库')
    expect(text).not.toContain('## ⚠ 回合末纠正提示')
  })

  it('提示按 agent 隔离：其他 agent 与无 agent 装配看不到', async () => {
    const { sections, statusHandlers } = install()
    const agentA = makeAgent(correctionTurn())
    const agentB = makeAgent(plainTurn(1))

    idle(statusHandlers, agentA)
    await settle()
    expect(sectionText(sections, agentA)).toContain('回合末纠正提示')
    expect(sectionText(sections, agentB)).not.toContain('## ⚠ 回合末纠正提示')
    expect(sectionText(sections)).not.toContain('## ⚠ 回合末纠正提示')
  })

  it('子 agent（delegationDepth > 0）不做预筛', async () => {
    const { sections, statusHandlers } = install()
    const child = makeAgent(correctionTurn(), 1)
    idle(statusHandlers, child)
    await settle()
    expect(sectionText(sections, child)).not.toContain('## ⚠ 回合末纠正提示')
  })

  it('running 撤销未触发的预筛，水位留待下次空闲补检', async () => {
    const { sections, statusHandlers } = install()
    const agent = makeAgent(correctionTurn())

    idle(statusHandlers, agent)
    running(statusHandlers, agent)
    await settle()
    expect(sectionText(sections, agent)).not.toContain('## ⚠ 回合末纠正提示')

    // 下次空闲用原水位补检，命中照常出现
    idle(statusHandlers, agent)
    await settle()
    expect(sectionText(sections, agent)).toContain('回合末纠正提示')
  })

  it('autoDetect: false 不注册预筛监听，规则段仍注册', async () => {
    const { sections, statusHandlers } = install(false)
    expect(statusHandlers).toHaveLength(0)
    expect(sections).toHaveLength(1)
    expect(sectionText(sections)).toContain('# 用户反馈规则库')
  })
})
