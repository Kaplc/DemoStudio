import { describe, expect, it } from 'vitest'
import {
  MAX_INDEX_LINE_LENGTH,
  MEMORY_TYPES,
  normalizeMemoryName,
  parseFrontmatter,
  parseMemoryType,
  renderMemoryFile,
} from '../src/memoryTypes.js'
import { renderIndexLine } from '../src/memoryStore.js'

describe('parseMemoryType', () => {
  it('合法类型透传', () => {
    for (const type of MEMORY_TYPES) expect(parseMemoryType(type)).toBe(type)
  })
  it('非法值返回 undefined 优雅降级', () => {
    expect(parseMemoryType('team')).toBeUndefined()
    expect(parseMemoryType('USER')).toBeUndefined()
    expect(parseMemoryType(42)).toBeUndefined()
    expect(parseMemoryType(undefined)).toBeUndefined()
  })
})

describe('parseFrontmatter', () => {
  it('解析规范文件（FR-4 格式）', () => {
    const file = renderMemoryFile('user_role', '用户角色与偏好', 'user', '正文第一行\n正文第二行')
    const { data, body } = parseFrontmatter(file)
    expect(data.name).toBe('user_role')
    expect(data.description).toBe('用户角色与偏好')
    expect(data.type).toBe('user')
    expect(body).toBe('正文第一行\n正文第二行\n')
  })

  it('非法 type 降级为 undefined，其余字段仍解析', () => {
    const { data } = parseFrontmatter('---\nname: a\ndescription: b\ntype: nonsense\n---\nbody')
    expect(data.type).toBeUndefined()
    expect(data.name).toBe('a')
    expect(data.description).toBe('b')
  })

  it('无 frontmatter / 空输入按无 frontmatter 处理', () => {
    expect(parseFrontmatter('just text').data).toEqual({})
    expect(parseFrontmatter('').data).toEqual({})
    expect(parseFrontmatter('---\nno closing fence').data).toEqual({})
    expect(parseFrontmatter('---').data).toEqual({})
  })

  it('容忍 BOM 与缺 name/description 的半损坏文件', () => {
    const { data, body } = parseFrontmatter('\uFEFF---\ntype: project\n---\n内容')
    expect(data.type).toBe('project')
    expect(data.name).toBeUndefined()
    expect(body).toBe('内容')
  })
})

describe('normalizeMemoryName', () => {
  it('接受裸名与 .md 名，规范化补 .md', () => {
    expect(normalizeMemoryName('user_role')).toBe('user_role.md')
    expect(normalizeMemoryName('user_role.md')).toBe('user_role.md')
    expect(normalizeMemoryName('a1_b2')).toBe('a1_b2.md')
  })
  it('拒绝非法名', () => {
    expect(() => normalizeMemoryName('')).toThrow()
    expect(() => normalizeMemoryName('User_Role')).toThrow()
    expect(() => normalizeMemoryName('1abc')).toThrow()
    expect(() => normalizeMemoryName('../escape')).toThrow()
    expect(() => normalizeMemoryName('a/b')).toThrow()
    expect(() => normalizeMemoryName('with space')).toThrow()
    expect(() => normalizeMemoryName('memory')).toThrow()
  })
})

describe('renderIndexLineHelper', () => {
  it('格式为 `- [name](name.md) — hook`', () => {
    expect(renderIndexLine('user_role', '回复要简洁')).toBe('- [user_role](user_role.md) — 回复要简洁')
  })
  it('超长 hook 截断到 MAX_INDEX_LINE_LENGTH', () => {
    const line = renderIndexLine('user_role', '长'.repeat(300))
    expect(line.length).toBeLessThanOrEqual(MAX_INDEX_LINE_LENGTH)
    expect(line.endsWith('…')).toBe(true)
  })
})
