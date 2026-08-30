import { describe, expect, it } from 'vitest'
import { parseSelectorOutput } from '../src/selectMemories.js'

describe('parseSelectorOutput（选择器输出宽容解析）', () => {
  it('纯 JSON 直接解析', () => {
    expect(parseSelectorOutput('{"selected_memories": ["a.md", "b.md"]}'))
      .toEqual(['a.md', 'b.md'])
  })
  it('JSON 外带解释文字时截取 {…} 块', () => {
    expect(parseSelectorOutput('好的：{"selected_memories": ["a.md"]} 以上。'))
      .toEqual(['a.md'])
  })
  it('空数组合法', () => {
    expect(parseSelectorOutput('{"selected_memories": []}')).toEqual([])
  })
  it('selected_memories 缺失/非数组/含非字符串项 → undefined 或过滤', () => {
    expect(parseSelectorOutput('{"selected_memories": "a.md"}')).toBeUndefined()
    expect(parseSelectorOutput('{}')).toBeUndefined()
    expect(parseSelectorOutput('{"selected_memories": ["a.md", 42, "b.md"]}'))
      .toEqual(['a.md', 'b.md'])
  })
  it('完全不是 JSON → undefined', () => {
    expect(parseSelectorOutput('抱歉，我无法回答')).toBeUndefined()
    expect(parseSelectorOutput('')).toBeUndefined()
  })
})
