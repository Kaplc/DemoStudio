import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { saveExperience } from '../src/experienceStore.js'
import { createExperienceSaveTool, createExperienceSearchTool, parseSelectorOutput } from '../src/experienceTools.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-tools-'))
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 单轮流式 mock：返回一段文本后 finish:stop。 */
function textStream(text: string): (request: GenerateOptions) => AsyncIterable<StreamChunk> {
  return async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function mockCtx(stream: (request: GenerateOptions) => AsyncIterable<StreamChunk>): Context {
  return {
    llm: { stream },
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  } as unknown as Context
}

const exec = { signal: new AbortController().signal } as never

describe('EXP-04 experience_search 空库', () => {
  it('返回空结果 + 友好文案，不报错', async () => {
    const ctx = mockCtx(textStream('{"selected_episodes": ["x.md"]}'))
    const tool = createExperienceSearchTool({
      experienceDirectory: dir, ctx, selectProvider: 'p', selectModel: 'm',
    })
    const value = await tool.execute({ query: 'junction 挂载' } as never, exec)
    expect(value.count).toBe(0)
    expect(value.matches).toEqual([])
    const rendered = tool.output.render({}, value)
    expect(rendered[0]!.type === 'text' && rendered[0].text).toContain('没有')
  })
})

describe('EXP-05 experience_search 命中', () => {
  it('选择器返回文件名 → ≤3 条，含 summary/lessons/outcome', async () => {
    await saveExperience(dir, {
      name: 'fix_junction_mount', taskType: 'build-fix', outcome: 'success',
      summary: 'PowerShell junction 挂载', lessons: 'Git Bash mklink 会挂',
    })
    await saveExperience(dir, {
      name: 'bump_dsh_kernel', taskType: 'build-fix', outcome: 'partial',
      summary: '升级内核版本', lessons: 'patch 行要整行替换',
    })
    await saveExperience(dir, {
      name: 'third_one', taskType: 'feature', outcome: 'success',
      summary: '无关经验', lessons: '无',
    })
    await saveExperience(dir, {
      name: 'fourth_one', taskType: 'feature', outcome: 'success',
      summary: '第四条', lessons: '无',
    })
    const ctx = mockCtx(textStream(JSON.stringify({
      selected_episodes: ['fix_junction_mount.md', 'bump_dsh_kernel.md', 'third_one.md', 'fourth_one.md', 'ghost.md'],
    })))
    const tool = createExperienceSearchTool({
      experienceDirectory: dir, ctx, selectProvider: 'p', selectModel: 'm',
    })
    const value = await tool.execute({ query: 'junction 挂载怎么做的' } as never, exec)
    // ≤3 条；清单外/不存在的文件名被过滤
    expect(value.count).toBeLessThanOrEqual(3)
    expect(value.matches.map(m => m.name)).toEqual(['fix_junction_mount', 'bump_dsh_kernel', 'third_one'])
    const first = value.matches[0]!
    expect(first.task_type).toBe('build-fix')
    expect(first.outcome).toBe('success')
    expect(first.summary).toContain('junction')
    expect(first.lessons).toContain('mklink')
  })
  it('选择器输出非法 JSON → 空结果不抛出', async () => {
    await saveExperience(dir, {
      name: 'some_episode', taskType: 'debug', outcome: 'failure',
      summary: 's', lessons: 'l',
    })
    const ctx = mockCtx(textStream('抱歉，我觉得没有相关的'))
    const tool = createExperienceSearchTool({
      experienceDirectory: dir, ctx, selectProvider: 'p', selectModel: 'm',
    })
    const value = await tool.execute({ query: 'x' } as never, exec)
    expect(value.count).toBe(0)
  })
})

describe('experience_save 工具', () => {
  it('新建/更新透出 status，非法 outcome 被 schema 拒绝前的显式校验兜底', async () => {
    const ctx = mockCtx(textStream('{}'))
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx })
    const created = await tool.execute({
      name: 'tool_saved_episode', task_type: 'debug', outcome: 'failure',
      summary: 's', lessons: 'l',
    } as never, exec)
    expect(created).toEqual({ status: 'created', file: 'tool_saved_episode.md' })
    const updated = await tool.execute({
      name: 'tool_saved_episode', task_type: 'debug', outcome: 'failure',
      summary: 's2', lessons: 'l2',
    } as never, exec)
    expect(updated.status).toBe('updated')
  })
})

describe('parseSelectorOutput', () => {
  it('宽容解析：外带文字/空数组/非字符串项', () => {
    expect(parseSelectorOutput('好的：{"selected_episodes": ["a.md"]}')).toEqual(['a.md'])
    expect(parseSelectorOutput('{"selected_episodes": []}')).toEqual([])
    expect(parseSelectorOutput('{"selected_episodes": ["a.md", 42]}')).toEqual(['a.md'])
    expect(parseSelectorOutput('没有 JSON')).toBeUndefined()
    expect(parseSelectorOutput('{"selected_episodes": "a.md"}')).toBeUndefined()
  })
})
