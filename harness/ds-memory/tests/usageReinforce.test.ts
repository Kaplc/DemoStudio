import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createMemoryForgetTool, createMemoryReinforceTool } from '../src/tools.js'
import { USAGE_FILE_NAME, readUsageFile, reinforceUsage, removeUsageEntries } from '../src/usageStore.js'
import { renderMemoryFile } from '../src/memoryTypes.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-memory-usage-'))
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
const childExec = {
  signal: new AbortController().signal,
  agent: { session: { header: { delegationDepth: 1 } } },
} as never

/** 造一份现存记忆（工具层存在性校验需要真实文件）。 */
async function seedMemory(name: string): Promise<void> {
  await writeFile(join(dir, `${name}.md`), renderMemoryFile(name, 'desc', 'project', 'content'), 'utf8')
}

describe('usageStore', () => {
  it('首次强化：uses=1 + lastUsedAt + note 留痕，落 .usage.json', async () => {
    const entry = await reinforceUsage(dir, 'user_role.md', '复盘时确认用到了')
    expect(entry.uses).toBe(1)
    expect(entry.lastUsedAt).toBeGreaterThan(0)
    expect(entry.notes).toEqual(['复盘时确认用到了'])
    const onDisk = await readFile(join(dir, USAGE_FILE_NAME), 'utf8')
    expect(JSON.parse(onDisk)).toMatchObject({ 'user_role.md': { uses: 1 } })
  })

  it('累计强化：uses 递增，notes 新→旧排列', async () => {
    await reinforceUsage(dir, 'user_role.md', '第一次')
    const entry = await reinforceUsage(dir, 'user_role.md', '第二次')
    expect(entry.uses).toBe(2)
    expect(entry.notes).toEqual(['第二次', '第一次'])
  })

  it('note 截断到上限；空白/缺省 note 不留痕', async () => {
    const long = 'x'.repeat(500)
    const clipped = await reinforceUsage(dir, 'a_one.md', long)
    expect(clipped.notes[0]).toHaveLength(200)
    const skipped = await reinforceUsage(dir, 'a_one.md', '   ')
    expect(skipped.notes).toHaveLength(1)
    const none = await reinforceUsage(dir, 'a_one.md', undefined)
    expect(none.notes).toHaveLength(1)
  })

  it('notes 上限 10 条，超出丢最旧的', async () => {
    let entry
    for (let i = 1; i <= 12; i++) {
      entry = await reinforceUsage(dir, 'b_two.md', `note-${i}`)
    }
    expect(entry!.uses).toBe(12)
    expect(entry!.notes).toHaveLength(10)
    expect(entry!.notes[0]).toBe('note-12')
    expect(entry!.notes).not.toContain('note-1')
  })

  it('pruneTo：顺带清理已不存在记忆的孤儿条目', async () => {
    await reinforceUsage(dir, 'alive_one.md', undefined)
    await reinforceUsage(dir, 'ghost_old.md', undefined)
    const entry = await reinforceUsage(dir, 'alive_one.md', undefined, new Set(['alive_one.md']))
    expect(entry.uses).toBe(2)
    const file = await readUsageFile(dir)
    expect(Object.keys(file)).toEqual(['alive_one.md'])
  })

  it('removeUsageEntries：删除指定条目；空数组 no-op 不写文件', async () => {
    await reinforceUsage(dir, 'c_three.md', undefined)
    await removeUsageEntries(dir, ['c_three.md'])
    expect(await readUsageFile(dir)).toEqual({})
    // 空数组：不创建文件
    await removeUsageEntries(dir, [])
    expect(await readUsageFile(dir)).toEqual({})
  })

  it('损坏的 usage 文件按空表自愈', async () => {
    await writeFile(join(dir, USAGE_FILE_NAME), '{not-json', 'utf8')
    const entry = await reinforceUsage(dir, 'd_four.md', undefined)
    expect(entry.uses).toBe(1)
  })
})

describe('memory_reinforce 工具', () => {
  it('强化存在的记忆：返回累计次数/留痕/ISO 时间，lossless JSON 安全', async () => {
    await seedMemory('user_role')
    const tool = createMemoryReinforceTool({ memoryDirectory: dir, ctx: mockCtx() })
    const first = await tool.execute({ name: 'user_role', note: '设计讨论时引用' } as never, exec)
    expect(first).toEqual({
      file: 'user_role.md',
      total_uses: 1,
      last_used_at: expect.any(String),
      notes: ['设计讨论时引用'],
    })
    const second = await tool.execute({ name: 'user_role' } as never, exec)
    expect(second.total_uses).toBe(2)
    // lossless JSON 边界：无显式 undefined 键
    expect(JSON.parse(JSON.stringify(second))).toStrictEqual(second)
    const rendered = tool.output.render({}, second)
    expect(rendered[0]!.type === 'text' && rendered[0].text).toContain('累计使用 2 次')
  })

  it('不存在的记忆报错并提示检索', async () => {
    const tool = createMemoryReinforceTool({ memoryDirectory: dir, ctx: mockCtx() })
    await expect(tool.execute({ name: 'ghost' } as never, exec)).rejects.toThrow('memory_search')
  })

  it('子 agent 拒绝', async () => {
    await seedMemory('user_role')
    const tool = createMemoryReinforceTool({ memoryDirectory: dir, ctx: mockCtx() })
    await expect(tool.execute({ name: 'user_role' } as never, childExec)).rejects.toThrow('子 agent')
  })

  it('.md 后缀写法兼容', async () => {
    await seedMemory('user_role')
    const tool = createMemoryReinforceTool({ memoryDirectory: dir, ctx: mockCtx() })
    const value = await tool.execute({ name: 'user_role.md' } as never, exec)
    expect(value.file).toBe('user_role.md')
  })
})

describe('memory_forget 联动清理 usage', () => {
  it('删除记忆时同步清理其使用计数', async () => {
    await seedMemory('user_role')
    await reinforceUsage(dir, 'user_role.md', '用过一次')
    const forget = createMemoryForgetTool({ memoryDirectory: dir, ctx: mockCtx() })
    const value = await forget.execute({ name: 'user_role' } as never, exec)
    expect(value.deleted).toEqual(['user_role.md'])
    expect(await readUsageFile(dir)).toEqual({})
  })
})
