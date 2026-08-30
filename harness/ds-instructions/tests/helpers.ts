/**
 * 测试公共设施：RecordingFileSystem（内存 fs provider）、stub Agent/Session、
 * 工具执行桩与 pre-step 驱动助手（对齐官方 agent-instructions 测试的桩模式）。
 *
 * @module tests/helpers
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { FsTargetKey, FsVersion, FileSystem, type FsDirEntry, type FsEditOutcome, type FsEditRequest, type FsInfo, type FsPathInfo, type FsTarget, type FsWriteIntent, type FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'

/** 布尔探针：嵌进指令正文便于断言。 */
export const PROBE = 'banana-271828'
export const NESTED_PROBE = 'papaya-314159'
export const UPDATED_PROBE = 'guava-161803'

export const testSignal = new AbortController().signal

export async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ds-instructions-'))
}

export async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

/**
 * 内存 FileSystem：entries 以绝对路径为键，可注入 stat/read 失败与缺席 size。
 */
export class RecordingFileSystem extends FileSystem {
  entries = new Map<string, { type: FsInfo['type']; content?: string; version?: string }>()
  throwOnStat = new Set<string>()
  throwOnRead = new Set<string>()
  omitSizes = new Set<string>()
  readTargets: string[] = []
  signals: AbortSignal[] = []

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    if (opts?.signal !== undefined) this.signals.push(opts.signal)
    opts?.signal?.throwIfAborted()
    const absolute = resolve(opts?.cwd ?? '/', path)
    return { targetKey: FsTargetKey(absolute), displayPath: absolute }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    const descendant = relative(String(parent.targetKey), String(child.targetKey))
    return descendant === '' || (!descendant.startsWith('..') && !isAbsolute(descendant))
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    if (signal !== undefined) this.signals.push(signal)
    signal?.throwIfAborted()
    if (this.throwOnStat.has(target.targetKey)) throw new Error(`stat failed: ${target.displayPath}`)
    const entry = this.entries.get(target.targetKey)
    if (entry === undefined) return undefined
    const info: FsInfo = {
      version: FsVersion(entry.version ?? `v:${target.targetKey}:${entry.type}:${entry.content ?? ''}`),
      type: entry.type,
    }
    if (entry.content !== undefined && !this.omitSizes.has(target.targetKey)) {
      info.size = Buffer.byteLength(entry.content, 'utf8')
    }
    return info
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    if (signal !== undefined) this.signals.push(signal)
    signal?.throwIfAborted()
    const target = await this.resolve(path, { ...opts, ...(signal === undefined ? {} : { signal }) })
    const info = await this.stat(target, signal)
    if (info === undefined) return undefined
    return { version: info.version, type: info.type, ...(info.size !== undefined ? { size: info.size } : {}) }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    if (signal !== undefined) this.signals.push(signal)
    signal?.throwIfAborted()
    return this.entries.get(target.targetKey)?.content ?? ''
  }

  override async readBytes(_target: FsTarget, _signal: AbortSignal | undefined, _maxBytes: number): Promise<Uint8Array> {
    throw new Error('not needed in ds-instructions tests')
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    if (signal !== undefined) this.signals.push(signal)
    signal?.throwIfAborted()
    this.readTargets.push(target.targetKey)
    if (this.throwOnRead.has(target.targetKey)) throw new Error(`read failed: ${target.displayPath}`)
    const content = this.entries.get(target.targetKey)?.content ?? ''
    return (async function* () {
      const midpoint = Math.ceil(content.length / 2)
      yield content.slice(0, midpoint)
      signal?.throwIfAborted()
      yield content.slice(midpoint)
    })()
  }

  override async listDir(_target: FsTarget): Promise<FsDirEntry[]> {
    return []
  }

  override async writeText(_target: FsTarget, _content: string, _expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    return { operation: 'update', version: FsVersion('unused'), before: '', after: _content }
  }

  override async editText(_target: FsTarget, _edit: FsEditRequest): Promise<FsEditOutcome> {
    return { version: FsVersion('unused'), before: '', after: '' }
  }
}

/** 构造满足 Agent 结构的内存桩（与官方测试一致的桩形状）。 */
export function stubAgent(cwd?: string, seed: SessionEvent[] = []): Agent {
  const id = SessionId('s1')
  const session = Session.create(id, seed, cwd === undefined ? undefined : { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd })
  return {
    ctx: new Context(),
    id: SessionId('a1'),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** 工具执行桩（token 可指定以构造嵌套 parent 链）。 */
export function stubToolExecution(
  input: Omit<ToolExecution, 'token' | 'rootCallId'> & {
    token?: ToolExecutionToken
    rootCallId?: ToolExecution['rootCallId']
  },
): ToolExecution {
  return {
    token: input.token ?? Symbol('ds-instructions-test-execution') as ToolExecutionToken,
    ...input,
    rootCallId: input.rootCallId ?? input.callId,
  }
}

export function blocksText(blocks: { type: string; text?: string }[] | undefined): string {
  return blocks?.map(block => block.type === 'text' ? block.text ?? '' : '').join('\n') ?? ''
}

export const okResult = { content: [] as never[], isError: false as const, value: null }
export const failResult = { content: [] as never[], isError: true as const, error: { message: 'failed' } }

/** 驱动一次 pre-step waterfall（claimed 批次与下游实现可定制）。 */
export async function runPreStep(
  ctx: Context,
  agent: Agent,
  claimed: UserMessage[] = [],
  nextImpl?: () => Promise<{ kind: 'enter'; messages: UserMessage[] } | { kind: 'reject' }>,
): Promise<{ kind: 'enter'; messages: UserMessage[] } | { kind: 'reject' }> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: claimed, turn: 1, step: 1, signal: testSignal },
    nextImpl ?? (() => Promise.resolve({ kind: 'enter' as const, messages: claimed })),
  )
}

/** 轮询等待探针产生值（投影是异步的）。 */
export async function waitFor<T>(probe: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** 创建被 session 采纳并广播的 user/message 事件（模拟 loop 进入 step 后落 durable）。 */
export function appendDurable(ctx: Context, agent: Agent, message: UserMessage): SessionEvent {
  const event = agent.session.append('user/message', message, { surfaceOp: 'append' })
  ctx.emit('session/event', agent.session, event)
  return event
}

export { createUserMessage, CallId }
