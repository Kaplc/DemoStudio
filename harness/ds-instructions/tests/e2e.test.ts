/**
 * §14.2 集成测试：完整 Agent 循环（LlmRuntime + SessionStore + SystemPrompt +
 * ToolRuntime + AgentRegistry + AgentLoop + LocalFileSystem + ToolFs + 本插件）。
 * Mock LLM 驱动真实 read 工具，检查下一次 LLM 请求的 messages、durable session
 * 事件、去重与 replace 语义、system prompt 段。
 *
 * 测试方法约束（§14.3）：不以 Agent 回答为证据；检查实际写入的 durable
 * user/message 与下一次 LLM 请求的 messages。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId, createUserMessage, LlmAdapter, LlmRuntime, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { afterEach, describe, expect, it } from 'vitest'
import * as Instructions from '../src/index.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

// ─────────────────────────── Mock LLM ───────────────────────────

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id: callId, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** 脚本化 Mock adapter：记录每次请求供断言。 */
class MockAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('MockAdapter: script exhausted')
    for (const chunk of entry) yield chunk
  }
}

// ─────────────────────────── harness ───────────────────────────

let ctx: Context | undefined
let workdir: string | undefined
let adapter: MockAdapter | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  adapter = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

async function harness(buildScript: (dir: string) => StreamChunk[][]): Promise<Agent> {
  const { mkdir } = await import('node:fs/promises')
  workdir = await mkdtemp(join(tmpdir(), 'dsh-instr-e2e-'))
  await mkdir(join(workdir, '.dsh/instructions'), { recursive: true })
  await mkdir(join(workdir, 'src/engine'), { recursive: true })
  await writeFile(join(workdir, '.dsh/instructions/engine.instructions.md'), 'ENGINE_RULE_PROBE 引擎规范')
  await writeFile(join(workdir, 'src/engine/Entity.ts'), 'export class Entity {}\n')
  await writeFile(join(workdir, 'src/engine/Component.ts'), 'export class Component {}\n')

  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'Answer concisely.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: '/' })
  await ctx.plugin(ToolFs)
  await ctx.plugin(Instructions, { projectRoot: workdir })
  await ctx.plugin(AgentLoop, { agents: [] })
  adapter = new MockAdapter(buildScript(workdir))
  ctx.llm.registerAdapter(['mock'], adapter)

  const handle = await ctx.agents.create({
    sessionId: SessionId(`e2e-${Math.random().toString(36).slice(2)}`),
    meta: { cwd: workdir },
    agentOptions: { provider: 'mock', model: 'mock-1' },
  })
  return handle.agent
}

function waitForIdle(context: Context, agent: Agent): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      dispose()
      reject(new Error('waitForIdle timeout'))
    }, 15_000)
    const dispose = context.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        clearTimeout(timer)
        dispose()
        resolve()
      }
    })
  })
}

function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap(message => message.content)
    .map(block => block.type === 'text' ? block.text : '')
    .join('\n')
}

function durableInstructionEvents(agent: Agent): SessionEvent[] {
  return agent.session.events.filter(event => event.type === 'user/message'
    && (event.data.source as { kind?: string }).kind === 'agent-instructions')
}

// ─────────────────────────── tests ───────────────────────────

describe('集成：真实 read 工具 → 下一次请求注入', () => {
  it('读取 src/engine 文件后下一次请求包含指令内容与 system prompt 段', async () => {
    const agent = await harness(dir => [
      toolCallResponse('c1', 'read', { file_path: join(dir, 'src/engine/Entity.ts') }),
      textResponse('done'),
    ])

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '读取 Entity.ts' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx!, agent)

    expect(adapter!.requests.length).toBeGreaterThanOrEqual(2)
    // 请求 1：无指令
    expect(requestText(adapter!.requests[0]!)).not.toContain('ENGINE_RULE_PROBE')
    // system prompt 段在首次请求即注册
    expect(adapter!.requests[0]!.system).toContain('DemoStudio may provide directory-specific instructions')
    // 请求 2：包含指令内容与路径
    const second = requestText(adapter!.requests[1]!)
    expect(second).toContain('ENGINE_RULE_PROBE')
    expect(second).toContain('.dsh/instructions/engine.instructions.md')
    // durable 会话中有 agent-instructions user/message（Model-visible ⟺ logged）
    const durable = durableInstructionEvents(agent)
    expect(durable).toHaveLength(1)
    expect(durable[0]!.data.source).toMatchObject({
      kind: 'agent-instructions',
      form: 'instructions',
      changes: [{ action: 'set', path: '.dsh/instructions/engine.instructions.md' }],
    })
    // ContextCard 数据源：changes[].path 与正文一致
    const cardText = durable[0]!.data.content
      .map(block => block.type === 'text' ? block.text : '').join('')
    expect(cardText).toContain('ENGINE_RULE_PROBE')
  }, 30_000)

  it('再次读取同目录文件不重复注入；指令文件修改后注入 replace 更新', async () => {
    const { mkdir, writeFile: wf } = await import('node:fs/promises')
    const agent = await harness(dir => [
      toolCallResponse('c1', 'read', { file_path: join(dir, 'src/engine/Entity.ts') }),
      toolCallResponse('c2', 'read', { file_path: join(dir, 'src/engine/Component.ts') }),
      textResponse('done'),
    ])

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '读取两个引擎文件' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx!, agent)

    // 第二次请求注入一次；第三次请求（第二个 read 之后）来自 durable 历史只有一份，无重复注入
    expect(requestText(adapter!.requests[1]!)).toContain('ENGINE_RULE_PROBE')
    const thirdText = requestText(adapter!.requests[2]!)
    expect(thirdText).toContain('ENGINE_RULE_PROBE')
    expect(thirdText.split('Additional DemoStudio instructions from:')).toHaveLength(2) // 1 次出现
    expect(durableInstructionEvents(agent)).toHaveLength(1)

    // 修改指令文件 → 再读取 → replace
    await mkdir(join(workdir!, '.dsh/instructions'), { recursive: true })
    await wf(join(workdir!, '.dsh/instructions/engine.instructions.md'), 'ENGINE_RULE_PROBE_V2 新规范')
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '再读一次 Entity.ts' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx!, agent)

    const turn2FirstRequest = adapter!.requests[3]!
    expect(requestText(turn2FirstRequest)).toContain('ENGINE_RULE_PROBE_V2')
    expect(requestText(turn2FirstRequest)).toContain('Updated instructions from:')
    const durable = durableInstructionEvents(agent)
    expect(durable).toHaveLength(2)
    expect(durable[1]!.data.source).toMatchObject({
      changes: [{ action: 'replace', path: '.dsh/instructions/engine.instructions.md' }],
    })
  }, 30_000)
})
