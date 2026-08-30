/**
 * 记忆目录扫描：frontmatter 清单、清单格式化、MEMORY.md 读取与截断。
 * 扫描单趟完成（open → fstat → 读头部 → close，read-then-sort），不先 stat 全目录再读。
 *
 * @module memoryScan
 */

import { open, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  FRONTMATTER_MAX_BYTES,
  FRONTMATTER_MAX_LINES,
  MAX_ENTRYPOINT_BYTES,
  MAX_ENTRYPOINT_LINES,
  MAX_MEMORY_FILES,
  MEMORY_ENTRYPOINT,
  parseFrontmatter,
} from './memoryTypes.js'
import type { MemoryType } from './memoryTypes.js'

/** 一份记忆的头部信息（清单与选择器的最小单元）。 */
export interface MemoryHeader {
  /** 记忆目录内的相对路径（含 .md）。 */
  filename: string
  /** 绝对路径。 */
  filePath: string
  /** mtime（毫秒），新鲜度与排序依据。 */
  mtimeMs: number
  /** 一行描述（检索相关性判断依据）；缺失为 undefined。 */
  description?: string
  /** 记忆类型；frontmatter 缺失或非法时为 undefined。 */
  type: MemoryType | undefined
}

/** 只读文件前若干行（及字节上限），单趟带出 mtime。 */
async function readHead(filePath: string, maxLines: number, maxBytes: number): Promise<{ text: string; mtimeMs: number }> {
  const handle = await open(filePath, 'r')
  try {
    const stats = await handle.stat()
    const length = Math.min(stats.size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    let text = buffer.toString('utf8')
    if (stats.size > maxBytes) {
      // 截断可能落在多字节字符中间，丢弃末尾不完整字符
      text = text.replace(/[\uD800-\uDBFF]?[\uDC00-\uDFFF]?$/, '')
    }
    const lines = text.split('\n')
    if (lines.length > maxLines) text = lines.slice(0, maxLines).join('\n')
    return { text, mtimeMs: stats.mtimeMs }
  } finally {
    await handle.close()
  }
}

/**
 * 扫描记忆目录下所有 .md 文件（排除 MEMORY.md），读取 frontmatter 生成头部清单。
 * 按 mtime 新→旧排序，上限 {@link MAX_MEMORY_FILES}。
 * 单个文件读取/解析失败静默跳过（坏文件不应拖垮检索）；目录不存在返回 []。
 */
export async function scanMemoryFiles(memoryDir: string, signal?: AbortSignal): Promise<MemoryHeader[]> {
  let entries: string[]
  try {
    entries = await readdir(memoryDir, { recursive: true })
  } catch {
    return []
  }
  const mdFiles = entries.filter((entry) => {
    const base = basename(entry)
    return base.endsWith('.md') && base !== MEMORY_ENTRYPOINT
  })
  signal?.throwIfAborted()
  const results = await Promise.allSettled(mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
    const filePath = join(memoryDir, relativePath)
    const { text, mtimeMs } = await readHead(filePath, FRONTMATTER_MAX_LINES, FRONTMATTER_MAX_BYTES)
    const { data } = parseFrontmatter(text)
    return {
      filename: relativePath.split('\\').join('/'),
      filePath,
      mtimeMs,
      description: data.description,
      type: data.type,
    }
  }))
  const headers = results
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return headers.slice(0, MAX_MEMORY_FILES)
}

/**
 * 把头部清单格式化为选择器提示中的一行一条：
 * `- [type] filename (ISO时间): description`
 */
export function formatMemoryManifest(memories: readonly MemoryHeader[]): string {
  return memories
    .map((memory) => {
      const tag = memory.type === undefined ? '' : `[${memory.type}] `
      const timestamp = new Date(memory.mtimeMs).toISOString()
      return memory.description === undefined
        ? `- ${tag}${memory.filename} (${timestamp})`
        : `- ${tag}${memory.filename} (${timestamp}): ${memory.description}`
    })
    .join('\n')
}

/**
 * MEMORY.md 注入前的硬截断：300 行 / 40KB（UTF-8）双触发。
 * 截断发生时在末尾追加警告行，避免模型把残缺索引当全量。
 */
export function truncateEntrypoint(text: string): { text: string; truncated: boolean } {
  const lines = text.split('\n')
  let truncated = false
  let kept = text
  if (lines.length > MAX_ENTRYPOINT_LINES) {
    kept = lines.slice(0, MAX_ENTRYPOINT_LINES).join('\n')
    truncated = true
  }
  const byteLength = Buffer.byteLength(kept, 'utf8')
  if (byteLength > MAX_ENTRYPOINT_BYTES) {
    kept = kept.slice(0, MAX_ENTRYPOINT_BYTES)
    // 字节截断可能切碎末尾字符，回退到行边界，保证不出现半个字符
    const lastBreak = kept.lastIndexOf('\n')
    if (lastBreak > 0) kept = kept.slice(0, lastBreak)
    truncated = true
  }
  if (truncated) {
    kept += `\n\n[警告] MEMORY.md 索引超过 ${MAX_ENTRYPOINT_LINES} 行 / ${MAX_ENTRYPOINT_BYTES} 字节上限，已截断；用 memory_search 检索完整记忆，并考虑用 memory_review 清理索引。`
  }
  return { text: kept, truncated }
}
