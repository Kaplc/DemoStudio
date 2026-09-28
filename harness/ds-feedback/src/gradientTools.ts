/**
 * 3 个模型可见梯度工具：gradient_propose（写 pending 候选）/ gradient_list（候选+台账+健康分聚合）/
 * gradient_apply（用户确认后按 kind 分发落地 + 台账留痕）。
 *
 * 提案-确认制与 rule_propose/apply 同构：propose 绝不生效；apply 由用户确认后调用。
 * apply 分发：rule=落 .dsh/rules/（复用 ruleStore 索引）；reminder=向 .dsh/reminder/<target> 追加一行；
 * instruction=只建议不落盘（指令目录是用户手工领地）。台账 JSONL 记每次应用供回滚审计。
 *
 * @module gradientTools
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  proposeGradient,
  listPendingGradients,
  readGradientProposal,
  removeGradientProposal,
  appendLedgerEntry,
  readLedger,
} from './gradientStore.js'
import type { GradientKind, GradientProposal } from './gradientStore.js'
import { upsertIndexLine, readActiveRules } from './ruleStore.js'
import { normalizeRuleName, todayIso, MAX_RULE_CONTENT_CHARS } from './ruleTypes.js'
import type { SessionLossView } from './lossProbe.js'

/** 提醒文案文件名的合法性（防路径逃逸：只允许纯文件名）。 */
function normalizeReminderTarget(target: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(target) || target.includes('..')) {
    throw new Error(`invalid reminder target "${target}" (expected a bare .md file name like "memory-end-of-turn.md")`)
  }
  return target
}

/** 梯度应用结果。 */
export interface GradientApplyResult {
  name: string
  kind: GradientKind
  target: string
  action: 'created' | 'overwritten' | 'appended' | 'suggested'
  /** 与现有 active 规则疑似语义重叠的规则名（rule 类别才有；非阻塞，仅供裁决参考）。 */
  conflicts?: string[]
}

/** 工具运行所需宿主环境。 */
export interface GradientToolHost {
  /** 梯度目录（绝对路径，配置钉到项目根）。 */
  gradientDirectory: string
  /** 规则目录（rule 类别落地目标 + 冲突检测）。 */
  rulesDirectory: string
  /** 提醒文案目录（reminder 类别落地目标）。 */
  reminderDirectory: string
  /** 会话损失视图取用（gradient_list 聚合健康分用）。 */
  lossViewFor?: (sessionId: string) => SessionLossView | undefined
  /** 结构化日志。 */
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void }
}

// ---------------------------------------------------------------------------
// gradient_propose
// ---------------------------------------------------------------------------

/** gradient_propose：写入文本梯度候选（不生效）。 */
export function createGradientProposeTool(host: GradientToolHost) {
  return defineTool({
    name: 'gradient_propose',
    description: '提交一条文本梯度候选（对 prompt 层文件的具体修改建议，写入待确认区 pending/，不会立即生效）。适用于：损失信号反复出现且已归因到具体行为修正，或用户明说要改某条提示词/规则/提醒文案。提案后必须向用户转述候选内容与证据并等待确认，用户同意后才调用 gradient_apply。',
    parameters: {
      name: { type: 'string', required: true, description: '候选名，语义化小写下划线（如 reminder_noop_dot_reply）' },
      kind: { type: 'string', enum: ['rule', 'reminder', 'instruction'], required: true, description: 'rule=沉淀为规则（.dsh/rules/）；reminder=修改提醒文案（.dsh/reminder/ 追加一行）；instruction=给用户手工指令目录的建议（不自动落盘）' },
      target: { type: 'string', required: true, description: '目标文件：rule=规则裸名；reminder=文案文件名（如 memory-end-of-turn.md）；instruction=指令文件名' },
      delta: { type: 'string', required: true, description: '文本梯度本体：一句具体可执行的修改（"遇 X 应 Y 不应 Z"或要追加的行）' },
      evidence: { type: 'string', required: true, description: '证据：损失信号摘要（类别+回合）或用户原话' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['proposed'], required: true },
          file: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已写入梯度候选 ${value.file}（未生效）。请向用户转述候选的 delta 内容、证据与目标文件，等待确认；用户同意后调用 gradient_apply {proposal: "${value.name}"} 落地。用户不同意则告知候选作废（可留在 pending 或忽略）。`,
      }],
    },
    async execute(args) {
      const file = await proposeGradient(host.gradientDirectory, {
        name: args.name,
        kind: args.kind,
        target: args.target,
        delta: args.delta,
        evidence: args.evidence,
      })
      host.logger?.info('梯度候选写入 %s（kind=%s target=%s，待用户确认）', file, args.kind, args.target)
      return { status: 'proposed' as const, file, name: args.name }
    },
  })
}

// ---------------------------------------------------------------------------
// gradient_list
// ---------------------------------------------------------------------------

/** gradient_list：聚合候选清单、应用台账与本会话损失摘要。 */
export function createGradientListTool(host: GradientToolHost) {
  return defineTool({
    name: 'gradient_list',
    description: '列出当前文本梯度候选（pending）、最近应用台账与本会话健康分/损失摘要。复盘时用它总览"有哪些待确认的 prompt 修改候选"。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ok'], required: true },
          pending: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                target: { type: 'string', required: true },
                delta: { type: 'string', required: true },
                evidence: { type: 'string', required: true },
                date: { type: 'string', required: true },
              },
            },
          },
          broken: { type: 'array', items: { type: 'string' }, required: true },
          ledger: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'number', required: true },
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                target: { type: 'string', required: true },
                action: { type: 'string', required: true },
                deltaPreview: { type: 'string', required: true },
              },
            },
          },
          health: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sessionId: { type: 'string', required: true },
              score: { type: 'number', required: true },
              total: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => {
        const pending = value.pending.length === 0
          ? '（无待确认候选）'
          : value.pending.map(p => `- [${p.kind}] ${p.name} → ${p.target}：${p.delta}`).join('\n')
        const ledger = value.ledger.length === 0
          ? ''
          : `\n最近应用：${value.ledger.map(entry => `${entry.name}(${entry.action})`).join('、')}`
        const health = value.health === undefined ? '' : `\n本会话健康分：${value.health.score}/100（损失信号 ${value.health.total} 条）`
        return [{
          type: 'text',
          text: `待确认梯度候选：\n${pending}${ledger}${health}`,
        }]
      },
    },
    async execute(_args, exec) {
      const { proposals, broken } = await listPendingGradients(host.gradientDirectory)
      const ledger = await readLedger(host.gradientDirectory, 10)
      const sessionId = exec?.agent?.session?.header?.id
      const view = sessionId !== undefined ? host.lossViewFor?.(String(sessionId)) : undefined
      const health = view === undefined
        ? undefined
        : { sessionId: view.sessionId, score: view.score, total: view.summary.total }
      host.logger?.info('gradient_list：pending=%d broken=%d ledger=%d', proposals.length, broken.length, ledger.length)
      return {
        status: 'ok' as const,
        pending: proposals.map((p: GradientProposal) => ({
          name: p.name,
          kind: p.kind,
          target: p.target,
          delta: p.delta,
          evidence: p.evidence,
          date: p.date,
        })),
        broken,
        ledger: ledger.map(entry => ({
          ts: entry.ts,
          name: entry.name,
          kind: entry.kind,
          target: entry.target,
          action: entry.action,
          deltaPreview: entry.deltaPreview,
        })),
        ...(health === undefined ? {} : { health }),
      }
    },
  })
}

// ---------------------------------------------------------------------------
// gradient_apply
// ---------------------------------------------------------------------------

/** 提取判别词（长度 ≥2 的词元），用于与 active 规则的朴素重叠检测。 */
function extractTerms(text: string): string[] {
  const terms = text.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter(term => term.length >= 2)
  return Array.from(new Set(terms))
}

/** rule 类别冲突检测：与某条 active 规则共享 ≥2 个判别词即视为疑似重叠（非阻塞）。 */
async function detectRuleConflicts(rulesDirectory: string, delta: string): Promise<string[]> {
  const terms = extractTerms(delta)
  if (terms.length === 0) return []
  const rules = await readActiveRules(rulesDirectory)
  const conflicts: string[] = []
  for (const rule of rules) {
    let hits = 0
    for (const term of terms) {
      if (rule.content.includes(term)) hits += 1
      if (hits >= 2) {
        conflicts.push(rule.name)
        break
      }
    }
    if (conflicts.length >= 3) break
  }
  return conflicts
}

/** rule 类别落地：写 .dsh/rules/<target>.md + 索引同步（同名无 mode 报错，语义同 rule_apply）。 */
async function applyRuleGradient(
  rulesDirectory: string,
  proposal: GradientProposal,
  mode: 'overwrite' | 'append' | undefined,
): Promise<GradientApplyResult> {
  const name = normalizeRuleName(proposal.target)
  if (proposal.delta.length > MAX_RULE_CONTENT_CHARS) {
    throw new Error(`梯度 delta 超过规则正文上限（${MAX_RULE_CONTENT_CHARS} 字符）；请拆分或精简后重新 gradient_propose`)
  }
  const activePath = join(rulesDirectory, `${name}.md`)
  let existing: string | undefined
  try {
    existing = await readFile(activePath, 'utf8')
  } catch {
    existing = undefined
  }
  if (existing !== undefined && mode === undefined) {
    throw new Error(`active 规则 ${name}.md 已存在；请显式给 mode：'overwrite'（整体替换）或 'append'（追加带日期小节）`)
  }
  let finalContent: string
  let action: GradientApplyResult['action']
  if (existing === undefined) {
    finalContent = proposal.delta
    action = 'created'
  } else if (mode === 'append') {
    finalContent = `${existing.replace(/\n*$/, '\n')}\n## ${todayIso()}（追加）\n\n${proposal.delta}\n`
    action = 'appended'
  } else {
    finalContent = proposal.delta
    action = 'overwritten'
  }
  await writeFile(activePath, finalContent, 'utf8')
  const hook = proposal.delta.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? ''
  await upsertIndexLine(rulesDirectory, name, hook)
  const conflicts = await detectRuleConflicts(rulesDirectory, proposal.delta)
  return { name: proposal.name, kind: 'rule', target: name, action, ...(conflicts.length > 0 ? { conflicts } : {}) }
}

/** reminder 类别落地：向 .dsh/reminder/<target> 追加一行（带总量预算防膨胀）。 */
async function applyReminderGradient(
  reminderDirectory: string,
  proposal: GradientProposal,
): Promise<GradientApplyResult> {
  const target = normalizeReminderTarget(proposal.target)
  const filePath = join(reminderDirectory, target)
  let existing: string
  try {
    existing = await readFile(filePath, 'utf8')
  } catch {
    throw new Error(`提醒文案文件不存在：${target}（gradient_apply 只修改现有文案，不新建）`)
  }
  if (existing.length + proposal.delta.length + 1 > MAX_RULE_CONTENT_CHARS) {
    throw new Error(`提醒文案 ${target} 追加后超过预算（${MAX_RULE_CONTENT_CHARS} 字符）；请先合并精简既有条目再追加`)
  }
  await writeFile(filePath, `${existing.replace(/\n*$/, '\n')}\n${proposal.delta.trim()}\n`, 'utf8')
  return { name: proposal.name, kind: 'reminder', target, action: 'appended' }
}

/** gradient_apply：用户确认后把候选落地（按 kind 分发）+ 台账留痕 + 删 pending。 */
export function createGradientApplyTool(host: GradientToolHost) {
  return defineTool({
    name: 'gradient_apply',
    description: '把待确认的文本梯度候选落地（按 kind 分发：rule 落规则库 / reminder 追加提醒文案 / instruction 只生成建议）。仅在用户确认候选后调用。rule 类别同名规则已存在时必须给 mode（overwrite/append）。',
    parameters: {
      proposal: { type: 'string', required: true, description: '要应用的候选名（gradient_propose 时的 name）' },
      mode: { type: 'string', enum: ['overwrite', 'append'], description: '仅 rule 类别同名规则已存在时必填' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['applied'], required: true },
          name: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          target: { type: 'string', required: true },
          action: { type: 'string', required: true },
          conflicts: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const actionLabel = value.action === 'created'
          ? '新建'
          : value.action === 'overwritten'
            ? '整体替换'
            : value.action === 'appended'
              ? '追加'
              : '仅建议（指令目录由用户手工维护，请人工处理）'
        const conflictNote = value.conflicts === undefined ? '' : `。注意：与现有规则疑似重叠：${value.conflicts.join('、')}（请人工裁决是否合并）`
        const effect = value.kind === 'rule'
          ? '规则段即时重算，当前会话立即生效'
          : value.kind === 'reminder'
            ? '提醒文案实时读取，下一回合末生效'
            : ''
        return [{
          type: 'text',
          text: `梯度已落地：${value.target}（${actionLabel}）${conflictNote}${effect === '' ? '' : `。${effect}`}。已记入台账（applied.jsonl），回滚走 git。`,
        }]
      },
    },
    async execute(args) {
      const proposal = await readGradientProposal(host.gradientDirectory, args.proposal)
      let result: GradientApplyResult
      if (proposal.kind === 'rule') {
        result = await applyRuleGradient(host.rulesDirectory, proposal, args.mode)
      } else if (proposal.kind === 'reminder') {
        result = await applyReminderGradient(host.reminderDirectory, proposal)
      } else {
        result = { name: proposal.name, kind: 'instruction', target: proposal.target, action: 'suggested' }
      }
      await appendLedgerEntry(host.gradientDirectory, {
        ts: Date.now(),
        name: proposal.name,
        kind: proposal.kind,
        target: result.target,
        action: result.action,
        deltaPreview: proposal.delta.replace(/\n/g, ' '),
      })
      await removeGradientProposal(host.gradientDirectory, proposal.name)
      host.logger?.info('梯度落地 %s（kind=%s target=%s action=%s）', proposal.name, proposal.kind, result.target, result.action)
      return {
        status: 'applied' as const,
        name: result.name,
        kind: result.kind,
        target: result.target,
        action: result.action,
        ...(result.conflicts === undefined ? {} : { conflicts: result.conflicts }),
      }
    },
  })
}

/** 创建全部 3 个梯度工具。 */
export function createGradientTools(host: GradientToolHost) {
  return [
    createGradientProposeTool(host),
    createGradientListTool(host),
    createGradientApplyTool(host),
  ]
}
