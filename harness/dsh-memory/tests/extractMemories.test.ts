import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseExtractionOutput, renderTurnTranscript, shouldNotifySaved } from '../src/extractMemories.js'
import { EXTRACT_MAX_PER_PASS, MAX_EXTRACT_TRANSCRIPT_CHARS } from '../src/memoryTypes.js'

/** 测试辅助：伪造会话事件（只填提取器消费的字段）。 */
function ev(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

const userMsg = (text: string) => ev('user/message', createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
}))

const pluginMsg = (text: string) => ev('user/message', createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin: 'dsh-memory', form: 'recall' },
}))

const toolMsg = (text: string) => ev('user/message', {
  role: 'user',
  id: 'x',
  content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: false }],
  source: { kind: 'tool', callId: 'c1' },
  ...text,
})

const assistantMsg = (turn: number, text: string) => ev('assistant/message', {
  turn,
  step: 1,
  message: { role: 'assistant', id: 'a', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
})

describe('renderTurnTranscript', () => {
  it('按回合范围过滤；保留用户/助手/工具调用，跳过插件注入与工具结果', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }),
      userMsg('第一轮的话'),
      assistantMsg(1, '第一轮回复'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ev('turn/start', { turn: 2 }),
      userMsg('第二轮的话'),
      pluginMsg('注入的记忆内容'),
      toolMsg('工具结果消息'),
      ev('tool/call', { turn: 2, step: 1, callId: 'c1', name: 'memory_search', arguments: '{"query":"x"}' }),
      ev('tool/result', { turn: 2, step: 1, message: {} }),
      assistantMsg(2, '第二轮回复'),
      ev('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ]
    const { transcript, maxTurn } = renderTurnTranscript(events, 0)
    expect(maxTurn).toBe(2)
    expect(transcript).toContain('[用户] 第一轮的话')
    expect(transcript).toContain('[助手] 第一轮回复')
    expect(transcript).toContain('[用户] 第二轮的话')
    expect(transcript).toContain('[调用工具 memory_search]')
    expect(transcript).not.toContain('注入的记忆内容')
    expect(transcript).not.toContain('tool-result')

    // 水位 1：只出第二轮
    const only2 = renderTurnTranscript(events, 1)
    expect(only2.transcript).not.toContain('第一轮')
    expect(only2.transcript).toContain('第二轮的话')
  })

  it('无新回合返回空转录且 maxTurn 保持水位', () => {
    const events: SessionEvent[] = [ev('turn/start', { turn: 1 }), userMsg('x'), ev('turn/end', { turn: 1, reason: { kind: 'completed' } })]
    const { transcript, maxTurn } = renderTurnTranscript(events, 1)
    expect(transcript).toBe('')
    expect(maxTurn).toBe(1)
  })

  it('总长超限截断并标注', () => {
    // 单条消息先被裁到 1500 字，需要多条才能触发 20000 总长上限
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }),
      ...Array.from({ length: 20 }, (_, i) => userMsg(`第${i}条 ${'长'.repeat(1500)}`)),
      userMsg('这句话不该出现'),
    ]
    const { transcript } = renderTurnTranscript(events, 0)
    expect(transcript.length).toBeLessThanOrEqual(MAX_EXTRACT_TRANSCRIPT_CHARS + 20)
    expect(transcript).toContain('已截断')
    expect(transcript).not.toContain('这句话不该出现')
  })
})

describe('parseExtractionOutput', () => {
  const valid = { name: 'user_style', type: 'feedback', description: '偏好简洁', content: '规则 **Why:** x **How to apply:** y' }
  it('合法输出逐条通过', () => {
    expect(parseExtractionOutput(`{"memories": [${JSON.stringify(valid)}]}`)).toEqual([
      { name: 'user_style.md', type: 'feedback', description: '偏好简洁', content: expect.stringContaining('规则') },
    ])
  })
  it('空 memories 是正常结果', () => {
    expect(parseExtractionOutput('{"memories": []}')).toEqual([])
  })
  it('非法类型/空字段/坏名字丢弃，其余保留', () => {
    const text = JSON.stringify({
      memories: [
        valid,
        { ...valid, name: 'bad_type', type: 'nonsense' },
        { ...valid, name: 'empty_desc', description: '' },
        { ...valid, name: 'Not_Valid_Name' },
      ],
    })
    const result = parseExtractionOutput(text)
    expect(result).toHaveLength(1)
    expect(result![0]!.name).toBe('user_style.md')
  })
  it('超过上限只保留前 N 条', () => {
    const many = Array.from({ length: EXTRACT_MAX_PER_PASS + 2 }, (_, i) => ({
      ...valid, name: `mem_${i}`, description: `d${i}`,
    }))
    expect(parseExtractionOutput(JSON.stringify({ memories: many }))).toHaveLength(EXTRACT_MAX_PER_PASS)
  })
  it('非 JSON / 缺 memories 字段 → undefined', () => {
    expect(parseExtractionOutput('抱歉')).toBeUndefined()
    expect(parseExtractionOutput('{}')).toBeUndefined()
    expect(parseExtractionOutput('{"memories": "x"}')).toBeUndefined()
  })
})

describe('shouldNotifySaved', () => {
  it('常规新建（含空保存）不打扰', () => {
    expect(shouldNotifySaved({ saved: [], updated: [] })).toBe(false)
    expect(shouldNotifySaved({ saved: ['a.md'], updated: [] })).toBe(false)
    expect(shouldNotifySaved({ saved: ['a.md', 'b.md'], updated: [] })).toBe(false)
  })
  it('覆盖已有记忆时提醒', () => {
    expect(shouldNotifySaved({ saved: ['a.md'], updated: ['a.md'] })).toBe(true)
    expect(shouldNotifySaved({ saved: ['a.md', 'b.md'], updated: ['b.md'] })).toBe(true)
  })
  it('单次保存达到上限时提醒', () => {
    const cap = Array.from({ length: EXTRACT_MAX_PER_PASS }, (_, i) => `m${i}.md`)
    expect(shouldNotifySaved({ saved: cap, updated: [] })).toBe(true)
  })
})
