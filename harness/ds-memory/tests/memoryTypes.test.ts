import { describe, expect, it } from 'vitest'
import {
  MAX_INDEX_LINE_LENGTH,
  MEMORY_TYPES,
  SAVE_FLOW_TEXT,
  WHAT_NOT_TO_SAVE_TEXT,
  memoryGuideSectionText,
  normalizeMemoryName,
  parseFrontmatter,
  parseMemoryType,
  parseTriggerFileList,
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

describe('renderMemoryFile / prefix 联想键（触发文件列表）', () => {
  it('带 prefix 序列化出方括号数组行并可解析回', () => {
    const file = renderMemoryFile('engine_pitfall', '引擎坑', 'project', '正文', ['src/engine/a.ts'])
    expect(file).toContain('prefix: [src/engine/a.ts]')
    const { data, body } = parseFrontmatter(file)
    expect(data.prefix).toEqual(['src/engine/a.ts'])
    expect(body).toBe('正文\n')
  })

  it('多文件列表逗号分隔序列化，解析还原为数组', () => {
    const file = renderMemoryFile('a', 'd', 'user', 'c', ['src/engine/a.ts', 'doc/engine/b.md'])
    expect(file).toContain('prefix: [src/engine/a.ts, doc/engine/b.md]')
    expect(parseFrontmatter(file).data.prefix).toEqual(['src/engine/a.ts', 'doc/engine/b.md'])
  })

  it('不带 prefix / 空数组时不写 prefix 行', () => {
    expect(renderMemoryFile('a', 'd', 'user', 'c')).not.toContain('prefix:')
    expect(renderMemoryFile('a', 'd', 'user', 'c', [])).not.toContain('prefix:')
  })

  it('解析方括号数组 / 裸单文件 / 带引号写法；空值 undefined', () => {
    expect(parseFrontmatter('---\nprefix: [src/engine/a.ts, doc/engine/b.md]\n---\nx').data.prefix)
      .toEqual(['src/engine/a.ts', 'doc/engine/b.md'])
    expect(parseFrontmatter('---\nprefix: src/engine/a.ts\n---\nx').data.prefix).toEqual(['src/engine/a.ts'])
    expect(parseFrontmatter("---\nprefix: 'src/engine/a.ts'\n---\nx").data.prefix).toEqual(['src/engine/a.ts'])
    expect(parseFrontmatter('---\nprefix:\n---\nx').data.prefix).toBeUndefined()
  })
})

describe('parseTriggerFileList（触发文件列表解析）', () => {
  it('方括号数组按逗号拆分，去空白', () => {
    expect(parseTriggerFileList('[src/engine/a.ts, doc/engine/b.md]'))
      .toEqual(['src/engine/a.ts', 'doc/engine/b.md'])
    expect(parseTriggerFileList('  [ a.ts ,  b.md ]  ')).toEqual(['a.ts', 'b.md'])
  })

  it('裸单文件值退化为单项数组（兼容手写单文件省略方括号）', () => {
    expect(parseTriggerFileList('src/engine/a.ts')).toEqual(['src/engine/a.ts'])
    expect(parseTriggerFileList('  src/engine/a.ts  ')).toEqual(['src/engine/a.ts'])
  })

  it('每项去成对引号；反斜杠归一为正斜杠', () => {
    expect(parseTriggerFileList(`["a.ts", 'b.md']`)).toEqual(['a.ts', 'b.md'])
    expect(parseTriggerFileList('[src\\engine\\a.ts]')).toEqual(['src/engine/a.ts'])
    expect(parseTriggerFileList('src\\engine\\a.ts')).toEqual(['src/engine/a.ts'])
  })

  it('空项丢弃；全空/空串返回 undefined（视为未声明，不参与联想）', () => {
    expect(parseTriggerFileList('[a.ts, , b.md]')).toEqual(['a.ts', 'b.md'])
    expect(parseTriggerFileList('[]')).toBeUndefined()
    expect(parseTriggerFileList('[  ]')).toBeUndefined()
    expect(parseTriggerFileList('')).toBeUndefined()
    expect(parseTriggerFileList('   ')).toBeUndefined()
  })

  it('目录型旧值解析为单项数组但按新语义不会命中其下文件（精确匹配由 associate 负责）', () => {
    // 旧 frontmatter 的目录值不再被特殊解释，只是永远匹配不到任何具体文件
    expect(parseTriggerFileList('src/engine')).toEqual(['src/engine'])
  })
})

describe('KM-01 记忆指导段踩坑四段结构（数据飞轮·知识飞轮）', () => {
  it('指导段含踩坑四段标签 Problem/Cause/Solution/Applicable', () => {
    const section = memoryGuideSectionText(undefined)
    for (const tag of ['**Problem:**', '**Cause:**', '**Solution:**', '**Applicable:**']) {
      expect(section).toContain(tag)
    }
  })
  it('Applicable 说明需写适用子系统/文件范围（供选择器路由）', () => {
    const section = memoryGuideSectionText('…索引…')
    expect(section).toMatch(/Applicable:\*.{0,80}(子系统|文件范围)/)
  })
  it('不保存清单不再包含无差别的"调试修复配方"，改为限定一次性修复过程', () => {
    expect(WHAT_NOT_TO_SAVE_TEXT).not.toContain('调试修复配方')
    expect(WHAT_NOT_TO_SAVE_TEXT).toContain('一次性的修复过程')
    expect(WHAT_NOT_TO_SAVE_TEXT).toContain('根因教训')
  })
  it('容器规则：一份文件 = 一个主题 + 一种条目格式；多条文件每坑一个 ## 小节', () => {
    const section = memoryGuideSectionText(undefined)
    expect(section).toContain('一份文件 = 一个主题')
    expect(section).toContain('## 短名')
    expect(section).toContain('数量即条数')
  })
  it('保存指导绑定具体触发点并要求当回合保存（主 agent 主动写）', () => {
    expect(SAVE_FLOW_TEXT).toContain('当回合立即')
    expect(SAVE_FLOW_TEXT).toContain('memory_write')
    expect(SAVE_FLOW_TEXT).toContain('宁缺毋滥')
  })
  it('指导段说明 prefix 文件联想：命中自动加载全文、正文须精炼、只按具体文件精确匹配', () => {
    const section = memoryGuideSectionText(undefined)
    expect(section).toContain('prefix 文件联想')
    expect(section).toContain('全文会被自动注入')
    expect(section).toContain('必须最精炼')
    expect(section).toContain('具体文件')
    expect(section).not.toContain('段级前缀')
  })
})
