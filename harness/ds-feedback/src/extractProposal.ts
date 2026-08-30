/**
 * 回合末纠正检测（独立水位，与 ds-experience 提炼互不接触）：
 * 渲染增量转录 → 客户端纠正关键词预筛（零成本门槛，未命中不发 side-query）→
 * 小模型按双条件判定：① 存在用户人工纠正；② 该纠正是一类任务正确完成的必要条件。
 * 两者同时成立才写 pending 提案（提案-确认制不变，生效仍只走 rule_apply 人工确认）。
 * 任何失败 ok:false 水位不推进，下次空闲重试，绝不抛出。
 *
 * @module extractProposal
 */

import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { normalizeRuleName } from './ruleTypes.js'
import { listPendingProposals, proposeRule, readActiveRules } from './ruleStore.js'
import { renderTurnTranscript } from './transcript.js'

/** 判定模型（小模型足够做转录判读）；config 可覆盖。 */
export const DEFAULT_DIAGNOSE_MODEL = 'deepseek-chat'
/** 判定 provider 路由；config 可覆盖。 */
export const DEFAULT_DIAGNOSE_PROVIDER = 'deepseek-official'
export const DIAGNOSE_TIMEOUT_MS = 30_000
export const DIAGNOSE_MAX_TOKENS = 1024

/**
 * 纠正关键词预筛（只测 `[用户] ` 行）：宁滥勿缺——误报只多花一次小模型判定，
 * 漏报则丢一条纠正。真正的双条件判定由 side-query 完成。
 */
export const CORRECTION_HINT_PATTERN =
  /(别|不要|不用这样|不准|不对|不是这样|不是这个|不行|错了|搞错|弄错|搞反|弄反|反了|漏了|回滚|重来|重新|撤回|停下|停止|打住|记住|以后都|以后别|以后不|沉淀|wrong|mistake|don't|do not|stop doing|revert|undo)/i

/** 判定 system prompt：双条件 + 与现有规则去重 + 严格 JSON 输出。 */
export const DIAGNOSE_SYSTEM_PROMPT = `你在为 DemoStudio（一个对标 UE 架构的 2D 游戏引擎 + Electron 编辑器，TypeScript 全栈）的开发助手维护反馈规则库。你会拿到一段回合转录（[用户]/[助手]/[调用工具] 行）和现有规则清单（active 规则 + 待确认提案）。

判定本回合是否同时满足两个条件：
1. 人工纠正：用户明确指出助手的做法或结果有问题，并给出了正确的做法。单纯提问、补充背景信息、提出新需求都不算纠正。
2. 必要条件：遵守这条纠正是一类任务正确完成的必要条件——不遵守就会做错、失败或返工。一次性偏好、只对当前这个任务有效的细节、纯代码风格意见都不算必要条件。

两个条件同时成立、且现有规则清单中没有覆盖同一内容的条目时，提炼一条规则提案；否则不提案。

只输出一个严格 JSON 对象，不要输出任何其他文字：
- 无纠正：{"correction": false}
- 有纠正但不是必要条件，或已有规则覆盖：{"correction": true, "necessary": false}
- 两个条件都成立：{"correction": true, "necessary": true, "rule": {"name": "小写下划线名（如 server_authoritative_movement）", "content": "一条明确可执行的约定（Markdown），说明以后要怎么做", "reason": "触发纠正的场景与用户原话（一句话）"}}`

/** 一次判定的执行环境。 */
export interface DiagnoseOptions {
  /** 已判定到的回合号（含）；本次只处理 > watermark 的回合。 */
  watermark: number
  /** 判定模型路由；undefined 时回退 fallback。 */
  overrideProvider?: string
  overrideModel?: string
  fallbackProvider: string
  fallbackModel: string
}

export interface DiagnoseResult {
  /** 是否成功跑完（失败不推进水位）。 */
  ok: boolean
  /** 本次扫描到的最大回合号（成功时即新水位）。 */
  maxTurn: number
  /** 本次写入的提案文件路径（pending/ 相对路径）。 */
  proposed: string[]
}

/** 判定结论（解析模型输出）。 */
export type DiagnoseVerdict =
  | { kind: 'invalid' }
  | { kind: 'no_correction' }
  | { kind: 'correction_only' }
  | { kind: 'propose'; name: string; content: string; reason: string }

/**
 * 宽容解析判定输出：截取首个 {...} 块并校验字段。
 * invalid = 输出不合法（视为失败，水位不推进重试）；
 * no_correction / correction_only = 判定完成、不提案（水位照常推进）；
 * propose = 双条件成立，落 pending 提案。
 */
export function parseDiagnoseOutput(text: string): DiagnoseVerdict {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { kind: 'invalid' }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return { kind: 'invalid' }
  }
  if (parsed.correction !== true) {
    return parsed.correction === false ? { kind: 'no_correction' } : { kind: 'invalid' }
  }
  if (parsed.necessary !== true) return { kind: 'correction_only' }
  const raw = parsed.rule
  if (raw === null || typeof raw !== 'object') return { kind: 'invalid' }
  const rule = raw as Record<string, unknown>
  if (typeof rule.name !== 'string' || typeof rule.content !== 'string' || typeof rule.reason !== 'string'
    || rule.content.trim() === '' || rule.reason.trim() === '') {
    return { kind: 'invalid' }
  }
  try {
    return {
      kind: 'propose',
      name: normalizeRuleName(rule.name),
      content: rule.content.trim(),
      reason: rule.reason.trim(),
    }
  } catch {
    return { kind: 'invalid' }
  }
}

/** 规则清单首行（去重清单用；截断防爆炸）。 */
function firstLineOf(content: string): string {
  const line = content.split('\n').map(candidate => candidate.trim()).find(candidate => candidate.length > 0) ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/**
 * 执行一次回合末纠正检测：渲染转录 → 预筛 → 现有规则清单 → side-query 双条件判定 → 落 pending。
 * 任何失败返回 ok:false（水位不推进，下次空闲重试），绝不抛出。
 */
export async function diagnoseFromSession(
  ctx: Context,
  session: Session,
  rulesDirectory: string,
  options: DiagnoseOptions,
): Promise<DiagnoseResult> {
  const { transcript, maxTurn } = renderTurnTranscript(session.events, { watermark: options.watermark })
  if (maxTurn <= options.watermark || transcript === '') {
    ctx.logger?.debug(`ds-feedback: 无新回合内容（水位 ${options.watermark}），跳过纠正检测`)
    return { ok: true, maxTurn: Math.max(maxTurn, options.watermark), proposed: [] }
  }
  // 客户端预筛：用户消息行不含纠正关键词 → 不发 side-query，水位照常推进（省一次判定）
  const userLines = transcript.split('\n').filter(line => line.startsWith('[用户] '))
  if (!userLines.some(line => CORRECTION_HINT_PATTERN.test(line))) {
    ctx.logger?.debug(`ds-feedback: 回合 >${options.watermark} 用户消息无纠正关键词，水位推进到 ${maxTurn}`)
    return { ok: true, maxTurn, proposed: [] }
  }
  const provider = options.overrideProvider ?? options.fallbackProvider
  const model = options.overrideModel ?? options.fallbackModel
  try {
    // 现有规则清单供判定模型去重（提案不重复建设）；清单失败不阻塞判定
    let manifest: string
    try {
      const [rules, pending] = await Promise.all([readActiveRules(rulesDirectory), listPendingProposals(rulesDirectory)])
      manifest = [
        rules.length === 0
          ? 'active 规则：（无）'
          : `active 规则：\n${rules.map(rule => `- ${rule.name}：${firstLineOf(rule.content)}`).join('\n')}`,
        pending.length === 0 ? '待确认提案：（无）' : `待确认提案：${pending.join('、')}`,
      ].join('\n')
    } catch {
      manifest = '（读取失败）'
    }
    const framed = `回合转录：\n${transcript}\n\n现有规则清单：\n${manifest}\n\n按系统指令判定并只输出严格 JSON。`
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: framed }],
      source: { kind: 'plugin', plugin: '@demostudio/ds-feedback' },
    })]
    const request: GenerateOptions = deepFreeze({
      provider,
      model,
      messages,
      system: DIAGNOSE_SYSTEM_PROMPT,
      maxTokens: DIAGNOSE_MAX_TOKENS,
    })
    using callDeadline = deadline(undefined, DIAGNOSE_TIMEOUT_MS, 'FEEDBACK_DIAGNOSE_TIMEOUT')
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(request)) {
      callDeadline.signal.throwIfAborted()
      assembler.push(chunk)
    }
    if (assembler.finish.kind !== 'stop') {
      ctx.logger?.warn(`ds-feedback: 判定模型异常结束（${assembler.finish.kind}），本次跳过`)
      return { ok: false, maxTurn: options.watermark, proposed: [] }
    }
    const text = assembler.blocks()
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(' ')
    const verdict = parseDiagnoseOutput(text)
    if (verdict.kind === 'invalid') {
      ctx.logger?.warn('ds-feedback: 判定输出不是合法 JSON，本次跳过')
      return { ok: false, maxTurn: options.watermark, proposed: [] }
    }
    if (verdict.kind !== 'propose') {
      ctx.logger?.info(
        `ds-feedback: 判定回合 >${options.watermark}（${verdict.kind === 'no_correction' ? '无纠正' : '纠正但非必要条件'}），水位推进到 ${maxTurn}`,
      )
      return { ok: true, maxTurn, proposed: [] }
    }
    const file = await proposeRule(rulesDirectory, {
      name: verdict.name,
      content: verdict.content,
      reason: verdict.reason,
    })
    ctx.logger?.info(`ds-feedback: 纠正检测命中双条件，提案写入 ${file}（待用户确认，未生效）`)
    return { ok: true, maxTurn, proposed: [file] }
  } catch (error: unknown) {
    ctx.logger?.warn('ds-feedback: 后台纠正检测失败，下次空闲重试', error)
    return { ok: false, maxTurn: options.watermark, proposed: [] }
  }
}
