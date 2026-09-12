/**
 * DS 行为飞轮：常量、episode 名校验、frontmatter 渲染/解析与 system prompt 段文本。
 * 经验保存与检索完全由主 agent 自觉调用工具完成，不走 LLM。
 *
 * @module experienceTypes
 */

/** 插件在 Cordis/DSH 中的注册名。 */
export const PLUGIN_NAME = '@demostudio/ds-experience'

/** 经验目录（相对项目根），随 git 跟踪（与 .dsh/memory 同一跟踪决策）。 */
export const EXPERIENCE_DIR_SEGMENT = '.dsh/experience'

/** 经验索引文件名（经验目录内）。 */
export const EXPERIENCE_INDEX_FILE = 'INDEX.md'

/** 经验指导段在 system prompt 中的排序：内核自带段止于 2900，memory=3200、instructions=3300。 */
export const SECTION_NAME = 'experience:guide'
export const SECTION_ORDER = 3000

/** AI 选择器单次最多选中的 episode 数（经验库按需冷检索，少而精）。 */
export const MAX_SELECTED = 3

/** INDEX.md 注入行数上限（同 memory 索引水位语义）。 */
export const MAX_INDEX_LINES = 300

/** INDEX.md 注入字节上限（UTF-8）。 */
export const MAX_INDEX_BYTES = 40_000

/** INDEX.md 索引单行长度上限。 */
export const MAX_INDEX_LINE_LENGTH = 150

/** 单条经验正文的注入截断上限（与 memory 检索侧同语义）。 */
export const MAX_EPISODE_CONTENT_CHARS = 8000

/** episode 结果三值（frontmatter 的 outcome 字段，闭式）。 */
export const EPISODE_OUTCOMES = ['success', 'partial', 'failure'] as const

/** 闭式 episode 结果。 */
export type EpisodeOutcome = (typeof EPISODE_OUTCOMES)[number]



/** 转录渲染的默认总字符上限（history_read 可用 max_chars 覆盖）。 */
export const DEFAULT_TRANSCRIPT_CHARS = 20_000

/** 转录中单条消息的字符上限（与 ds-memory renderTurnTranscript 同语义）。 */
export const MAX_TRANSCRIPT_MESSAGE_CHARS = 1_500

/** 转录中单条工具调用参数的字符上限。 */
export const MAX_TRANSCRIPT_TOOL_ARGS_CHARS = 200

/**
 * 校验并规范化 episode 名：语义化小写下划线；非法输入抛错（防路径逃逸）。
 * 接受裸名或 `<name>.md`，返回 `<name>.md`。
 */
export function normalizeEpisodeName(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('episode name must be a non-empty string')
  }
  const bare = input.endsWith('.md') ? input.slice(0, -3) : input
  if (!/^[a-z][a-z0-9_]*$/.test(bare)) {
    throw new Error(
      `invalid episode name "${input}" (expected lowercase snake_case like "fix_junction_mount", got "${bare}")`,
    )
  }
  if (bare === 'index') {
    throw new Error('"index" is reserved; pick a more specific episode name')
  }
  return `${bare}.md`
}

/** 一次经验沉淀的输入（experience_save 与自动提炼共用）。 */
export interface EpisodeInput {
  /** 语义化小写下划线名（如 fix_junction_mount）。 */
  name: string
  /** 任务类型短语（如 build-fix / feature / refactor / debug）。 */
  taskType: string
  /** 任务结果。 */
  outcome: EpisodeOutcome
  /** 一句话概述：这是个什么任务、怎么做的。 */
  summary: string
  /** 学到什么：有效的路径、踩的坑、下次怎么办。 */
  lessons: string
  /** 有效的落点（文件/目录/命令），可选。 */
  effectivePath?: string
  /**
   * 联想触发文件列表（可选）：项目根相对的**具体文件路径**数组
   * （如 `['harness/ds-memory/src/associate.ts']`，单文件可省略方括号）。
   * 会话中 Agent 读到列表中的任一文件时，本条经验全文会被自动注入（每会话一次）。
   * 只按具体文件精确匹配：目录前缀、`&&`/`||` 表达式、`/` 全局已废弃（2026-09-12）。
   */
  prefix?: string[]
}

/** 解析后的 frontmatter（字段均可缺省：半损坏文件仍可扫描）。 */
export interface EpisodeFrontmatter {
  name?: string
  task_type?: string
  outcome?: string
  date?: string
  /** 联想触发文件列表（可选），语义同 EpisodeInput.prefix。 */
  prefix?: string[]
}

/**
 * 解析 episode 文件的 frontmatter + 正文。
 * 仅认 `---` 首尾围栏内每行一条 `key: value`；无围栏、空输入按无 frontmatter 处理。
 */
export function parseEpisodeFrontmatter(text: string): { data: EpisodeFrontmatter; body: string } {
  const trimmed = text.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) return { data: {}, body: trimmed }
  const lineBreak = trimmed.indexOf('\n')
  if (lineBreak < 0) return { data: {}, body: trimmed }
  const end = trimmed.indexOf('\n---', lineBreak)
  if (end < 0) return { data: {}, body: trimmed }
  const block = trimmed.slice(lineBreak + 1, end)
  const afterFence = trimmed.slice(end + 4)
  const body = afterFence.startsWith('\n') ? afterFence.slice(1) : afterFence
  const data: EpisodeFrontmatter = {}
  for (const line of block.split('\n')) {
    const sep = line.indexOf(':')
    if (sep <= 0) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (value.length === 0) continue
    if (key === 'name') data.name = value
    else if (key === 'task_type') data.task_type = value
    else if (key === 'outcome') data.outcome = value
    else if (key === 'date') data.date = value
    else if (key === 'prefix') {
      const files = parseTriggerFileList(value)
      if (files !== undefined) data.prefix = files
    }
  }
  return { data, body }
}

/** 去掉 frontmatter 值两侧的成对引号（支持 `prefix: 'src/engine/x.ts'` 写法）。 */
function unquoteFrontmatterValue(value: string): string {
  if (value.length >= 2) {
    const head = value[0]!
    const tail = value[value.length - 1]!
    if ((head === tail) && (head === "'" || head === '"')) return value.slice(1, -1).trim()
  }
  return value
}

/**
 * 解析 frontmatter 中的 prefix 值为触发文件列表：
 * - `prefix: [src/engine/a.ts, doc/engine/b.md]`（推荐方括号数组形式，逗号分隔）
 * - `prefix: src/engine/a.ts`（单文件可省略方括号）
 * 每项去成对引号、反斜杠归一为正斜杠；空项丢弃；全部为空返回 undefined（视为未声明）。
 */
export function parseTriggerFileList(value: string): string[] | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
  const entries = inner
    .split(',')
    .map(entry => unquoteFrontmatterValue(entry.trim()).replace(/\\/g, '/').trim())
    .filter(entry => entry.length > 0)
  return entries.length > 0 ? entries : undefined
}

/**
 * 规范化工具入参的触发文件列表：反斜杠归一为正斜杠、去空白、丢弃空项与非字符串项。
 * 全部为空返回 undefined（等同 hold 的"无联想"）；条目含换行抛错（frontmatter 单行约束）。
 */
export function normalizeTriggerFiles(entries: readonly unknown[] | undefined): string[] | undefined {
  if (entries === undefined) return undefined
  const normalized: string[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string') continue
    const text = entry.replace(/\\/g, '/').trim()
    if (text.length === 0) continue
    if (/[\r\n]/.test(text)) {
      throw new Error(`prefix 条目 "${entry}" 非法：必须是单行文件路径（不含换行）`)
    }
    normalized.push(text)
  }
  return normalized.length > 0 ? normalized : undefined
}

/** 触发文件列表的展示格式（索引标注/注入标题用）：`a.ts, b.md`。 */
export function formatTriggerFiles(files: readonly string[]): string {
  return files.join(', ')
}

/** 校验 outcome 字段（宽松：未知值降级 undefined，文件仍可扫描）。 */
export function parseEpisodeOutcome(value: unknown): EpisodeOutcome | undefined {
  if (typeof value !== 'string') return undefined
  return (EPISODE_OUTCOMES as readonly string[]).includes(value)
    ? value as EpisodeOutcome
    : undefined
}

/** 当天日期（本地时区，YYYY-MM-DD）。 */
export function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 回合末经验提醒文本（turn/end 时经 agent.inject 注入，form='notice'）。 */
export const END_OF_TURN_EXPERIENCE_REMINDER_TEXT = `## 回合末经验提醒

本回合即将结束。若本回合完成过一次有复用价值的完整任务，考虑沉淀经验：
- 下次做同类事会用到这条做事轨迹？
- 踩了值得记录的坑（环境坑/易错点/反模式）？
- 发现了比旧经验更优的路线（用同名覆盖更新，别丢旧坑信息）？

有 → 立即调用 experience_save 保存（prefix 必填：声明联想触发的文件数组，无联想填 hold）。没有 → 不保存。该消息来自插件机制而非用户，无需回复。`

/** 按规范序列化一份 episode 文件（frontmatter：name/task_type/outcome/date[/prefix] + 固定小节）。 */
export function renderEpisodeFile(input: EpisodeInput, date: string): string {
  const sections = [
    `## Summary\n\n${input.summary.trim()}`,
    `## Lessons\n\n${input.lessons.trim()}`,
  ]
  if (input.effectivePath !== undefined && input.effectivePath.trim() !== '') {
    sections.push(`## Effective Path\n\n${input.effectivePath.trim()}`)
  }
  const prefixLine = input.prefix !== undefined && input.prefix.length > 0
    ? `\nprefix: [${input.prefix.join(', ')}]`
    : ''
  return `---\nname: ${input.name}\ntask_type: ${input.taskType}\noutcome: ${input.outcome}\ndate: ${date}${prefixLine}\n---\n${sections.join('\n\n')}\n`
}

// ---------------------------------------------------------------------------
// system prompt 经验指导段文本
// ---------------------------------------------------------------------------

/**
 * 组装"经验库指导"system prompt 段。
 * @param indexText - 截断后的 INDEX.md 内容；undefined/空 = 目录尚无内容，不注入索引部分。
 */
export function experienceGuideSectionText(indexText: string | undefined): string {
  const parts = [
    `# 经验库（做事轨迹）

你有跨会话经验库，存放于项目根 \`.dsh/experience/\`，记录"一次完整任务是怎么做的"。与记忆系统的分工（硬约束）：
- **记忆（ds-memory）** = 事实与规则 — **禁止把经验轨迹/任务过程写进 memory_write**。
- **经验（本插件）** = 做事轨迹（怎么做的、什么有效、踩了什么）— **禁止把事实/规则写进 experience_save**。
- 同一次事件常需**双写**：蒸馏后的结论/规则进记忆（memory_write），做事轨迹进本库（experience_save）。
- **Lessons 引用而不复述**：规则已沉淀进记忆时写"规则见 memory:条目名"，不要复述规则本身——两库 prefix 相近会被同时注入，复述浪费上下文（记忆侧同理不复述轨迹）。

## 何时用经验工具

- 接到可能与过往工作重复的改动类任务 → 先 \`history_search\` 查历史会话（"上次怎么做的"）；命中后 \`history_read\` 读那场会话的任务转录。
- 疑似有相似经验（同类任务以前做过）→ \`experience_search\` 按需检索经验库。
- **完成一个有复用价值的任务后 → 主动调用 \`experience_save\` 沉淀经验**（你的职责：判断哪些工作值得记录，做完就存，不要等人提醒）。

## prefix 文件联想（与记忆系统同构）

- \`experience_save\` 的 \`prefix\` 参数**必填**（字符串数组，如 \`["harness/ds-memory/src/associate.ts"]\`）：声明**联想触发的具体文件列表**（项目根相对的精确文件路径）；会话中读到列表中的**任一文件**时，该经验**全文自动注入**（同会话同条只注入一次）。无联想、或更新同名经验时保持原样，填 \`hold\`（hold 不落 frontmatter）。
- 只按**具体文件**精确匹配（2026-09-12 起）：目录前缀、\`&&\`/\`||\` 表达式、\`/\` 全局均已废弃——声明目录不会命中其下文件。
- **声明 prefix 的经验正文会被整篇加载**：Summary/Lessons 必须精炼，只留不可推导的核心（踩坑/有效路径），不写过程流水账。
- 改动高频触点文件（如联想器、引擎入口、核心资产）的经验值得把该文件声明进 prefix，让下次改到它时自动想起。

## 回合末提醒

每个回合结束（turn/end）会收到一条"回合末经验提醒"（60 秒冷却，可配置关闭 \`enableEndOfTurnReminder\`）：按"是否完成过有复用价值的完整任务"自查，有则当回合 \`experience_save\`，没有则忽略；该消息来自插件机制而非用户，无需回复。

## 发现更优路线时

- 保存前先 \`experience_search\` 查同类旧经验，读到旧 lessons 后对比。
- **旧路线已过时**（新做法明确更优）→ 用相同 name 覆盖，在 lessons 中保留旧路线的教训作为对比参考。
- **两条路线各有适用场景**（如不同规模/约束下分别更优）→ 用不同 name 新建，lessons 中互相引用。
- **不管哪种方式，都不要丢失旧经验中"踩了什么坑"的信息**——那是最有复用价值的部分。`,
  ]
  if (indexText !== undefined && indexText.length > 0) {
    parts.push(`## INDEX.md 索引\n\n${indexText}`)
  }
  return parts.join('\n\n')
}
