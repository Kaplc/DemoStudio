import { describe, expect, it } from 'vitest'
import { truncateEntrypoint } from '../src/memoryScan.js'
import { MAX_ENTRYPOINT_BYTES, MAX_ENTRYPOINT_LINES } from '../src/memoryTypes.js'

describe('truncateEntrypoint', () => {
  it('不超限时原样返回、无警告', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    const result = truncateEntrypoint(text)
    expect(result.truncated).toBe(false)
    expect(result.text).toBe(text)
  })

  it('行数超限：截到 300 行并附警告行', () => {
    const lines = Array.from({ length: MAX_ENTRYPOINT_LINES + 50 }, (_, i) => `line ${i}`)
    const result = truncateEntrypoint(lines.join('\n'))
    expect(result.truncated).toBe(true)
    const keptLines = result.text.split('\n')
    expect(keptLines[0]).toBe('line 0')
    expect(keptLines[MAX_ENTRYPOINT_LINES - 1]).toBe(`line ${MAX_ENTRYPOINT_LINES - 1}`)
    expect(result.text).toContain('已截断')
  })

  it('字节超限：截到 40KB 内并附警告行', () => {
    // 每行 ~100 字节 × 500 行 ≈ 50KB > 40KB，但行数 < 300
    const lines = Array.from({ length: 500 }, (_, i) => `x`.repeat(99) + ` ${i}`)
    const result = truncateEntrypoint(lines.join('\n'))
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThan(MAX_ENTRYPOINT_BYTES + 400)
    expect(result.text).toContain('已截断')
  })

  it('行数+字节双触发：先按行截，再按字节截', () => {
    const longLine = 'y'.repeat(500)
    const lines = Array.from({ length: MAX_ENTRYPOINT_LINES + 100 }, () => longLine)
    const result = truncateEntrypoint(lines.join('\n'))
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThan(MAX_ENTRYPOINT_BYTES + 400)
    expect(result.text).toContain('已截断')
  })
})
