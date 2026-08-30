/**
 * 2 个模型可见规则工具：rule_propose / rule_apply。
 * 提案-确认制：propose 只写 pending，结果文本要求模型向用户转述并等待确认；
 * apply 由用户确认后调用，落地 active 并即时反映到常驻规则段。
 *
 * @module tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { applyRule, proposeRule } from './ruleStore.js'

/** 工具运行所需宿主环境（由 index.ts 装配时闭包注入）。 */
export interface RuleToolHost {
  /** 解析后的规则目录（默认 <cwd>/.dsh/rules，可由配置 ruleDir 覆盖）。 */
  rulesDirectory: string
  /** Cordis 上下文：关键流程日志走 ctx.logger（测试桩可省略）。 */
  ctx?: Context
}

/** rule_propose：写入待确认提案。 */
export function createRuleProposeTool(host: RuleToolHost) {
  return defineTool({
    name: 'rule_propose',
    description: '提交一条持久规则提案（写入待确认区 pending/，不会立即生效）。适用于：同一纠正再次出现、或用户明说"以后都这样"。提案前先向用户口头确认；提案后必须向用户转述规则内容并等待确认，用户同意后才调用 rule_apply。',
    parameters: {
      name: { type: 'string', required: true, description: '规则名，语义化小写下划线（如 server_authoritative_movement）' },
      content: { type: 'string', required: true, description: '规则正文（Markdown）：一条明确可执行的约定，说明"以后要怎么做"' },
      reason: { type: 'string', required: true, description: '为什么提出这条规则（用户原话或场景）' },
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
        text: `已写入提案 ${value.file}（未生效）。请向用户转述规则内容与理由并等待确认；用户确认后调用 rule_apply {proposal: "${value.name}"} 落地，落地后当前会话立即生效。用户不同意则告知提案已作废（可留在 pending 或忽略）。`,
      }],
    },
    async execute(args) {
      const file = await proposeRule(host.rulesDirectory, {
        name: args.name,
        content: args.content,
        reason: args.reason,
      })
      host.ctx?.logger?.info(`ds-feedback: 规则提案写入 ${file}（待用户确认，未生效）`)
      return {
        status: 'proposed' as const,
        file,
        name: args.name.endsWith('.proposed.md')
          ? args.name.slice(0, -'.proposed.md'.length)
          : args.name.replace(/\.md$/, ''),
      }
    },
  })
}

/** rule_apply：用户确认后把提案落地为 active 规则。 */
export function createRuleApplyTool(host: RuleToolHost) {
  return defineTool({
    name: 'rule_apply',
    description: '把待确认提案落地为生效规则（pending → .dsh/rules/<name>.md），当前会话立即生效。仅在用户确认提案后调用。同名 active 规则已存在时必须给 mode：overwrite=整体替换，append=追加带日期小节。',
    parameters: {
      proposal: { type: 'string', required: true, description: '要应用的提案名（rule_propose 时的 name，如 server_authoritative_movement）' },
      mode: { type: 'string', enum: ['overwrite', 'append'], description: '同名规则已存在时必填；缺省且同名规则存在会报错' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['applied'], required: true },
          file: { type: 'string', required: true },
          action: { type: 'string', enum: ['created', 'overwritten', 'appended'], required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `规则已生效：${value.file}（${value.action === 'created' ? '新建' : value.action === 'overwritten' ? '整体替换' : '追加'}）。规则段即时重算，当前会话立即生效，无需重启。`,
      }],
    },
    async execute(args) {
      let result
      try {
        result = await applyRule(host.rulesDirectory, {
          proposal: args.proposal,
          ...(args.mode === undefined ? {} : { mode: args.mode }),
        })
      } catch (error) {
        // 提案不存在/同名冲突等模型可见错误——留 warn 便于排查被拒的 apply
        host.ctx?.logger?.warn('ds-feedback: rule_apply 被拒绝', error)
        throw error
      }
      host.ctx?.logger?.info(`ds-feedback: 规则落地 ${result.fileName}（${result.action}），规则段即时生效`)
      return { status: 'applied' as const, file: result.fileName, action: result.action }
    },
  })
}

/** 创建全部 2 个规则工具。 */
export function createRuleTools(host: RuleToolHost) {
  return [
    createRuleProposeTool(host),
    createRuleApplyTool(host),
  ]
}
