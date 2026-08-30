/**
 * 历史会话工具：history_search / history_read。
 * 自行包装内核常驻的 ctx.sessionQuery 服务（官方模型侧 tool-session-query 包不随 rc.2 发布，
 * 决策记录见 harness/dsh-source/.agents/notes/.../2026-08-02-session-search-not-shipped-default.md）。
 *
 * @module historyTools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 类型副作用：加载 sessionQuery 服务在 Context 上的模块增强
import '@deepseek-ai/dsh-session-query'
import { DEFAULT_TRANSCRIPT_CHARS } from './experienceTypes.js'
import { renderTurnTranscript } from './transcript.js'

/** 工具运行所需宿主环境（由 index.ts 装配时闭包注入）。 */
export interface HistoryToolHost {
  /** Cordis 上下文：检索/读取走 ctx.sessionQuery。 */
  ctx: Context
}

/** 单条命中（schema/render 共用形态）。 */
export interface HistoryHit {
  session_id: string
  date: string
  title?: string
  snippet: string
}

/** history_search：按当前会话 cwd 过滤的跨会话全文检索。 */
export function createHistorySearchTool(host: HistoryToolHost) {
  return defineTool({
    name: 'history_search',
    description: '全文检索本项目的历史会话（按当前工作区 cwd 过滤），返回每个会话的最强命中（会话 id/日期/标题/命中摘要）。接到可能与过往工作重复的改动类任务时先调用，"上次是怎么做的"从这里查起。',
    parameters: {
      query: { type: 'string', required: true, description: '检索关键词或短语' },
      limit: { type: 'integer', description: '最多返回的会话数，默认 5，上限 20' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                session_id: { type: 'string' },
                date: { type: 'string' },
                title: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? `历史会话中没有命中「${value.query}」。${value.note ?? ''}`
          : `历史会话命中 ${value.count} 场（按最强命中排序）：\n${value.hits.map(hit => `- ${hit.date} ${hit.title ?? '（无标题）'} [${hit.session_id}]\n  ${(hit.snippet ?? '').replace(/\n/g, ' ')}`).join('\n')}\n\n需要细节时用 history_read 传 session_id 读取转录。`,
      }],
    },
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(args.limit ?? 5, 20))
      // cwd 过滤：只搜当前工作区的会话（跨项目隔离）；header 无 cwd 时退化为全库检索
      const cwd = exec.agent?.session.header.cwd
      const page = await host.ctx.sessionQuery.searchSessions({
        query: args.query,
        ...(cwd === undefined ? {} : { sessionFilters: [{ kind: 'cwd' as const, values: [cwd] }] }),
        limit,
      }, { signal: exec.signal })
      const hits: HistoryHit[] = await Promise.all(page.items.map(async (hit) => {
        let title: string | undefined
        try {
          const snapshot = await host.ctx.sessionQuery.readTitle(hit.header.id, exec.signal)
          title = snapshot?.title
        } catch {
          title = undefined
        }
        return {
          session_id: hit.header.id,
          date: new Date(hit.header.createdAt).toISOString().slice(0, 10),
          ...(title === undefined ? {} : { title }),
          snippet: hit.bestMatch.snippet,
        }
      }))
      host.ctx.logger?.info(`ds-experience: history_search "${args.query}" → ${hits.length} 场命中${cwd === undefined ? '（无 cwd，未过滤）' : `（cwd ${cwd}）`}`)
      return {
        query: args.query,
        count: hits.length,
        hits,
        ...(cwd === undefined ? { note: '当前会话无 cwd 元数据，本次未做工作区过滤。' } : {}),
      }
    },
  })
}

/** history_read：读取一场历史会话的任务转录。 */
export function createHistoryReadTool(host: HistoryToolHost) {
  return defineTool({
    name: 'history_read',
    description: '读取一场历史会话的完整任务转录（真实用户消息 + 助手文本 + 工具调用，插件注入与工具结果不包含），用于复述"上次怎么做的"。session_id 来自 history_search。',
    parameters: {
      session_id: { type: 'string', required: true, description: '历史会话 id（history_search 返回的 session_id）' },
      max_chars: { type: 'integer', description: `转录最大字符数，默认 ${DEFAULT_TRANSCRIPT_CHARS}` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session_id: { type: 'string', required: true },
          date: { type: 'string', required: true },
          transcript: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `会话 ${value.session_id}（${value.date}）的任务转录：\n${value.transcript}`,
      }],
    },
    async execute(args, _exec) {
      // readSession 对不存在的 id 抛 SESSION_QUERY_SESSION_NOT_FOUND — 原样透出为工具错误
      const snapshot = await host.ctx.sessionQuery.readSession(args.session_id as SessionId)
      const { transcript } = renderTurnTranscript(snapshot.events, {
        maxChars: Math.max(500, Math.min(args.max_chars ?? DEFAULT_TRANSCRIPT_CHARS, 200_000)),
      })
      host.ctx.logger?.info(`ds-experience: history_read ${args.session_id} → ${transcript.length} 字转录`)
      return {
        session_id: args.session_id,
        date: new Date(snapshot.session.createdAt).toISOString().slice(0, 10),
        transcript: transcript === '' ? '（该会话没有可渲染的任务内容。）' : transcript,
      }
    },
  })
}

/** 创建 2 个历史会话工具。 */
export function createHistoryTools(host: HistoryToolHost) {
  return [
    createHistorySearchTool(host),
    createHistoryReadTool(host),
  ]
}
