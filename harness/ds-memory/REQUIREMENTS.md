# DSH 记忆系统插件需求文档

> 项目：`@demostudio/ds-memory`（`E:\DemoStudio\harness\ds-memory\`）
> 日期：2026-08-30
> 参考：GitHub Copilot Chat（`E:\Project\vscode-copilot-chat\`）+ LearnSystem/Claude Code（`E:\Project\LearnSystem\src\memdir\`）

---

## 1. 需求背景与目标

- **为什么做**：DSH（DeepSeek Harness，位于 `E:\DemoStudio\harness\dsh-source`）目前没有记忆子系统。DemoStudio 游戏项目使用 dsh agent 辅助开发，但 agent 无法跨会话记住用户偏好、项目决策、开发约定等信息，每轮新会话都要重新交代。参考 GitHub Copilot Chat 与 LearnSystem（Claude Code）两套成熟记忆系统设计，为 dsh 开发一个记忆插件。
- **要达成什么**：开发插件 `@demostudio/ds-memory`，让 dsh agent 具备跨会话持久记忆能力——能显式保存/遗忘/检索/审查记忆，能在回合结束时自动提取值得记住的信息，能在每次请求时自动注入相关记忆。成功标准：会话 A 保存的记忆，在新会话 B 中能被检索注入并正确影响 agent 行为。

## 2. 项目上下文

**项目与技术栈**：
- DSH 是 all-plugin Cordis agent harness（TypeScript/ESM，pnpm workspace）。**必读文档**（执行前先读）：
  - `docs/architecture.md` — 整体架构与包结构
  - `docs/cookbook/extension-cookbook.md` — 插件扩展机制总表（**Memory = section provider + tool**）
  - `docs/cordis-primer.md` — Cordis 插件语义（`ctx.effect`、waterfall、注册即副作用）
  - `docs/capability-seams.md` — 能力缝（Service Definition / Provider / Consumer 三角色）
  - `packages/llm/README.md` — LLM 能力（本插件 AI 选择器要用的 side-query 通道）
  - `packages/context/`、`packages/session/` — 事件与上下文机制
- 参考项目（**设计参考，代码按 dsh 风格重写，不直接搬运**）：
  - `E:\Project\LearnSystem\src\memdir\`（LearnSystem/Claude Code 记忆系统：`memdir.ts`、`memoryTypes.ts`、`memoryAge.ts`、`memoryScan.ts`、`findRelevantMemories.ts`、`paths.ts`、`teamMemPaths.ts`、`teamMemPrompts.ts`）
  - `E:\Project\vscode-copilot-chat\`（Copilot Chat：`src/extension/prompt/common/conversation.ts`、`src/extension/chatSessions/`、`src/platform/embeddings/` 等，参考其分层理念即可）
- 现有插件先例：`E:\DemoStudio\harness\ds-engine-tools`（`@demostudio/ds-engine-tools`，用 `ctx.tools.register` 注册工具）——了解项目插件的注册风格与包结构，但本插件采用正式 import + 类型（见下）。

**需遵循的项目约定**：
- 注册即副作用：所有贡献走 `ctx.effect()` / `ctx.on()`，register 返回 disposer
- ESM 全项目（`"type": "module"`），本地相对导入用 `.ts` 后缀
- 事件用声明合并的 typed events；waterfall 监听器必须调用 `next()` 放行
- "Model-visible ⟺ logged"：注入给模型的内容必须可从 session log 重建
- 插件默认值必须是 cordis.yml `Config` 可配置的或 `DEFAULT_*` 常量，不能硬编码可调参数
- 切换 discriminated tags，闭合联合以 `assertNever` 结尾
- 混配置失败要 loud：加载时自检失败立即报错，不静默跳过

## 3. 功能需求

### FR-1 显式记忆工具（P0）
注册 4 个工具（`ctx.tools.register()`，schema 自动流入装配）：
- `memory_write`：保存一条记忆。入参：`name`（语义化小写下划线文件名，如 `user_role.md`）、`content`、`type`（`user|feedback|project|reference`）、`description`（一行，用于检索相关性判断）、`scope`（默认 `private`，本项目只实现 private，字段预留）。写入前检查同 name 或同 description 的已有记忆，有则更新而非新建（去重）。写完后更新 `MEMORY.md` 索引（追加一行 `- [Title](file.md) — one-line hook`，≤150 字符）。
- `memory_search`：检索记忆。入参：`query`（查询文本）。实现：调用 AI 选择器（见 FR-3）从记忆清单中选出最多 5 个相关记忆文件，返回文件路径 + 内容 + 新鲜度标注。
- `memory_forget`：遗忘。入参：`name` 或 `description` 关键词。找到匹配记忆文件删除，并同步从 `MEMORY.md` 索引移除对应行。
- `memory_review`：审查整理。扫描所有记忆，输出分类报告：过时（建议更新/删除）、重复（建议合并）、与当前事实冲突（建议修正）。只报告提案不直接改，输出给用户审批（可带 `apply: true` 参数直接执行）。

### FR-2 回合末自动提取（P0）
- 常驻指导：通过 `ctx.systemPrompt.section()` 注入"记忆指导"段（内容见 FR-6），主 agent 在回合过程中自觉判断并调用 `memory_write` 保存。
- 回合结束轻量提醒：监听 `agent/turn-stopping`，每回合注入一行短提醒（约 30 token）：「如果本回合出现了值得长期记住的信息（用户偏好/纠正/项目决策/外部系统指针），请用 memory_write 保存；否则忽略」。

### FR-3 AI 选择检索注入（P0）
- 每次请求前：扫描 `.dsh/memory/` 下所有 `.md` 文件（排除 `MEMORY.md`，上限 200 个文件，按 mtime 新→旧排序取前 200），读取 frontmatter 生成清单（`[type] filename (ISO时间): description`）。
- 用 AI 选择器（走 dsh LLM 能力的 side-query，见 §4 实现细节）从清单中选出与当前请求最相关的**最多 5 个**文件，返回文件名数组（JSON schema 约束输出，校验只接受清单内文件名）。
- 通过 `agent.inject()` 将选中文件内容注入到用户消息前，每个文件附带新鲜度标注（见 FR-5）。
- 选择器排除：`MEMORY.md`（已在 system prompt 中）、本会话已注入过的文件（`alreadySurfaced` 集合，避免重复占用 5 个名额）。

### FR-4 记忆分类与格式（P0）
- 闭式四类型：`user` / `feedback` / `project` / `reference`：
  - `user`：用户角色、目标、责任、知识水平（塑造服务方式）
  - `feedback`：用户纠正（"不要 X"）与确认（"对，保持 X"）——纠正与成功确认都要记录；正文结构：规则 → `**Why:**`（原因）→ `**How to apply:**`（何时生效）
  - `project`：项目动态/决策/截止日期/事故，非代码可推导的信息；相对日期转绝对日期保存；正文结构同 feedback
  - `reference`：外部系统指针（看板、监控面板、频道等）
- 每份记忆文件格式：
  ```markdown
  ---
  name: {{记忆名}}
  description: {{一行描述，用于检索相关性判断}}
  type: {{user|feedback|project|reference}}
  ---
  {{内容}}
  ```
- "不保存清单"写入指导：代码模式/架构/文件结构（可读代码推导）、git 历史（git log 权威）、调试修复配方（修复已在代码里）、CLAUDE.md 已记录的内容、临时任务状态。**即使显式要求保存 PR 列表等也要追问"哪里令人意外"**。

### FR-5 新鲜度警告（P1）
- 记忆注入/返回时附带年龄：0 天="today"、1 天="yesterday"、N 天="N days ago"。
- 超过 1 天的记忆附警告文本：「This memory is N days old. Memories are point-in-time observations, not live state — claims about code behavior or file:line citations may be outdated. Verify against current code before asserting as fact.」（中文可译为对应语义）。
- system prompt 的记忆指导中包含漂移提醒：「记忆可能过期，使用前与当前状态核对；记忆与当前事实冲突时信当前、更新或删除旧记忆」。

### FR-6 记忆系统提示（P0）
`ctx.systemPrompt.section()` 注入，包含：
- 记忆目录位置与存在性说明（目录已存在，直接写，不要 mkdir/检查）
- 记忆范围（private 个人作用域说明；team 字段预留但不实现）
- 四类型定义（何时保存/如何使用/正文结构/示例）
- 不保存清单
- 两步保存流程：Step 1 写记忆文件（frontmatter 格式）→ Step 2 更新 `MEMORY.md` 索引（一行 ≤150 字符，索引不是记忆，不要把内容写进索引）
- 何时访问记忆（相关时/用户明确要求时；用户说"忽略记忆"时视为 MEMORY.md 为空，不引用不比较）
- 记忆与其他持久化机制的分工（Plan 用于当前任务的方案对齐、Tasks 用于当前任务进度，记忆只留给未来会话有用的信息）
- `MEMORY.md` 索引内容：**仅在记忆目录存在内容时注入**，注入前做 300 行 / 40KB 截断，截断时附加警告行说明被截断。

## 4. 实现思路与细节（用户已确认，不得更改）

**技术选型**：
- 语言 TypeScript/ESM，包名 `@demostudio/ds-memory`，目录 `E:\DemoStudio\harness\ds-memory\`（独立新包，与 `harness/ds-engine-tools` 平级），`package.json` 中 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` 结构参考 `harness/ds-engine-tools/package.json`。
- **正式 import + 类型依赖**：直接依赖 `@deepseek-ai/dsh` 相关包类型（llm capability、session 事件、systemPrompt、tools API），不用鸭子类型。
- 存储：纯文件系统（Markdown），无数据库。

**数据流**：
```
[写入] memory_write / 主agent自动提取
  → .dsh/memory/<name>.md（frontmatter + 内容）
  → MEMORY.md 索引追加一行
[检索] 每次 agent/request 前
  → scanMemoryFiles() 扫描 frontmatter 清单（≤200 个）
  → AI 选择器（dsh LLM side-query，最多选 5）
  → agent.inject() 注入选中文件内容 + 新鲜度标注
[遗忘] memory_forget → 删文件 + 删索引行
[审查] memory_review → 扫描报告/去重/更新提案
```

**关键结构**（参考 LearnSystem 但按 dsh 风格重写）：
- `src/memoryTypes.ts` — 四类型定义、frontmatter 解析（`parseMemoryType`，非法值返回 undefined 优雅降级）、提示段文本（TYPES/WHAT_NOT_TO_SAVE/WHEN_TO_ACCESS/TRUSTING_RECALL）
- `src/memoryAge.ts` — `memoryAgeDays`/`memoryAge`/`memoryFreshnessText`（纯函数，可参考 LearnSystem 实现）
- `src/memoryScan.ts` — 扫描目录读 frontmatter 生成清单（`readdir` recursive + 每文件只读前 30 行）、`formatMemoryManifest` 清单格式化、300 行/40KB 截断
- `src/memoryStore.ts` — 写入/更新/删除文件与索引、去重检查（同 name 或同 description）
- `src/selectMemories.ts` — AI 选择器（走 dsh llm capability 发起 side-query，`output_format: json_schema` 约束输出 `{selected_memories: string[]}`，校验只接受清单内文件名；失败/中止时返回空数组并 warn 日志）
- `src/paths.ts` — 记忆目录解析（项目根 + `.dsh/memory/`）、路径校验
- `src/security.ts` — 完整路径安全防护：拒绝 null 字节、URL 编码穿越（`%2e%2e%2f`）、Unicode 规范化攻击（NFKC 全角 `．．／`）、反斜杠、绝对路径；写文件前对最深存在祖先做 `realpath` 检查防符号链接逃逸（参考 LearnSystem `realpathDeepestExisting` 与 `sanitizePathKey`）
- `src/tools.ts` — 4 个工具的 schema 与 execute 实现
- `src/index.ts` — 插件入口：`ctx.effect()` 内注册 section、工具、事件监听

**事件接入**：
- `agent/turn-stopping`：每回合注入轻量提取提醒（约 30 token，一行）
- `agent/request`（或等价前置事件）：注入相关记忆（FR-3）
- `turn/end`：可选用作兜底记录（如延迟索引更新），不阻塞主流程

**配置**（cordis.yml `config`）：
- `enabled: boolean`（默认 true）——唯一可配置项，关闭时所有 section/工具/事件/注入全部不生效
- `selectModel: string`（默认 `'deepseek-chat'`）——AI 选择器模型，代码内 `DEFAULT_SELECT_MODEL` 常量
- 其余为代码内常量：记忆目录 `.dsh/memory/`（相对项目根）、`MAX_MEMORY_FILES=200`、`MAX_SELECTED=5`、`MAX_ENTRYPOINT_LINES=300`、`MAX_ENTRYPOINT_BYTES=40_000`、`FRONTMATTER_MAX_LINES=30`、`MAX_INDEX_LINE_LENGTH=150`

**实现顺序**（依赖关系）：
1. 包脚手架（package.json/tsconfig/cordis.patch.yml 空数组占位）
2. `memoryTypes.ts` + `memoryAge.ts` + `paths.ts` + `security.ts`（纯函数，可独立单测）
3. `memoryStore.ts` + `memoryScan.ts`（存储与索引）
4. `selectMemories.ts`（AI 选择器，走 dsh llm capability——先读 `packages/llm/README.md` 与 `docs/capability-seams.md` 确认 service consumer 用法）
5. `tools.ts`（4 工具）+ `index.ts`（section/事件/装配）

## 5. 非功能需求

- **成本**：AI 选择器每次请求仅一次小模型调用（`deepseek-chat` 档）；回合提醒 ≤30 token/回合；索引注入有 300 行/40KB 硬上限
- **性能**：扫描 frontmatter 单趟（read-then-sort 而非 stat-sort-read）；注入的 5 个文件内容限长，避免 token 爆炸
- **可维护性**：纯函数独立成模块（可单测）；提示文本集中在 `memoryTypes.ts` 常量数组
- **安全**：路径校验是安全红线（FR：完整防护），任何文件名/路径输入都过校验层
- **兼容性**：不修改 dsh `agent-loop` 内核；所有行为走文档化扩展点；`cordis.yml` 留空数组占位即可，插件通过代码注册（参考 `harness/ds-plugin/cordis.patch.yml` 注释说明）

## 6. 约束与禁忌

- 禁止修改 `E:\DemoStudio\harness\dsh-source` 下任何源码（dsh 内核不动，插件化扩展）
- 禁止直接复制 LearnSystem/Copilot Chat 的代码文件——只允许参考设计理念与 prompt 文本（用户已确认"参考但重写"），代码按 dsh 风格与约定重写
- 记忆目录必须在项目根 `.dsh/memory/`，**随 git 跟踪**（不要加 .gitignore），这是用户明确决策
- 不做 `Embeddings`/向量/`TF-IDF` 语义检索（AI 选择器已覆盖检索能力）
- 注入给模型的任何内容必须符合 dsh "Model-visible ⟺ logged" 约定
- 工具 schema 必须完整（`input.schema` + `output.schema`/render），参考 `docs/cookbook/adding-a-tool.md`

## 7. 边界与不做范围

明确不做：
- Embeddings / TF-IDF / 向量语义检索
- 团队记忆（team memory）与跨用户同步（`scope: team` 字段仅预留）
- 会话内记忆（session memory，压缩交现有 compaction 能力）
- Claude Code hooks 桥接
- GUI/UI（纯 CLI 插件，工具 + system prompt 即可）
- 记忆自动过期/清理（只靠 memory_review 人工审查）

## 8. 验收标准（可勾选）

- [ ] **单测**：vitest 覆盖——frontmatter 解析（含非法 type 降级）、memoryAge 边界（今天/昨天/N 天/未来时钟钳制）、截断逻辑（300 行、40KB、行+字节双触发）、去重（同 name/同 description）、安全校验（null 字节/URL 穿越/Unicode 攻击/反斜杠/绝对路径/符号链接逃逸 各拒绝用例）
- [ ] **跨会话召回 e2e**：会话 A 中 `memory_write` 保存"用户偏好：回复要简洁，不总结 diff"（type=feedback）→ 结束会话 → 新会话 B 发送与偏好相关的请求 → 验证注入命中该记忆且影响 agent 行为（或至少能在 `memory_search` 召回）
- [ ] **手动验证**：在 DemoStudio 项目实际运行 dsh（`pnpm dsh --profile ...`），验证 4 工具可用、索引随写随更新、`enabled: false` 时全部静默
- [ ] **lint/typecheck 通过**：`pnpm run typecheck`、`pnpm run lint`（在 harness/ds-memory 包内）
- [ ] 记忆文件与 `MEMORY.md` 格式符合 §FR-4 规范，目录内无脏数据

## 9. 失败处理

- dsh API 用法不确定时：先读 `docs/architecture.md`、`docs/capability-seams.md`、`packages/llm/README.md`、`docs/cookbook/extension-cookbook.md` 及对应包源码，再实现；仍不确定的在交付说明中列出待确认点
- AI 选择器调用失败/超时：静默返回空数组（不注入记忆），warn 日志，不阻塞主对话
- 遇到无法实现的子项：明确报告"未实现 X + 原因 + 建议替代方案"，不静默阉割功能

## 10. 交互方式

执行过程中如遇需求文档未覆盖的决策点，可自行按文档原则判断并记录；涉及范围变更（新增功能/改变已确认决策）必须停下来询问用户。默认基于本文档自行决策推进。

---

## 核心决策摘要

1. **独立插件包** `@demostudio/ds-memory`（`harness/ds-memory/`），正式 import dsh 类型，不改 dsh 内核
2. **LearnSystem 文件结构 + Copilot 分层理念融合**：`.dsh/memory/`（git 跟踪）+ `MEMORY.md` 索引（300 行/40KB 截断）+ 四类型 frontmatter + 新鲜度警告
3. **AI 选择检索**：dsh LLM side-query（`deepseek-chat`，可配）从清单选最多 5 个文件，`agent.inject()` 到用户消息
4. **自动提取**：system prompt 常驻记忆指导 + `agent/turn-stopping` 每回合轻量提醒，主 agent 自己写（无后台 subagent）
5. **4 工具**：`memory_write/search/forget/review`；只做 `enabled` 开关配置；完整路径安全防护；不做 Embeddings/团队/会话内记忆/hooks/GUI

---

## 决策变更记录

- **2026-09-01 写入路径回归第 4 条原案（主 agent 主动写）**：实现期曾引入"形态二"后台提取（`agent/status` 空闲防抖 → side-query 判读转录 → 插件直接落盘），已整体移除（`extractMemories.ts`、`notifySaved`、水位/防抖状态机、`extractModel`/`extractProvider` 配置）。理由：主 agent 是唯一看到完整上下文（含工具结果）的一方，转录渲染的重截断损害保存质量；后台提取依赖空闲窗口（会话中断即丢）；每回合一次 side-query 是纯增成本。保存指导改为 `SAVE_FLOW_TEXT` 触发点绑定（纠正/决策/踩坑根因/用户画像/外部指针 → 当回合立即 `memory_write`）。`agent/turn-stopping` 轻量提醒不采用——回合收尾注入的消息只能影响下一回合，对"本回合记得保存"无效。
- **2026-09-01 子 agent 边界收紧**：`memory_write` / `memory_forget` / `memory_review(apply=true)` 在工具 execute 层拒绝子 agent（`delegationDepth > 0`）调用——委托上下文归属父 agent，由父决定是否保存；`memory_search` 只读，子 agent 仍可用。
