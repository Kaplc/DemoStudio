import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createExperienceReinforceTool } from '../src/experienceTools.js'
import { USAGE_FILE_NAME, readUsageFile, reinforceUsage, removeUsageEntries } from '../src/usageStore.js'
import { renderEpisodeFile } from '../src/experienceTypes.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-usage-'))
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

/** 造一份现存经验（工具层存在性校验需要真实文件）。 */
async function seedEpisode(name: string): Promise<void> {
  await writeFile(
    join(dir, `${name}.md`),
    renderEpisodeFile({ name, taskType: 'debug', outcome: 'success', summary: 's', lessons: 'l' }, '2026-09-30'),
    'utf8',
  )
}

describe('usageStore（experience）', () => {
  it('首次强化：uses=1 + note 留痕；累计时 notes 新→旧', async () => {
    await reinforceUsage(dir, 'fix_junction_mount.md', '第一次')
    const entry = await reinforceUsage(dir, 'fix_junction_mount.md', '第二次')
    expect(entry.uses).toBe(2)
    expect(entry.notes).toEqual(['第二次', '第一次'])
    const file = await readUsageFile(dir)
    expect(file['fix_junction_mount.md']!.uses).toBe(2)
  })

  it('pruneTo：顺带清理已不存在经验的孤儿条目', async () => {
    await reinforceUsage(dir, 'alive_one.md', undefined)
    await reinforceUsage(dir, 'ghost_old.md', undefined)
    await reinforceUsage(dir, 'alive_one.md', undefined, new Set(['alive_one.md']))
    const file = await readUsageFile(dir)
    expect(Object.keys(file)).toEqual(['alive_one.md'])
  })

  it('notes 上限 10 条', async () => {
    let entry
    for (let i = 1; i <= 11; i++) {
      entry = await reinforceUsage(dir, 'b_two.md', `note-${i}`)
    }
    expect(entry!.notes).toHaveLength(10)
    expect(entry!.notes).not.toContain('note-1')
  })

  it('removeUsageEntries 删除条目；空数组 no-op', async () => {
    await reinforceUsage(dir, 'c_three.md', undefined)
    await removeUsageEntries(dir, ['c_three.md'])
    expect(await readUsageFile(dir)).toEqual({})
    expect(USAGE_FILE_NAME).toBe('.usage.json')
  })
})

describe('experience_reinforce 工具', () => {
  it('强化存在的经验：返回累计次数/留痕/ISO 时间，lossless JSON 安全', async () => {
    await seedEpisode('fix_junction_mount')
    const tool = createExperienceReinforceTool({ experienceDirectory: dir, ctx: mockCtx() })
    const first = await tool.execute({ name: 'fix_junction_mount', note: '改联想器时参考' } as never, exec)
    expect(first).toEqual({
      file: 'fix_junction_mount.md',
      total_uses: 1,
      last_used_at: expect.any(String),
      notes: ['改联想器时参考'],
    })
    const second = await tool.execute({ name: 'fix_junction_mount' } as never, exec)
    expect(second.total_uses).toBe(2)
    // lossless JSON 边界：无显式 undefined 键
    expect(JSON.parse(JSON.stringify(second))).toStrictEqual(second)
    const rendered = tool.output.render({}, second)
    expect(rendered[0]!.type === 'text' && rendered[0].text).toContain('累计使用 2 次')
  })

  it('不存在的经验报错并提示检索', async () => {
    const tool = createExperienceReinforceTool({ experienceDirectory: dir, ctx: mockCtx() })
    await expect(tool.execute({ name: 'ghost' } as never, exec)).rejects.toThrow('experience_search')
  })

  it('子 agent 拒绝', async () => {
    await seedEpisode('fix_junction_mount')
    const tool = createExperienceReinforceTool({ experienceDirectory: dir, ctx: mockCtx() })
    await expect(tool.execute({ name: 'fix_junction_mount' } as never, childExec)).rejects.toThrow('子 agent')
  })
})
