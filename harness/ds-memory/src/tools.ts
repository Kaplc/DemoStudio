/**
 * 4 个模型可见记忆工具：memory_write / memory_search / memory_forget / memory_review。
 * schema 由 defineTool 声明并自动流入装配；execute 返回规范 JSON 值，render 负责模型可见文本。
 *
 * @module tools
 */

import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { memoryAge, memoryAgeDays, memoryFreshnessText } from './memoryAge.js'
import {
  MAX_MEMORY_CONTENT_CHARS,
  MEMORY_ENTRYPOINT,
  MEMORY_TYPES,
  STALE_MEMORY_DAYS,
} from './memoryTypes.js'
import { forgetMemories, readAllMemories, removeFromIndex, writeMemory } from './memoryStore.js'
import type { MemoryRecord } from './memoryStore.js'

/** 工具运行所需宿主环境（由 index.ts 装配时闭包注入）。 */
export interface MemoryToolHost {
  /** 解析后的记忆目录（默认 <cwd>/.dsh/memory，可由配置 memoryDir 覆盖）。 */
  memoryDirectory: string
  /** Cordis 上下文：日志走 ctx.logger。 */
  ctx: Context
}

/** 单份记忆的限长正文与元数据（搜索/审查共用）。 */
function clipContent(content: string): string {
  return content.length > MAX_MEMORY_CONTENT_CHARS
    ? `${content.slice(0, MAX_MEMORY_CONTENT_CHARS)}\n[...内容过长已截断]`
    : content
}

function describeRecord(record: MemoryRecord, nowMs: number) {
  return {
    file: record.fileName,
    type: record.type,
    age: memoryAge(record.mtimeMs, nowMs),
    description: record.description,
    content: clipContent(record.content.trim()),
    freshness_warning: memoryFreshnessText(record.mtimeMs, nowMs),
  }
}

/** 子 agent（委托产生的）只读：变更类记忆操作一律拒绝——上下文归属父 agent，由父决定是否保存。 */
function assertNotChildAgent(agent: Agent | undefined): void {
  const depth = (agent?.session.header as { delegationDepth?: number } | undefined)?.delegationDepth
  if (typeof depth === 'number' && depth > 0) {
    throw new Error('子 agent 不能修改持久记忆（上下文归属父 agent）。如需保存，请在回复中说明，由父 agent 调用 memory_write。')
  }
}

// ---------------------------------------------------------------------------
// memory_write
// ---------------------------------------------------------------------------

/** 保存/更新一条记忆（FR-1）。 */
export function createMemoryWriteTool(host: MemoryToolHost) {
  return defineTool({
    name: 'memory_write',
    description: '保存/更新一条跨会话持久记忆（Markdown 文件 + MEMORY.md 索引）。发现值得跨会话记住的信息（用户纠正/确认、项目决策、踩坑根因教训、用户画像、外部系统指针）时当回合主动使用；同名或同描述的已有记忆会被更新而不是重复新建。name 用语义化小写下划线（如 user_role）。',
    parameters: {
      name: { type: 'string', required: true, description: '语义化小写下划线文件名（不含 .md），如 user_role' },
      content: { type: 'string', required: true, description: '记忆正文（Markdown）。feedback/project 类型需含 **Why:** 与 **How to apply:**；相对日期转绝对日期' },
      type: { type: 'string', enum: MEMORY_TYPES, required: true, description: 'user=用户画像 | feedback=纠正与确认 | project=项目决策动态 | reference=外部系统指针' },
      description: { type: 'string', required: true, description: '一行描述，用于检索相关性判断与去重' },
      scope: { type: 'string', enum: ['private', 'team'], description: '记忆作用域，默认 private；当前仅实现 private' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['created', 'updated'], required: true },
          file: { type: 'string', required: true },
          deduped_by: { type: 'string', enum: ['name', 'description'] },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'created'
          ? `已保存记忆 ${value.file} 并更新 MEMORY.md 索引。${value.note ?? ''}`
          : `已更新已有记忆 ${value.file}（按${value.deduped_by === 'name' ? '同名' : '同描述'}去重），索引已同步。${value.note ?? ''}`,
      }],
    },
    async execute(args, exec) {
      assertNotChildAgent(exec.agent)
      if (args.scope !== undefined && args.scope !== 'private') {
        throw new Error(`scope "${args.scope}" 尚未实现；当前仅支持 private`)
      }
      const result = await writeMemory(host.memoryDirectory, {
        name: args.name,
        content: args.content,
        type: args.type,
        description: args.description,
      })
      return {
        status: result.status,
        file: result.fileName,
        ...(result.dedupedBy === undefined ? {} : { deduped_by: result.dedupedBy }),
        ...(args.scope === undefined ? {} : { note: 'scope 字段已接受；当前实现仅 private（team 为预留）。' }),
      }
    },
  })
}

// ---------------------------------------------------------------------------
// memory_search
// ---------------------------------------------------------------------------

/** 按文件名列表检索记忆：直接读取文件内容返回，不走 LLM。 */
export function createMemorySearchTool(host: MemoryToolHost) {
  return defineTool({
    name: 'memory_search',
    description: '按文件名读取记忆文件内容。传入 MEMORY.md 索引中的文件名（如 ["ds-plugin-mounting", "user_role"]），返回对应记忆的正文与元数据。空数组时返回所有记忆的摘要列表（不含正文）。',
    parameters: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: '要读取的记忆名列表（不含 .md 后缀，如 ["ds-plugin-mounting"]）。空数组或省略时返回全部记忆摘要。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          memories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string' },
                type: { type: 'string' },
                age: { type: 'string' },
                description: { type: 'string' },
                content: { type: 'string' },
                freshness_warning: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? '记忆库中没有匹配的记忆。'
          : `返回 ${value.count} 条记忆：\n\n${value.memories.map(m => {
              const header = `### ${m.file} [${m.type ?? 'unknown'}] (${m.age})${m.freshness_warning === '' ? '' : ` ⚠ ${m.freshness_warning}`}`
              return m.content === ''
                ? header
                : `${header}\n${m.content}`
            }).join('\n\n')}`,
      }],
    },
    async execute(args) {
      const all = await readAllMemories(host.memoryDirectory)
      const now = Date.now()
      const names = args.names ?? []
      if (names.length === 0) {
        // 空数组：返回全部摘要（不含正文，省 token）
        return {
          count: all.length,
          memories: all.map(record => ({
            file: record.fileName,
            type: record.type,
            age: memoryAge(record.mtimeMs, now),
            description: record.description,
            content: '',
            freshness_warning: memoryFreshnessText(record.mtimeMs, now),
          })),
        }
      }
      // 有指定名称：精确匹配返回正文
      const wanted = new Set(names.map(n => n.endsWith('.md') ? n : `${n}.md`))
      const matches = all
        .filter(record => wanted.has(record.fileName))
        .map(record => describeRecord(record, now))
      return { count: matches.length, memories: matches }
    },
  })
}

// ---------------------------------------------------------------------------
// memory_forget
// ---------------------------------------------------------------------------

/** 遗忘记忆（FR-1）：按 name 或描述关键词删除文件并同步索引。 */
export function createMemoryForgetTool(host: MemoryToolHost) {
  return defineTool({
    name: 'memory_forget',
    description: '遗忘持久记忆：按 name（精确）或描述关键词删除记忆文件并同步从 MEMORY.md 索引移除。两个参数至少给一个。',
    parameters: {
      name: { type: 'string', description: '要删除的记忆名（如 user_role）；精确匹配' },
      description_keyword: { type: 'string', description: '描述或文件名包含的关键词（大小写不敏感）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'array', required: true, items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.deleted.length === 0
          ? `没有匹配的记忆被删除。${value.note ?? ''}`
          : `已遗忘并从索引移除：${value.deleted.join('、')}。`,
      }],
    },
    async execute(args, exec) {
      assertNotChildAgent(exec.agent)
      if (args.name === undefined && args.description_keyword === undefined) {
        throw new Error('memory_forget 需要 name 或 description_keyword 至少一个')
      }
      const deleted = await forgetMemories(host.memoryDirectory, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description_keyword === undefined ? {} : { descriptionContains: args.description_keyword }),
      })
      return {
        deleted,
        ...(deleted.length === 0 ? { note: '未找到匹配项；可先用 memory_search 确认记忆名。' } : {}),
      }
    },
  })
}

// ---------------------------------------------------------------------------
// memory_review
// ---------------------------------------------------------------------------

/** 审查提案。 */
export interface ReviewProposal {
  file: string
  kind: 'stale' | 'duplicate' | 'conflict'
  reason: string
  suggestion: string
}

/** 从正文/描述中提取已过期的绝对日期（YYYY-MM-DD / YYYY/MM/DD），用于冲突探测。 */
function findPastDates(text: string, nowMs: number): string[] {
  const past: string[] = []
  for (const match of text.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)) {
    const time = Date.parse(`${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}T23:59:59`)
    if (!Number.isNaN(time) && time < nowMs) past.push(match[0])
  }
  return past
}

/**
 * 审查整理记忆（FR-1）：输出过时/重复/冲突提案；apply=true 时
 * 仅自动执行"完全重复"的删除（保留最新），其余提案需要人工/模型补充内容后处理。
 */
export function createMemoryReviewTool(host: MemoryToolHost) {
  return defineTool({
    name: 'memory_review',
    description: '审查整理记忆库：报告过时（建议更新/删除）、重复（建议合并）、与当前事实冲突（建议修正）的提案。默认只报告不修改；apply=true 时自动执行无争议的部分（完全重复去重）。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时自动执行无争议提案（完全重复去重）；默认 false 只报告' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          proposals: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string' },
                kind: { type: 'string', enum: ['stale', 'duplicate', 'conflict'] },
                reason: { type: 'string' },
                suggestion: { type: 'string' },
              },
            },
          },
          applied: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.total === 0
          ? '记忆库为空，无需审查。'
          : `共 ${value.total} 条记忆，${value.proposals.length} 条提案：\n${value.proposals.map(proposal => `- [${proposal.kind}] ${proposal.file}：${proposal.reason} → ${proposal.suggestion}`).join('\n')}${value.applied.length === 0 ? '' : `\n\n已自动执行（apply=true）：${value.applied.join('、')}`}`,
      }],
    },
    async execute(args, exec) {
      const all = await readAllMemories(host.memoryDirectory)
      const now = Date.now()
      const proposals: ReviewProposal[] = []

      // 过时：超过 STALE_MEMORY_DAYS 未更新
      for (const record of all) {
        if (memoryAgeDays(record.mtimeMs, now) > STALE_MEMORY_DAYS) {
          proposals.push({
            file: record.fileName,
            kind: 'stale',
            reason: `已 ${Math.floor((now - record.mtimeMs) / 86_400_000)} 天未更新`,
            suggestion: '核对后用 memory_write 更新内容，或用 memory_forget 删除',
          })
        }
      }

      // 重复：description 完全一致（大小写/首尾空白归一）— 保留最新
      const byDescription = new Map<string, MemoryRecord[]>()
      for (const record of all) {
        const key = record.description?.trim().toLowerCase()
        if (key === undefined) continue
        const bucket = byDescription.get(key) ?? []
        bucket.push(record)
        byDescription.set(key, bucket)
      }
      const duplicates: MemoryRecord[] = []
      for (const bucket of byDescription.values()) {
        if (bucket.length < 2) continue
        const sorted = [...bucket].sort((a, b) => b.mtimeMs - a.mtimeMs)
        for (const record of sorted.slice(1)) {
          duplicates.push(record)
          proposals.push({
            file: record.fileName,
            kind: 'duplicate',
            reason: `与 ${sorted[0]!.fileName} 描述重复（保留更新的 ${sorted[0]!.fileName}）`,
            suggestion: '删除该重复文件',
          })
        }
      }

      // 冲突：正文/描述中出现已过期的绝对日期（project 类截止日期常见）
      for (const record of all) {
        if (duplicates.includes(record)) continue
        const pastDates = findPastDates(`${record.description ?? ''}\n${record.content}`, now)
        if (pastDates.length > 0) {
          proposals.push({
            file: record.fileName,
            kind: 'conflict',
            reason: `包含已过期的日期：${pastDates.join('、')}`,
            suggestion: '核对事实后用 memory_write 修正，或用 memory_forget 删除',
          })
        }
      }

      // apply=true 只自动执行无争议的部分：完全重复的删除（其余提案需人工/模型核对内容）
      const applied: string[] = []
      if (args.apply === true) {
        assertNotChildAgent(exec.agent)
        for (const record of duplicates) {
          await rm(record.filePath, { force: true })
          await removeFromIndex(host.memoryDirectory, record.fileName.replace(/\.md$/, ''))
          applied.push(record.fileName)
        }
      }
      exec.signal.throwIfAborted()
      return {
        total: all.length,
        proposals,
        applied,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// memory_list
// ---------------------------------------------------------------------------

/** 主动读取 MEMORY.md 索引文件原文。 */
export function createMemoryListTool(host: MemoryToolHost) {
  return defineTool({
    name: 'memory_list',
    description: '读取 MEMORY.md 记忆索引文件的完整内容。用于查看当前有哪些记忆条目、确认索引是否正确。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.exists
          ? `MEMORY.md 索引内容：\n${value.content}`
          : 'MEMORY.md 索引文件不存在（记忆目录为空）。',
      }],
    },
    async execute() {
      const entryPath = join(host.memoryDirectory, MEMORY_ENTRYPOINT)
      try {
        const content = await readFile(entryPath, 'utf8')
        return { content, exists: true }
      } catch {
        return { content: '', exists: false }
      }
    },
  })
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

/** 创建全部 5 个记忆工具。 */
export function createMemoryTools(host: MemoryToolHost) {
  return [
    createMemoryWriteTool(host),
    createMemorySearchTool(host),
    createMemoryForgetTool(host),
    createMemoryReviewTool(host),
    createMemoryListTool(host),
  ]
}
