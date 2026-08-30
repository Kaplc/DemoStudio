# DSH 数据飞轮实施计划（三层数据飞轮：知识 / 反馈 / 行为）

> 状态：已实施（2026-08-30 落地，验证清单中自动化工序全绿，手动用例见测试文档执行记录）
> 目标：在现有 DSH 插件体系上落地项目级 Agent 数据飞轮的前三层，不训练模型，全部走 记忆/检索/提案/轨迹 通道。
> 相关文档：[`dsh_data_flywheel_test_cases.md`](./dsh_data_flywheel_test_cases.md)（配套测试用例集）、[`dsh_plugin_install.md`](./dsh_plugin_install.md)（插件挂载机制）、[`dsh_instructions_prd_revised.md`](./dsh_instructions_prd_revised.md)

## 0. 调研结论（计划的事实依据）

- `ctx.sessionQuery` 服务（`@deepseek-ai/dsh-session-query`，sqlite 实现已装）在内核**常驻挂载**；base bundle 把 `session-query-sqlite` 行写死为 `path: ':memory:'` + `openAt: never`——这只关闭全文搜索（报 `SESSION_QUERY_SEARCH_DISABLED`），精确读/trace/lineage 仍可用。官方注释明确：部署方在 profile patch 里覆写 `openAt: first-search` + 持久 `path` 即可启用（patch 是整行 config 替换，path/openAt 两键都要写全）。
- 官方模型侧工具包 `@deepseek-ai/dsh-tool-session-query`（session_search 等 5 工具）在 npm rc.2 内核里**不存在**（dsh-base 不依赖、node_modules 无此包；决策记录见 `harness/dsh-source/.agents/notes/implemented/feature/2026-08-02-session-search-not-shipped-default.md`）。因此历史检索工具在 ds-experience 内自行包装 `ctx.sessionQuery`，不依赖该包。
- `searchSessions` 支持 `sessionFilters: [{ kind: 'cwd', values: [...] }]`，可按工作区隔离（只搜本项目会话）。
- 反馈飞轮**独立为 ds-feedback 插件**（ds-instructions 是用户手工维护目录指令的通道，不复用、互不接触）：规则库放 `.dsh/rules/`；规则数量少、单条小，采用常驻 systemPrompt 段注入（text 每步重算），apply 后当前会话立即生效，无需读取触发。
- ds-memory 热通道约束：recall 每条用户消息重检索注入；记忆库无自动清理、检索视野 200 条截断。**经验轨迹绝不能进 memory**，必须走独立冷通道。
- systemPrompt section order：内核自带段止于 2900，ds-memory=3200、ds-instructions=3300；ds-experience 指导段取 3000、ds-feedback 规则段取 3100。
- 现有经验/复盘功能为空白地，无重复建设风险。

## 1. 知识飞轮：ds-memory 提示词结构化（无代码行为变更）

文件：`harness/ds-memory/src/memoryTypes.ts`

1. `WHAT_NOT_TO_SAVE_TEXT`：现条目「调试修复配方 — 修复已落在代码里」与踩坑飞轮矛盾。改为：**一次性**修复过程不存，可复用的根因教训要存。
2. `MEMORY_TYPES_TEXT`（feedback/project 条目）：**格式以"条"为单位**——文件只是路由容器，
   每条记忆都必须是完整规范格式：踩坑/教训类每条固定四段（粗体标签）
   `**Problem:** / **Cause:** / **Solution:** / **Applicable:**`（Applicable 写适用子系统/文件范围，供 AI 选择器路由）；
   普通纠正/约定条目沿用既有"规则 → **Why:** → **How to apply:**"三段式。
   容器规则（写进 guide 文本）：① 一份文件 = 一个主题 + 一种条目格式——name/description/type 都是文件级，
   检索按整文件注入，混主题/混格式会破坏选择器路由、review 去重与更新语义；
   ② 单条文件正文直接四行，多条文件每条一个 `## 短名` 小节（`##` 数量即条数，便于将来按条解析/统计/抽 skill），
   description 须覆盖全部条目；③ 禁止一份文件混不同主题、类型或格式。
3. `EXTRACT_SYSTEM_PROMPT`：后台提取提示同步要求该结构。
4. `npm run build` 后 web profile 热重载生效（headless 需重启）。

## 2. 反馈飞轮：新插件 ds-feedback（规则提案/应用）

独立插件（骨架照 ds-memory 模板：package.json 依赖钉 0.1.1-rc.2 / tsconfig / vitest.config.ts / cordis.patch.yml 占位 / install.ps1），与 ds-instructions 完全解耦。

- `inject = ['tools', 'systemPrompt']`
- 规则目录：`<root>/.dsh/rules/`（patch 里 `ruleDir` 钉 `E:/DemoStudio/.dsh/rules`）；active 规则 `*.md` + `RULES.md` 索引，`pending/` 子目录存待确认提案
- 工具（defineTool，照 ds-memory tools.ts 规范）：
  - `rule_propose {name, content, reason}`：写入 `pending/<name>.proposed.md`（frontmatter：name/reason/date）；结果文本提示模型向用户转述待确认（提案-确认制，不静默落盘）
  - `rule_apply {proposal, mode?}`：pending → active `<ruleDir>/<name>.md`；同名规则已存在且未显式 `mode: 'overwrite' | 'append'` 时报错（append 追加带日期小节）；成功后删提案并同步索引
- 注入机制：常驻 systemPrompt 段 `feedback:rules`（order 3100，text 为同步函数每步重算）——沉淀指引（段首）+ active 规则全量列出 + RULES.md 索引（行数/字节上限截断），**apply 后当前会话立即生效**，无需读取触发
- 晋升指引（写在段文本里）：用户明说"记住/以后都这样/沉淀为规则"→ 先口头确认再 rule_propose；用户显式纠正且可泛化也可提案；一次性偏好不提案
- **回合末自动检测（2026-08-31 补，`extractProposal.ts`）**：依赖主模型自觉调 rule_propose 被证伪（落地首日经验库自动落 5 条 episode、规则库 0 提案），改为复刻 ds-experience 回合末骨架——agent 空闲防抖 3s → 客户端纠正关键词预筛（`CORRECTION_HINT_PATTERN`，只测 `[用户] ` 行；未命中零成本推进水位）→ 命中才发 side-query 小模型双条件判定（① 存在用户人工纠正；② 该纠正为此类任务正确完成的必要条件——不遵守就会做错/返工，一次性偏好不算）→ 双条件成立写 `pending/<name>.proposed.md` 并注入 notice（转述+等确认，绝不自动 apply）。提案-确认制不变，自动化只填 pending。判定模型 deepseek-chat/deepseek-official（config `extractModel`/`extractProvider` 可覆盖，`autoDetect: false` 关闭）；独立水位，子 agent 跳过，失败下次空闲重试。转录用本插件自持 `renderTurnTranscript` 副本（ds-memory/ds-experience/ds-feedback 三份同语义副本，插件间零依赖）。新增依赖 dsh-llm/dsh-timeout/dsh-session/dsh-agent；12 项新单测，总 32 全绿
- vitest：非法 name 拒绝 / propose→apply 全流程 / 同名无 mode 报错 / pending 不出现在规则段 / 预筛不发散/不漏判 / 双条件判定全分支 / 水位增量

## 3. 行为飞轮

### A. 启用内核持久会话索引（profile patch）

`~/.dsh/profiles/web/cordis.patch.yml`（headless 同步一份）追加：

```yaml
- id: session-query-sqlite
  config:
    path: '<home>/.dsh/session-query/index.sqlite'   # 写实际绝对路径
    openAt: first-search
```

- 索引放 home：派生数据不进 git，丢失自动重建；`first-search` 首次搜索才建库。

### B. 新插件 `harness/ds-experience`

骨架照 ds-memory 模板：package.json（依赖钉 0.1.1-rc.2）/ tsconfig / vitest.config.ts / cordis.patch.yml 占位 / install.ps1。

- `inject = ['tools', 'systemPrompt', 'llm', 'sessionQuery']`
- 经验目录：`<root>/.dsh/experience`（patch 里 `experienceDir` 钉 `E:/DemoStudio/.dsh/experience`，同 memoryDir 的 cwd 不可靠理由）
- 工具（defineTool，照 ds-memory tools.ts 规范）：
  1. `history_search {query, limit?}` — `ctx.sessionQuery.searchSessions({query, sessionFilters:[{kind:'cwd', values:[当前会话 cwd]}], limit})`，返回每会话最强命中（id/日期/标题/命中摘要）；
  2. `history_read {session_id, max_chars?}` — `readSession` 后按 ds-memory `renderTurnTranscript` 同规则渲染成任务转录（用户消息+助手文本+工具调用）；
  3. `experience_save {name, task_type, outcome, summary, lessons, effective_path?}` — episode 落盘 + INDEX.md 索引（frontmatter：task_type/outcome/date）；
  4. `experience_search {query}` — AI 选择器（复刻 selectMemories.ts 模式）按需检索，最多 3 条。
- 回合末自动提炼（形态二同款骨架，独立水位）：`agent/status` 空闲防抖 3s → side-query 判断本回合是否构成一次任务（有工具调用），是则提炼 1 条 episode 落盘；仅覆盖已有 episode 时发 notice；子 agent 跳过；失败静默下次重试。代价：每次空闲多一次小模型 side-query。
- systemPrompt 段 `experience:guide`（order 3000）：
  - 接到可能与过往工作重复的改动类任务 → 先 `history_search`；
  - 疑似有相似经验 → `experience_search`；
  - 分工声明：**记忆=事实与规则（热通道自动注入），经验=做事轨迹（冷通道按需检索），禁止把经验轨迹写进 memory_write**。
- 挂载：junction（web+headless，PowerShell `New-Item -ItemType Junction`）+ 两个 profile 的 patch insert 行。

## 4. 实施顺序

1. ds-memory 提示词 → build
2. 新插件 ds-feedback → build + vitest + junction + patch 行
3. patch 启用 sqlite 索引
4. 新插件 ds-experience → build + vitest + junction + patch 行
5. 验证

## 5. 验证清单

- `dsh web --dump-config | grep` 确认三个新行（session-query-sqlite 覆盖、ds-feedback、ds-experience）
- 新会话确认 6 个新工具在册（rule_propose / rule_apply / history_search / history_read / experience_save / experience_search）
- 跑一个带工具调用的小任务 → 空闲后 `.dsh/experience/` 落盘一条 episode
- `history_search` 能命中历史会话
- `rule_propose` → apply 后确认 system prompt 规则段出现新规则（当前会话即生效，无需重启）

## 6. 坑位提醒（历史踩坑，均已在调研中确认）

| 坑 | 对策 |
|----|------|
| patch 是整行 config 替换 | 覆盖 session-query-sqlite 时写全 path/openAt |
| junction 用 Git Bash mklink 会挂 | PowerShell `New-Item -ItemType Junction` |
| schemastery 把缺省字段填成空数组 | 工具参数不设默认数组；mappings 空数组视为未配置的逻辑已有 |
| 规则与目录指令两套体系混淆 | 分工固定：手工规范进 `.dsh/instructions`（ds-instructions），用户纠正沉淀进 `.dsh/rules`（ds-feedback），互不读写 |
| headless 无热重载 | 改动后重启 headless 内核 |
| 编辑器以 harness/dsh-source 为 cwd 拉内核 | experienceDir/projectRoot 用绝对路径钉住 |
| 经验塞进 ds-memory 会淹掉 200 条检索视野 | 记忆/经验双通道严格分离（热注入 vs 冷检索） |

## 7. 后续（本期不做）

- 策略飞轮：等 ds-experience 攒 episode 后做聚合统计（哪类任务哪步易失败、何种计划成功率高）。**晋升阈值定案（2026-08-31）**：同型 `task_type` ≥3~5 次命中 → 产出 skill 或 rule 提案（走 ds-feedback 确认制，绝不生成可执行函数挂载——安全等价物是人可审的 Markdown 指令）。按 episode 积累速度预计约 2026-10-31 具备聚合条件。
- 跨项目晋升：反复命中的 episode → 抽象成 skill（`.zcode/skills/skl-*` 同构机制）。
- AiBrain 对接：`.dsh/experience/` 即 Experience 层数据源，格式保持中立 Markdown+frontmatter，双端可共读。

### 7.1 已对照并否决的外部方案（2026-08-31，"专机专用三飞轮"）

- **否决**：成功轨迹自动压缩成可执行函数挂载工具库（无测试、随代码库漂移、静默错；且本仓库是编辑型工作，重复的是决策套路非 API 调用序列）。
- **否决**：错误轨迹编译成前置校验代码插工具链（无常驻外部工具链可插；常驻规则段 order 3100 即工具链最前端）。
- **否决**：schema diff 每周自动重写 System Prompt（本仓库 schema 变更者即用户本人且过 git；自动重写会与 instructions/doc 打架）。
- **否决**：三张 SQLite 表存储（Markdown+frontmatter 可 git、可人审、AiBrain 双端共读，session-query sqlite 只作派生索引）。
- **吸收**："第 N 次命中触发晋升"的阈值思想 → 策略飞轮 ≥3~5 次定案；"绝不自动上线"铁律 → 与提案-确认制/notice 一致。
