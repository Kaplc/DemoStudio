import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyRule,
  listPendingProposals,
  proposeRule,
  readActiveRules,
  renderIndexLine,
  truncateIndex,
} from '../src/ruleStore.js'
import { MAX_INDEX_BYTES, MAX_INDEX_LINES, rulesSectionText } from '../src/ruleTypes.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-'))
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 组装规则段文本（与 index.ts section text 同路径：磁盘扫描派生索引）。 */
async function sectionText(): Promise<string> {
  const rules = await readActiveRules(dir)
  const index = truncateIndex(rules.map(r => renderIndexLine(r.name, r.content.split('\n')[0]!)).join('\n')).text
  return rulesSectionText(rules, index)
}

describe('RL-01/03 规则名校验（propose 与 apply 共用 normalizeRuleName）', () => {
  it('空名 / 大写 / 含分隔符 / .. 一律拒绝', async () => {
    for (const bad of ['', 'Server_Rule', 'server-rule', 'a/b', 'a\\b', '../escape', '1abc', 'with space']) {
      await expect(proposeRule(dir, { name: bad, content: 'c', reason: 'r' }), `propose "${bad}"`).rejects.toThrow()
      await expect(applyRule(dir, { proposal: bad }), `apply "${bad}"`).rejects.toThrow()
    }
  })
  it('合法名接受并可完整走通', async () => {
    await proposeRule(dir, { name: 'server_authoritative_movement', content: '正文', reason: '用户要求' })
    const result = await applyRule(dir, { proposal: 'server_authoritative_movement' })
    expect(result.action).toBe('created')
  })
})

describe('RL-02 提案落盘', () => {
  it('pending/<name>.proposed.md 生成，frontmatter 含 name/reason/date', async () => {
    const file = await proposeRule(dir, {
      name: 'server_authoritative_movement',
      content: '移动判定一律服务端权威',
      reason: '用户明说"以后都这样"',
    })
    expect(file).toBe('pending/server_authoritative_movement.proposed.md')
    const text = await readFile(join(dir, 'pending', 'server_authoritative_movement.proposed.md'), 'utf8')
    expect(text).toContain('name: server_authoritative_movement')
    expect(text).toContain('reason: 用户明说"以后都这样"')
    expect(text).toMatch(/date: \d{4}-\d{2}-\d{2}/)
    expect(text).toContain('移动判定一律服务端权威')
  })
  it('同名重复提案幂等覆盖，不报错', async () => {
    await proposeRule(dir, { name: 'dupe_rule', content: 'v1', reason: 'r1' })
    await proposeRule(dir, { name: 'dupe_rule', content: 'v2', reason: 'r2' })
    const pending = await listPendingProposals(dir)
    expect(pending).toEqual(['dupe_rule'])
    const text = await readFile(join(dir, 'pending', 'dupe_rule.proposed.md'), 'utf8')
    expect(text).toContain('v2')
  })
})

describe('RL-04 apply 不存在的提案', () => {
  it('报错并列出 pending 现有提案', async () => {
    await proposeRule(dir, { name: 'alpha_rule', content: 'c', reason: 'r' })
    await proposeRule(dir, { name: 'beta_rule', content: 'c', reason: 'r' })
    const error = await applyRule(dir, { proposal: 'missing_rule' }).catch(e => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('missing_rule')
    expect(error.message).toContain('alpha_rule')
    expect(error.message).toContain('beta_rule')
  })
  it('pending 为空时提示（空）', async () => {
    await expect(applyRule(dir, { proposal: 'anything' })).rejects.toThrow('（空）')
  })
})

describe('RL-05/06/07 同名冲突与 mode', () => {
  beforeEach(async () => {
    await proposeRule(dir, { name: 'conflict_rule', content: '新内容', reason: 'r' })
    await writeFile(join(dir, 'conflict_rule.md'), '原始规则内容\n', 'utf8')
  })
  it('RL-05 已存在且未给 mode → 报错并提示 overwrite/append 二选一', async () => {
    await expect(applyRule(dir, { proposal: 'conflict_rule' })).rejects.toThrow(/overwrite.*append|append.*overwrite/s)
    // 报错时提案保留，未静默落地
    expect(existsSync(join(dir, 'pending', 'conflict_rule.proposed.md'))).toBe(true)
  })
  it('RL-06 mode:overwrite → 整体替换', async () => {
    const result = await applyRule(dir, { proposal: 'conflict_rule', mode: 'overwrite' })
    expect(result.action).toBe('overwritten')
    expect(await readFile(join(dir, 'conflict_rule.md'), 'utf8')).not.toContain('原始规则内容')
  })
  it('RL-07 mode:append → 原内容保留 + 追加带日期小节', async () => {
    const result = await applyRule(dir, { proposal: 'conflict_rule', mode: 'append' })
    expect(result.action).toBe('appended')
    const text = await readFile(join(dir, 'conflict_rule.md'), 'utf8')
    expect(text).toContain('原始规则内容')
    expect(text).toContain('新内容')
    expect(text).toMatch(/## \d{4}-\d{2}-\d{2}（追加）/)
  })
})

describe('RL-08 apply 成功后的收尾', () => {
  it('提案删除；RULES.md 索引恰一行（更新不产生重复行）', async () => {
    await proposeRule(dir, { name: 'index_rule', content: '第一版', reason: 'r' })
    await applyRule(dir, { proposal: 'index_rule' })
    expect(existsSync(join(dir, 'pending', 'index_rule.proposed.md'))).toBe(false)

    // 再次同名规则走 append 更新，索引仍单行
    await proposeRule(dir, { name: 'index_rule', content: '第二版补充', reason: 'r2' })
    await applyRule(dir, { proposal: 'index_rule', mode: 'append' })
    const text = await readFile(join(dir, 'RULES.md'), 'utf8')
    const ruleLines = text.split('\n').filter(line => line.startsWith('- [index_rule]'))
    expect(ruleLines).toHaveLength(1)
  })
})

describe('RL-09 pending 不出现在规则段', () => {
  it('section 只列 active 规则', async () => {
    await proposeRule(dir, { name: 'pending_only_rule', content: '还在待确认的内容', reason: 'r' })
    await proposeRule(dir, { name: 'active_rule', content: '已生效内容', reason: 'r' })
    await applyRule(dir, { proposal: 'active_rule' })
    const text = await sectionText()
    expect(text).toContain('已生效内容')
    expect(text).not.toContain('还在待确认的内容')
    expect(text).not.toContain('pending_only_rule')
  })
})

describe('RL-10 超限规则库截断', () => {
  it('索引 >300 行截断并带提示，不崩', async () => {
    const lines = Array.from({ length: MAX_INDEX_LINES + 50 }, (_, i) => `- [rule_${i}](rule_${i}.md) — hook`)
    const { text, truncated } = truncateIndex(lines.join('\n'))
    expect(truncated).toBe(true)
    expect(text).toContain('已截断')
    expect(text!.split('\n').length).toBeLessThanOrEqual(MAX_INDEX_LINES + 2)
  })
  it('索引 >40KB 截断并带提示，不崩', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `- [rule_${i}](rule_${i}.md) — ${'长'.repeat(200)}`)
    const { text, truncated } = truncateIndex(lines.join('\n'))
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(text!, 'utf8')).toBeLessThanOrEqual(MAX_INDEX_BYTES + 60)
  })
  it('空库：段文本不列规则、不报错（SP-04 空库模式）', async () => {
    const text = await sectionText()
    expect(text).toContain('规则库当前为空')
    expect(text).not.toContain('RULES.md 索引')
  })
})

describe('store 辅助行为', () => {
  it('readActiveRules 跳过 RULES.md 与 pending 子目录', async () => {
    await proposeRule(dir, { name: 'kept_rule', content: '正文', reason: 'r' })
    await applyRule(dir, { proposal: 'kept_rule' })
    const rules = await readActiveRules(dir)
    expect(rules.map(r => r.name)).toEqual(['kept_rule'])
    const files = await readdir(dir)
    expect(files).toContain('RULES.md')
  })
  it('apply 后 RULES.md 与磁盘规则一致（hook = 提案 reason）', async () => {
    await proposeRule(dir, { name: 'hook_rule', content: '规则正文', reason: '因为用户三次纠正' })
    await applyRule(dir, { proposal: 'hook_rule' })
    const text = await readFile(join(dir, 'RULES.md'), 'utf8')
    expect(text).toContain('- [hook_rule](hook_rule.md) — 因为用户三次纠正')
  })
})
