# 数据飞轮测试用例集

> **一句话定位**：配套 [数据飞轮实施计划](./dsh_data_flywheel_plan.md) 的**验证用例集**——用 vitest 单测锁住 ds-memory 提示词结构、ds-feedback 规则提案/预筛、ds-experience 经验落盘与历史检索的行为，再用手动用例验真实内核会话里单测覆盖不到的 LLM 行为与落盘副作用。
>
> **什么时候会用到你**：改完飞轮插件要跑验收、想知道某个编号（KM/RL/EXP…）验证什么、判断某行为该归到哪组、写新用例时对照编号规则。
>
> 代码位置：`harness/ds-memory/tests/`、`harness/ds-feedback/tests/`、`harness/ds-experience/tests/`（单测）；`E:\DemoStudio\.dsh/{memory,rules,experience}/`（手动用例的数据落盘）

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [memoryTypes.test.ts](../../harness/ds-memory/tests/memoryTypes.test.ts) | KM-01：锁住记忆指导段四段格式与「什么不该存」文案 | 改 `memoryTypes.ts` 提示词后必跑 |
| [ruleStore.test.ts](../../harness/ds-feedback/tests/ruleStore.test.ts) | RL-01~10：规则名校验、提案落盘、同名 mode 冲突、索引单行、超限截断 | 改 `ruleStore.ts` 落盘逻辑 |
| [preScreen.test.ts](../../harness/ds-feedback/tests/preScreen.test.ts) | RL-12~13：纠正关键词预筛 + 提示块渲染 | 调关键词或摘录上限 |
| [turnEnd.test.ts](../../harness/ds-feedback/tests/turnEnd.test.ts) | RL-14~16：回合末接线、agent 隔离、子 agent 门控、running 撤销补检 | 改 `index.ts` 空闲监听 |
| [experienceStore.test.ts](../../harness/ds-experience/tests/experienceStore.test.ts) | EXP-01~03：episode 落盘、同名覆盖、非法名拒绝 | 改经验落盘格式 |
| [historyTools.test.ts](../../harness/ds-experience/tests/historyTools.test.ts) | EXP-06~07 + cwd 过滤：报错透出、转录跳过注入 | 改历史检索/转录渲染 |

**关键心智模型**：用例分**单测**（vitest，锁行为，`mkdtemp` 临时目录 + mock `ctx`，不碰真实数据）与**手动**（真实交互式内核会话，验 LLM 行为、事件时序、落盘副作用）。手动用例不是「单测跑绿就算过」。

**本次全量核实后必须知道的一件事**：旧文档的执行记录与实际代码已经脱节——KM-02 全量、EXP-08/09、EXP-10 对照组、EXP-11/12 在当前代码下**无法通过**，详见 §4.3 与 §7。

---

## 2. 环境准备：从干净到可跑

### 2.1 构建与挂载

三个插件的 `package.json` scripts 完全一致（见 [ds-experience/package.json](../../harness/ds-experience/package.json)）：`build`/`typecheck` = `tsc`，`lint` = `oxlint src tests`，`test` = `vitest run`。

> `test` 是单跑一次不是 watch；`lint` 用 **oxlint**，与仓库根缺失的 eslint 无关。

跑用例前先装依赖——**三个插件的 `node_modules` 目前只有 `.vite` 缓存，没有 `@deepseek-ai/*` 依赖包**，直接 `npx vitest run` 会报 `Cannot find package '@deepseek-ai/dsh-llm'`：

```powershell
cd harness/ds-memory     && npm install && npm run build && npm test
cd harness/ds-feedback   && npm install && npm run build && npm test
cd harness/ds-experience && npm install && npm run build && npm test
```

两个插件自带的 [cordis.patch.yml](../../harness/ds-experience/cordis.patch.yml) 是**空数组占位**（全部贡献走代码注册），挂载行要写进 profile patch（详见 [插件安装](./dsh_plugin_install.md)）——`~/.dsh/profiles/{web,headless}/cordis.patch.yml` 追加 `session-query-sqlite` 条目，`config` 里 `path: '<home>/.dsh/session-query/index.sqlite'` 与 `openAt: first-search` **两键都要写全**。

### 2.2 测试数据与隔离

单测**不需要**手工准备数据，每个文件自己造临时目录：`beforeEach` 里 `dir = await mkdtemp(join(tmpdir(), 'ds-feedback-'))`，`afterEach` 里 `await rm(dir, { recursive: true, force: true })`（新写用例照抄这个骨架）。

> 为什么这么写：规则目录/经验目录都是**真实磁盘目录**，不隔离就会写进 `E:\DemoStudio\.dsh\rules`，把手动用例的数据污染掉；漏掉 `afterEach` 会在 `%TEMP%` 堆垃圾。`turnEnd.test.ts` 还要额外 `vi.useFakeTimers()`，因为回合末预筛有 **3 秒防抖**。

手动用例反过来，**必须**先清空经验库再跑：`Move-Item E:\DemoStudio\.dsh\experience\*.md E:\DemoStudio\.dsh\experience\_bak\ -Force`。

> 为什么要清空：`.dsh/experience/` 现有 24 个历史 episode。断言「落了 1 条 episode」时旧数据会让你分不清新旧——尤其同名 episode 走**覆盖更新**不新建（EXP-02），旧文件被静默改写，断言直接失真。

---

## 3. 用例编号体系

| 编号 | 管什么 | 对应插件 | 主要测试文件 |
|---|---|---|---|
| KM | 知识飞轮：ds-memory 提示词结构化 | ds-memory | `memoryTypes.test.ts` |
| RL | 反馈飞轮：规则提案/应用 + 回合末预筛 | ds-feedback | `ruleStore.test.ts`、`tools.test.ts`、`preScreen.test.ts`、`turnEnd.test.ts` |
| SQ | 会话索引：`session-query-sqlite` patch | 内核 + profile patch | 无（纯手动） |
| EXP | 经验插件：落盘/检索/历史转录 | ds-experience | `experienceStore.test.ts`、`experienceTools.test.ts`、`historyTools.test.ts`、`extractExperience.test.ts`、`index.test.ts` |
| SP | systemPrompt 装配：段序与工具清单 | 三插件 + ds-instructions | `ruleStore.test.ts`（空库分支） |
| M | 挂载与全局回归 | 全部 | 无（纯手动） |

**SQ / SP / M 三组没有单测**：它们验的是 profile patch 是否生效、段序是否正确、插件挂载后有无重复注册——只有真跑起来的内核能回答。

---

## 4. 用例详解

### 4.1 KM 知识飞轮（ds-memory）

KM-01 是唯一有单测的 KM 用例，锁的是**提示词文本本身**（改文案极易回退，必须断言）：

```ts
it('不保存清单不再包含无差别的"调试修复配方"，改为限定一次性修复过程', () => {
  expect(WHAT_NOT_TO_SAVE_TEXT).not.toContain('调试修复配方')
  expect(WHAT_NOT_TO_SAVE_TEXT).toContain('一次性的修复过程')
})
```

> 在防什么回归：知识飞轮核心是「踩坑要存、一次性修复流水账不要存」。旧文案写的是无差别的「调试修复配方 — 修复已落在代码里」——那会把**所有**踩坑都挡在外面，飞轮空转。改成「一次性的修复过程」后，可复用根因才能进记忆库。改了 `memoryTypes.ts` 却没同步这里，CI 不会拦，只有这组断言会。

| 编号 | 类型 | 验证什么 / 怎么跑 | 预期 |
|---|---|---|---|
| KM-01 | 单测 | 四段标签、`WHAT_NOT_TO_SAVE` 语义、容器规则、保存触发点（`memoryTypes.test.ts:87` 起 5 个 it） | 全绿 |
| KM-02 | 单测 | memory 四工具 + 解析用例全量重跑，提示词改动不得破坏解析/落盘 | 全绿。**当前 7 个文件红 1 个，见 §7 坑 2** |
| KM-03 | 手动 | 真实踩一个可复用坑 → 等提取 → 查 `.dsh/memory/` | 新记忆按 Problem/Cause/Solution/Applicable 四段组织 |
| KM-04 | 手动 | 一次无可复用根因的单点 bug 修复后等提取 | 不生成修复流水账记忆（宁缺毋滥） |
| KM-05 | 手动 | 同一主题下连踩多个坑 | 合并进同一文件，每坑一个 `## 小节`，不拆碎 |

KM-02 的单测部分锁的是「改了结构后解析函数还能吃下老格式」——`parseFrontmatter` 对 BOM、缺 `name`/`description`、无闭合 fence、空输入一律返回 `{}` 而非抛错（`memoryTypes.test.ts:27` 起 4 个 it）。

> 为什么这么宽容：磁盘上的记忆文件是**人可编辑的 Markdown**，BOM、缺字段是常态（Windows 编辑器 + 手工改）。解析一旦严格起来，一条坏文件就让整个记忆库扫描崩掉——记忆是热通道，崩了等于失忆。

### 4.2 RL 反馈飞轮（ds-feedback）

RL 是全组覆盖最完整的。规则名校验一道关，`propose` 和 `apply` 共用 `normalizeRuleName`（`ruleStore.test.ts:35`）：

```ts
for (const bad of ['', 'Server_Rule', 'server-rule', 'a/b', 'a\\b', '../escape', '1abc', 'with space']) {
  await expect(proposeRule(dir, { name: bad, content: 'c', reason: 'r' }), `propose "${bad}"`).rejects.toThrow()
  await expect(applyRule(dir, { proposal: bad }), `apply "${bad}"`).rejects.toThrow()
}
```

> 在防什么回归：`../escape` 是**路径逃逸**——规则名直接拼进文件路径，不校验就能写穿 `.dsh/rules/` 到任意目录。两个入口双双断言，只测一个会漏。

同名冲突是「提案-确认制」的核心，未显式给 `mode` 必须报错且**提案保留**（`ruleStore.test.ts:92`）：

```ts
await expect(applyRule(dir, { proposal: 'conflict_rule' })).rejects.toThrow(/overwrite.*append|append.*overwrite/s)
// 报错时提案保留，未静默落地
expect(existsSync(join(dir, 'pending', 'conflict_rule.proposed.md'))).toBe(true)
```

> 注意那条 `existsSync` 断言：防的是「报错了但提案被误删」。报错即停止、提案原地保留，用户才能改个 mode 重试——报错还把用户数据删了是最坏的失败模式。

预筛（RL-12）是**零模型请求**的纯正则，命中/不命中都钉死：

```ts
it('普通任务消息不命中', () => {
  for (const text of ['把鱼塘场景的背景色改成深蓝', '新建一个炮台蓝图，放到场景里']) {
    expect(CORRECTION_HINT_PATTERN.test(`[用户] ${text}`)).toBe(false)
  }
})
```

> 两组对照缺一不可：只测命中，改宽正则也能绿；只测不命中，改窄了也绿。**预筛是纠正进入飞轮的唯一门槛，漏报 = 丢一条纠正。**

| 编号 | 类型 | 位置 | 预期 |
|---|---|---|---|
| RL-01/03 | 单测 | `ruleStore.test.ts:34`、`tools.test.ts:22` | 8 种非法名 propose/apply 双双拒绝 |
| RL-02 | 单测 | `ruleStore.test.ts:48`、`tools.test.ts:29` | `pending/<name>.proposed.md` 生成，frontmatter 含 name/reason/date；render 提示「未生效」+ 转述 |
| RL-04 | 单测 | `ruleStore.test.ts:72`、`tools.test.ts:50` | 不存在提案报错并列出 pending 清单；pending 空则提示（空） |
| RL-05/06/07 | 单测 | `ruleStore.test.ts:87` | 无 mode 报错且提案保留；overwrite 整体替换；append 保留原文 + `## 日期（追加）` 小节 |
| RL-08 | 单测 | `ruleStore.test.ts:112` | 提案删除；RULES.md 索引恰一行（更新不产生重复行） |
| RL-09 | 单测 | `ruleStore.test.ts:127` | pending 内容不出现在规则段（只列 active） |
| RL-10 | 单测 | `ruleStore.test.ts:139` | >300 行 / >40KB 截断并带「已截断」提示，不崩 |
| RL-12 | 单测 | `preScreen.test.ts:5` | 命中/不命中两组对照；只取 `[用户] ` 行；保留最近 2 条；超长截断加 `…` |
| RL-13 | 单测 | `preScreen.test.ts:65` | 有 hint 出现「⚠ 回合末纠正提示（N 号回合，待判定）」；无 hint / 空 excerpts 不出现 |
| RL-14 | 单测 | `turnEnd.test.ts:105` | 命中回合挂提示，下一回合未命中自动撤下；普通回合不挂 |
| RL-15 | 单测 | `turnEnd.test.ts:133`、`:145` | 提示按 agent 隔离；其他 agent 与无 agent 装配看不到；子 agent 不预筛 |
| RL-16 | 单测 | `turnEnd.test.ts:153`、`:168` | running 撤销预筛、水位留待下次空闲补检；`autoDetect:false` 不注册监听但规则段仍注册 |
| RL-17 | 手动 | 真实会话 | 纠正 → propose → 用户说应用 → apply，下一 step 规则段即含新规则（当前会话立即生效） |
| RL-18 | 手动 | 真实会话 | 与 ds-instructions 并存，两通道互不读写 |

RL-14 把「挂上→撤下」跑成一条时间线（`vi.advanceTimersByTimeAsync(3_000)` 推进防抖）：

```ts
idle(statusHandlers, agent)
await settle()
expect(hinted).toContain('## ⚠ 回合末纠正提示（1 号回合，待判定）')

events.push(...plainTurn(2))
idle(statusHandlers, agent)
await settle()
expect(sectionText(sections, agent)).not.toContain('## ⚠ 回合末纠正提示')
```

> 后半段（撤下）比前半段（挂上）更重要：提示挂在规则段里，下回合不撤就会**永久污染后续每一回合的 system prompt**，模型会一直以为用户刚纠正了它。水位增量推进就是为这个。

### 4.3 SQ / EXP / SP / M

**EXP 是本次核实问题最多的一组**。落盘（EXP-01~03）与检索（EXP-04~05）是健康的：

```ts
it('更新原文件（不产生副本），INDEX.md 保持单行', async () => {
  await saveExperience(dir, input)
  const second = await saveExperience(dir, { ...input, summary: '更新后的概述' })
  expect(second.status).toBe('updated')

  const files = (await readdir(dir)).filter(f => f.endsWith('.md') && f !== 'INDEX.md')
  expect(files).toEqual(['fix_junction_mount.md'])
```

> `expect(files).toEqual([...])` 是**精确相等**不是 `toContain`——防的是「同名 save 生成 `xxx_1.md` 副本」。副本会让经验库随每次覆盖无限膨胀，检索时新旧版本一起被召回。

EXP-06/07 锁的是历史转录的**过滤语义**（`historyTools.test.ts:36`）：转录须含 `[用户] …`、`[调用工具 bash]`、`[助手] …`，且**不含**插件注入内容与 `tool-result`；`maxChars` 超限截断并标注「已截断」。

> 为什么要过滤：会话事件流里混着 ds-memory 注入的召回内容（`source.kind: 'plugin'`）和工具结果。不过滤，`history_read` 读回来的「上次怎么做的」会夹带一大坨当时的记忆注入，token 爆炸且语义错乱。

但 **EXP-08/09/10 与 EXP-11/12 已和代码脱节**。`extractFromSession` 已被禁用，[extractExperience.ts:94](../../harness/ds-experience/src/extractExperience.ts) 现在只有一行日志加 `return { ok: true, saved: [], updated: [] }`——**恒定返回空结果**，而 [extractExperience.test.ts:110](../../harness/ds-experience/tests/extractExperience.test.ts) 仍断言 `expect(result.saved).toEqual(['build_ds_experience_plugin.md'])` 与 `expect(result.maxTurn).toBe(1)`；`ExtractResult` 接口里**已经没有 `maxTurn` 字段**（只有 `ok`/`saved`/`updated`）。

| 编号 | 状态 | 证据 |
|---|---|---|
| EXP-08 | ❌ 已失效 | 断言 `saved` 非空 / `maxTurn` 推进，实际恒定返回空数组且无该字段 |
| EXP-09 | ❌ 已失效 | 断言 `ok:false` + 水位不推进，实际恒定 `ok:true`；「非法 JSON 重试」路径已不存在 |
| EXP-10 | ⚠️ 部分失效 | 子 agent 门控仍成立；但 `index.test.ts:89` 对照组断言会落 `should_not_appear.md`，提炼禁用后不再落盘 |
| EXP-11 | ❌ 前提已变 | 「跑任务→等空闲→自动落 1 条 episode」，自动提炼已禁用，不调 `experience_save` 就不会落盘 |
| EXP-12 | ❌ 已失效 | 「只对新增回合提炼（水位增量）」依赖的水位机制随提炼一起停用 |
| EXP-13 | ⚠️ 语义变更 | 现在只有主 agent 调 `experience_save` 才会覆盖，无自动 notice 通道 |
| EXP-14 | ⚠️ 前提消失 | 后台提炼不存在了，也就无所谓「静默失败」 |
| EXP-15 | ✅ 有效 | `history_search` → `history_read` → 模型复述，纯工具链，不依赖提炼 |

> 这些不是「暂时红了」，而是**被测能力已从代码中移除**。修法只有两条：把 `extractExperience.test.ts` / `index.test.ts` 里对应断言翻新为「禁用后恒定 `ok:true`/不落盘」的新口径，或直接删掉这两组测试文件——保留一套永远无法通过的断言，比没有测试更糟。

其余用例：

| 编号 | 类型 | 位置 / 验证什么 | 预期 |
|---|---|---|---|
| EXP-01 | 单测 | `experienceStore.test.ts:27` 新建 episode | `<dir>/<name>.md` + INDEX.md 各一行，含 task_type/outcome/date/Summary/Lessons |
| EXP-02 | 单测 | `:54` 同名重复 save | `status:'updated'`，目录内**只有**一个文件，索引单行 |
| EXP-03 | 单测 | `:72` 非法名拒绝 | 大写/分隔符/空名/保留名 `index` 一律抛错 |
| EXP-04 | 单测 | `experienceTools.test.ts:40` 空库检索 | `count:0` + 友好文案，不报错 |
| EXP-05 | 单测 | `:54` 命中检索 | ≤3 条；清单外/不存在的 `ghost.md` 被过滤 |
| EXP-06 | 单测 | `historyTools.test.ts:142` 不存在 session | `SESSION_QUERY_SESSION_NOT_FOUND` 透出为工具错误 |
| EXP-07 | 单测 | `:35` 转录渲染 | 保留用户/助手/工具调用；跳过插件注入与 tool-result |
| SQ-01 | 手动 | `dsh web --dump-config` | 持久 path + `openAt: first-search`，无 `:memory:` 残留 |
| SQ-02 | 手动 | 首搜建库 | 首次 `history_search` 才建库（惰性），首次有建库耗时属预期 |
| SQ-03 | 手动 | 搜历史会话独有关键词 | 命中，返回 id/日期/标题/最强命中摘要 |
| SQ-04 | 手动 | 搜其他 cwd 会话 | 不命中（cwd 过滤隔离是设计） |
| SQ-05 | 手动 | 回退 `openAt: never` | 全文搜索报 `SESSION_QUERY_SEARCH_DISABLED`；`history_read` 精确读仍可用 |
| SP-01 | 手动 | 段序 | 2900(内核) < 3000(experience) < 3100(feedback) < 3200(memory) < 3300(instructions) |
| SP-02 | 手动 | 清空经验库后新会话 | guide 注入但无索引部分；非空后索引出现 |
| SP-03 | 手动 | 问模型工具清单 | 6 个新工具在册：rule_propose / rule_apply / history_search / history_read / experience_save / experience_search |
| SP-04 | 单测 | `ruleStore.test.ts:153` 空库模式 | 段文本含「规则库当前为空」，不列规则、不报错 |
| M-01 | 手动 | `dsh --profile {web,headless} --dump-config` | 三行在册（ds-feedback / ds-experience insert + session-query-sqlite 覆盖） |
| M-02 | 手动 | 插件行加 `enabled: false` | section/工具/事件监听全部消失，其余插件不受影响 |
| M-03 | 手动 | web profile 改 patch 热重载 | 重挂成功；多次改后无重复定时器/重复 section（`ctx.effect` 清理生效） |
| M-04 | 手动 | 双通道分离 | `.dsh/experience/` 只含 episode；`.dsh/memory/` 无任务轨迹条目 |
| M-05 | 手动 | 全量 test + build | 全绿；`git status` 仅预期文件变更 |

SP-01 的段序有源码支撑（`grep SECTION_ORDER` 得到四个常量，分处四个插件）：`ds-experience/src/experienceTypes.ts:19` = 3000、`ds-feedback/src/ruleTypes.ts:24` = 3100、`ds-memory/src/index.ts:38` = 3200（const 未导出）、`ds-instructions/src/index.ts:58` = 3300（const 未导出）。

SP-04 是唯一有单测的 SP 用例，覆盖最容易忽略的空库分支（`ruleStore.test.ts:153`）：段文本须含「规则库当前为空」且不含「RULES.md 索引」。

> 新装好插件、一条规则都没有时，规则段不能渲染成「索引：」后面一片空白，也不能因读不到 `RULES.md` 抛异常——那会让**每次** system prompt 装配都炸。

---

## 5. 执行命令速查

| 命令 / 位置 | 干什么 | 注意 |
|---|---|---|
| `npm install && npm run build && npm test`（各插件目录） | 装依赖 + 编译 + 跑单测 | **依赖当前未安装**，不装会报 `Cannot find package` |
| `npm test -- ruleStore`（各插件目录） | 只跑匹配名称的测试文件 | vitest 过滤器 |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / `oxlint src tests` | lint 用 oxlint，**不是**仓库根的 eslint |
| `dsh web --dump-config \| Select-String "ds-experience\|session-query-sqlite"` | 查挂载是否在册 | PowerShell 用 `Select-String`，不是 `grep` |
| `Get-Item $env:USERPROFILE\.dsh\profiles\web\node_modules\@demostudio\ds-experience \| Select Target` | 确认 junction 指向 | 必须是 Junction 不是硬链接 |
| `E:\DemoStudio\.dsh/experience/` | 经验库，现有 24 个 episode | 手动用例前先备份清空 |
| `E:\DemoStudio\.dsh/rules/` | 规则库（`RULES.md` + `pending/`） | 手动用例 RL-17/18 的落盘 |

位置速查（`文件:行号`，均已在 §4 各表中出现过）：KM-01 → [memoryTypes.test.ts:87](../../harness/ds-memory/tests/memoryTypes.test.ts)；RL-01/03 → [ruleStore.test.ts:34](../../harness/ds-feedback/tests/ruleStore.test.ts)，RL-05/06/07 → `:87`，SP-04 → `:153`；RL-12 → [preScreen.test.ts:5](../../harness/ds-feedback/tests/preScreen.test.ts)；RL-14 → [turnEnd.test.ts:105](../../harness/ds-feedback/tests/turnEnd.test.ts)；EXP-01~03 → [experienceStore.test.ts:27](../../harness/ds-experience/tests/experienceStore.test.ts)；EXP-07 → [historyTools.test.ts:35](../../harness/ds-experience/tests/historyTools.test.ts)；提炼禁用点 → [extractExperience.ts:94](../../harness/ds-experience/src/extractExperience.ts)。

---

## 6. 流程影响：牵动哪些功能

### 上游：谁驱动它

| 上游 | 怎么驱动 | 相关文档 |
|---|---|---|
| 插件 `npm test` / `build` | 单测与类型检查的执行入口 | [数据飞轮计划](./dsh_data_flywheel_plan.md) |
| profile patch 挂载 | 决定 SQ/SP/M 组手动用例能否在真实内核上跑 | [插件安装](./dsh_plugin_install.md) |
| 真实交互式内核会话 | 手动用例依赖真实 LLM 行为与事件时序 | [DSH 引擎集成](./dsh_engine_integration.md) |
| `ctx.sessionQuery` 服务 | SQ/EXP 检索用例依赖其索引可用 | [数据飞轮计划](./dsh_data_flywheel_plan.md) |
| 主 agent 自觉调 `experience_save` | 提炼禁用后经验落盘的唯一来源 | [Harness 工程](./harness_system.md) |

### 下游：它波及谁

| 下游功能 | 波及点 | 相关文档 |
|---|---|---|
| ds-memory 记忆格式 | KM 组锁定四段格式与容器规则 | [数据飞轮计划](./dsh_data_flywheel_plan.md) |
| ds-feedback 规则库 | RL 组锁定提案-确认制与预筛行为 | [数据飞轮计划](./dsh_data_flywheel_plan.md) |
| ds-experience 经验库 | EXP 组锁定落盘/检索；**08/09/11/12 需翻新口径** | [数据飞轮计划](./dsh_data_flywheel_plan.md) |
| system prompt 装配 | SP 组锁定段序 3000/3100/3200/3300 与 6 工具清单 | [ds-instructions PRD](./dsh_instructions_prd_revised.md) |
| 双通道分离 | M-04 是硬约束回归点 | [数据飞轮计划](./dsh_data_flywheel_plan.md) |
| git 跟踪决策 | M-05 涉及 `.dsh/{memory,rules,experience}` 是否提交 | [插件安装](./dsh_plugin_install.md) |

---

## 7. 踩坑清单

**1. `npx vitest run` 报 `Cannot find package '@deepseek-ai/dsh-llm'`** —— 三个插件 `node_modules` 下只有 `.vite` 缓存，依赖没装（`dsh-source/node_modules` 里也没有）；ds-experience 4/5、ds-feedback 2/4 文件因此 FAIL。规则：先 `npm install`；**这类「Failed to load url」是环境问题不是用例失败**，别去改测试代码。

**2. `selectMemories.test.ts` 报 `Failed to load url ../src/selectMemories.js`** —— `src/selectMemories.ts` 已删除（`ds-memory/src` 现只剩 8 个文件），测试文件还在；ds-memory 7 个文件红 1 个，其余 6 个 55 测试全绿。规则：KM-02「全量重跑」当前无法全绿，要么恢复源码要么删孤儿测试。

**3. EXP-08/09/10/11/12 的断言与代码永久冲突** —— `extractFromSession` 恒定返回 `{ ok: true, saved: [], updated: [] }`，测试却断言 `saved` 非空、`maxTurn` 推进，而 `ExtractResult` 已移除 `maxTurn`。规则：**被测能力移除后必须同步翻新或删除测试**，留着永远红的断言会掩盖真实回归信号。

**4. 手动用例被旧 episode 干扰** —— `.dsh/experience/` 现有 24 个文件，且同名 save 走**覆盖更新**不新建，旧文件被静默改写。规则：跑前先备份/清空。

**5. 只靠「模型说看到了指令」验收** —— LLM 会顺着提问给肯定回答，口头确认不是证据。规则：必须检查 session 里实际写入的 durable `user/message`，以及下一次 LLM 请求的 messages。

**6. headless 改完 patch 直接跑用例，结果仍是旧行为** —— headless 无 `patchReload: live`。规则：每次改动后**重启内核**。

**7. patch 覆盖只写一部分键导致 SQ 组全红** —— patch 是整行替换，只写 `path` 会让 `openAt` 回默认 `never`，报 `SESSION_QUERY_SEARCH_DISABLED`。规则：`path` + `openAt` 一起写全。

**8. 忘了 `afterEach` 删临时目录** —— 只写 `mkdtemp` 没写清理，`%TEMP%` 下堆一堆 `ds-feedback-XXXX`。规则：照抄 §2.2 骨架，两个钩子成对出现。

**9. RL-11 已随 side-query 裁撤** —— 2026-09-02 裁撤后作废，RL-12 承接「预筛命中/不漏判」。规则：以 [计划 §4.3](./dsh_data_flywheel_plan.md) 现行机制为准。

---

## 8. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| 单测 vs 手动 | 单测锁行为，手动验真实内核/LLM/落盘 | 两类都不能省 |
| 依赖未安装 | `Cannot find package`，非用例失败 | 先 `npm install` |
| `src/selectMemories.ts` 已删除 | `selectMemories.test.ts` 恒红 | 恢复源码或删孤儿测试 |
| `extractFromSession` 已禁用 | 恒定 `ok:true`/不落盘，无 `maxTurn` | EXP-08/09/11/12 翻新口径 |
| headless 内核 | 改动需重启，无热重载 | 每次改动后重启 |
| web profile | `patchReload: live` 热重挂 | 多次改动后查无重复 section/定时器（M-03） |
| `.dsh/experience/` 有旧数据（现 24 个） | 干扰手动断言，同名覆盖静默改写 | 先备份/清空 |
| 搜索其他 cwd 会话 | 不命中（SQ-04 预期） | cwd 过滤隔离是设计，非 bug |
| `openAt: never` | 全文搜索报 `SESSION_QUERY_SEARCH_DISABLED`，精确读仍可用 | SQ-05 预期 |
| 子 agent（`delegationDepth>0`） | 不预筛、不提炼、不注入（EXP-10、RL-15） | 门控是设计 |
| 规则库超限（>300 行 / >40KB） | 截断并带提示，不崩 | RL-10 预期 |
| 空规则库 | 段含「规则库当前为空」，不报错 | SP-04 预期 |
| 同名 episode / 同名规则 | 覆盖更新不产生副本（EXP-02） | 断言用 `toEqual` 而非 `toContain` |
| 提炼失败（断网/非法 JSON） | 相关路径已随提炼禁用消失 | EXP-09/14 前提不再成立 |
