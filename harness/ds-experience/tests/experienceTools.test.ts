import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createExperienceSaveTool, createExperienceSearchTool } from '../src/experienceTools.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-tools-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function mockCtx(): Context {
  return {
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  } as unknown as Context
}

const exec = { signal: new AbortController().signal } as never

describe('experience_search 空库', () => {
  it('空数组 → count 0 + 友好文案，不报错', async () => {
    const tool = createExperienceSearchTool({ experienceDirectory: dir, ctx: mockCtx() })
    const value = await tool.execute({ names: [] } as never, exec)
    expect(value.count).toBe(0)
    expect(value.matches).toEqual([])
    const rendered = tool.output.render({}, value)
    expect(rendered[0]!.type === 'text' && rendered[0].text).toContain('没有')
  })
})

describe('experience_search 按文件名命中', () => {
  it('指定文件名 → 精确匹配返回完整 summary/lessons/task_type/outcome', async () => {
    const ctx = mockCtx()
    const save = createExperienceSaveTool({ experienceDirectory: dir, ctx })
    await save.execute({
      name: 'fix_junction_mount', task_type: 'build-fix', outcome: 'success',
      summary: 'PowerShell junction 挂载', lessons: 'Git Bash mklink 会挂', prefix: 'hold',
    } as never, exec)
    await save.execute({
      name: 'bump_dsh_kernel', task_type: 'build-fix', outcome: 'partial',
      summary: '升级内核版本', lessons: 'patch 行要整行替换', prefix: 'hold',
    } as never, exec)
    const tool = createExperienceSearchTool({ experienceDirectory: dir, ctx })
    const value = await tool.execute({ names: ['fix_junction_mount'] } as never, exec)
    expect(value.count).toBe(1)
    expect(value.matches[0]).toMatchObject({
      name: 'fix_junction_mount', task_type: 'build-fix', outcome: 'success',
    })
    expect(value.matches[0]!.summary).toContain('junction')
    expect(value.matches[0]!.lessons).toContain('mklink')
  })

  it('不存在的文件名被过滤；.md 后缀写法兼容', async () => {
    const ctx = mockCtx()
    const save = createExperienceSaveTool({ experienceDirectory: dir, ctx })
    await save.execute({
      name: 'some_episode', task_type: 'debug', outcome: 'failure',
      summary: 's', lessons: 'l', prefix: 'hold',
    } as never, exec)
    const tool = createExperienceSearchTool({ experienceDirectory: dir, ctx })
    const miss = await tool.execute({ names: ['ghost'] } as never, exec)
    expect(miss.count).toBe(0)
    const hit = await tool.execute({ names: ['some_episode.md'] } as never, exec)
    expect(hit.count).toBe(1)
  })

  it('空数组返回全部经验摘要（不含正文过滤）', async () => {
    const ctx = mockCtx()
    const save = createExperienceSaveTool({ experienceDirectory: dir, ctx })
    await save.execute({ name: 'a_one', task_type: 'feature', outcome: 'success', summary: 'a', lessons: 'l', prefix: 'hold' } as never, exec)
    await save.execute({ name: 'b_two', task_type: 'debug', outcome: 'partial', summary: 'b', lessons: 'l', prefix: 'hold' } as never, exec)
    const tool = createExperienceSearchTool({ experienceDirectory: dir, ctx })
    const value = await tool.execute({} as never, exec)
    expect(value.count).toBe(2)
    expect(value.matches.map((m: { name: string }) => m.name).sort()).toEqual(['a_one', 'b_two'])
  })

  it('lossless JSON 边界：缺 date 的记录省略键而非 undefined 值', async () => {
    const { writeFile } = await import('node:fs/promises')
    // 手写一份无 date 字段的 frontmatter（saveExperience 恒写 date，这里模拟手工/旧文件）
    await writeFile(
      join(dir, 'no_date_episode.md'),
      '---\nname: no_date_episode\ntask_type: debug\noutcome: failure\n---\n## Summary\n\ns\n\n## Lessons\n\nl\n',
      'utf8',
    )
    const tool = createExperienceSearchTool({ experienceDirectory: dir, ctx: mockCtx() })
    const value = await tool.execute({ names: ['no_date_episode'] } as never, exec)
    expect(value.count).toBe(1)
    // 内核 lossless 边界同款断言：JSON round-trip 必须无损
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
    expect('date' in value.matches[0]!).toBe(false)
  })
})

describe('experience_save 工具', () => {
  it('新建/更新透出 status', async () => {
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    const created = await tool.execute({
      name: 'tool_saved_episode', task_type: 'debug', outcome: 'failure',
      summary: 's', lessons: 'l', prefix: 'hold',
    } as never, exec)
    expect(created).toEqual({ status: 'created', file: 'tool_saved_episode.md' })
    const updated = await tool.execute({
      name: 'tool_saved_episode', task_type: 'debug', outcome: 'failure',
      summary: 's2', lessons: 'l2', prefix: 'hold',
    } as never, exec)
    expect(updated.status).toBe('updated')
  })

  it('prefix=hold：新建不写 prefix 行；更新同名经验保留旧联想', async () => {
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    await tool.execute({
      name: 'hold_episode', task_type: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'src/engine',
    } as never, exec)
    await tool.execute({
      name: 'hold_episode', task_type: 'feature', outcome: 'success',
      summary: 's2', lessons: 'l2', prefix: 'HOLD',
    } as never, exec)
    const kept = await readFile(join(dir, 'hold_episode.md'), 'utf8')
    expect(kept).toContain('prefix: src/engine')

    await tool.execute({
      name: 'plain_hold_episode', task_type: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'HOLD',
    } as never, exec)
    const fresh = await readFile(join(dir, 'plain_hold_episode.md'), 'utf8')
    expect(fresh).not.toContain('prefix:')
  })

  it('非 hold 的无效 prefix 表达式抛错（提示可填 hold）', async () => {
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    await expect(tool.execute({
      name: 'bad_prefix', task_type: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: '&& ||',
    } as never, exec)).rejects.toThrow(/无联想填 hold/)
  })

  it('prefix 落盘 frontmatter，检索记录可读回', async () => {
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    await tool.execute({
      name: 'prefixed_episode', task_type: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'harness || doc/harness',
    } as never, exec)
    const file = await readFile(join(dir, 'prefixed_episode.md'), 'utf8')
    expect(file).toContain('prefix: harness || doc/harness')
    const search = createExperienceSearchTool({ experienceDirectory: dir, ctx: mockCtx() })
    const value = await search.execute({ names: ['prefixed_episode'] } as never, exec)
    expect(value.count).toBe(1)
  })

  it('prefix=hold 不写 prefix 行；含换行的 prefix 被显式校验拒绝', async () => {
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    await tool.execute({
      name: 'plain_episode', task_type: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'hold',
    } as never, exec)
    const file = await readFile(join(dir, 'plain_episode.md'), 'utf8')
    expect(file).not.toContain('prefix:')
    await expect(tool.execute({
      name: 'bad_prefix', task_type: 'feature', outcome: 'success',
      summary: 's', lessons: 'l', prefix: 'a\nb',
    } as never, exec)).rejects.toThrow(/single-line/)
  })

  it('render 输出 created/updated 两种文案', () => {
    const tool = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    const createdText = tool.output.render({}, { status: 'created', file: 'x.md' })
    const updatedText = tool.output.render({}, { status: 'updated', file: 'x.md' })
    expect(createdText[0]!.type === 'text' && createdText[0].text).toContain('已保存')
    expect(updatedText[0]!.type === 'text' && updatedText[0].text).toContain('已覆盖更新')
  })
})

describe('experience_search 工具元信息', () => {
  it('工具注册名与描述声明 prefix 联想能力', () => {
    const save = createExperienceSaveTool({ experienceDirectory: dir, ctx: mockCtx() })
    const search = createExperienceSearchTool({ experienceDirectory: dir, ctx: mockCtx() })
    expect(save.name).toBe('experience_save')
    expect(save.description).toContain('prefix')
    expect(search.name).toBe('experience_search')
    expect(vi.isMockFunction(search.execute)).toBe(false)
  })
})
