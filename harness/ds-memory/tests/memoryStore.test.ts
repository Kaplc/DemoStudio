import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MEMORY_ENTRYPOINT } from '../src/memoryTypes.js'
import { forgetMemories, readAllMemories, removeFromIndex, upsertIndexLine, writeMemory } from '../src/memoryStore.js'

const createdDirs: string[] = []
async function memoryDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-memory-'))
  createdDirs.push(dir)
  return dir
}

afterAll(async () => {
  for (const dir of createdDirs) await rm(dir, { recursive: true, force: true })
})

describe('writeMemory', () => {
  it('新建记忆 + 建索引', async () => {
    const mem = await memoryDirectory()
    const result = await writeMemory(mem, {
      name: 'user_role',
      content: '回复要简洁',
      type: 'feedback',
      description: '用户偏好：回复要简洁，不总结 diff',
    })
    expect(result.status).toBe('created')
    const text = await readFile(join(mem, 'user_role.md'), 'utf8')
    expect(text).toContain('name: user_role')
    expect(text).toContain('type: feedback')
    expect(text).toContain('回复要简洁')
    const index = await readFile(join(mem, MEMORY_ENTRYPOINT), 'utf8')
    expect(index).toContain('- [user_role](user_role.md) — 用户偏好：回复要简洁，不总结 diff')
  })

  it('同 name 去重：更新而非新建', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, { name: 'cfg_a', content: 'v1', type: 'project', description: '描述 A' })
    const result = await writeMemory(mem, { name: 'cfg_a', content: 'v2', type: 'project', description: '描述 A' })
    expect(result.status).toBe('updated')
    expect(result.dedupedBy).toBe('name')
    const files = (await readdir(mem)).filter(name => name.endsWith('.md') && name !== MEMORY_ENTRYPOINT)
    expect(files).toEqual(['cfg_a.md'])
    expect(await readFile(join(mem, 'cfg_a.md'), 'utf8')).toContain('v2')
  })

  it('同 description 去重：更新旧文件而非新建', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, { name: 'old_name', content: 'v1', type: 'project', description: '同一份描述' })
    const result = await writeMemory(mem, { name: 'new_name', content: 'v2', type: 'project', description: '同一份描述' })
    expect(result.status).toBe('updated')
    expect(result.dedupedBy).toBe('description')
    expect(result.fileName).toBe('old_name.md')
    const files = (await readdir(mem)).filter(name => name.endsWith('.md') && name !== MEMORY_ENTRYPOINT)
    expect(files).toEqual(['old_name.md'])
  })

  it('不同名不同描述 = 新建第二条', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, { name: 'mem_one', content: 'a', type: 'user', description: '描述一' })
    const result = await writeMemory(mem, { name: 'mem_two', content: 'b', type: 'user', description: '描述二' })
    expect(result.status).toBe('created')
  })
})

describe('index 维护', () => {
  it('upsert 替换同名行；removeFromIndex 删除行', async () => {
    const mem = await memoryDirectory()
    await upsertIndexLine(mem, 'demo', '第一版')
    await upsertIndexLine(mem, 'demo', '第二版')
    let index = await readFile(join(mem, MEMORY_ENTRYPOINT), 'utf8')
    expect(index.match(/- \[demo\]/g)).toHaveLength(1)
    expect(index).toContain('第二版')
    await removeFromIndex(mem, 'demo')
    index = await readFile(join(mem, MEMORY_ENTRYPOINT), 'utf8')
    expect(index).not.toContain('- [demo]')
  })
})

describe('forgetMemories', () => {
  it('按 name 精确删除并同步索引', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, { name: 'del_me', content: 'x', type: 'reference', description: '看板指针' })
    await writeMemory(mem, { name: 'keep_me', content: 'y', type: 'reference', description: '监控面板' })
    const deleted = await forgetMemories(mem, { name: 'del_me' })
    expect(deleted).toEqual(['del_me.md'])
    const files = (await readdir(mem)).filter(name => name.endsWith('.md') && name !== MEMORY_ENTRYPOINT)
    expect(files).toEqual(['keep_me.md'])
    const index = await readFile(join(mem, MEMORY_ENTRYPOINT), 'utf8')
    expect(index).not.toContain('del_me')
    expect(index).toContain('keep_me')
  })

  it('按描述关键词删除；无匹配返回空数组', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, { name: 'board_ptr', content: 'x', type: 'reference', description: 'DemoStudio 看板地址' })
    const deleted = await forgetMemories(mem, { descriptionContains: '看板' })
    expect(deleted).toEqual(['board_ptr.md'])
    expect(await forgetMemories(mem, { descriptionContains: '不存在' })).toEqual([])
  })
})

describe('readAllMemories', () => {
  it('返回完整记录；跳过 MEMORY.md', async () => {
    const mem = await memoryDirectory()
    await writeMemory(mem, { name: 'rec_a', content: '内容 A', type: 'project', description: '记录 A' })
    const records = await readAllMemories(mem)
    const target = records.find(record => record.fileName === 'rec_a.md')
    expect(target).toBeDefined()
    expect(target!.content).toContain('内容 A')
    expect(target!.type).toBe('project')
    expect(records.every(record => record.fileName !== MEMORY_ENTRYPOINT)).toBe(true)
  })
})
