import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId, SessionLogSnapshot, SessionSearchHit, SessionSearchPage, SessionTitleSnapshot } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createHistoryReadTool, createHistorySearchTool } from '../src/historyTools.js'
import { renderTurnTranscript } from '../src/transcript.js'

/** 测试辅助：伪造会话事件（只填渲染器消费的字段）。 */
function ev(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

const userMsg = (text: string) => ev('user/message', createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
}))

const pluginMsg = (text: string) => ev('user/message', createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin: 'ds-memory', form: 'recall' },
}))

const toolResultMsg = () => ev('user/message', {
  role: 'user', id: 'x',
  content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: false }],
  source: { kind: 'tool', callId: 'c1' },
})

const assistantMsg = (turn: number, text: string) => ev('assistant/message', {
  turn, step: 1,
  message: { role: 'assistant', id: 'a', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
})

/** EXP-07：转录只含真实用户消息、助手文本、工具调用。 */
describe('EXP-07 转录渲染过滤插件注入与工具结果', () => {
  it('保留用户/助手/工具调用；跳过插件注入与 tool-result', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }),
      userMsg('把插件挂载修好'),
      pluginMsg('注入的记忆内容不应出现'),
      toolResultMsg(),
      ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }),
      ev('tool/result', { turn: 1, step: 1, message: {} }),
      assistantMsg(1, '已经修好'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ev('assistant/chunk', { turn: 1, step: 1, index: 0 }),
    ]
    const { transcript } = renderTurnTranscript(events, {})
    expect(transcript).toContain('[用户] 把插件挂载修好')
    expect(transcript).toContain('[调用工具 bash]')
    expect(transcript).toContain('[助手] 已经修好')
    expect(transcript).not.toContain('注入的记忆内容不应出现')
    expect(transcript).not.toContain('tool-result')
  })
  it('max_chars 超限截断并标注', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }),
      userMsg('短消息可以进来'),
      userMsg('长'.repeat(1400)),
    ]
    const { transcript } = renderTurnTranscript(events, { maxChars: 1200 })
    expect(transcript.length).toBeLessThanOrEqual(1300)
    expect(transcript).toContain('已截断')
    expect(transcript).toContain('短消息可以进来')
    expect(transcript).not.toContain('短消息可以进来长')
  })
})

// ---------------------------------------------------------------------------
// history 工具（mock ctx.sessionQuery）
// ---------------------------------------------------------------------------

const header = (id: string, cwd?: string): SessionHeader => ({
  version: 1, id: id as SessionId, createdAt: Date.parse('2026-08-20T10:00:00Z'), ...(cwd === undefined ? {} : { cwd }),
}) as SessionHeader

function mockCtx(options: {
  searchResults?: SessionSearchHit[]
  readSessionResult?: SessionLogSnapshot
  readSessionError?: Error
  title?: string
}): Context {
  return {
    sessionQuery: {
      async searchSessions(): Promise<SessionSearchPage<SessionSearchHit>> {
        return { items: options.searchResults ?? [] }
      },
      async readSession(id: SessionId): Promise<SessionLogSnapshot> {
        if (options.readSessionError !== undefined) throw options.readSessionError
        return options.readSessionResult ?? { session: header(id), events: [] }
      },
      async readTitle(): Promise<SessionTitleSnapshot | undefined> {
        return options.title === undefined ? undefined : { title: options.title } as SessionTitleSnapshot
      },
    },
  } as unknown as Context
}

const execWith = (cwd?: string) => ({
  signal: new AbortController().signal,
  agent: cwd === undefined ? undefined : { session: { header: { cwd } } },
}) as never

describe('history_search', () => {
  it('按会话 cwd 过滤检索并返回 id/日期/标题/摘要', async () => {
    let captured: { sessionFilters?: unknown } | undefined
    const ctx = {
      sessionQuery: {
        async searchSessions(request: never): Promise<SessionSearchPage<SessionSearchHit>> {
          captured = request as never
          const hit: SessionSearchHit = {
            header: header('sess-1', 'E:/DemoStudio'),
            live: true, persisted: false,
            bestMatch: { seq: 3, time: 0, type: 'user/message', surface: 'current', sessionId: 'sess-1' as SessionId, snippet: 'junction 挂载的坑在 PowerShell' },
          }
          return { items: [hit] }
        },
        async readTitle(): Promise<SessionTitleSnapshot | undefined> {
          return { title: '修复 junction 挂载' } as SessionTitleSnapshot
        },
      },
    } as unknown as Context
    const tool = createHistorySearchTool({ ctx })
    const value = await tool.execute({ query: 'junction 挂载' } as never, execWith('E:/DemoStudio'))
    // cwd 过滤生效
    expect(captured?.sessionFilters).toEqual([{ kind: 'cwd', values: ['E:/DemoStudio'] }])
    expect(value.count).toBe(1)
    expect(value.hits[0]).toMatchObject({
      session_id: 'sess-1', date: '2026-08-20', title: '修复 junction 挂载',
    })
    expect(value.hits[0]!.snippet).toContain('PowerShell')
  })
  it('空命中返回友好空结果', async () => {
    const ctx = mockCtx({})
    const tool = createHistorySearchTool({ ctx })
    const value = await tool.execute({ query: '不存在的东西' } as never, execWith('E:/DemoStudio'))
    expect(value.count).toBe(0)
    expect(value.hits).toEqual([])
  })
})

describe('EXP-06 history_read 不存在的 session_id', () => {
  it('SESSION_QUERY_SESSION_NOT_FOUND 透出为工具错误', async () => {
    const notFound = Object.assign(new Error('session not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    const ctx = mockCtx({ readSessionError: notFound })
    const tool = createHistoryReadTool({ ctx })
    const error = await tool.execute({ session_id: 'missing' } as never, execWith('E:/DemoStudio')).catch(e => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as { code?: string }).code).toBe('SESSION_QUERY_SESSION_NOT_FOUND')
  })
  it('正常读取渲染转录', async () => {
    const snapshot: SessionLogSnapshot = {
      session: header('sess-9'),
      events: [
        ev('turn/start', { turn: 1 }),
        userMsg('上次的任务'),
        ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'grep', arguments: '{}' }),
        assistantMsg(1, '完成了'),
      ],
    }
    const ctx = mockCtx({ readSessionResult: snapshot, title: 't' })
    const tool = createHistoryReadTool({ ctx })
    const value = await tool.execute({ session_id: 'sess-9' } as never, execWith('E:/DemoStudio'))
    expect(value.transcript).toContain('[用户] 上次的任务')
    expect(value.transcript).toContain('[调用工具 grep]')
    expect(value.transcript).toContain('[助手] 完成了')
  })
})
