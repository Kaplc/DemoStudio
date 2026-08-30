import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeEpisodeName, parseEpisodeFrontmatter } from '../src/experienceTypes.js'
import { readAllEpisodes, renderIndexLine, saveExperience } from '../src/experienceStore.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-experience-store-'))
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const input = {
  name: 'fix_junction_mount',
  taskType: 'build-fix',
  outcome: 'success' as const,
  summary: '用 PowerShell New-Item Junction 挂载插件',
  lessons: 'Git Bash mklink 会挂；一律走 PowerShell',
}

describe('EXP-01 experience_save 新建 episode', () => {
  it('<experienceDir>/<name>.md 落盘 + INDEX.md 各一行（含 task_type/outcome）', async () => {
    const result = await saveExperience(dir, input)
    expect(result.status).toBe('created')
    expect(result.fileName).toBe('fix_junction_mount.md')

    const file = await readFile(join(dir, 'fix_junction_mount.md'), 'utf8')
    expect(file).toContain('name: fix_junction_mount')
    expect(file).toContain('task_type: build-fix')
    expect(file).toContain('outcome: success')
    expect(file).toMatch(/date: \d{4}-\d{2}-\d{2}/)
    expect(file).toContain('## Summary')
    expect(file).toContain('## Lessons')

    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    const lines = index.split('\n').filter(line => line.startsWith('- [fix_junction_mount]'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('build-fix · success')
  })
  it('effective_path 提供时渲染 Effective Path 小节', async () => {
    await saveExperience(dir, { ...input, effectivePath: 'powershell New-Item -ItemType Junction' })
    const file = await readFile(join(dir, 'fix_junction_mount.md'), 'utf8')
    expect(file).toContain('## Effective Path')
    expect(file).toContain('New-Item -ItemType Junction')
  })
})

describe('EXP-02 同名重复 save', () => {
  it('更新原文件（不产生副本），INDEX.md 保持单行', async () => {
    await saveExperience(dir, input)
    const second = await saveExperience(dir, { ...input, summary: '更新后的概述' })
    expect(second.status).toBe('updated')

    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(dir)).filter(f => f.endsWith('.md') && f !== 'INDEX.md')
    expect(files).toEqual(['fix_junction_mount.md'])

    const file = await readFile(join(dir, 'fix_junction_mount.md'), 'utf8')
    expect(file).toContain('更新后的概述')
    const index = await readFile(join(dir, 'INDEX.md'), 'utf8')
    expect(index.split('\n').filter(line => line.startsWith('- [fix_junction_mount]'))).toHaveLength(1)
    expect(index).toContain('更新后的概述')
  })
})

describe('EXP-03 非法名拒绝', () => {
  it('大写/路径分隔符/空名一律抛错', async () => {
    for (const bad of ['', 'Fix_Junction', 'a/b', 'a\\b', '../escape', 'with space', '1abc']) {
      expect(() => normalizeEpisodeName(bad), `"${bad}"`).toThrow()
    }
    expect(normalizeEpisodeName('fix_junction_mount.md')).toBe('fix_junction_mount.md')
  })
  it('保留名 index 拒绝（INDEX.md 是索引文件）', () => {
    expect(() => normalizeEpisodeName('index')).toThrow()
  })
})

describe('store 辅助', () => {
  it('readAllEpisodes 跳过 INDEX.md、解析 frontmatter', async () => {
    await saveExperience(dir, input)
    await saveExperience(dir, { ...input, name: 'another_episode', taskType: 'feature', outcome: 'partial' })
    const records = await readAllEpisodes(dir)
    expect(records.map(r => r.fileName)).toEqual(['another_episode.md', 'fix_junction_mount.md'])
    expect(records[1]!.taskType).toBe('build-fix')
    expect(records[1]!.outcome).toBe('success')
    expect(records[0]!.outcome).toBe('partial')
  })
  it('空目录 readAllEpisodes 返回 []', async () => {
    expect(await readAllEpisodes(dir)).toEqual([])
  })
  it('renderIndexLine 超长截断', () => {
    const line = renderIndexLine('long_episode', 'build-fix', 'success', '概'.repeat(300))
    expect(line.length).toBeLessThanOrEqual(150)
    expect(line.endsWith('…')).toBe(true)
  })
  it('半损坏文件（无 frontmatter）仍可被扫描', async () => {
    await saveExperience(dir, input)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'broken.md'), '没有 frontmatter 的正文', 'utf8')
    const records = await readAllEpisodes(dir)
    expect(records).toHaveLength(2)
    expect(records.find(r => r.fileName === 'broken.md')?.body).toContain('没有 frontmatter')
  })
  it('parseEpisodeFrontmatter 宽松解析', () => {
    const { data } = parseEpisodeFrontmatter('---\nname: a\ntask_type: debug\noutcome: weird\ndate: 2026-08-30\n---\nbody')
    expect(data.name).toBe('a')
    expect(data.task_type).toBe('debug')
    expect(data.outcome).toBe('weird')
    expect(data.date).toBe('2026-08-30')
  })
})
