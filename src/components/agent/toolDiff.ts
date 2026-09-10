/**
 * 工具卡片 diff 视图的纯函数层
 *
 * 数据来源两路（对齐 DSH WebUI diff-card-model 的语义）：
 * 1. 权威路：write/edit 工具 settle 后 result meta 携带的 `diffs`
 *    （computeHunkDiffs 产物，含 3 行上下文的真实前后文本）；
 * 2. 意图路：调用进行中（无 result）从工具入参派生的"将要做的修改"。
 *
 * 渲染行模型：把 hunk 的 oldText/newText 按公共前后缀对齐成
 * ctx（上下文）/ del（删除）/ add（新增）三种行，附带行号（best-effort 绝对行号，
 * 由 resolveDiffStartLines 定位；定位失败回退 1 起始）。
 */
import type { FileDiff } from '../../types/agent'

/** diff 行 kind：path=文件路径行 gap=多 hunk 分隔行 ctx/del/add=内容行 */
export type DiffRowKind = 'path' | 'gap' | 'ctx' | 'del' | 'add'

/** diff 视图的一行（line 为 best-effort 行号，缺省时不显示数字） */
export interface DiffRow {
  kind: DiffRowKind
  text: string
  line?: number
}

/** 支持 diff 视图的文件编辑工具名（tool/call 事件里的 name） */
const DIFF_TOOL_NAMES = new Set(['edit', 'write', 'str_replace_editor'])

/** 是否为可渲染 diff 视图的工具 */
export function isDiffToolName(name: string): boolean {
  return DIFF_TOOL_NAMES.has(name)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * 调用进行中（无权威 diffs）从工具入参派生"将要做的修改"。
 * 非 diff 工具或参数形状不符返回 null（走通用 JSON 视图）。
 */
export function deriveDiffsFromArgs(name: string, args: unknown): FileDiff[] | null {
  if (!isDiffToolName(name) || !args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  const path = asString(a.file_path) ?? asString(a.path)
  if (!path) return null
  if (name === 'edit') {
    const oldText = asString(a.old_string)
    const newText = asString(a.new_string)
    if (oldText === null && newText === null) return null
    return [{ path, oldText, newText: newText ?? '' }]
  }
  if (name === 'write') {
    const content = asString(a.content)
    if (content === null) return null
    return [{ path, oldText: null, newText: content }]
  }
  // str_replace_editor 兼容（command: str_replace | create）
  const command = asString(a.command)
  if (command === 'str_replace') {
    return [{ path, oldText: asString(a.old_str), newText: asString(a.new_str) ?? '' }]
  }
  if (command === 'create') {
    const fileText = asString(a.file_text)
    if (fileText === null) return null
    return [{ path, oldText: null, newText: fileText }]
  }
  return null
}

/** hunk 文本 → 行数组（对齐 DSH DiffBlock：结尾单个换行不产生空尾行） */
export function splitDiffLines(text: string | null): string[] {
  if (text === null || text === '') return []
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
}

/**
 * 把一个 hunk 对齐成渲染行：公共前缀/后缀为 ctx，中段 old 侧为 del、new 侧为 add。
 * 行号规则（对齐 GitHub unified 单列 gutter）：ctx/del 行显示旧文件行号，add 行显示新文件行号；
 * startLine 为 hunk 首行在文件中的行号（定位失败传 1）。
 */
export function alignDiffRows(diff: FileDiff, startLine = 1): DiffRow[] {
  const oldLines = splitDiffLines(diff.oldText)
  const newLines = splitDiffLines(diff.newText)

  // 公共前缀
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
  // 公共后缀（不与前缀重叠）
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++

  const rows: DiffRow[] = []
  let oldNo = startLine
  let newNo = startLine
  const pushCtx = (text: string) => { rows.push({ kind: 'ctx', text, line: oldNo }); oldNo++; newNo++ }
  for (let i = 0; i < prefix; i++) pushCtx(oldLines[i])
  for (let i = prefix; i < oldLines.length - suffix; i++) { rows.push({ kind: 'del', text: oldLines[i], line: oldNo }); oldNo++ }
  for (let i = prefix; i < newLines.length - suffix; i++) { rows.push({ kind: 'add', text: newLines[i], line: newNo }); newNo++ }
  for (let i = oldLines.length - suffix; i < oldLines.length; i++) pushCtx(oldLines[i])
  return rows
}

/**
 * 组装整个 diff 视图的行序列：首个 hunk 前放 path 行，同文件连续 hunk 之间放 gap 行。
 * startLines 为各 hunk 的起始行号（resolveDiffStartLines 产物；缺省按 1 起始）。
 */
export function buildDiffRows(diffs: FileDiff[], startLines?: ReadonlyMap<number, number>): DiffRow[] {
  const rows: DiffRow[] = []
  let prevPath: string | undefined
  diffs.forEach((diff, index) => {
    if (diff.path !== prevPath) rows.push({ kind: 'path', text: diff.path })
    else rows.push({ kind: 'gap', text: '⋯' })
    prevPath = diff.path
    rows.push(...alignDiffRows(diff, startLines?.get(index) ?? 1))
  })
  return rows
}

/** 复制用纯文本（对齐 DSH DiffBlock：del 前缀 "- "，add 前缀 "+ "） */
export function formatDiffRowsForCopy(rows: readonly DiffRow[]): string {
  return rows.map((row) => {
    switch (row.kind) {
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      default: return row.text
    }
  }).join('\n')
}

/** 文件读取器签名（渲染进程走 electronAPI.readTextFile；测试注入桩） */
export type DiffFileReader = (path: string) => Promise<string | null>

/**
 * best-effort 定位各 hunk 的绝对起始行号：读当前文件内容，顺序查找每个 hunk 的
 * 锚点文本（newText 优先，纯删除时退回 oldText）。同路径多 hunk 用游标按顺序推进，
 * 避免重复内容全部命中同一处。任一环失败（文件读不到 / CRLF 外的漂移 / 内容已被后续编辑覆盖）
 * 该 hunk 无行号，渲染回退 1 起始。
 */
export async function resolveDiffStartLines(diffs: readonly FileDiff[], reader: DiffFileReader): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  if (diffs.length === 0) return result
  // 路径 → 内容缓存（同文件多 hunk 只读一次）
  const contentCache = new Map<string, string | null>()
  // 路径 → 下次查找起始偏移（顺序 hunk 游标）
  const cursorByPath = new Map<string, number>()
  for (let index = 0; index < diffs.length; index++) {
    const diff = diffs[index]
    if (!contentCache.has(diff.path)) {
      try {
        contentCache.set(diff.path, await reader(diff.path))
      } catch {
        contentCache.set(diff.path, null)
      }
    }
    const content = contentCache.get(diff.path)
    if (!content) continue
    // DSH diff 基线为 LF 规范化文本，读到的 Windows 文件是 CRLF —— 统一归一再定位
    const normalized = content.replace(/\r\n/g, '\n')
    const anchor = diff.newText || diff.oldText
    if (!anchor) continue
    const cursor = cursorByPath.get(diff.path) ?? 0
    const found = normalized.indexOf(anchor, cursor)
    if (found < 0) continue
    cursorByPath.set(diff.path, found + anchor.length)
    let line = 1
    for (let i = 0; i < found; i++) {
      if (normalized[i] === '\n') line++
    }
    result.set(index, line)
  }
  return result
}
