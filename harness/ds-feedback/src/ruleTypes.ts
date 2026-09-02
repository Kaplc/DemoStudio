/**
 * DS 反馈飞轮：常量、规则名校验与 system prompt 段文本。
 *
 * @module ruleTypes
 */

/** 插件在 Cordis/DSH 中的注册名。 */
export const PLUGIN_NAME = '@demostudio/ds-feedback'

/** 规则目录（相对项目根），随 git 跟踪（与 .dsh/memory 同一跟踪决策）。 */
export const RULES_DIR_SEGMENT = '.dsh/rules'

/** 规则索引文件名（规则目录内）。 */
export const RULES_INDEX_FILE = 'RULES.md'

/** 待确认提案子目录名（规则目录内）。 */
export const PENDING_SEGMENT = 'pending'

/** 提案文件后缀（pending 目录内，`<name>.proposed.md`）。 */
export const PROPOSED_SUFFIX = '.proposed.md'

/** 规则段在 system prompt 中的排序：内核自带段止于 2900，ds-memory=3200、ds-instructions=3300。 */
export const SECTION_NAME = 'feedback:rules'
export const SECTION_ORDER = 3100

/** RULES.md 索引注入行数上限（同 memory 索引水位语义）。 */
export const MAX_INDEX_LINES = 300

/** RULES.md 索引注入字节上限（UTF-8）。 */
export const MAX_INDEX_BYTES = 40_000

/** RULES.md 索引单行长度上限。 */
export const MAX_INDEX_LINE_LENGTH = 150

/** 规则段内单条规则正文的字符上限（防止 token 爆炸）。 */
export const MAX_RULE_CONTENT_CHARS = 8000

/**
 * 校验并规范化规则名：接受裸名（`server_authoritative_movement`）。
 * 语义化小写下划线命名；非法输入（路径分隔符、大写、空、`..` 等）抛错（防路径逃逸）。
 */
export function normalizeRuleName(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('rule name must be a non-empty string')
  }
  const bare = input.endsWith(PROPOSED_SUFFIX)
    ? input.slice(0, -PROPOSED_SUFFIX.length)
    : input.endsWith('.md')
      ? input.slice(0, -3)
      : input
  if (!/^[a-z][a-z0-9_]*$/.test(bare)) {
    throw new Error(
      `invalid rule name "${input}" (expected lowercase snake_case like "server_authoritative_movement", got "${bare}")`,
    )
  }
  return bare
}

/** 当天日期（本地时区，YYYY-MM-DD）——提案 frontmatter 与 append 小节标题用。 */
export function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// ---------------------------------------------------------------------------
// system prompt 规则段文本
// ---------------------------------------------------------------------------

/** 单条 active 规则（段落渲染输入）。 */
export interface ActiveRule {
  /** 规则名（裸名，不含 .md）。 */
  name: string
  /** 规则正文（文件全文，含 frontmatter 时调用方先剥掉）。 */
  content: string
}

/**
 * 回合末预筛命中后的提示载荷：主 agent 在下一回合的规则段末尾看到，
 * 由它结合上下文自行判定并走提案-确认制（本插件不发模型请求）。
 */
export interface SuspicionHint {
  /** 触发预筛的回合号。 */
  turn: number
  /** 命中的用户消息原话摘录（已剥前缀截断，最多保留最近的 2 条）。 */
  excerpts: readonly string[]
}

/**
 * 组装"用户反馈规则库"system prompt 段。
 * @param rules - 全部 active 规则（调用方保证来自磁盘扫描）。
 * @param indexText - RULES.md 索引（截断后）；undefined/空 = 规则库为空，不注入索引部分。
 * @param hint - 回合末预筛命中提示；undefined = 不注入提示部分。
 */
export function rulesSectionText(
  rules: readonly ActiveRule[],
  indexText: string | undefined,
  hint?: SuspicionHint,
): string {
  const ruleBlocks = rules.map(rule => {
    const clipped = rule.content.length > MAX_RULE_CONTENT_CHARS
      ? `${rule.content.slice(0, MAX_RULE_CONTENT_CHARS)}\n[...规则过长已截断]`
      : rule.content
    return `<rule name="${rule.name}">\n${clipped.trim()}\n</rule>`
  })
  const parts = [
    `# 用户反馈规则库

用户纠正沉淀出的持久规则存于 \`.dsh/rules/\`，**已生效，直接遵守**，无需读取文件；本段每步重算，规则 apply 后当前会话立即生效。

## 何时沉淀新规则

- 用户明说"记住"、"以后都这样"、"别再"、"沉淀为规则"等：先口头确认要固化成什么规则，再 rule_propose 提案，向用户转述内容，用户确认后 rule_apply。
- 用户显式纠正且明显可泛化（不限于当前这一次任务）时也可提案；一次性偏好、只对当前任务有效的临时要求不要提案——规则库保持少而精。
- 回合末后台只做零成本关键词预筛（不发模型请求）：命中时本段末尾出现"回合末纠正提示"，由你结合上下文判定双条件（人工纠正 + 可泛化必要条件）后走提案-确认制；不成立或已处理就忽略提示。绝不未经用户确认 rule_apply。
- 与目录指令（\`.dsh/instructions/\`，用户手工维护）分工：手工规范进指令目录，用户纠正沉淀进规则库，两套体系互不读写。`,
    ruleBlocks.length === 0 ? '（规则库当前为空。）' : ruleBlocks.join('\n\n'),
  ]
  if (indexText !== undefined && indexText.length > 0) {
    parts.push(`## RULES.md 索引\n\n${indexText}`)
  }
  if (hint !== undefined && hint.excerpts.length > 0) {
    parts.push(`## ⚠ 回合末纠正提示（${hint.turn} 号回合，待判定）

关键词预筛在该回合用户消息中发现疑似纠正：
${hint.excerpts.map(excerpt => `> ${excerpt}`).join('\n')}

请结合会话上下文自行判定：若确属"用户人工纠正"且"可泛化为一类任务的必要条件"、规则库又未覆盖——先口头向用户确认规则内容与理由，再 rule_propose 提案；用户确认后才 rule_apply。若是一次性调整、风格意见或提示对应内容已处理过，直接忽略本提示，无需向用户提及。`)
  }
  return parts.join('\n\n')
}
