import { describe, expect, it } from 'vitest'
import { robustUnwrap } from '../src/tools/robustDefine.js'

describe('robustUnwrap - 强力反序列化', () => {
  it('非字符串原样返回', () => {
    expect(robustUnwrap(42)).toBe(42)
    expect(robustUnwrap(null)).toBe(null)
    expect(robustUnwrap(undefined)).toBe(undefined)
    expect(robustUnwrap({ kind: 'new', idPrefix: 'test' })).toEqual({ kind: 'new', idPrefix: 'test' })
  })

  it('普通 JSON 对象字符串 → 解析为对象', () => {
    const input = '{"kind":"new","idPrefix":"test"}'
    expect(robustUnwrap(input)).toEqual({ kind: 'new', idPrefix: 'test' })
  })

  it('双重编码字符串 → 逐层剥引号后解析', () => {
    // 第一层是字符串 "..."，内容是 JSON 对象
    const input = '"{\\"kind\\":\\"new\\",\\"idPrefix\\":\\"test\\"}"'
    const result = robustUnwrap(input)
    expect(result).toEqual({ kind: 'new', idPrefix: 'test' })
  })

  it('三重编码字符串 → 最多剥 8 层', () => {
    const inner = '{"kind":"new","idPrefix":"test"}'
    let encoded = inner
    // 编码 3 层
    for (let i = 0; i < 3; i++) {
      encoded = JSON.stringify(encoded)
    }
    const result = robustUnwrap(encoded)
    expect(result).toEqual({ kind: 'new', idPrefix: 'test' })
  })

  it('key=value&... 键值串 → 解析为对象', () => {
    const input = 'kind=new&idPrefix=test'
    const result = robustUnwrap(input) as Record<string, string>
    expect(result.kind).toBe('new')
    expect(result.idPrefix).toBe('test')
  })

  it('key=value;... 分号分隔 → 解析为对象', () => {
    const input = 'kind=new;idPrefix=test'
    const result = robustUnwrap(input) as Record<string, string>
    expect(result.kind).toBe('new')
    expect(result.idPrefix).toBe('test')
  })

  it('普通字符串（无法解析）→ 返回原字符串', () => {
    expect(robustUnwrap('just a string')).toBe('just a string')
  })

  it('空字符串 → 返回空字符串', () => {
    expect(robustUnwrap('')).toBe('')
  })

  it('带前后空格的 JSON → trim 后解析', () => {
    const input = '  {"kind":"existing","pluginId":"abc"}  '
    expect(robustUnwrap(input)).toEqual({ kind: 'existing', pluginId: 'abc' })
  })

  it('非法 JSON 字符串 → 返回原字符串', () => {
    expect(robustUnwrap('{broken json')).toBe('{broken json')
  })

  it('数组 JSON → 返回原字符串（只解析对象）', () => {
    // robustUnwrap 只解析 {} 对象，不解析 [] 数组
    const input = '[1,2,3]'
    expect(robustUnwrap(input)).toBe('[1,2,3]')
  })

  it('数字字符串 → 返回原字符串（不是对象）', () => {
    expect(robustUnwrap('42')).toBe('42')
  })
})
