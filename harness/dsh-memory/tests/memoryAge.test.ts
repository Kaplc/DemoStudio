import { describe, expect, it } from 'vitest'
import { memoryAge, memoryAgeDays, memoryFreshnessText } from '../src/memoryAge.js'

const DAY = 86_400_000

describe('memoryAgeDays', () => {
  it('0 天 = 今天', () => {
    const now = Date.now()
    expect(memoryAgeDays(now - 1000, now)).toBe(0)
    expect(memoryAgeDays(now, now)).toBe(0)
  })

  it('1 天 = 昨天', () => {
    const now = Date.now()
    expect(memoryAgeDays(now - DAY, now)).toBe(1)
    expect(memoryAgeDays(now - DAY - 3_600_000, now)).toBe(1)
  })

  it('N 天', () => {
    const now = Date.now()
    expect(memoryAgeDays(now - 47 * DAY, now)).toBe(47)
  })

  it('未来 mtime（时钟回拨/偏移）钳制为 0', () => {
    const now = Date.now()
    expect(memoryAgeDays(now + DAY, now)).toBe(0)
    expect(memoryAgeDays(now + 1000, now)).toBe(0)
  })
})

describe('memoryAge', () => {
  const now = Date.parse('2026-08-30T12:00:00Z')
  it('today / yesterday / N days ago', () => {
    expect(memoryAge(now, now)).toBe('today')
    expect(memoryAge(now - DAY, now)).toBe('yesterday')
    expect(memoryAge(now - 30 * DAY, now)).toBe('30 days ago')
  })
})

describe('memoryFreshnessText', () => {
  const now = Date.now()
  it('≤1 天返回空串（新鲜记忆不警告）', () => {
    expect(memoryFreshnessText(now, now)).toBe('')
    expect(memoryFreshnessText(now - DAY, now)).toBe('')
  })
  it('>1 天返回带天数的警告', () => {
    const text = memoryFreshnessText(now - 5 * DAY, now)
    expect(text).toContain('5 天')
    expect(text).toContain('时点观察')
    expect(text).toContain('file:line')
  })
})
