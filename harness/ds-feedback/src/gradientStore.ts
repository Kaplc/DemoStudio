/**
 * 文本梯度存储：梯度候选（pending）→ 应用分发（tools 层）→ 应用台账（applied.jsonl）。
 *
 * 设计要点：
 * - **两段式**：gradient_propose 只写 pending 不生效（同 rule_propose 铁律）；
 *   gradient_apply 在用户确认后按 kind 分发落地，并记台账供回滚审计。
 * - kind 分发：rule=落 .dsh/rules/（复用 ruleStore）；reminder=向 .dsh/reminder/<target> 追加一行；
 *   instruction=只生成 diff 建议不落盘（指令目录是用户手工领地）。
 * - 台账是 JSONL 追加：`{ts, name, kind, target, action, deltaPreview}`——`.dsh/` 随 git 走，
 *   回滚 = git revert + 台账留痕。
 *
 * @module gradientStore
 */

import { mkdir, readFile, readdir, rm, appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { todayIso } from './ruleTypes.js'

/** 梯度目录段（相对项目根）。 */
export const GRADIENT_DIR_SEGMENT = '.dsh/gradient'

/** 待确认候选子目录名。 */
export const PENDING_SEGMENT = 'pending'

/** 候选文件后缀。 */
export const PROPOSED_SUFFIX = '.proposed.md'

/** 应用台账文件名（梯度目录内，JSONL）。 */
export const LEDGER_FILE = 'applied.jsonl'

/** 梯度候选类别。 */
export type GradientKind = 'rule' | 'reminder' | 'instruction'

/** 台账单行字符上限（deltaPreview 截断）。 */
export const MAX_LEDGER_PREVIEW_CHARS = 200

/** 候选输入。 */
export interface GradientProposeInput {
  /** 语义化小写下划线候选名。 */
  name: string
  /** 类别：rule（规则）/ reminder（提醒文案）/ instruction（指令建议，不自动落盘）。 */
  kind: GradientKind
  /** 目标文件：rule=规则裸名；reminder=文案文件名（如 memory-end-of-turn.md）；instruction=指令文件名。 */
  target: string
  /** 文本梯度本体：一句具体的修改（"遇 X 应 Y 不应 Z"或要追加的行）。 */
  delta: string
  /** 证据：loss 信号摘要或用户原话。 */
  evidence: string
}

/** 落盘的候选（解析后形态）。 */
export interface GradientProposal extends GradientProposeInput {
  /** 提案日期（YYYY-MM-DD）。 */
  date: string
  /** pending 文件相对梯度目录的路径。 */
  file: string
}

/** 校验并规范化候选名（同规则名约束：小写下划线，防路径逃逸）。 */
export function normalizeGradientName(input: string): string {
  const bare = input.endsWith(PROPOSED_SUFFIX)
    ? input.slice(0, -PROPOSED_SUFFIX.length)
    : input.endsWith('.md')
      ? input.slice(0, -3)
      : input
  if (!/^[a-z][a-z0-9_]*$/.test(bare)) {
    throw new Error(`invalid gradient name "${input}" (expected lowercase snake_case, got "${bare}")`)
  }
  return bare
}

export function pendingDir(lossDirectory: string): string {
  return join(lossDirectory, PENDING_SEGMENT)
}

/** 候选文件渲染（frontmatter 五键 + delta 正文）。 */
export function renderProposalFile(input: GradientProposeInput, date: string): string {
  const escaped = (text: string): string => text.replace(/\n/g, ' ')
  return [
    '---',
    `name: ${normalizeGradientName(input.name)}`,
    `kind: ${input.kind}`,
    `target: ${escaped(input.target)}`,
    `evidence: ${escaped(input.evidence)}`,
    `date: ${date}`,
    '---',
    `${input.delta.endsWith('\n') ? input.delta : `${input.delta}\n`}`,
  ].join('\n')
}

/** 解析候选文件全文；字段缺失抛错（apply 前置校验）。 */
export function parseProposalFile(text: string, file: string): GradientProposal {
  if (!text.startsWith('---')) throw new Error(`梯度候选 ${file} 缺少 frontmatter`)
  const lineBreak = text.indexOf('\n')
  const end = text.indexOf('\n---', lineBreak)
  if (lineBreak < 0 || end < 0) throw new Error(`梯度候选 ${file} frontmatter 未闭合`)
  const fields: Record<string, string> = {}
  for (const line of text.slice(lineBreak + 1, end).split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0) fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
  }
  const kind = fields['kind'] as GradientKind | undefined
  if (kind !== 'rule' && kind !== 'reminder' && kind !== 'instruction') {
    throw new Error(`梯度候选 ${file} 的 kind 非法：${fields['kind'] ?? '（缺失）'}（应为 rule|reminder|instruction）`)
  }
  const name = normalizeGradientName(fields['name'] ?? '')
  const target = fields['target'] ?? ''
  const delta = text.slice(end + 4).replace(/^\n+/, '').trim()
  if (target === '' || delta === '') throw new Error(`梯度候选 ${file} 缺少 target 或 delta 正文`)
  return {
    name,
    kind,
    target,
    delta,
    evidence: fields['evidence'] ?? '',
    date: fields['date'] ?? todayIso(),
    file,
  }
}

function proposalPath(gradientDirectory: string, name: string): string {
  return join(pendingDir(gradientDirectory), `${normalizeGradientName(name)}${PROPOSED_SUFFIX}`)
}

/** 写入一条候选到 pending（同名覆盖，幂等）；返回相对路径。 */
export async function proposeGradient(gradientDirectory: string, input: GradientProposeInput): Promise<string> {
  if (input.delta.trim() === '') throw new Error('gradient delta must be a non-empty string')
  if (input.evidence.trim() === '') throw new Error('gradient evidence must be a non-empty string（需引用 loss 信号或用户原话）')
  if (input.target.trim() === '') throw new Error('gradient target must be a non-empty string')
  const name = normalizeGradientName(input.name)
  const directory = pendingDir(gradientDirectory)
  await mkdir(directory, { recursive: true })
  await writeFile(proposalPath(gradientDirectory, name), renderProposalFile(input, todayIso()), 'utf8')
  return `${PENDING_SEGMENT}/${name}${PROPOSED_SUFFIX}`
}

/** 列出全部 pending 候选（解析失败的单个文件跳过并带回坏文件名）。 */
export async function listPendingGradients(gradientDirectory: string): Promise<{ proposals: GradientProposal[]; broken: string[] }> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(pendingDir(gradientDirectory), { withFileTypes: true })
  } catch {
    return { proposals: [], broken: [] }
  }
  const proposals: GradientProposal[] = []
  const broken: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(PROPOSED_SUFFIX)) continue
    try {
      const text = await readFile(join(pendingDir(gradientDirectory), entry.name), 'utf8')
      proposals.push(parseProposalFile(text, `${PENDING_SEGMENT}/${entry.name}`))
    } catch {
      broken.push(entry.name)
    }
  }
  proposals.sort((a, b) => a.name.localeCompare(b.name))
  return { proposals, broken }
}

/** 读单个候选（不存在抛错，错误信息列出可用候选）。 */
export async function readGradientProposal(gradientDirectory: string, name: string): Promise<GradientProposal> {
  const path = proposalPath(gradientDirectory, name)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    const { proposals } = await listPendingGradients(gradientDirectory)
    throw new Error(`梯度候选 "${normalizeGradientName(name)}" 不存在。pending 现有：${proposals.length === 0 ? '（空）' : proposals.map(p => p.name).join('、')}`)
  }
  return parseProposalFile(text, `${PENDING_SEGMENT}/${normalizeGradientName(name)}${PROPOSED_SUFFIX}`)
}

/** 删除 pending 候选（apply 成功后调用；幂等）。 */
export async function removeGradientProposal(gradientDirectory: string, name: string): Promise<void> {
  await rm(proposalPath(gradientDirectory, name), { force: true })
}

/** 台账行。 */
export interface GradientLedgerEntry {
  /** 应用时间（epoch 毫秒）。 */
  ts: number
  /** 候选名。 */
  name: string
  /** 类别。 */
  kind: GradientKind
  /** 目标文件。 */
  target: string
  /** 落地方式。 */
  action: 'created' | 'overwritten' | 'appended' | 'suggested'
  /** delta 预览（截断）。 */
  deltaPreview: string
}

/** 追加一条台账（JSONL；坏字段在 tools 层前置校验，这里只落盘）。 */
export async function appendLedgerEntry(gradientDirectory: string, entry: GradientLedgerEntry): Promise<void> {
  await mkdir(gradientDirectory, { recursive: true })
  const preview = entry.deltaPreview.length > MAX_LEDGER_PREVIEW_CHARS
    ? `${entry.deltaPreview.slice(0, MAX_LEDGER_PREVIEW_CHARS - 1)}…`
    : entry.deltaPreview
  await appendFile(join(gradientDirectory, LEDGER_FILE), `${JSON.stringify({ ...entry, deltaPreview: preview })}\n`, 'utf8')
}

/** 读台账最近 N 条（默认 20；文件不存在返回 []）。 */
export async function readLedger(gradientDirectory: string, limit = 20): Promise<GradientLedgerEntry[]> {
  let text: string
  try {
    text = await readFile(join(gradientDirectory, LEDGER_FILE), 'utf8')
  } catch {
    return []
  }
  const entries: GradientLedgerEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      entries.push(JSON.parse(trimmed) as GradientLedgerEntry)
    } catch {
      // 坏行跳过
    }
  }
  return entries.slice(-limit)
}
