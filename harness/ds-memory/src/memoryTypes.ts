/**
 * DSH 记忆系统：四类型定义、frontmatter 解析、文件名校验与全部可调常量。
 *
 * @module memoryTypes
 */

/** 记忆插件在 Cordis/DSH 中的注册名。 */
export const PLUGIN_NAME = '@demostudio/ds-memory'

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
  /**
   * 联想前缀表达式（可选）：项目根相对路径前缀，支持 `||`（任一命中）与
   * `&&`（会话内全部读过才触发）组合多路径（如 `src/engine || doc/engine`）。
   * 会话中 Agent 读到满足表达式的文件时，本条记忆全文会被自动注入（每会话一次）。
   */
  prefix?: string
}

/**
 * 解析 prefix 表达式为 DNF（OR 组的列表，每组是 AND 项列表）：
 * - `src/engine` → `[['src/engine']]`（单项单组，等同旧单前缀语义）
 * - `a || b` → `[['a'], ['b']]`（任一命中触发）
 * - `a && b` → `[['a', 'b']]`（会话中全部读过才触发，可跨多次读取累计）
 * - `a && b || c` → `[['a', 'b'], ['c']]`（`&&` 优先级高于 `||`，与代码一致）
 * 空项/空组被丢弃；全部为空返回 undefined（视为未声明，不参与联想）。
 */
export function parsePrefixExpr(expr: string): string[][] | undefined {
  const normalized = expr.trim()
  if (normalized.length === 0) return undefined
  const groups = normalized
    .split('||')
    .map(group => group.split('&&').map(term => term.trim()).filter(term => term.length > 0))
    .filter(group => group.length > 0)
  return groups.length === 0 ? undefined : groups
}

/**
 * 解析记忆文件的 frontmatter + 正文。
 * 仅认 `---` 首尾围栏内每行一条 `key: value`；无围栏、空输入按无 frontmatter 处理。
 * prefix 值支持代码风格逻辑运算符组合多路径（`a || b` / `a && b`，见 parsePrefixExpr）。
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
    else if (key === 'prefix') {
      const prefix = unquoteFrontmatterValue(value)
      if (prefix.length > 0) data.prefix = prefix
    }
  }
  return { data, body }
}

/** 去掉 frontmatter 值两侧的成对引号（支持 `prefix: 'src/engine'` 写法）。 */
function unquoteFrontmatterValue(value: string): string {
  if (value.length >= 2) {
    const head = value[0]!
    const tail = value[value.length - 1]!
    if ((head === "'" && tail === "'") || (head === '"' && tail === '"')) {
      return value.slice(1, -1)
    }
  }
  return value
}

/** 按规范序列化一份记忆文件（FR-4 格式）。prefix 为可选联想前缀，缺省不写该行。 */
export function renderMemoryFile(
  name: string,
  description: string,
  type: MemoryType,
  content: string,
  prefix?: string,
): string {
  const normalizedContent = content.endsWith('\n') ? content : `${content}\n`
  const prefixLine = prefix !== undefined && prefix.trim() !== '' ? `prefix: ${prefix.trim()}\n` : ''
  return `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n${prefixLine}---\n${normalizedContent}`
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
- **feedback** — 用户的纠正（"不要 X"）与确认（"对，保持 X"）。纠正与成功确认都要记录。
- **project** — 项目动态：决策、约定、截止日期、事故、踩坑。只记代码推导不出的信息；相对日期必须转为绝对日期（"下周" → 具体日期）。
- **reference** — 外部系统指针：看板、监控面板、频道、文档站的 URL 与用途。

条目正文格式见下方"记忆条目格式"。`

/** 记忆条目格式文本：格式以"条"为单位，文件只是路由容器（踩坑飞轮结构化）。 */
export const MEMORY_ENTRY_FORMAT_TEXT = `## 记忆条目格式（以"条"为单位）

文件只是路由容器：name/description/type 都是**文件级**字段，检索按整文件注入。因此**每一条**记忆都必须是完整规范格式：

- **踩坑/教训类条目**固定四段（粗体标签）：
  \`**Problem:**\` 现象 → \`**Cause:**\` 根因 → \`**Solution:**\` 解法 → \`**Applicable:**\` 适用子系统/文件范围（供 AI 选择器路由）。
- **普通纠正/约定条目**沿用三段式：规则 → \`**Why:**\`（原因）→ \`**How to apply:**\`（何时生效）。

### 文件容器规则

1. **一份文件 = 一个主题 + 一种条目格式**——混主题/混格式会破坏选择器路由、review 去重与更新语义。
2. 单条文件正文直接写条目（四行或三行）；多条文件每条一个 \`## 短名\` 小节（\`##\` 数量即条数，便于将来按条解析/统计/抽 skill），description 必须覆盖全部条目。
3. 禁止一份文件混不同主题、类型或格式。`

/** 不保存清单文本（FR-4）。 */
export const WHAT_NOT_TO_SAVE_TEXT = `## 不要保存为记忆

- 代码模式、架构、文件结构 — 读代码可推导
- git 历史 — \`git log\` 是权威来源
- 一次性的修复过程流水账 — 修复已落在代码里；但可复用的根因教训（环境坑、易错点、反模式）要按踩坑四段格式存
- 项目指导文件（AGENTS.md / CLAUDE.md 等）已记录的内容
- 临时任务状态、当前会话的进度
即使被显式要求保存此类清单（如 PR 列表），也要先追问"哪里令人意外"，只把意外的部分存为记忆。`

/** 何时访问记忆文本（FR-6）。 */
export const WHEN_TO_ACCESS_TEXT = `## 何时访问记忆

- 相关或需要时主动用 memory_search 检索；用户明确要求时必须检索。
- 用户说"忽略记忆"时：视为 MEMORY.md 为空 — 不引用、不比较、不检索。
- 记忆是时点观察：与当前代码/状态冲突时，信当前事实，并更新或删除旧记忆。`

/** 保存机制说明文本（主 agent 主动写：触发点绑定，防漏存与滥存）。 */
export const SAVE_FLOW_TEXT = `## 记忆如何被保存

你自己负责保存记忆——回合过程中出现以下触发点时，**当回合立即**调用 memory_write，不要期待有后台系统替你提取：
- 用户纠正了你的做法，或明确确认了某个方向（feedback；纠正与确认都要存）
- 做出了架构/设计/工作流决策，或敲定了带日期的约定（project；相对日期转绝对日期）
- 定位到可复用的根因教训：环境坑、易错点、反模式（project；踩坑四段格式）
- 了解到用户的角色、长期偏好、工作习惯（user）
- 拿到看板/监控/文档站等外部系统指针（reference）

memory_write **不直接落盘**：它做参数校验与查重后返回写入指引，你按指引手动完成三步——① 用 write/edit 写记忆文件（frontmatter + 条目格式）② 同步 MEMORY.md 索引行 ③ 按指引全库检查过时记忆并顺便更新/清理。三步做完才算保存完成。

没有触发点就不要保存——宁缺毋滥，普通问答、实现细节和过程流水账不存（见上方"不要保存"清单）。用户显式要求时照办：删除用 memory_forget，整理审查用 memory_review。`

/** 回合末记忆提醒文本（新增机制）。 */
export const END_OF_TURN_REMINDER_TEXT = `## 回合末记忆检查

每回合结束前，快速回顾本回合是否有值得跨会话记住的信息。如果有，立即调用 memory_write 保存。常见触发点：
- 用户纠正或确认了某个方向
- 做出了架构/设计/工作流决策
- 定位到可复用的根因教训
- 了解到用户的角色/偏好/工作习惯
- 拿到外部系统指针（看板/文档站 URL）

如果没有触发点，不要保存。宁缺毋滥。`

/** prefix 自动联想说明文本：声明 prefix 的记忆命中后全文自动加载，正文必须精炼。 */
export const ASSOCIATE_LOAD_TEXT = `## prefix 自动联想（命中即自动加载全文）

- 记忆文件 frontmatter 可加一行 \`prefix:\` 声明适用路径前缀（如 \`src/engine\`、\`harness\`）。会话中 Agent 读到该前缀下的文件时，本条记忆**全文会被自动注入**上下文（同一会话内同一条只注入一次），无需手动检索。
- 支持代码风格逻辑运算符组合多文件/多目录：
  - \`prefix: src/engine || doc/engine\` — **OR**：任一路径命中即触发；
  - \`prefix: src/engine && doc/editor\` — **AND**：这些前缀在会话中**全部**被读过才触发（可跨多次读取累计，顺序不限）；
  - 混用时 \`&&\` 优先级高于 \`||\`（\`a && b || c\` = (a且b) 或 c），与代码语义一致。
- \`prefix: /\` = 全局：读取任意文件都触发；**未声明 prefix 的记忆不会被自动加载**，只走 memory_search 按需检索。
- ⚠️ 自动全文加载意味着正文会整篇进入上下文：声明 prefix 的记忆**必须最精炼**——只保留不可推导的核心事实（踩坑四段 / 规则三段 / 指针 URL），不要背景介绍、过程流水账或读代码可推导的内容。
- prefix 是段级前缀匹配（\`src/engine\` 不命中 \`src/engine2\`），路径相对项目根；\`memory_write\` 的 \`prefix\` 参数可选，不带则只写不联想。`

// ---------------------------------------------------------------------------
// memory_write 手动落盘指引（工具只校验+查重，返回本提示词由 agent 手动写文件）
// ---------------------------------------------------------------------------

/** memory_write 手动落盘指引的组装输入。 */
export interface ManualWritePromptInput {
  /** 目标记忆文件绝对路径（已按查重结果定稿）。 */
  filePath: string
  /** create=新建；update-by-name/update-by-description=命中已有记忆，应更新而非新建。 */
  mode: 'create' | 'update-by-name' | 'update-by-description'
  /** 命中的已有记忆文件名（mode 非 create 时存在）。 */
  existingFile?: string
  /** 记忆类型（已校验的合法值）。 */
  type: string
  /** 本次声明的联想前缀表达式（已校验；声明了就要写进 frontmatter）。 */
  prefix?: string
}

/**
 * 组装 memory_write 的手动落盘指引提示词（纯函数）。
 * 三步缺一不可：写文件 → 同步索引 → 全库过时检查。
 */
export function buildManualWritePrompt(input: ManualWritePromptInput): string {
  const writeStep = input.mode === 'create'
    ? `用 **write** 新建文件 \`${input.filePath}\``
    : `用 **edit** 更新已有文件 \`${input.filePath}\`（按${input.mode === 'update-by-name' ? '同名' : '同描述'}命中 \`${input.existingFile}\`，不要新建重复文件）`
  return [
    '## 记忆写入指引（memory_write 不直接落盘，按本指引手动完成三步）',
    '',
    `**① 写记忆文件**：${writeStep}。frontmatter 必含 name/description/type，可选 prefix（支持代码风格表达式：\`a || b\` 任一路径命中触发、\`a && b\` 会话内全部读过才触发，\`&&\` 优先级高于 \`||\`；\`/\` = 全局。带 prefix 的正文必须精炼——命中即整篇注入）：`,
    '',
    '```',
    '---',
    'name: <小写下划线名>',
    'description: <一行描述>',
    `type: ${input.type}`,
    '---',
    '<正文>',
    '```',
    '',
    '条目格式：踩坑/教训类用四段 **Problem:** → **Cause:** → **Solution:** → **Applicable:**；普通规则/约定用 规则 → **Why:** → **How to apply:**。一份文件一个主题；多条目每条一个 `## 短名` 小节，description 覆盖全部条目。相对日期转绝对日期。',
    ...(input.prefix !== undefined
      ? [`本次声明的 prefix：写进 frontmatter 的 \`prefix: ${input.prefix}\` 行（更新已有记忆时如无变更则保留原行）。`]
      : []),
    '',
    '**② 同步 MEMORY.md 索引**：同名行原位替换 / 新记忆追加到末尾，格式 `- [name](name.md) — 一行钩子（概述）`。',
    '',
    '**③ 全库过时检查（必做）**：写完后通读记忆目录全部记忆，发现与当前事实冲突、含已过期日期、或内容已过时的条目，顺便用 edit 更新或删除（删除时同步移除索引行）。',
    '',
    '⚠️ 只留未来会话有用的信息；代码可推导的内容与一次性流水账不存。',
  ].join('\n')
}

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
    MEMORY_ENTRY_FORMAT_TEXT,
    WHAT_NOT_TO_SAVE_TEXT,
    SAVE_FLOW_TEXT,
    WHEN_TO_ACCESS_TEXT,
    ASSOCIATE_LOAD_TEXT,
    END_OF_TURN_REMINDER_TEXT,
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
