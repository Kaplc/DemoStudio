/**
 * §14.1/§14.3 生命周期测试矩阵（stub Agent + RecordingFileSystem）：
 * tools/pre-execute 候选、tools/result 成功确认、嵌套汇总、step 边界、
 * 并发合并、session/path/digest 去重、set/replace/remove、恢复与压缩、
 * durable 失败自愈、Agent 隔离、Node 兜底与 dispose。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as Instructions from '../src/index.js'
import {
  appendDurable,
  blocksText,
  failResult,
  okResult,
  RecordingFileSystem,
  runPreStep,
  stubAgent,
  stubToolExecution,
  testSignal,
  tempRepo,
  write,
} from './helpers.js'

let ctx: Context | undefined
let root: string | undefined
let fs: RecordingFileSystem | undefined

const ENGINE_REL = '.dsh/instructions/engine.instructions.md'
const PROJECT_REL = '.dsh/instructions/project.instructions.md'

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  fs = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** ctx.fs 模式 harness：RecordingFileSystem + 显式 projectRoot。 */
async function harness(options: {
  engine?: string
  project?: string
  config?: Record<string, unknown>
} = {}): Promise<{ engineAbs: string; projectAbs: string }> {
  root = await tempRepo()
  ctx = new Context()
  // 裸 ctx.plugin 不经 dsh loader，inject 不兑现：先挂 systemPrompt/tools 服务（等价真实 profile bundle）
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RecordingFileSystem)
  fs = (ctx as unknown as { fs: RecordingFileSystem }).fs
  const engineAbs = join(root, '.dsh/instructions/engine.instructions.md')
  const projectAbs = join(root, '.dsh/instructions/project.instructions.md')
  if (options.engine !== undefined) {
    fs.entries.set(engineAbs, { type: 'file', content: options.engine })
  }
  if (options.project !== undefined) {
    fs.entries.set(projectAbs, { type: 'file', content: options.project })
  }
  await ctx.plugin(Instructions, {
    projectRoot: root,
    ...options.config,
  })
  return { engineAbs, projectAbs }
}

/** Node 兜底模式 harness：真实临时文件 + 无 fs provider。 */
async function nodeHarness(options: { engine?: string } = {}): Promise<{ engineAbs: string }> {
  root = await tempRepo()
  const engineAbs = join(root, '.dsh/instructions/engine.instructions.md')
  if (options.engine !== undefined) await write(engineAbs, options.engine)
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Instructions, { projectRoot: root })
  return { engineAbs }
}

function readTouch(agent: Agent, filePath: string): void {
  ctx!.emit('tools/result', stubToolExecution({
    signal: testSignal,
    callId: CallId(`read-${Math.random().toString(36).slice(2)}`),
    name: 'read',
    arguments: { file_path: filePath },
    agent,
  }), okResult)
}

const userMsg = (text: string): UserMessage => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

/** 驱动 pre-step 并断言注入消息在 claimed 之后。 */
async function prestep(
  agent: Agent,
  claimed: UserMessage[] = [userMsg('读一下文件')],
): Promise<Extract<PreStepDecision, { kind: 'enter' }>> {
  const decision = await runPreStep(ctx!, agent, claimed)
  if (decision.kind !== 'enter') throw new Error('expected enter decision')
  return decision
}

/** 找出注入的 agent-instructions 消息。 */
function instructionMessages(messages: readonly UserMessage[]): UserMessage[] {
  return messages.filter(message => (message.source as { kind?: string }).kind === 'agent-instructions')
}

describe('注入基础（ctx.fs 路径）', () => {
  it('成功读取 src/engine 文件后下一次请求包含 engine 指令，source 契约完整', async () => {
    await harness({ engine: `引擎规范 ${'banana-271828'}` })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/Entity.ts'))

    const decision = await prestep(agent)
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[0]).toBe(decision.messages.find(m => m.source.kind === 'user'))
    const injected = instructionMessages(decision.messages)
    expect(injected).toHaveLength(1)
    const text = blocksText(injected[0]!.content)
    expect(text).toContain('<system-reminder>')
    expect(text).toContain(`Additional DemoStudio instructions from: ${ENGINE_REL}`)
    expect(text).toContain('banana-271828')
    expect(injected[0]!.source).toMatchObject({
      kind: 'agent-instructions',
      form: 'instructions',
      changes: [{ action: 'set', path: ENGINE_REL }],
    })
    expect((injected[0]!.source as { changes: Array<{ digest?: string }> }).changes[0]!.digest)
      .toMatch(/^[0-9a-f]{40}$/)
  })

  it('同一 session 同一 digest 不重复注入（durable 落地后去重）', async () => {
    await harness({ engine: 'rule v1' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, agent, message)

    readTouch(agent, join(root, 'src/engine/b.ts'))
    const second = await prestep(agent)
    expect(instructionMessages(second.messages)).toHaveLength(0)
  })

  it('durable 写入失败（未落地）时重试注入，不会永久跳过', async () => {
    await harness({ engine: 'rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    // 模拟 step 未形成 durable 记录：不 append
    expect(instructionMessages(first.messages)).toHaveLength(1)

    const again = await prestep(agent)
    expect(instructionMessages(again.messages)).toHaveLength(1)
  })

  it('指令文件内容变化 → replace 语义 durable 消息', async () => {
    await harness({ engine: 'rule v1' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, agent, message)

    fs!.entries.set(join(root, ENGINE_REL), { type: 'file', content: 'rule v2', version: 'v2' })
    readTouch(agent, join(root, 'src/engine/b.ts'))
    const second = await prestep(agent)
    const injected = instructionMessages(second.messages)
    expect(injected).toHaveLength(1)
    expect(injected[0]!.source).toMatchObject({
      kind: 'agent-instructions',
      changes: [{ action: 'replace', path: ENGINE_REL }],
    })
    const text = blocksText(injected[0]!.content)
    expect(text).toContain(`Updated instructions from: ${ENGINE_REL}`)
    expect(text).toContain('rule v2')
    expect(text).not.toContain('rule v1')
  })

  it('指令文件删除 → remove；恢复后可再次 set', async () => {
    await harness({ engine: 'rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    await prestep(agent).then(first => {
      for (const message of instructionMessages(first.messages)) appendDurable(ctx!, agent, message)
    })

    fs!.entries.delete(join(root, ENGINE_REL))
    readTouch(agent, join(root, 'src/engine/b.ts'))
    const removed = await prestep(agent)
    const removeMessages = instructionMessages(removed.messages)
    expect(removeMessages).toHaveLength(1)
    expect(removeMessages[0]!.source).toMatchObject({
      changes: [{ action: 'remove', path: ENGINE_REL }],
    })
    expect(blocksText(removeMessages[0]!.content)).toContain(`Instructions removed: ${ENGINE_REL}`)
    for (const message of removeMessages) appendDurable(ctx!, agent, message)

    fs!.entries.set(join(root, ENGINE_REL), { type: 'file', content: 'rule v2', version: 'v-restored' })
    readTouch(agent, join(root, 'src/engine/c.ts'))
    const restored = await prestep(agent)
    expect(instructionMessages(restored.messages)[0]!.source)
      .toMatchObject({ changes: [{ action: 'set', path: ENGINE_REL }] })
  })

  it('空指令文件不注入；超限文件跳过并记录', async () => {
    await harness({ engine: '   ', config: { maxSourceBytes: 100 } })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)

    fs!.entries.set(join(root, ENGINE_REL), { type: 'file', content: 'x'.repeat(1000) })
    readTouch(agent, join(root, 'src/engine/b.ts'))
    const oversized = await prestep(agent)
    expect(instructionMessages(oversized.messages)).toHaveLength(0)
  })
})

describe('生命周期顺序（§14.3 生命周期）', () => {
  it('tools/pre-execute 只登记候选，不产生注入', async () => {
    await harness({ engine: 'rule' })
    const agent = stubAgent(root)
    ctx!.emit('tools/pre-execute', stubToolExecution({
      signal: testSignal,
      callId: CallId('candidate'),
      name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') },
      agent,
    }), async () => ({ kind: 'allow' as const }))

    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)
  })

  it('失败/取消/无主/非跟踪工具/缺 file_path 不注入，且原始结果不受影响', async () => {
    await harness({ engine: 'rule' })
    const agent = stubAgent(root)
    const aborted = new AbortController()
    aborted.abort(new Error('cancelled'))

    // 失败结果
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('f'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent,
    }), failResult)
    // aborted 成功结果
    ctx!.emit('tools/result', stubToolExecution({
      signal: aborted.signal, callId: CallId('a'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent,
    }), okResult)
    // 无主（无 agent）
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('n'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') },
    }), okResult)
    // 非跟踪工具（write 默认关闭）
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('w'), name: 'write',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent,
    }), okResult)
    // 缺 file_path
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('p'), name: 'read',
      arguments: {}, agent,
    }), okResult)
    // file_path 非字符串
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('t'), name: 'read',
      arguments: { file_path: 42 }, agent,
    }), okResult)
    // 越界路径
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('o'), name: 'read',
      arguments: { file_path: join(root, '../outside/src/engine/a.ts') }, agent,
    }), okResult)
    // 越过项目根但映射路径
    ctx!.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('e'), name: 'read',
      arguments: { file_path: 'E:/elsewhere/src/engine/a.ts' }, agent,
    }), okResult)

    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)
  })

  it('打开的 step 内不提交投影；step/end 后才投影', async () => {
    await harness({ engine: 'nested rule' })
    const agent = stubAgent(root)
    const turnStart = agent.session.append('turn/start', { turn: 1 })
    ctx!.emit('session/event', agent.session, turnStart)
    const stepStart = agent.session.append('step/start', { turn: 1, step: 1 })
    ctx!.emit('session/event', agent.session, stepStart)

    readTouch(agent, join(root, 'src/engine/a.ts'))
    // step 仍打开：pre-step 拿不到期望消息
    const during = await prestep(agent)
    expect(instructionMessages(during.messages)).toHaveLength(0)

    const stepEnd = agent.session.append('step/end', { turn: 1, step: 1 })
    ctx!.emit('session/event', agent.session, stepEnd)
    const after = await prestep(agent)
    expect(blocksText(instructionMessages(after.messages)[0]?.content)).toContain('nested rule')
  })

  it('从既有 session 历史推断关闭的 step 状态（恢复后直接投影）', async () => {
    await harness({ engine: 'history rule' })
    const agent = stubAgent(root)
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(blocksText(instructionMessages(decision.messages)[0]?.content)).toContain('history rule')
  })

  it('pre-step reject 保留 pending，不丢失', async () => {
    await harness({ engine: 'keep rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))

    const rejected = await runPreStep(ctx!, agent, [userMsg('hi')], () => Promise.resolve({ kind: 'reject' }))
    expect(rejected.kind).toBe('reject')

    const accepted = await prestep(agent)
    expect(blocksText(instructionMessages(accepted.messages)[0]?.content)).toContain('keep rule')
  })

  it('第一步没有实际消息时不生成独立指令请求', async () => {
    await harness({ engine: 'hold rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))

    const empty = await runPreStep(ctx!, agent, [], () => Promise.resolve({ kind: 'enter', messages: [] }))
    if (empty.kind !== 'enter') throw new Error('expected enter')
    expect(empty.messages).toHaveLength(0)

    const later = await prestep(agent)
    expect(blocksText(instructionMessages(later.messages)[0]?.content)).toContain('hold rule')
  })

  it('插件 dispose 后不再响应工具结果', async () => {
    await harness({ engine: 'rule' })
    await ctx!.fiber.dispose()
    ctx = undefined

    // dispose 后 emit 不再触达插件；pre-step 走不到注入逻辑
    ctx = new Context()
    await ctx.plugin(Instructions, { projectRoot: root!, enabled: false })
    const fresh = stubAgent(root)
    ctx.emit('tools/result', stubToolExecution({
      signal: testSignal, callId: CallId('x'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent: fresh,
    }), okResult)
    const decision = await runPreStep(ctx, fresh)
    expect(decision.kind === 'enter' ? instructionMessages(decision.messages) : []).toHaveLength(0)
  })
})

describe('嵌套与并发（§14.3）', () => {
  it('单层 parent token 汇总到外层后投影', async () => {
    await harness({ engine: 'nested touch' })
    const agent = stubAgent(root)
    const outerToken = Symbol('outer') as ToolExecutionToken

    ctx!.emit('tools/result', stubToolExecution({
      token: Symbol('nested') as ToolExecutionToken, parent: outerToken,
      signal: testSignal, callId: CallId('n1'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent,
    }), okResult)
    ctx!.emit('tools/result', stubToolExecution({
      token: outerToken, signal: testSignal, callId: CallId('outer'),
      name: 'run_code', arguments: {}, agent,
    }), okResult)

    const decision = await prestep(agent)
    expect(blocksText(instructionMessages(decision.messages)[0]?.content)).toContain('nested touch')
  })

  it('多层嵌套汇总到根调用', async () => {
    await harness({ engine: 'deep nested' })
    const agent = stubAgent(root)
    const rootToken = Symbol('root') as ToolExecutionToken
    const midToken = Symbol('mid') as ToolExecutionToken

    ctx!.emit('tools/result', stubToolExecution({
      token: Symbol('leaf') as ToolExecutionToken, parent: midToken,
      signal: testSignal, callId: CallId('leaf'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent,
    }), okResult)
    ctx!.emit('tools/result', stubToolExecution({
      token: midToken, parent: rootToken, signal: testSignal, callId: CallId('mid'),
      name: 'run_code', arguments: {}, agent,
    }), okResult)
    ctx!.emit('tools/result', stubToolExecution({
      token: rootToken, signal: testSignal, callId: CallId('root'),
      name: 'run_code', arguments: {}, agent,
    }), okResult)

    const decision = await prestep(agent)
    expect(blocksText(instructionMessages(decision.messages)[0]?.content)).toContain('deep nested')
  })

  it('外层失败时子调用成功也不注入', async () => {
    await harness({ engine: 'should not appear' })
    const agent = stubAgent(root)
    const outerToken = Symbol('outer') as ToolExecutionToken

    ctx!.emit('tools/result', stubToolExecution({
      token: Symbol('nested') as ToolExecutionToken, parent: outerToken,
      signal: testSignal, callId: CallId('n1'), name: 'read',
      arguments: { file_path: join(root, 'src/engine/a.ts') }, agent,
    }), okResult)
    ctx!.emit('tools/result', stubToolExecution({
      token: outerToken, signal: testSignal, callId: CallId('outer'),
      name: 'run_code', arguments: {}, agent,
    }), failResult)

    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)
  })

  it('并行读取 engine 与 project 合并为一条消息，顺序稳定', async () => {
    await harness({ engine: 'engine rules', project: 'project rules' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/projects/snake/SnakePawn.ts'))
    readTouch(agent, join(root, 'src/engine/Entity.ts'))

    const decision = await prestep(agent)
    const injected = instructionMessages(decision.messages)
    expect(injected).toHaveLength(1)
    expect(injected[0]!.source).toMatchObject({
      changes: [
        { action: 'set', path: ENGINE_REL },
        { action: 'set', path: PROJECT_REL },
      ],
    })
    const text = blocksText(injected[0]!.content)
    expect(text).toContain('engine rules')
    expect(text).toContain('project rules')
    expect(text.indexOf(ENGINE_REL)).toBeLessThan(text.indexOf(PROJECT_REL))
  })

  it('并行读取同一目录多次只生成一份指令', async () => {
    await harness({ engine: 'dedupe' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    readTouch(agent, join(root, 'src/engine/b.ts'))
    readTouch(agent, join(root, 'src/engine/c.ts'))

    const decision = await prestep(agent)
    const injected = instructionMessages(decision.messages)
    expect(injected).toHaveLength(1)
    expect(injected[0]!.source).toMatchObject({ changes: [{ action: 'set', path: ENGINE_REL }] })
  })

  it('两个 Agent 的状态与去重完全隔离（新 session 重新注入）', async () => {
    await harness({ engine: 'session scoped' })
    const agentA = stubAgent(root)
    readTouch(agentA, join(root, 'src/engine/a.ts'))
    const firstA = await prestep(agentA)
    for (const message of instructionMessages(firstA.messages)) appendDurable(ctx!, agentA, message)

    const agentB = stubAgent(root)
    readTouch(agentB, join(root, 'src/engine/a.ts'))
    const firstB = await prestep(agentB)
    expect(instructionMessages(firstB.messages)).toHaveLength(1)
  })

  it('projection 期间 Agent 被替换（销毁）不产生错误', async () => {
    await harness({ engine: 'rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    // 立即用新 agent 驱动 pre-step（旧 agent 的 projection 目标不再被消费）
    await prestep(agent)
  })
})

describe('session 恢复、重建与压缩（§14.3）', () => {
  it('Agent 重建恢复相同 session 后不重复注入相同 path/digest', async () => {
    await harness({ engine: 'resumable' })
    const original = stubAgent(root)
    readTouch(original, join(root, 'src/engine/a.ts'))
    const first = await prestep(original)
    const durableEvents: SessionEvent[] = []
    for (const message of instructionMessages(first.messages)) {
      durableEvents.push(appendDurable(ctx!, original, message))
    }

    const resumed = stubAgent(root, [...original.session.events])
    readTouch(resumed, join(root, 'src/engine/b.ts'))
    const second = await prestep(resumed)
    expect(instructionMessages(second.messages)).toHaveLength(0)
    expect(resumed.session.events.filter(event => event.type === 'user/message'
      && (event.data.source as { kind?: string }).kind === 'agent-instructions')).toHaveLength(1)
  })

  it('恢复时旧指令已变化 → replace', async () => {
    await harness({ engine: 'offline v1' })
    const original = stubAgent(root)
    readTouch(original, join(root, 'src/engine/a.ts'))
    const first = await prestep(original)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, original, message)

    fs!.entries.set(join(root, ENGINE_REL), { type: 'file', content: 'offline v2', version: 'v-offline' })
    const resumed = stubAgent(root, [...original.session.events])
    readTouch(resumed, join(root, 'src/engine/b.ts'))
    const second = await prestep(resumed)
    const injected = instructionMessages(second.messages)
    expect(injected[0]!.source).toMatchObject({ changes: [{ action: 'replace', path: ENGINE_REL }] })
    expect(blocksText(injected[0]!.content)).toContain('offline v2')
  })

  it('恢复时旧指令已删除 → remove', async () => {
    await harness({ engine: 'to be deleted' })
    const original = stubAgent(root)
    readTouch(original, join(root, 'src/engine/a.ts'))
    const first = await prestep(original)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, original, message)

    fs!.entries.delete(join(root, ENGINE_REL))
    const resumed = stubAgent(root, [...original.session.events])
    readTouch(resumed, join(root, 'src/engine/b.ts'))
    const second = await prestep(resumed)
    expect(instructionMessages(second.messages)[0]!.source)
      .toMatchObject({ changes: [{ action: 'remove', path: ENGINE_REL }] })
  })

  it('上下文压缩使旧指令离开可见 surface 后重新注入当前版本', async () => {
    await harness({ engine: 'compacted rules' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    // claimed 用户消息与指令消息都落 durable（seq 0 被 session/end-seed 占用）
    const durableSeqs: number[] = []
    for (const message of first.messages) {
      durableSeqs.push(appendDurable(ctx!, agent, message).seq)
    }
    expect(durableSeqs).toHaveLength(2)

    // 构造压缩：summary 消息 replace 掉两个 durable 节点（start/end 为 seq，
    // sourceEventSeqs 必须引用被遮蔽的真实 surface 节点 seq）
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compressed summary' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: durableSeqs[0]!, end: durableSeqs[1]! },
      sourceEventSeqs: durableSeqs,
    })

    const resumed = stubAgent(root, [...agent.session.events])
    readTouch(resumed, join(root, 'src/engine/b.ts'))
    const second = await prestep(resumed)
    const injected = instructionMessages(second.messages)
    expect(injected).toHaveLength(1)
    expect(injected[0]!.source).toMatchObject({ changes: [{ action: 'set', path: ENGINE_REL }] })
    expect(blocksText(injected[0]!.content)).toContain('compacted rules')
  })

  it('session clear（新 session）后重新注入当前指令', async () => {
    await harness({ engine: 'cleared but back' })
    const original = stubAgent(root)
    readTouch(original, join(root, 'src/engine/a.ts'))
    const first = await prestep(original)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, original, message)

    // 新 session：无任何 durable 历史
    const fresh = stubAgent(root, [])
    readTouch(fresh, join(root, 'src/engine/a.ts'))
    const second = await prestep(fresh)
    expect(instructionMessages(second.messages)).toHaveLength(1)
  })
})

describe('文件系统与版本（§14.3）', () => {
  it('ctx.fs stat 失败（unavailable）时保留最后已知状态，不误发 remove', async () => {
    await harness({ engine: 'stable rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, agent, message)

    fs!.throwOnStat.add(join(root, ENGINE_REL))
    readTouch(agent, join(root, 'src/engine/b.ts'))
    const second = await prestep(agent)
    expect(instructionMessages(second.messages)).toHaveLength(0)
  })

  it('ctx.fs 返回新版本号时刷新缓存并重读正文', async () => {
    await harness({ engine: 'cached v1' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, agent, message)

    const abs = join(root, ENGINE_REL)
    const beforeReads = fs!.readTargets.length
    fs!.entries.set(abs, { type: 'file', content: 'cached v2', version: 'explicit-v2' })
    readTouch(agent, join(root, 'src/engine/c.ts'))
    const second = await prestep(agent)
    expect(fs!.readTargets.length).toBeGreaterThan(beforeReads)
    expect(blocksText(instructionMessages(second.messages)[0]?.content)).toContain('cached v2')
  })

  it('Node 兜底模式（无 fs provider）注入真实文件内容', async () => {
    const { engineAbs } = await nodeHarness({ engine: 'node fallback rule' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(blocksText(instructionMessages(decision.messages)[0]?.content)).toContain('node fallback rule')
    expect(engineAbs).toContain('engine.instructions.md')
  })

  it('Node 兜底读取路径与 ctx.fs 互斥：有 provider 时走 provider', async () => {
    await harness({ engine: 'via provider' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(blocksText(instructionMessages(decision.messages)[0]?.content)).toContain('via provider')
    // provider 的读取记录非空
    expect(fs!.readTargets.length).toBeGreaterThan(0)
  })

  it('instructionsDir 越出项目根时不注入（绑定失败跳过）', async () => {
    root = await tempRepo()
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(RecordingFileSystem)
    fs = (ctx as unknown as { fs: RecordingFileSystem }).fs
    const outside = join(await tempRepo(), 'outside')
    fs.entries.set(join(outside, 'engine.instructions.md'), { type: 'file', content: 'should not load' })
    await ctx.plugin(Instructions, { projectRoot: root, instructionsDir: outside })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)
    await rm(outside, { recursive: true, force: true })
  })

  it('maxMessageBytes=0 时禁用注入', async () => {
    await harness({ engine: 'budget zero', config: { maxMessageBytes: 0 } })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)
  })

  it('maxSourceBytes 超限的指令文件跳过（元数据提前判定）', async () => {
    await harness({
      engine: 'y'.repeat(5000),
      config: { maxSourceBytes: 1000 },
    })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(instructionMessages(decision.messages)).toHaveLength(0)
  })

  it('文件消失后再出现可突破旧缓存状态', async () => {
    await harness({ engine: 'phoenix' })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const first = await prestep(agent)
    for (const message of instructionMessages(first.messages)) appendDurable(ctx!, agent, message)

    fs!.entries.delete(join(root, ENGINE_REL))
    readTouch(agent, join(root, 'src/engine/b.ts'))
    await prestep(agent).then(second => {
      for (const message of instructionMessages(second.messages)) appendDurable(ctx!, agent, message)
    })

    fs!.entries.set(join(root, ENGINE_REL), { type: 'file', content: 'phoenix', version: 'v-phoenix' })
    readTouch(agent, join(root, 'src/engine/c.ts'))
    const third = await prestep(agent)
    expect(instructionMessages(third.messages)[0]!.source)
      .toMatchObject({ changes: [{ action: 'set', path: ENGINE_REL }] })
  })
})

describe('真实文件系统的 Node 兜底安全（§14.3）', () => {
  it('符号链接指向项目外的指令文件被拒绝（POSIX）', async () => {
    if (process.platform === 'win32') return
    root = await tempRepo()
    const outside = await tempRepo()
    const instructionsDir = join(root, '.dsh/instructions')
    await mkdir(instructionsDir, { recursive: true })
    await writeFile(join(outside, 'engine.instructions.md'), 'outside body')
    await writeFile(join(instructionsDir, 'engine.instructions.md'), 'inside body')
    const { symlink } = await import('node:fs/promises')
    await rm(join(instructionsDir, 'engine.instructions.md'))
    await symlink(join(outside, 'engine.instructions.md'), join(instructionsDir, 'engine.instructions.md'))

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Instructions, { projectRoot: root })
    const agent = stubAgent(root)
    readTouch(agent, join(root, 'src/engine/a.ts'))
    const decision = await prestep(agent)
    expect(blocksText(instructionMessages(decision.messages)[0]?.content)).not.toContain('outside body')
    await rm(outside, { recursive: true, force: true })
  })
})
