/**
 * 使用强化计数存储（.usage.json）。
 *
 * 复盘强化的计数**不写经验文件本体**——mtime 是联想注入的新鲜度展示与排序依据，
 * 写回 frontmatter 会把它污染成"永远刚更新"；计数落目录内的独立 JSON：
 *   { "<fileName>": { "uses": 3, "lastUsedAt": 1696060800000, "notes": ["…"] } }
 *
 * - 键为 episode 文件名（含 .md），与 readAllEpisodes 的 fileName 一致，便于 prune 比对；
 * - `.usage.json` 不是 .md，不会进入任何经验扫描/索引/注入链路；
 * - 文件损坏（非法 JSON）按空表处理，下次强化写入时自愈；
 * - prune：强化时传入现存经验文件名集合，顺带清理已不存在的孤儿条目。
 *
 * 与 ds-memory/src/usageStore.ts 同构（改行为必须两侧同步）。
 *
 * @module usageStore
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 使用强化计数文件名（经验目录内的隐藏文件）。 */
export const USAGE_FILE_NAME = '.usage.json'

/** 每条最多保留的 note 留痕条数（新→旧，超出丢最旧的）。 */
export const MAX_USAGE_NOTES = 10

/** 单条 note 的字符上限（留痕不是正文，超长截断）。 */
export const MAX_USAGE_NOTE_CHARS = 200

/** 单条经验的使用强化记录。 */
export interface UsageEntry {
  /** 累计强化次数（复盘确认"真用到了"的次数，非注入次数）。 */
  uses: number
  /** 最近一次强化的时间戳（毫秒）。 */
  lastUsedAt: number
  /** 最近的留痕（新→旧，上限 {@link MAX_USAGE_NOTES} 条）。 */
  notes: string[]
}

/** usage 文件的内存形态：fileName（含 .md）→ 条目。 */
export type UsageFile = Record<string, UsageEntry>

/** 读取 usage 文件；不存在或损坏返回空表（自愈基线）。 */
export async function readUsageFile(directory: string): Promise<UsageFile> {
  try {
    const text = await readFile(join(directory, USAGE_FILE_NAME), 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as UsageFile
  } catch {
    return {}
  }
}

/**
 * 强化一条经验：uses+1、记 lastUsedAt、note 留痕（去空白、截断、上限丢弃）。
 * @param pruneTo - 现存经验文件名集合；给出时顺带清理集合外的孤儿条目（自愈）。
 * @returns 强化后的条目（新值）。
 */
export async function reinforceUsage(
  directory: string,
  fileName: string,
  note: string | undefined,
  pruneTo?: ReadonlySet<string>,
): Promise<UsageEntry> {
  const entries = await readUsageFile(directory)
  // 孤儿自愈：强化是低频写路径，顺带清理已删除经验的计数，防 .usage.json 无界膨胀
  const kept: UsageFile = {}
  for (const [key, entry] of Object.entries(entries)) {
    if (pruneTo === undefined || pruneTo.has(key)) kept[key] = entry
  }
  const previous = kept[fileName]
  const next: UsageEntry = {
    uses: (previous?.uses ?? 0) + 1,
    lastUsedAt: Date.now(),
    notes: previous?.notes ?? [],
  }
  const trimmedNote = note?.trim()
  if (trimmedNote !== undefined && trimmedNote !== '') {
    next.notes = [trimmedNote.slice(0, MAX_USAGE_NOTE_CHARS), ...next.notes].slice(0, MAX_USAGE_NOTES)
  }
  kept[fileName] = next
  await writeFile(join(directory, USAGE_FILE_NAME), `${JSON.stringify(kept, null, 2)}\n`, 'utf8')
  return next
}

/** 从 usage 文件移除若干条目（文件不存在时 no-op）。 */
export async function removeUsageEntries(directory: string, fileNames: readonly string[]): Promise<void> {
  if (fileNames.length === 0) return
  const entries = await readUsageFile(directory)
  let changed = false
  for (const fileName of fileNames) {
    if (fileName in entries) {
      delete entries[fileName]
      changed = true
    }
  }
  if (changed) {
    await writeFile(join(directory, USAGE_FILE_NAME), `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  }
}
