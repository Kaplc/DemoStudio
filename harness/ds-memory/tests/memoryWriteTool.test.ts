import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createMemorySearchTool, createMemoryWriteTool } from '../src/tools.js'
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

describe('memory_write 半自动：frontmatter 工具落盘，正文提醒 agent 手写', () => {
  it('新建：落盘 frontmatter（正文为空），返回 created + 补写提醒，索引行同步', async () => {
    const host = await makeHost()
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute(
      { name: 'user_role', type: 'user', description: '用户画像', prefix: ['hold'] },
      exec,
    )
    expect(value.action).toBe('write_frontmatter')
    expect(value.status).toBe('created')
    expect(value.file).toMatch(/[\\/]user_role\.md$/)
    // 文件已真实落盘：frontmatter 完整、正文空
    expect(existsSync(value.file)).toBe(true)
    const file = await readFile(value.file, 'utf8')
    expect(file).toContain('---\nname: user_role')
    expect(file).toContain('description: 用户画像')
    expect(file).toContain('type: user')
    const body = file.slice(file.indexOf('---', 4) + 4).trim()
    expect(body).toBe('')
    // 索引行已同步
    const index = await readFile(join(host.memoryDirectory, 'MEMORY.md'), 'utf8')
    expect(index).toContain('- [user_role](user_role.md) — 用户画像')
    // 提醒指向正文补写
    expect(value.reminder).toContain('追加正文')
    expect(value.reminder).toContain('**Problem:**')
    expect(value.reminder).toContain('全库过时检查')
  })

  it('新建带 prefix 文件列表：frontmatter 写入方括号数组行，索引行带标注，提醒含精炼要求', async () => {
    const host = await makeHost()
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute(
      { name: 'prefixed_mem', type: 'project', description: '带联想的记忆', prefix: ['src/engine/a.ts', 'doc/engine/b.md'] },
      exec,
    )
    const file = await readFile(value.file, 'utf8')
    expect(file).toContain('prefix: [src/engine/a.ts, doc/engine/b.md]')
    const index = await readFile(join(host.memoryDirectory, 'MEMORY.md'), 'utf8')
    expect(index).toContain('（prefix: src/engine/a.ts, doc/engine/b.md）')
    expect(value.reminder).toContain('正文必须精炼')
    expect(value.reminder).toContain('src/engine/a.ts')
  })

  it('同名已存在：原位更新 frontmatter（deduped_by=name），正文原样保留，索引行替换不重复', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'dup_mem', content: '旧正文内容', type: 'project', description: '旧描述',
    })
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute(
      { name: 'dup_mem', type: 'feedback', description: '新描述', prefix: ['hold'] },
      exec,
    )
    expect(value.status).toBe('updated')
    expect(value.deduped_by).toBe('name')
    expect(value.existing_file).toBe('dup_mem.md')
    expect(value.reminder).toContain('edit')
    expect(value.reminder).toContain('正文原样保留')

    const file = await readFile(value.file, 'utf8')
    expect(file).toContain('description: 新描述')
    expect(file).toContain('type: feedback')
    expect(file).toContain('旧正文内容') // 正文没被工具动过

    const index = await readFile(join(host.memoryDirectory, 'MEMORY.md'), 'utf8')
    expect(index.split('\n').filter(line => line.startsWith('- [dup_mem]'))).toHaveLength(1)
    expect(index).toContain('新描述')
  })

  it('同描述命中另一文件：更新命中文件（frontmatter name 跟随文件名），不新建重复文件', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'other_name', content: 'v1', type: 'project', description: '完全相同的描述',
    })
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute(
      { name: 'brand_new', type: 'project', description: '完全相同的描述', prefix: ['hold'] },
      exec,
    )
    expect(value.status).toBe('updated')
    expect(value.deduped_by).toBe('description')
    expect(value.existing_file).toBe('other_name.md')
    expect(value.file).toMatch(/[\\/]other_name\.md$/)
    expect(existsSync(join(host.memoryDirectory, 'brand_new.md'))).toBe(false)
    const file = await readFile(value.file, 'utf8')
    expect(file).toContain('name: other_name') // name 跟随文件名，不被请求改名
    expect(file).toContain('v1') // 正文保留
  })

  it('更新时prefix=hold 保留旧值；声明新文件列表则覆盖', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'p_mem', content: 'c', type: 'project', description: 'd', prefix: ['src/engine/a.ts'],
    })
    const tool = createMemoryWriteTool(host)
    await tool.execute({ name: 'p_mem', type: 'project', description: 'd2', prefix: ['hold'] }, exec)
    const kept = await readFile(join(host.memoryDirectory, 'p_mem.md'), 'utf8')
    expect(kept).toContain('prefix: [src/engine/a.ts]')
    await tool.execute({ name: 'p_mem', type: 'project', description: 'd3', prefix: ['harness/tools.ts'] }, exec)
    const replaced = await readFile(join(host.memoryDirectory, 'p_mem.md'), 'utf8')
    expect(replaced).toContain('prefix: [harness/tools.ts]')
    expect(replaced).not.toContain('prefix: [src/engine/a.ts]')
  })

  it('非法 name/type/prefix/scope 一律抛错，子 agent 被拒绝', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    await expect(tool.execute({ name: 'Bad Name', type: 'user', description: 'd', prefix: ['hold'] }, exec)).rejects.toThrow()
    await expect(tool.execute({ name: '', type: 'user', description: 'd', prefix: ['hold'] }, exec)).rejects.toThrow()
    await expect(tool.execute({ name: 'a/b', type: 'user', description: 'd', prefix: ['hold'] }, exec)).rejects.toThrow()
    await expect(tool.execute({ name: 'm1', type: 'wrong', description: 'd', prefix: ['hold'] }, exec)).rejects.toThrow(/type/)
    await expect(
      tool.execute({ name: 'p_mem', type: 'project', description: 'd', prefix: ['a\nb'] }, exec),
    ).rejects.toThrow(/单行/)
    await expect(
      tool.execute({ name: 's_mem', type: 'user', description: 'd', scope: 'team', prefix: ['hold'] }, exec),
    ).rejects.toThrow(/scope/)
    const childExec = {
      agent: { session: { header: { delegationDepth: 1 } } },
      signal: undefined,
    } as never
    await expect(
      tool.execute({ name: 'child_mem', type: 'user', description: 'd', prefix: ['hold'] }, childExec),
    ).rejects.toThrow(/子 agent/)
  })
})

describe('prefix 必填与 hold 语义（文件数组）', () => {
  it('hold（大小写不敏感、容忍空白条目；空数组同义）：新建不写 prefix 行、索引无联想标注、提醒无精炼要求', async () => {
    for (const hold of [['hold'], ['HOLD'], ['  hold  '], []]) {
      const host = await makeHost()
      const tool = createMemoryWriteTool(host)
      const value = await tool.execute(
        { name: 'hold_mem', type: 'project', description: 'd', prefix: hold },
        exec,
      )
      const file = await readFile(value.file, 'utf8')
      expect(file).not.toContain('prefix:')
      const index = await readFile(join(host.memoryDirectory, 'MEMORY.md'), 'utf8')
      expect(index).not.toContain('prefix:')
      expect(value.reminder).not.toContain('正文必须精炼')
    }
  })

  it('更新时 prefix=hold 保留旧值；声明新文件列表覆盖旧值', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'keep_p', content: 'c', type: 'project', description: 'd', prefix: ['src/engine/a.ts'],
    })
    const tool = createMemoryWriteTool(host)
    await tool.execute({ name: 'keep_p', type: 'project', description: 'd2', prefix: ['hold'] }, exec)
    const kept = await readFile(join(host.memoryDirectory, 'keep_p.md'), 'utf8')
    expect(kept).toContain('prefix: [src/engine/a.ts]')
    await tool.execute({ name: 'keep_p', type: 'project', description: 'd3', prefix: ['doc/editor.md'] }, exec)
    const replaced = await readFile(join(host.memoryDirectory, 'keep_p.md'), 'utf8')
    expect(replaced).toContain('prefix: [doc/editor.md]')
    expect(replaced).not.toContain('prefix: [src/engine/a.ts]')
  })

  it('含换行条目抛错（frontmatter 单行约束，提示可填 hold）', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    await expect(
      tool.execute({ name: 'bad_p', type: 'user', description: 'd', prefix: ['a\nb'] }, exec),
    ).rejects.toThrow(/单行/)
    await expect(
      tool.execute({ name: 'bad_p', type: 'user', description: 'd', prefix: ['ok.ts', ' bad\nline.ts '] }, exec),
    ).rejects.toThrow(/单行/)
  })

  it('条目反斜杠归一为正斜杠后落盘', async () => {
    const host = await makeHost()
    const tool = createMemoryWriteTool(host)
    await tool.execute({ name: 'slash_mem', type: 'user', description: 'd', prefix: ['src\\engine\\a.ts'] }, exec)
    const file = await readFile(join(host.memoryDirectory, 'slash_mem.md'), 'utf8')
    expect(file).toContain('prefix: [src/engine/a.ts]')
  })
})

describe('lossless JSON 边界（内核要求返回值 JSON round-trip 无损）', () => {
  /** 断言返回值可无损 JSON 序列化：显式 undefined 键会被 toStrictEqual 抓出。 */
  function expectLossless(value: unknown): void {
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
  }

  it('memory_write 新建路径（deduped_by/existing_file 缺省为无键而非 undefined）', async () => {
    const tool = createMemoryWriteTool(await makeHost())
    const value = await tool.execute({ name: 'fresh_mem', type: 'user', description: 'd', prefix: ['hold'] }, exec)
    expectLossless(value)
    expect('deduped_by' in value).toBe(false)
    expect('existing_file' in value).toBe(false)
  })

  it('memory_write 更新路径（deduped_by/existing_file 有值）', async () => {
    const host = await makeHost()
    await writeMemory(host.memoryDirectory, {
      name: 'old_mem', content: 'v1', type: 'project', description: '旧',
    })
    const tool = createMemoryWriteTool(host)
    const value = await tool.execute({ name: 'old_mem', type: 'project', description: '新', prefix: ['hold'] }, exec)
    expectLossless(value)
  })

  it('memory_search：frontmatter 缺 type/description 的记录仍无损', async () => {
    const host = await makeHost()
    // writeMemory 恒写 description，手写最小 frontmatter 才能构造缺 type/description 的记录
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(host.memoryDirectory, { recursive: true })
    await writeFile(join(host.memoryDirectory, 'sparse_mem.md'), '---\nname: sparse_mem\n---\n只有正文', 'utf8')
    const tool = createMemorySearchTool(host)
    const value = await tool.execute({ names: ['sparse_mem'] }, exec)
    expectLossless(value)
    expect(value.count).toBe(1)
    const summary = await tool.execute({ names: [] }, exec)
    expectLossless(summary)
  })
})
