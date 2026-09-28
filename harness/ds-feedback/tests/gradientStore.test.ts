import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  proposeGradient,
  listPendingGradients,
  readGradientProposal,
  removeGradientProposal,
  appendLedgerEntry,
  readLedger,
  parseProposalFile,
  normalizeGradientName,
} from '../src/gradientStore.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-gradient-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const input = {
  name: 'reminder_dot_reply',
  kind: 'reminder' as const,
  target: 'memory-end-of-turn.md',
  delta: '无事可做时回复只输出句号「。」',
  evidence: '用户 2026-09-30 纠正：整段复盘说明是噪音',
}

describe('gradientStore', () => {
  it('propose → list → read 往返', async () => {
    const file = await proposeGradient(dir, input)
    expect(file).toBe('pending/reminder_dot_reply.proposed.md')
    const { proposals, broken } = await listPendingGradients(dir)
    expect(broken).toEqual([])
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      name: 'reminder_dot_reply',
      kind: 'reminder',
      target: 'memory-end-of-turn.md',
      delta: '无事可做时回复只输出句号「。」',
      evidence: '用户 2026-09-30 纠正：整段复盘说明是噪音',
    })
    const single = await readGradientProposal(dir, 'reminder_dot_reply')
    expect(single.name).toBe('reminder_dot_reply')
  })

  it('同名覆盖幂等；delta 多行正文完整保留', async () => {
    await proposeGradient(dir, input)
    await proposeGradient(dir, { ...input, delta: '第一行\n第二行' })
    const { proposals } = await listPendingGradients(dir)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.delta).toBe('第一行\n第二行')
  })

  it('非法输入逐项抛错（name/delta/evidence/target/kind）', async () => {
    await expect(proposeGradient(dir, { ...input, name: 'Bad-Name' })).rejects.toThrow(/invalid gradient name/)
    await expect(proposeGradient(dir, { ...input, name: '../escape' })).rejects.toThrow(/invalid gradient name/)
    await expect(proposeGradient(dir, { ...input, delta: '  ' })).rejects.toThrow(/delta must be a non-empty/)
    await expect(proposeGradient(dir, { ...input, evidence: '' })).rejects.toThrow(/evidence must be a non-empty/)
    await expect(proposeGradient(dir, { ...input, target: '' })).rejects.toThrow(/target must be a non-empty/)
    expect(() => parseProposalFile('no frontmatter', 'x')).toThrow(/frontmatter/)
    expect(() => parseProposalFile('---\nname: a\nkind: bogus\ntarget: t\n---\ndelta', 'x')).toThrow(/kind 非法/)
  })

  it('read 不存在的候选报错并列出现有；remove 幂等', async () => {
    await proposeGradient(dir, input)
    await expect(readGradientProposal(dir, 'missing_one')).rejects.toThrow(/不存在.*reminder_dot_reply/s)
    await removeGradientProposal(dir, 'reminder_dot_reply')
    await removeGradientProposal(dir, 'reminder_dot_reply')
    const { proposals } = await listPendingGradients(dir)
    expect(proposals).toHaveLength(0)
  })

  it('坏文件计入 broken 不拖垮列表', async () => {
    await proposeGradient(dir, input)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'pending', 'bad_one.proposed.md'), '---\nname: bad_one\nkind: ???\n---\n', 'utf8')
    const { proposals, broken } = await listPendingGradients(dir)
    expect(proposals).toHaveLength(1)
    expect(broken).toEqual(['bad_one.proposed.md'])
  })

  it('台账追加与按 limit 读取（坏行跳过）', async () => {
    for (let i = 0; i < 3; i++) {
      await appendLedgerEntry(dir, { ts: i, name: `g_${i}`, kind: 'rule', target: `rule_${i}`, action: 'created', deltaPreview: `delta ${i}` })
    }
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(dir, 'applied.jsonl'), 'not-json\n', 'utf8')
    expect(await readLedger(dir, 2)).toHaveLength(2)
    const all = await readLedger(dir)
    expect(all).toHaveLength(3)
    expect(all[0]?.name).toBe('g_0')
  })

  it('台账 deltaPreview 超长截断', async () => {
    await appendLedgerEntry(dir, { ts: 1, name: 'long_delta', kind: 'reminder', target: 'a.md', action: 'appended', deltaPreview: '长'.repeat(500) })
    const [entry] = await readLedger(dir)
    expect(entry?.deltaPreview.length).toBeLessThanOrEqual(200)
    expect(entry?.deltaPreview.endsWith('…')).toBe(true)
  })

  it('normalizeGradientName 兼容后缀剥离', () => {
    expect(normalizeGradientName('a_b')).toBe('a_b')
    expect(normalizeGradientName('a_b.md')).toBe('a_b')
    expect(normalizeGradientName('a_b.proposed.md')).toBe('a_b')
    expect(() => normalizeGradientName('')).toThrow()
    expect(() => normalizeGradientName('A_B')).toThrow()
  })
})
