import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'
import { lossSectionText } from '../src/lossProbe.js'
import { readSignals } from '../src/lossStore.js'
import { createGradientTools } from '../src/gradientTools.js'
import type { GradientToolHost } from '../src/gradientTools.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-loss-gradient-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const ev = (type: string, data: unknown): SessionEvent => ({ type, data, seq: 0, time: 0 }) as unknown as SessionEvent

const makeSession = (id: string, delegationDepth?: number): Session =>
  ({ header: delegationDepth === undefined ? { id } : { id, delegationDepth } }) as unknown as Session

const makeAgent = (id: string, delegationDepth?: number): Agent =>
  ({ session: makeSession(id, delegationDepth) }) as unknown as Agent

interface Captured {
  sessionEventHandlers: Array<(session: Session, event: SessionEvent) => void>
  toolResultHandlers: Array<(exec: { name: string; agent?: Agent }, result: { isError?: boolean }) => undefined>
  registered: string[]
  sections: Array<{ name: string; order: number; text: (assembly: { agent?: Agent }) => string }>
}

function install(config?: { enableLossProbe?: boolean; enableGradient?: boolean }): Captured {
  const captured: Captured = { sessionEventHandlers: [], toolResultHandlers: [], registered: [], sections: [] }
  const ctx = {
    on: (name: string, handler: unknown) => {
      if (name === 'session/event') captured.sessionEventHandlers.push(handler as Captured['sessionEventHandlers'][number])
      if (name === 'tools/result') captured.toolResultHandlers.push(handler as Captured['toolResultHandlers'][number])
    },
    systemPrompt: {
      section: (section: Captured['sections'][number]) => {
        captured.sections.push(section)
        return () => {}
      },
    },
    tools: { register: (tool: { name: string }) => captured.registered.push(tool.name) },
    effect: (fn: () => () => void) => fn(),
    logger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
  } as unknown as Context
  apply(ctx, { ruleDir: join(dir, 'rules'), lossDir: join(dir, 'loss'), gradientDir: join(dir, 'gradient'), reminderDir: join(dir, 'reminder'), ...config })
  return captured
}

const fire = (captured: Captured, session: Session, event: SessionEvent) =>
  captured.sessionEventHandlers.forEach(handler => handler(session, event))

/** 等待 fire-and-forget 落盘完成（探针写盘为 void promise，不阻塞事件处理）。 */
const untilCount = async (dirPath: string, options: Parameters<typeof readSignals>[1], length: number) => {
  await vi.waitFor(async () => {
    expect(await readSignals(dirPath, options)).toHaveLength(length)
  })
}

describe('损失探针（apply 接线）', () => {
  it('turn/end error → 落盘 + 摘要视图计数与摘录', async () => {
    const captured = install()
    const session = makeSession('sess-a')
    fire(captured, session, ev('turn/start', { turn: 3 }))
    fire(captured, session, ev('turn/end', { turn: 3, reason: { kind: 'error', error: { message: '连接超时', code: 'ETIMEDOUT' } } }))
    await untilCount(join(dir, 'loss'), { sessionId: 'sess-a' }, 1)
    const signals = await readSignals(join(dir, 'loss'), { sessionId: 'sess-a' })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ kind: 'turn_error', turn: 3 })
    expect(signals[0]?.excerpt).toBe('连接超时')
  })

  it('aborted/max-tokens/completed 分类正确；completed 不记', async () => {
    const captured = install()
    const session = makeSession('sess-b')
    fire(captured, session, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    fire(captured, session, ev('turn/end', { turn: 2, reason: { kind: 'aborted', reason: 'user' } }))
    fire(captured, session, ev('turn/end', { turn: 3, reason: { kind: 'max-tokens' } }))
    await untilCount(join(dir, 'loss'), { sessionId: 'sess-b' }, 2)
    const signals = await readSignals(join(dir, 'loss'), { sessionId: 'sess-b' })
    expect(signals.map(signal => signal.kind)).toEqual(['turn_aborted', 'turn_error'])
    expect(signals[1]?.excerpt).toBe('max-tokens')
  })

  it('llm/retry 宽松比较可记；agent/inbox/spliced 仅 next-step 且非 canceled 记 steer', async () => {
    const captured = install()
    const session = makeSession('sess-c')
    fire(captured, session, ev('llm/retry', { turn: 2, failure: { message: '429 rate limited' } }))
    fire(captured, session, ev('agent/inbox/spliced', { target: 'next-turn', inserted: [{}] }))
    fire(captured, session, ev('agent/inbox/spliced', { target: 'next-step', outcome: 'canceled', inserted: [{}] }))
    fire(captured, session, ev('agent/inbox/spliced', { target: 'next-step', inserted: [{}] }))
    await untilCount(join(dir, 'loss'), { sessionId: 'sess-c' }, 2)
    const signals = await readSignals(join(dir, 'loss'), { sessionId: 'sess-c' })
    expect(signals.map(signal => signal.kind)).toEqual(['retry', 'steer_interrupt'])
    expect(signals[0]?.excerpt).toBe('429 rate limited')
  })

  it('子 agent 会话不采集', async () => {
    const captured = install()
    const child = makeSession('sess-child', 1)
    fire(captured, child, ev('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } }))
    expect(await readSignals(join(dir, 'loss'))).toHaveLength(0)
  })

  it('rule_propose 成功经 tools/result 记强信号；失败不记', async () => {
    const captured = install()
    const agent = makeAgent('sess-d')
    captured.toolResultHandlers.forEach(handler => handler({ name: 'rule_propose', agent }, { isError: false }))
    captured.toolResultHandlers.forEach(handler => handler({ name: 'rule_propose', agent }, { isError: true }))
    captured.toolResultHandlers.forEach(handler => handler({ name: 'memory_write', agent }, { isError: false }))
    await untilCount(join(dir, 'loss'), { sessionId: 'sess-d' }, 1)
    const signals = await readSignals(join(dir, 'loss'), { sessionId: 'sess-d' })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.kind).toBe('rule_propose')
  })

  it('规则段合成损失摘要块；无信号时不含', async () => {
    const captured = install()
    const agent = makeAgent('sess-e')
    const plain = captured.sections[0]!.text({ agent })
    expect(plain).toContain('# 用户反馈规则库')
    expect(plain).not.toContain('回合末损失摘要')

    fire(captured, agent.session as Session, ev('turn/start', { turn: 1 }))
    fire(captured, agent.session as Session, ev('turn/end', { turn: 1, reason: { kind: 'error', error: { message: '模型超时' } } }))
    const withLoss = captured.sections[0]!.text({ agent })
    expect(withLoss).toContain('回合末损失摘要')
    expect(withLoss).toContain('健康分 92/100')
    expect(withLoss).toContain('> 模型超时')
    // 无 agent 装配看不到摘要
    expect(captured.sections[0]!.text({})).not.toContain('回合末损失摘要')
  })

  it('enableLossProbe: false 不订阅事件流、规则段无摘要', async () => {
    const captured = install({ enableLossProbe: false })
    expect(captured.sessionEventHandlers).toHaveLength(0)
    const agent = makeAgent('sess-f')
    expect(captured.sections[0]!.text({ agent })).not.toContain('回合末损失摘要')
  })

  it('noteExternal 供预筛补记 correction_hint', async () => {
    const { createLossProbe: create } = await import('../src/lossProbe.js')
    const probe = create({ lossDirectory: join(dir, 'loss2') })
    const session = makeSession('sess-g')
    probe.noteExternal(session, 'correction_hint', 4, '别用全局变量')
    await untilCount(join(dir, 'loss2'), {}, 1)
    const signals = await readSignals(join(dir, 'loss2'))
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ kind: 'correction_hint', turn: 4, excerpt: '别用全局变量' })
  })
})

describe('lossSectionText', () => {
  it('无视图或零信号返回 undefined', () => {
    expect(lossSectionText(undefined)).toBeUndefined()
  })
})

describe('梯度工具', () => {
  const host = (): GradientToolHost => ({
    gradientDirectory: join(dir, 'gradient'),
    rulesDirectory: join(dir, 'rules'),
    reminderDirectory: join(dir, 'reminder'),
    lossViewFor: (sessionId: string) => (sessionId === 'sess-h' ? { sessionId, score: 84, summary: { total: 2, totalWeight: 16, byKind: { turn_error: 2 } }, excerpts: [] } : undefined),
    logger: { info: () => {}, warn: () => {} },
  })

  const tools = (h: GradientToolHost) => Object.fromEntries(createGradientTools(h).map(tool => [tool.name, tool]))

  it('propose → list（含健康分）→ apply rule 类别 created', async () => {
    await mkdir(join(dir, 'rules'), { recursive: true })
    const t = tools(host())
    const propose = await (t['gradient_propose']!.execute as (args: unknown) => Promise<unknown>)({
      name: 'rule_no_global_state',
      kind: 'rule',
      target: 'no_global_state',
      delta: '组件状态一律放组件属性，不要挂全局单例',
      evidence: 'turn_error=2 回合3-4，归因：全局状态串场',
    })
    expect(propose).toMatchObject({ status: 'proposed' })
    const listResult = await (t['gradient_list']!.execute as (args: unknown, exec?: unknown) => Promise<unknown>)({}, { agent: makeAgent('sess-h') })
    expect(listResult).toMatchObject({ status: 'ok', health: { sessionId: 'sess-h', score: 84 } })
    const applied = await (t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'rule_no_global_state' })
    expect(applied).toMatchObject({ status: 'applied', action: 'created', target: 'no_global_state' })
    const ruleText = await readFile(join(dir, 'rules', 'no_global_state.md'), 'utf8')
    expect(ruleText).toContain('不要挂全局单例')
    const indexText = await readFile(join(dir, 'rules', 'RULES.md'), 'utf8')
    expect(indexText).toContain('no_global_state')
    const { listPendingGradients } = await import('../src/gradientStore.js')
    expect((await listPendingGradients(join(dir, 'gradient'))).proposals).toHaveLength(0)
  })

  it('rule 类别同名无 mode 报错；append 追加带日期小节；冲突检测出疑似重叠规则', async () => {
    await mkdir(join(dir, 'rules'), { recursive: true })
    await writeFile(join(dir, 'rules', 'no_global_state.md'), '组件状态一律放组件属性，不要挂全局单例\n', 'utf8')
    const t = tools(host())
    await (t['gradient_propose']!.execute as (args: unknown) => Promise<unknown>)({
      name: 'rule_no_global_state_v2',
      kind: 'rule',
      target: 'no_global_state',
      delta: '组件状态不要挂全局单例，服务定位器也不行',
      evidence: '用户原话',
    })
    await expect((t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'rule_no_global_state_v2' })).rejects.toThrow(/已存在.*mode/s)
    const applied = await (t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'rule_no_global_state_v2', mode: 'append' })
    expect(applied).toMatchObject({ action: 'appended' })
    expect(applied).toHaveProperty('conflicts')
    const ruleText = await readFile(join(dir, 'rules', 'no_global_state.md'), 'utf8')
    expect(ruleText).toContain('## ')
    expect(ruleText).toContain('服务定位器也不行')
  })

  it('reminder 类别追加文案；超预算拒绝', async () => {
    await mkdir(join(dir, 'reminder'), { recursive: true })
    await writeFile(join(dir, 'reminder', 'memory-end-of-turn.md'), '## 回合末记忆复盘\n\n1. 复盘。\n', 'utf8')
    const t = tools(host())
    await (t['gradient_propose']!.execute as (args: unknown) => Promise<unknown>)({
      name: 'reminder_dot_reply',
      kind: 'reminder',
      target: 'memory-end-of-turn.md',
      delta: '4. 都没有 → 只回复句号「。」。',
      evidence: '用户 2026-09-30 纠正',
    })
    const applied = await (t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'reminder_dot_reply' })
    expect(applied).toMatchObject({ kind: 'reminder', action: 'appended', target: 'memory-end-of-turn.md' })
    const text = await readFile(join(dir, 'reminder', 'memory-end-of-turn.md'), 'utf8')
    expect(text).toContain('只回复句号「。」')

    // 超预算：预置接近上限的文件（7998 + delta 7 字符 + 1 > 8000）
    await writeFile(join(dir, 'reminder', 'big.md'), 'x'.repeat(7998), 'utf8')
    await (t['gradient_propose']!.execute as (args: unknown) => Promise<unknown>)({
      name: 'reminder_big_overflow',
      kind: 'reminder',
      target: 'big.md',
      delta: '这一行会超预算',
      evidence: '测试',
    })
    await expect((t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'reminder_big_overflow' })).rejects.toThrow(/超过预算/)
  })

  it('reminder 目标文件不存在报错；非法目标名在 propose 阶段可落、apply 阶段拦截', async () => {
    await mkdir(join(dir, 'reminder'), { recursive: true })
    const t = tools(host())
    await (t['gradient_propose']!.execute as (args: unknown) => Promise<unknown>)({
      name: 'reminder_missing_target',
      kind: 'reminder',
      target: 'not-exist.md',
      delta: 'x',
      evidence: 'y',
    })
    await expect((t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'reminder_missing_target' })).rejects.toThrow(/不存在/)
  })

  it('instruction 类别只建议不落盘，台账记 suggested', async () => {
    const t = tools(host())
    await (t['gradient_propose']!.execute as (args: unknown) => Promise<unknown>)({
      name: 'instruction_asset_lint_note',
      kind: 'instruction',
      target: 'asset.instructions.md',
      delta: '资产检查器新增字段必须同步 schema',
      evidence: 'retry=3',
    })
    const applied = await (t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'instruction_asset_lint_note' })
    expect(applied).toMatchObject({ action: 'suggested', kind: 'instruction' })
    const { readLedger } = await import('../src/gradientStore.js')
    const ledger = await readLedger(join(dir, 'gradient'))
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ action: 'suggested' })
    expect(await readFile(join(dir, 'instructions', 'asset.instructions.md'), 'utf8').catch(() => 'MISSING')).toBe('MISSING')
  })

  it('apply 不存在的候选报错并列出现有', async () => {
    const t = tools(host())
    await expect((t['gradient_apply']!.execute as (args: unknown) => Promise<unknown>)({ proposal: 'missing_x' })).rejects.toThrow(/不存在/)
  })
})
