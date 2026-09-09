import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createMemoryWriteTool } from '../src/tools.js'
import type { MemoryToolHost } from '../src/tools.js'
import { writeMemory } from '../src/memoryStore.js'

const createdDirs: string[] = []
async function makeHost(): Promise<MemoryToolHost> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-memory-write-'))
  createdDirs.push(dir)
  return { memoryDirectory: dir, ctx: {} as MemoryToolHost['ctx'] }
}

/** defineTool 的 exec 仅用到 agent/signal；测试用最小桩。 */
const exec = { agent: undefined, signal: undefined } as never

afterAll(async () => {
  for (const dir of createdDirs) await rm(dir, { recursive: true, force: true })
})

describe('memory_write（校验+查重+返回指引，不落盘）', () => {
  it('新建：返回 manual_write + 指引含目标路径/frontmatter/索引同步/全库检查', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    const value = await tool.execute({ name: 'user_role', type: 'user', description: '用户画像' }, exec)
    expect(value.action).toBe('manual_write')
    expect(value.file).toMatch(/[\\/]user_role\.md$/)
    expect(value.deduped_by).toBeUndefined()
    expect(value.existing_file).toBeUndefined()
    expect(value.prompt).toContain(value.file)
    expect(value.prompt).toContain('**write** 新建文件')
    expect(value.prompt).toContain('type: user')
    expect(value.prompt).toContain('MEMORY.md')
    expect(value.prompt).toContain('全库过时检查')
    expect(value.prompt).toContain('**Problem:**')
  })

  it('同名已存在：deduped_by=name，指引要求 edit 更新而非新建', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'dup_mem', content: 'v1', type: 'project', description: '旧描述',
    })
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute({ name: 'dup_mem', type: 'project', description: '新描述' }, exec)
    expect(value.deduped_by).toBe('name')
    expect(value.existing_file).toBe('dup_mem.md')
    expect(value.file).toMatch(/[\\/]dup_mem\.md$/)
    expect(value.prompt).toContain('**edit** 更新已有文件')
    expect(value.prompt).toContain('不要新建重复文件')
  })

  it('同描述命中：deduped_by=description', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'other_name', content: 'v1', type: 'project', description: '完全相同的描述',
    })
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute({ name: 'brand_new', type: 'project', description: '完全相同的描述' }, exec)
    expect(value.deduped_by).toBe('description')
    expect(value.existing_file).toBe('other_name.md')
    expect(value.prompt).toContain('同描述命中')
  })

  it('非法 name 抛错（大写/空/路径分隔符）', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    await expect(tool.execute({ name: 'Bad Name', type: 'user', description: 'd' }, exec)).rejects.toThrow()
    await expect(tool.execute({ name: '', type: 'user', description: 'd' }, exec)).rejects.toThrow()
    await expect(tool.execute({ name: 'a/b', type: 'user', description: 'd' }, exec)).rejects.toThrow()
  })

  it('无效 prefix 表达式抛错；合法表达式通过', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    await expect(
      tool.execute({ name: 'p_mem', type: 'project', description: 'd', prefix: '&& ||' }, exec),
    ).rejects.toThrow(/prefix 表达式/)
    const ok = await tool.execute(
      { name: 'p_mem', type: 'project', description: 'd', prefix: 'src/engine && doc/editor' },
      exec,
    )
    expect(ok.prompt).toContain('src/engine && doc/editor')
  })

  it('非法 scope 抛错', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    await expect(
      tool.execute({ name: 's_mem', type: 'user', description: 'd', scope: 'team' }, exec),
    ).rejects.toThrow(/scope/)
  })

  it('子 agent 调用被拒绝', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    const childExec = {
      agent: { session: { header: { delegationDepth: 1 } } },
      signal: undefined,
    } as never
    await expect(
      tool.execute({ name: 'child_mem', type: 'user', description: 'd' }, childExec),
    ).rejects.toThrow(/子 agent/)
  })
})
