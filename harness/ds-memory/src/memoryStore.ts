/**
 * 记忆存储：写入（去重）、删除、MEMORY.md 索引同步、全量读取。
 * 纯文件系统（Markdown + frontmatter），无数据库。
 * 所有写入路径先过 security 层（安全红线）。
 *
 * @module memoryStore
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MAX_INDEX_LINE_LENGTH,
  MEMORY_ENTRYPOINT,
  normalizeMemoryName,
  parseFrontmatter,
  renderMemoryFile,
} from './memoryTypes.js'
import type { MemoryType } from './memoryTypes.js'
import { assertSafeWritePath, sanitizePathKey } from './security.js'

/** 一份记忆的完整内容（review/去重需要全文与元数据）。 */
export interface MemoryRecord {
  /** 文件名（如 user_role.md）。 */
  fileName: string
  filePath: string
  mtimeMs: number
  name?: string
  description?: string
  type: MemoryType | undefined
  /** frontmatter 之后的正文。 */
  content: string
}

/** 写入结果。 */
export interface WriteResult {
  status: 'created' | 'updated'
  /** 实际落盘的文件名。 */
  fileName: string
  /** 触发去重的原因；新建为 undefined。 */
  dedupedBy?: 'name' | 'description'
}

/** memory_write 的输入。 */
export interface WriteInput {
  /** 语义化小写下划线名（如 user_role）。 */
  name: string
  content: string
  type: MemoryType
  /** 一行描述，检索相关性判断依据；同时作为去重键之一。 */
  description: string
}

/** 读入记忆目录下全部记忆（全量读取正文；跳过 MEMORY.md 与读取失败的文件）。 */
export async function readAllMemories(memoryDirectory: string): Promise<MemoryRecord[]> {
  const records: MemoryRecord[] = []
  const files = await readdirFlat(memoryDirectory)
  for (const fileName of files) {
    if (fileName === MEMORY_ENTRYPOINT || !fileName.endsWith('.md')) continue
    const filePath = join(memoryDirectory, fileName)
    try {
      const text = await readFile(filePath, 'utf8')
      const { data, body } = parseFrontmatter(text)
      records.push({
        fileName,
        filePath,
        mtimeMs: (await stat(filePath)).mtimeMs,
        name: data.name,
        description: data.description,
        type: data.type,
        content: body,
      })
    } catch {
      // 单个坏文件不拖垮全量读取
    }
  }
  return records
}

/** 列出记忆目录顶层的 .md 文件名（目录不存在返回 []）。 */
async function readdirFlat(memoryDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(memoryDirectory, { withFileTypes: true })
    return entries.filter(entry => entry.isFile()).map(entry => entry.name)
  } catch {
    return []
  }
}

/** MEMORY.md 单行索引：`- [name](name.md) — hook`，超长截断到上限。 */
export function renderIndexLine(name: string, hook: string): string {
  const prefix = `- [${name}](${name}.md) — `
  const budget = MAX_INDEX_LINE_LENGTH - prefix.length
  const text = hook.length > budget ? `${hook.slice(0, Math.max(1, budget - 1))}…` : hook
  return `${prefix}${text}`
}

/**
 * 用全量重写的方式同步索引行：替换同名条目或追加到末尾。
 * MEMORY.md 不存在时创建（含标题头）；解析不出的历史行原样保留（不丢数据）。
 */
export async function upsertIndexLine(memoryDirectory: string, name: string, hook: string): Promise<void> {
  await mkdir(memoryDirectory, { recursive: true })
  const entryPath = memoryEntrypointPathFor(memoryDirectory)
  const line = renderIndexLine(name, hook)
  let existing = ''
  try {
    existing = await readFile(entryPath, 'utf8')
  } catch {
    existing = '# 记忆索引\n\n<!-- 由 @demostudio/ds-memory 维护；索引不是记忆，正文在各自文件中 -->\n'
  }
  const lines = existing.split('\n')
  const pattern = new RegExp(`^\\- \\[${escapeRegExp(name)}\\]\\(${escapeRegExp(name)}\\.md\\) —`)
  const index = lines.findIndex(candidate => pattern.test(candidate))
  if (index >= 0) lines[index] = line
  else {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    lines.push(line, '')
  }
  await writeFile(entryPath, `${lines.join('\n').replace(/\n*$/, '\n')}`, 'utf8')
}

/** 从 MEMORY.md 移除对应行（文件不存在时为 no-op）。 */
export async function removeFromIndex(memoryDirectory: string, name: string): Promise<void> {
  const entryPath = memoryEntrypointPathFor(memoryDirectory)
  let existing: string
  try {
    existing = await readFile(entryPath, 'utf8')
  } catch {
    return
  }
  const pattern = new RegExp(`^\\- \\[${escapeRegExp(name)}\\]\\(${escapeRegExp(name)}\\.md\\) —`)
  const lines = existing.split('\n').filter(candidate => !pattern.test(candidate))
  await writeFile(entryPath, `${lines.join('\n').replace(/\n*$/, '\n')}`, 'utf8')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 测试注入点：与生产实现一致的入口路径推导。 */
function memoryEntrypointPathFor(memoryDirectory: string): string {
  return join(memoryDirectory, MEMORY_ENTRYPOINT)
}

/**
 * 写入/更新一份记忆（FR-1 去重规则）：
 * 先按 name、再按 description 在已有记忆中找重复；命中则改写那份文件（保留其文件名），
 * 否则新建。写完同步 MEMORY.md 索引行。
 */
export async function writeMemory(memoryDirectory: string, input: WriteInput): Promise<WriteResult> {
  const fileName = normalizeMemoryName(input.name)
  const existing = await readAllMemories(memoryDirectory)
  const byName = existing.find(record => record.fileName === fileName)
  const byDescription = byName === undefined
    ? existing.find(record => record.description !== undefined && record.description === input.description)
    : undefined
  const duplicate = byName ?? byDescription
  const target = duplicate?.fileName ?? fileName

  const content = renderMemoryFile(
    target.replace(/\.md$/, ''),
    input.description,
    input.type,
    input.content,
  )
  const targetPath = join(memoryDirectory, sanitizePathKey(target))
  await assertSafeWritePath(memoryDirectory, target)
  await mkdir(memoryDirectory, { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  await upsertIndexLine(memoryDirectory, target.replace(/\.md$/, ''), input.description)
  return duplicate === undefined
    ? { status: 'created', fileName: target }
    : { status: 'updated', fileName: target, dedupedBy: byName !== undefined ? 'name' : 'description' }
}

/** 遗忘匹配项：删文件 + 删索引行；返回实际删除的文件名列表。 */
export async function forgetMemories(
  memoryDirectory: string,
  matcher: { name?: string; descriptionContains?: string },
): Promise<string[]> {
  const all = await readAllMemories(memoryDirectory)
  const wantedName = matcher.name === undefined
    ? undefined
    : normalizeMemoryName(matcher.name)
  const keyword = matcher.descriptionContains?.toLowerCase()
  const matches = all.filter((record) => {
    if (wantedName !== undefined) return record.fileName === wantedName
    if (keyword !== undefined) {
      return (record.description?.toLowerCase().includes(keyword) ?? false)
        || record.fileName.toLowerCase().includes(keyword)
    }
    return false
  })
  for (const record of matches) {
    await rm(record.filePath, { force: true })
    await removeFromIndex(memoryDirectory, record.fileName.replace(/\.md$/, ''))
  }
  return matches.map(record => record.fileName)
}
