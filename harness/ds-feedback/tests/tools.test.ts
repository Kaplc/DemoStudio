import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRuleApplyTool, createRuleProposeTool } from '../src/tools.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-feedback-tools-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** defineTool 产物是 { name, ..., execute }；本插件工具不消费 exec，最小桩即可。 */
const exec = {} as never

describe('rule_propose 工具', () => {
  it('RL-01 非法 name 拒绝', async () => {
    const tool = createRuleProposeTool({ rulesDirectory: dir })
    for (const bad of ['', 'Bad_Name', 'a/b', '../x']) {
      await expect(tool.execute({ name: bad, content: 'c', reason: 'r' } as never, exec)).rejects.toThrow()
    }
    expect(existsSync(join(dir, 'pending'))).toBe(false)
  })
  it('RL-02 合法提案写入 pending，render 要求模型向用户转述待确认', async () => {
    const tool = createRuleProposeTool({ rulesDirectory: dir })
    const value = await tool.execute({
      name: 'server_authoritative_movement',
      content: '移动判定一律服务端权威',
      reason: '用户明说以后都这样',
    } as never, exec)
    expect(value).toEqual({
      status: 'proposed',
      file: 'pending/server_authoritative_movement.proposed.md',
      name: 'server_authoritative_movement',
    })
    const rendered = tool.output.render({}, value)
    const text = rendered[0]!.type === 'text' ? rendered[0].text : ''
    expect(text).toContain('未生效')
    expect(text).toContain('转述')
    expect(text).toContain('rule_apply {proposal: "server_authoritative_movement"}')
  })
})

describe('rule_apply 工具', () => {
  it('RL-04 不存在的提案报错且错误信息带现有提案清单', async () => {
    const propose = createRuleProposeTool({ rulesDirectory: dir })
    await propose.execute({ name: 'known_rule', content: 'c', reason: 'r' } as never, exec)
    const apply = createRuleApplyTool({ rulesDirectory: dir })
    const error = await apply.execute({ proposal: 'other_rule' } as never, exec).catch(e => e as Error)
    expect(error.message).toContain('other_rule')
    expect(error.message).toContain('known_rule')
  })
  it('apply 成功后规则文件落地、提案删除', async () => {
    const propose = createRuleProposeTool({ rulesDirectory: dir })
    await propose.execute({ name: 'good_rule', content: '正文', reason: 'r' } as never, exec)
    const apply = createRuleApplyTool({ rulesDirectory: dir })
    const value = await apply.execute({ proposal: 'good_rule' } as never, exec)
    expect(value).toEqual({ status: 'applied', file: 'good_rule.md', action: 'created' })
    expect(existsSync(join(dir, 'good_rule.md'))).toBe(true)
    expect(existsSync(join(dir, 'pending', 'good_rule.proposed.md'))).toBe(false)
    const index = await readFile(join(dir, 'RULES.md'), 'utf8')
    expect(index).toContain('good_rule')
  })
})
