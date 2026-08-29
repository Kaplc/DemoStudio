/**
 * DSH 记忆系统：四类型定义、frontmatter 解析、文件名校验与全部可调常量。
 *
 * @module memoryTypes
 */

/** 记忆插件在 Cordis/DSH 中的注册名。 */
export const PLUGIN_NAME = '@demostudio/dsh-memory'

/** 记忆目录（相对项目根），随 git 跟踪（用户明确决策，不得 gitignore）。 */
export const MEMORY_DIR_SEGMENT = '.dsh/memory'

/** 记忆索引文件名（记忆目录内）。 */
export const MEMORY_ENTRYPOINT = 'MEMORY.md'

/** AI 选择器默认模型（需求 §4 唯一可配置模型项）。 */
export const DEFAULT_SELECT_MODEL = 'deepseek-chat'

/** AI 选择器默认 provider 路由（GenerateOptions.provider 必填，DeepSeek 官方适配器注册名）。 */
export const DEFAULT_SELECT_PROVIDER = 'deepseek-official'

/** 每次检索扫描的记忆文件上限（按 mtime 新→旧截断）。 */
export const MAX_MEMORY_FILES = 200

/** AI 选择器单次最多选中的记忆数。 */
export const MAX_SELECTED = 5

/** MEMORY.md 注入行数上限。 */
export const MAX_ENTRYPOINT_LINES = 300

/** MEMORY.md 注入字节上限（UTF-8）。 */
export const MAX_ENTRYPOINT_BYTES = 40_000

/** 扫描阶段每个记忆文件只读的前置行数（frontmatter 足够）。 */
export const FRONTMATTER_MAX_LINES = 30

/** 扫描阶段单文件前置读取的字节上限（防止无换行的超长首行）。 */
export const FRONTMATTER_MAX_BYTES = 8192

/** MEMORY.md 索引单行长度上限。 */
export const MAX_INDEX_LINE_LENGTH = 150

/** 工具返回/注入时单份记忆正文的字符上限（防止 token 爆炸）。 */
export const MAX_MEMORY_CONTENT_CHARS = 8000

/** AI 选择器 side-query 超时（毫秒）。 */
export const SELECT_TIMEOUT_MS = 15_000

/** AI 选择器输出 token 上限（5 个文件名的 JSON，绰绰有余）。 */
export const SELECT_MAX_TOKENS = 512

/** memory_review 判定"过时"的天数阈值。 */
export const STALE_MEMORY_DAYS = 30

/** 记忆四类型（闭式联合，新类型必须显式扩展此处并同步提示文本）。 */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const

/** 闭式记忆类型。 */
export type MemoryType = (typeof MEMORY_TYPES)[number]

/**
 * 解析 frontmatter 中的 type 字段。
 * 非法值返回 undefined 优雅降级（记忆仍可用，只是清单里不带类型标注）。
 */
export function parseMemoryType(value: unknown): MemoryType | undefined {
  if (typeof value !== 'string') return undefined
  return (MEMORY_TYPES as readonly string[]).includes(value)
    ? value as MemoryType
    : undefined
}

/** 解析后的 frontmatter 数据（字段均可缺省：半损坏的文件仍可被扫描/审查）。 */
export interface MemoryFrontmatter {
  name?: string
  description?: string
  type?: MemoryType
}

/**
 * 解析记忆文件的 frontmatter + 正文。
 * 仅认 `---` 首尾围栏内每行一条 `key: value`；无围栏、空输入按无 frontmatter 处理。
 */
export function parseFrontmatter(text: string): { data: MemoryFrontmatter; body: string } {
  const trimmed = text.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) return { data: {}, body: trimmed }
  const lineBreak = trimmed.indexOf('\n')
  if (lineBreak < 0) return { data: {}, body: trimmed }
  const end = trimmed.indexOf('\n---', lineBreak)
  if (end < 0) return { data: {}, body: trimmed }
  const block = trimmed.slice(lineBreak + 1, end)
  const afterFence = trimmed.slice(end + 4)
  const body = afterFence.startsWith('\n') ? afterFence.slice(1) : afterFence
  const data: MemoryFrontmatter = {}
  for (const line of block.split('\n')) {
    const sep = line.indexOf(':')
    if (sep <= 0) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key === 'name' && value.length > 0) data.name = value
    else if (key === 'description' && value.length > 0) data.description = value
    else if (key === 'type') data.type = parseMemoryType(value)
  }
  return { data, body }
}

/** 按规范序列化一份记忆文件（FR-4 格式）。 */
export function renderMemoryFile(name: string, description: string, type: MemoryType, content: string): string {
  const normalizedContent = content.endsWith('\n') ? content : `${content}\n`
  return `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n${normalizedContent}`
}

/**
 * 校验并规范化记忆名：接受 `user_role` 或 `user_role.md`，返回 `user_role.md`。
 * 语义化小写下划线命名；非法输入（路径分隔符、大写、空、保留名等）抛错。
 */
export function normalizeMemoryName(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('memory name must be a non-empty string')
  }
  const bare = input.endsWith('.md') ? input.slice(0, -3) : input
  if (!/^[a-z][a-z0-9_]*$/.test(bare)) {
    throw new Error(
      `invalid memory name "${input}" (expected lowercase snake_case like "user_role", got "${bare}")`,
    )
  }
  if (bare === 'memory') {
    throw new Error('"memory" is reserved; pick a more specific memory name')
  }
  return `${bare}.md`
}

// ---------------------------------------------------------------------------
// system prompt 提示文本（FR-6）。集中在本模块便于统一审阅与修改。
// ---------------------------------------------------------------------------

/** 四类型定义文本（FR-4）。 */
export const MEMORY_TYPES_TEXT = `## 记忆类型（闭式四类，frontmatter 的 type 字段）

- **user** — 用户是谁：角色、目标、职责、知识水平、长期偏好。用来塑造服务方式，不记录一次性任务。
- **feedback** — 用户的纠正（"不要 X"）与确认（"对，保持 X"）。纠正与成功确认都要记录。正文结构：规则 → \`**Why:**\`（原因）→ \`**How to apply:**\`（何时生效）。
- **project** — 项目动态：决策、约定、截止日期、事故。只记代码推导不出的信息；相对日期必须转为绝对日期（"下周" → 具体日期）。正文结构同 feedback。
- **reference** — 外部系统指针：看板、监控面板、频道、文档站的 URL 与用途。`

/** 不保存清单文本（FR-4）。 */
export const WHAT_NOT_TO_SAVE_TEXT = `## 不要保存为记忆

- 代码模式、架构、文件结构 — 读代码可推导
- git 历史 — \`git log\` 是权威来源
- 调试修复配方 — 修复已落在代码里
- 项目指导文件（AGENTS.md / CLAUDE.md 等）已记录的内容
- 临时任务状态、当前会话的进度
即使被显式要求保存此类清单（如 PR 列表），也要先追问"哪里令人意外"，只把意外的部分存为记忆。`

/** 何时访问记忆文本（FR-6）。 */
export const WHEN_TO_ACCESS_TEXT = `## 何时访问记忆

- 相关或需要时主动用 memory_search 检索；用户明确要求时必须检索。
- 用户说"忽略记忆"时：视为 MEMORY.md 为空 — 不引用、不比较、不检索。
- 记忆是时点观察：与当前代码/状态冲突时，信当前事实，并更新或删除旧记忆。`

/** 保存机制说明文本（形态二：后台自动提取 + 显式指令才手写）。 */
export const SAVE_FLOW_TEXT = `## 记忆如何被保存

- 常规保存由系统在**回合结束后自动提取**完成，你无需主动保存，也不要为"可能有价值"的信息调用 memory_write。
- 仅当用户**显式要求**时才动手：让保存/更新某条记忆用 memory_write，让删除用 memory_forget，要求整理审查用 memory_review。`

// ---------------------------------------------------------------------------
// 注入与提醒的文本模板（FR-2 / FR-3 / FR-5）
// ---------------------------------------------------------------------------

/** 新鲜度警告（>1 天的记忆注入/返回时附带）。 */
export function freshnessWarningText(days: number): string {
  return `该记忆已保存 ${days} 天。记忆是时点观察而非实时状态 — 其中关于代码行为或 file:line 的引用可能已过期，作为事实断言前请先与当前代码核对。`
}

// ---------------------------------------------------------------------------
// system prompt 记忆指导段（FR-6 全文）
// ---------------------------------------------------------------------------

/**
 * 组装"记忆指导"system prompt 段。
 * @param memoryIndex - 截断后的 MEMORY.md 内容；undefined/空 表示目录尚无内容，不注入索引部分。
 */
export function memoryGuideSectionText(memoryIndex: string | undefined): string {
  const parts = [
    `# 持久记忆系统

你有跨会话持久记忆，存放于项目根 \`.dsh/memory/\` 目录（随 git 跟踪，团队共享）。目录已存在，直接写文件即可，不要 mkdir 或检查存在性。当前为 private 个人作用域（team 跨用户同步为未来预留，frontmatter 的 scope 字段不实现）。`,
    MEMORY_TYPES_TEXT,
    WHAT_NOT_TO_SAVE_TEXT,
    SAVE_FLOW_TEXT,
    WHEN_TO_ACCESS_TEXT,
    `## 记忆与其他持久化机制的分工

- **Plan** — 当前任务的方案对齐，会话内有效
- **Tasks** — 当前任务的进度跟踪，会话内有效
- **记忆（本系统）** — 只留给未来会话有用的信息；当前任务的工作状态不要写进记忆`,
    `## 信任与漂移

记忆可能过期。使用前与当前状态核对；记忆与当前事实冲突时，信当前事实，并更新或删除旧记忆（memory_write 覆盖、memory_forget 删除）。`,
  ]
  if (memoryIndex !== undefined && memoryIndex.length > 0) {
    parts.push(`## MEMORY.md 索引\n\n${memoryIndex}`)
  }
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// 后台提取（形态二）：常量与提示文本
// ---------------------------------------------------------------------------

/** 提取 side-query 超时（毫秒）。 */
export const EXTRACT_TIMEOUT_MS = 30_000

/** 提取输出 token 上限。 */
export const EXTRACT_MAX_TOKENS = 1024

/** 单次提取最多保存的记忆条数。 */
export const EXTRACT_MAX_PER_PASS = 3

/** 提取转录的总字符上限。 */
export const MAX_EXTRACT_TRANSCRIPT_CHARS = 20_000

/** 转录中单条消息的字符上限。 */
export const MAX_EXTRACT_MESSAGE_CHARS = 1_500

/** 转录中单条工具调用参数的字符上限。 */
export const MAX_EXTRACT_TOOL_ARGS_CHARS = 200

/** 回合末提取的 system prompt（FR-4 规则在此执行）。 */
export const EXTRACT_SYSTEM_PROMPT = `你在为 AI agent 的持久记忆库做回合末提取。你会拿到一段回合转录（用户消息、助手回复、工具调用）和一份现有记忆清单（文件名 + 描述）。

判断这段对话里是否出现了值得跨会话记住的信息。规则：
- 四类型：user（用户画像、偏好、知识水平）、feedback（用户的纠正与确认；正文结构：规则 → **Why:** → **How to apply:**）、project（决策、约定、截止日期；相对日期必须转成绝对日期）、reference（外部系统指针及用途）。
- 不保存：代码模式/架构/文件结构（读代码可推导）、git 历史、调试修复配方、临时任务状态、普通问答与执行过程本身。
- 现有清单里已有同等信息的不重复输出；信息有实质更新时才输出（name 用原文件名）。
- 宁缺毋滥：没有值得存的就返回空数组，这是最常见的结果。最多 3 条。

只输出一个严格 JSON 对象：{"memories":[{"name":"小写下划线名","type":"user|feedback|project|reference","description":"一行描述","content":"Markdown 正文"}]}，不要输出任何其他文字。`
