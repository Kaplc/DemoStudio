/**
 * 经验存储：episode 写入（同名覆盖）、INDEX.md 索引同步、全量读取。
 * 纯文件系统（Markdown + frontmatter），无数据库。
 *
 * @module experienceStore
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EXPERIENCE_INDEX_FILE,
  MAX_INDEX_LINE_LENGTH,
  normalizeEpisodeName,
  parseEpisodeFrontmatter,
  parseEpisodeOutcome,
  renderEpisodeFile,
  todayIso,
} from './experienceTypes.js'
import type { EpisodeInput, EpisodeOutcome } from './experienceTypes.js'

/** 一份 episode 的完整内容（检索选择后回读用）。 */
export interface EpisodeRecord {
  /** 文件名（如 fix_junction_mount.md）。 */
  fileName: string
  filePath: string
  name?: string
  taskType?: string
  outcome: EpisodeOutcome | undefined
  date?: string
  /** frontmatter 之后的正文（含 Summary/Lessons 小节）。 */
  body: string
}

/** 保存结果。 */
export interface SaveResult {
  status: 'created' | 'updated'
  fileName: string
}

/** episode 文件名（含 .md）在经验目录下的绝对路径。 */
export function episodeFilePath(experienceDirectory: string, fileName: string): string {
  return join(experienceDirectory, fileName)
}

/**
 * 写入/更新一条 episode：同名（规范化后）即覆盖原文件（不产生副本），否则新建。
 * 写完同步 INDEX.md 索引行（更新不产生重复行）。
 */
export async function saveExperience(experienceDirectory: string, input: EpisodeInput): Promise<SaveResult> {
  if (input.taskType.trim() === '') throw new Error('task_type must be a non-empty string')
  if (input.summary.trim() === '') throw new Error('summary must be a non-empty string')
  if (input.lessons.trim() === '') throw new Error('lessons must be a non-empty string')
  const fileName = normalizeEpisodeName(input.name)
  const existing = await fileExists(episodeFilePath(experienceDirectory, fileName))
  const content = renderEpisodeFile({ ...input, name: fileName.replace(/\.md$/, '') }, todayIso())
  await mkdir(experienceDirectory, { recursive: true })
  await writeFile(episodeFilePath(experienceDirectory, fileName), content, 'utf8')
  await upsertIndexLine(experienceDirectory, fileName.replace(/\.md$/, ''), input)
  return { status: existing ? 'updated' : 'created', fileName }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** INDEX.md 单行索引：`- [name](name.md) — task_type · outcome · summary`，超长截断。 */
export function renderIndexLine(name: string, taskType: string, outcome: string, summary: string): string {
  const hook = `${taskType} · ${outcome} · ${summary.replace(/\n/g, ' ').trim()}`
  const prefix = `- [${name}](${name}.md) — `
  const budget = MAX_INDEX_LINE_LENGTH - prefix.length
  const text = hook.length > budget ? `${hook.slice(0, Math.max(1, budget - 1))}…` : hook
  return `${prefix}${text}`
}

/**
 * 用全量重写的方式同步 INDEX.md 索引行：替换同名条目或追加到末尾。
 * INDEX.md 不存在时创建（含标题头）。
 */
export async function upsertIndexLine(
  experienceDirectory: string,
  name: string,
  input: Pick<EpisodeInput, 'taskType' | 'outcome' | 'summary'>,
): Promise<void> {
  await mkdir(experienceDirectory, { recursive: true })
  const entryPath = join(experienceDirectory, EXPERIENCE_INDEX_FILE)
  const line = renderIndexLine(name, input.taskType, input.outcome, input.summary)
  let existing = ''
  try {
    existing = await readFile(entryPath, 'utf8')
  } catch {
    existing = '# 经验索引\n\n<!-- 由 @demostudio/ds-experience 维护；索引不是经验，正文在各自文件中 -->\n'
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 读入经验目录下全部 episode（跳过 INDEX.md 与读取失败的文件；按文件名排序）。 */
export async function readAllEpisodes(experienceDirectory: string): Promise<EpisodeRecord[]> {
  const records: EpisodeRecord[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(experienceDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === EXPERIENCE_INDEX_FILE) continue
    const filePath = join(experienceDirectory, entry.name)
    try {
      const text = await readFile(filePath, 'utf8')
      const { data, body } = parseEpisodeFrontmatter(text)
      records.push({
        fileName: entry.name,
        filePath,
        name: data.name,
        taskType: data.task_type,
        outcome: parseEpisodeOutcome(data.outcome),
        date: data.date,
        body,
      })
    } catch {
      // 单个坏文件不拖垮全量读取
    }
  }
  return records.sort((a, b) => a.fileName.localeCompare(b.fileName))
}

/** 选择器清单行：`name | task_type | outcome | date | summary首行`（clip 后）。 */
export function renderEpisodeManifestLine(record: EpisodeRecord): string {
  const summary = firstLine(record.body) || record.name || record.fileName
  return `${record.fileName} | ${record.taskType ?? 'unknown'} | ${record.outcome ?? 'unknown'} | ${record.date ?? '?'} | ${summary}`
}

/** 选择器清单（逐行）。 */
export function formatEpisodeManifest(records: readonly EpisodeRecord[]): string {
  return records.map(renderEpisodeManifestLine).join('\n')
}

function firstLine(text: string): string {
  const match = text.match(/##\s*Summary\s*\n+([^\n]+)/)
  return (match?.[1] ?? '').trim()
}
