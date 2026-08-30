/**
 * §14.3 插件组合与回归：与官方 agent-instructions 同时挂载时不读取同名文件、
 * 不重复注入、状态互不覆盖（我们的 visible 状态只认自己的指令路径）。
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as Instructions from '../src/index.js'
import { visibleInstructionState } from '../src/state.js'
import type { ResolvedRootConfig } from '../src/config.js'
import { bindRootConfig, resolveConfig } from '../src/config.js'
import { appendDurable, RecordingFileSystem, runPreStep, stubAgent, tempRepo } from './helpers.js'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function bound(): ResolvedRootConfig {
  const resolved = bindRootConfig(resolveConfig({ projectRoot: root! }), root!)
  expect(resolved).toBeDefined()
  return resolved!
}

describe('与官方 agent-instructions 共存', () => {
  it('我们的可见状态只消费自己的路径，忽略官方 AGENTS.md 的 changes', async () => {
    root = await tempRepo()
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(RecordingFileSystem)
    await ctx.plugin(Instructions, { projectRoot: root })
    const agent: Agent = stubAgent(root)

    // 模拟官方插件写入的 durable 消息（AGENTS.md scope）与我们的消息共存
    appendDurable(ctx!, agent, createUserMessage({
      content: [{ type: 'text', text: 'official AGENTS.md rules' }],
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        changes: [{ action: 'set', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'a'.repeat(40) }],
      },
    }))
    appendDurable(ctx!, agent, createUserMessage({
      content: [{ type: 'text', text: 'our engine rules' }],
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        changes: [{ action: 'set', scope: '.dsh/instructions\u0000engine.instructions.md', path: '.dsh/instructions/engine.instructions.md', digest: 'b'.repeat(40) }],
      },
    }))
    // 伪造消息：scope 冒充我们的目录但 path 不一致 → 必须被忽略（防伪造）
    appendDurable(ctx!, agent, createUserMessage({
      content: [{ type: 'text', text: 'spoofed' }],
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        changes: [{ action: 'set', scope: '.dsh/instructions\u0000engine.instructions.md', path: 'somewhere/else.md', digest: 'c'.repeat(40) }],
      },
    }))

    const visible = visibleInstructionState(agent, bound())
    expect(visible.size).toBe(1)
    expect(visible.has('.dsh/instructions/engine.instructions.md')).toBe(true)
  })

  it('同一 context 中双方消息同时进入时互不干扰（各自 splice 各自的）', async () => {
    root = await tempRepo()
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(RecordingFileSystem)
    const engineAbs = join(root, '.dsh/instructions/engine.instructions.md')
    const fs = (ctx as unknown as { fs: RecordingFileSystem }).fs
    fs.entries.set(engineAbs, { type: 'file', content: 'our rules' })
    await ctx.plugin(Instructions, { projectRoot: root })
    const agent = stubAgent(root)

    // 直接读取我们的映射文件
    ctx.emit('tools/result', {
      token: Symbol('t') as never, callId: 'c1' as never, rootCallId: 'c1' as never,
      name: 'read', arguments: { file_path: `${root}/src/engine/a.ts` }, agent, signal: new AbortController().signal,
    } as never, { content: [], isError: false, value: null })

    const claimed = [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })]
    const decision = await runPreStep(ctx!, agent, claimed)
    if (decision.kind !== 'enter') throw new Error('expected enter')
    const ours = decision.messages.filter(m => (m.source as { kind?: string }).kind === 'agent-instructions')
    expect(ours).toHaveLength(1)
    expect(JSON.stringify(ours[0]!.source)).toContain('engine.instructions.md')
  })
})
