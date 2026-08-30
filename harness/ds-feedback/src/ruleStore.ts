/**
 * 规则存储：提案（pending）→ 应用（active）→ RULES.md 索引同步。
 * 纯文件系统（Markdown），无数据库。所有文件名先过 normalizeRuleName 校验（防路径逃逸）。
 *
 * @module ruleStore
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MAX_INDEX_BYTES,
  MAX_INDEX_LINES,
  MAX_INDEX_LINE_LENGTH,
  PROPOSED_SUFFIX,
  PENDING_SEGMENT,
  RULES_INDEX_FILE,
  normalizeRuleName,
  todayIso,
} from './ruleTypes.js'
import type { ActiveRule } from './ruleTypes.js'

/** pending 目录绝对路径。 */
export function pendingDir(rulesDirectory: string): string {
  return join(rulesDirectory, PENDING_SEGMENT)
}

/** 提案文件的输入。 */
export interface ProposeInput {
  /** 语义化小写下划线规则名。 */
  name: string
  /** 规则正文（Markdown）。 */
  content: string
  /** 为什么提出这条规则。 */
  reason: string
}

/** 提案文件内容（frontmatter：name/reason/date + 正文）。 */
export function renderProposalFile(input: ProposeInput, date: string): string {
  return `---\nname: ${input.name}\nreason: ${input.reason.replace(/\n/g, ' ')}\ndate: ${date}\n---\n${input.content.endsWith('\n') ? input.content : `${input.content}\n`}`
}

/**
 * 写入一条提案到 `pending/<name>.proposed.md`（同名旧提案被覆盖——重复提案幂等）。
 * @returns 提案文件相对规则目录的路径（展示用）。
 */
export async function proposeRule(rulesDirectory: string, input: ProposeInput): Promise<string> {
  const name = normalizeRuleName(input.name)
  if (input.content.trim() === '') throw new Error('rule content must be a non-empty string')
  if (input.reason.trim() === '') throw new Error('rule reason must be a non-empty string')
  const directory = pendingDir(rulesDirectory)
  await mkdir(directory, { recursive: true })
  const fileName = `${name}${PROPOSED_SUFFIX}`
  await writeFile(join(directory, fileName), renderProposalFile(input, todayIso()), 'utf8')
  return `${PENDING_SEGMENT}/${fileName}`
}

/** 解析提案文件 frontmatter（name/reason/date；宽松——字段缺失不阻塞 apply）。 */
function parseProposal(text: string): { reason?: string } {
  if (!text.startsWith('---')) return {}
  const lineBreak = text.indexOf('\n')
  const end = lineBreak < 0 ? -1 : text.indexOf('\n---', lineBreak)
  if (lineBreak < 0 || end < 0) return {}
  let reason: string | undefined
  for (const line of text.slice(lineBreak + 1, end).split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0 && line.slice(0, sep).trim() === 'reason') {
      const value = line.slice(sep + 1).trim()
      if (value.length > 0) reason = value
    }
  }
  return reason === undefined ? {} : { reason }
}

/** apply 的输入。 */
export interface ApplyInput {
  /** 提案名（rule_propose 时的 name）。 */
  proposal: string
  /** 同名 active 规则已存在时必填：overwrite=整体替换，append=追加带日期小节。 */
  mode?: 'overwrite' | 'append'
}

export interface ApplyResult {
  /** 落地的 active 规则文件名（`<name>.md`）。 */
  fileName: string
  /** 本次采取的写入方式。 */
  action: 'created' | 'overwritten' | 'appended'
}

/** 列出 pending 目录现有提案（裸名；目录不存在/为空返回 []）。 */
export async function listPendingProposals(rulesDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(pendingDir(rulesDirectory), { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith(PROPOSED_SUFFIX))
      .map(entry => entry.name.slice(0, -PROPOSED_SUFFIX.length))
      .sort()
  } catch {
    return []
  }
}

/**
 * 提案应用（提案-确认制的落地步）：pending → active `<ruleDir>/<name>.md`。
 * 同名规则已存在且未显式给 mode 时报错（二选一提示）；成功后删提案并同步 RULES.md 索引。
 */
export async function applyRule(rulesDirectory: string, input: ApplyInput): Promise<ApplyResult> {
  const name = normalizeRuleName(input.proposal)
  const pendingPath = join(pendingDir(rulesDirectory), `${name}${PROPOSED_SUFFIX}`)
  let proposalText: string
  try {
    proposalText = await readFile(pendingPath, 'utf8')
  } catch {
    const existing = await listPendingProposals(rulesDirectory)
    throw new Error(
      `提案 "${name}" 不存在。pending 目录现有提案：${existing.length === 0 ? '（空）' : existing.join('、')}`,
    )
  }
  const { reason } = parseProposal(proposalText)
  const bodyStart = proposalText.indexOf('\n---', 3)
  const content = bodyStart < 0 ? proposalText : proposalText.slice(bodyStart + 4).replace(/^\n+/, '')

  await mkdir(rulesDirectory, { recursive: true })
  const fileName = `${name}.md`
  const activePath = join(rulesDirectory, fileName)
  let existing: string | undefined
  try {
    existing = await readFile(activePath, 'utf8')
  } catch {
    existing = undefined
  }
  if (existing !== undefined && input.mode === undefined) {
    throw new Error(`active 规则 ${fileName} 已存在；请显式给 mode：'overwrite'（整体替换）或 'append'（追加带日期小节）`)
  }
  let finalContent: string
  let action: ApplyResult['action']
  if (existing === undefined) {
    finalContent = content
    action = 'created'
  } else if (input.mode === 'append') {
    const dated = `## ${todayIso()}（追加）\n\n${content}`
    finalContent = `${existing.replace(/\n*$/, '\n')}\n${dated}\n`
    action = 'appended'
  } else {
    finalContent = content
    action = 'overwritten'
  }
  await writeFile(activePath, finalContent, 'utf8')
  await rm(pendingPath, { force: true })
  const hook = reason ?? firstLine(content)
  await upsertIndexLine(rulesDirectory, name, hook)
  return { fileName, action }
}

/** 索引 hook：规则正文首个非空行（截断到索引行预算内）。 */
function firstLine(content: string): string {
  return content.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? ''
}

/** 读取全部 active 规则（顶层 `*.md`，跳过 RULES.md 与 pending 子目录；按文件名排序）。 */
export async function readActiveRules(rulesDirectory: string): Promise<ActiveRule[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(rulesDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  const rules: ActiveRule[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === RULES_INDEX_FILE) continue
    try {
      const text = await readFile(join(rulesDirectory, entry.name), 'utf8')
      rules.push({ name: entry.name.slice(0, -3), content: stripFrontmatter(text) })
    } catch {
      // 单个坏文件不拖垮全量读取
    }
  }
  return rules.sort((a, b) => a.name.localeCompare(b.name))
}

/** 剥掉 `---` 围栏 frontmatter（规则文件正文；无围栏原样返回）。 */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const lineBreak = text.indexOf('\n')
  const end = lineBreak < 0 ? -1 : text.indexOf('\n---', lineBreak)
  if (lineBreak < 0 || end < 0) return text
  const after = text.slice(end + 4)
  return after.startsWith('\n') ? after.slice(1) : after
}

/** RULES.md 单行索引：`- [name](name.md) — hook`，超长截断。 */
export function renderIndexLine(name: string, hook: string): string {
  const prefix = `- [${name}](${name}.md) — `
  const budget = MAX_INDEX_LINE_LENGTH - prefix.length
  const text = hook.length > budget ? `${hook.slice(0, Math.max(1, budget - 1))}…` : hook
  return `${prefix}${text}`
}

/**
 * 用全量重写的方式同步 RULES.md 索引行：替换同名条目或追加到末尾（更新不产生重复行）。
 * RULES.md 不存在时创建（含标题头）。
 */
export async function upsertIndexLine(rulesDirectory: string, name: string, hook: string): Promise<void> {
  await mkdir(rulesDirectory, { recursive: true })
  const entryPath = join(rulesDirectory, RULES_INDEX_FILE)
  const line = renderIndexLine(name, hook)
  let existing = ''
  try {
    existing = await readFile(entryPath, 'utf8')
  } catch {
    existing = `# 规则索引\n\n<!-- 由 @demostudio/ds-feedback 维护；索引不是规则，正文在各自文件中 -->\n`
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

/** 截断结果（同 memory 索引水位语义）。 */
export interface TruncatedIndex {
  text: string | undefined
  truncated: boolean
}

/**
 * 索引截断：>300 行或 >40KB 时截断并带截断提示；空内容返回 undefined。
 */
export function truncateIndex(indexText: string): TruncatedIndex {
  const trimmed = indexText.trim()
  if (trimmed.length === 0) return { text: undefined, truncated: false }
  let lines = trimmed.split('\n')
  let truncated = false
  if (lines.length > MAX_INDEX_LINES) {
    lines = lines.slice(0, MAX_INDEX_LINES)
    truncated = true
  }
  let text = lines.join('\n')
  if (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES) {
    while (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES && text.length > 0) {
      text = text.slice(0, Math.floor(text.length * 0.9))
    }
    truncated = true
  }
  if (truncated) text += '\n[...索引过长已截断]'
  return { text, truncated }
}

/** 同步渲染规则段的索引部分（磁盘扫描派生，保证与 active 规则一致；同步 IO 可接受）。 */
export function renderIndexSync(rules: readonly ActiveRule[]): TruncatedIndex {
  const lines = rules.map(rule => renderIndexLine(rule.name, firstLine(rule.content)))
  return truncateIndex(lines.join('\n'))
}
