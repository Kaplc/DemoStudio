# DSH 数据飞轮测试用例

> 配套 [`dsh_data_flywheel_plan.md`](./dsh_data_flywheel_plan.md) 的验证用例集。覆盖三个改动包：ds-memory 提示词结构化（知识飞轮）、ds-feedback 新插件（反馈飞轮）、ds-experience 插件 + session-query 持久索引（行为飞轮）。
> 用例编号规则：`KM`=知识飞轮、`RL`=规则提案（ds-feedback）、`SQ`=会话索引、`EXP`=经验插件（ds-experience）、`SP`=systemPrompt 装配、`M`=挂载与全局回归。
> 类型说明：**单测**=vitest 自动化；**手动**=真实会话/内核行为验证（单测覆盖不到的 LLM 行为、事件时序、落盘副作用）。

## 1. 测试环境与前置

| 项 | 要求 |
|----|------|
| 构建 | 三个插件目录 `npm run build` 全部通过；`npx vitest run`（各插件内）全绿 |
| 挂载 | ds-feedback、ds-experience junction（web+headless 各一）+ 两 profile patch insert 行；session-query-sqlite 覆盖行已加 |
| 内核 | web profile 改动靠 `patchReload: live` 热重载；**headless 每次改动后重启** |
| 测试数据 | ≥1 段含工具调用的历史会话（供 history_search 命中）；`.dsh/memory/`、`.dsh/experience/` 可随时清空重跑 |
| 隔离 | 手动用例建议先备份/清空 `.dsh/experience/`，避免旧 episode 干扰断言 |

验证命令速查：

```sh
cd harness/ds-memory && npm run build && npx vitest run        # 三个插件同理
dsh web --dump-config | grep -E "ds-experience|session-query-sqlite"
# junction（PowerShell）
powershell -c "Get-Item $env:USERPROFILE\.dsh\profiles\web\node_modules\@demostudio\ds-experience | Select Target"
```

## 2. KM — 知识飞轮（ds-memory 提示词结构化）

| 编号 | 类型 | 步骤 | 预期 |
|------|------|------|------|
| KM-01 | 单测 | 对 `memoryGuideSectionText` 输出做文本断言：含 `Problem`/`Cause`/`Solution`/`Applicable`；`WHAT_NOT_TO_SAVE` 不再包含无差别的「调试修复配方 — 修复已落在代码里」，改为限定一次性修复过程 | 断言通过，防止后续改文案时回退 |
| KM-02 | 单测 | 现有 memory 四工具 + 提取解析用例全量重跑 | 全绿（提示词改动不得破坏解析/落盘行为） |
| KM-03 | 手动 | 对话中真实踩一个可复用的坑（如构建/挂载问题），解决后等空闲 ≥3s 提取完成，查 `.dsh/memory/` 新记忆 | 踩坑记忆正文按 Problem/Cause/Solution/Applicable 四段组织，Applicable 写明适用子系统 |
| KM-04 | 手动 | 一次普通的单点 bug 修复（无可复用根因）后等提取 | 不生成修复流水账记忆（宁缺毋滥语义保持） |
| KM-05 | 手动 | 同一主题下先后踩多个坑（如 PowerShell 环境坑 ×3） | 合并进同一个记忆文件：每坑一个 `## 小节` 各含四段，description 覆盖全部坑；不拆成一堆碎文件，也不把不同主题塞进同一文件 |

## 3. RL — 反馈飞轮（ds-feedback 规则提案/应用）

独立插件 `harness/ds-feedback`：规则库 `<root>/.dsh/rules/`（active `*.md` + RULES.md 索引，`pending/` 存提案），注入走常驻 systemPrompt 段 `feedback:rules`（order 3100，text 每步重算，apply 后当前会话立即生效）。与 ds-instructions（用户手工目录指令）完全解耦。

**单测（vitest，临时目录模拟 ruleDir）：**

| 编号 | 步骤 | 预期 |
|------|------|------|
| RL-01 | `rule_propose` 传非法 name（空/大写/含分隔符） | 报错 |
| RL-02 | 合法 propose（如 name=server_authoritative_movement） | `pending/server_authoritative_movement.proposed.md` 生成，frontmatter 含 name/reason/date |
| RL-03 | name 含路径分隔符或 `..` | 拒绝（防路径逃逸） |
| RL-04 | `rule_apply` 传不存在的提案名 | 报错并列出 pending 目录现有提案 |
| RL-05 | 同名 active 规则已存在、apply 未传 mode | 报错，提示 overwrite/append 二选一 |
| RL-06 | 已存在同名 + `mode:'overwrite'` | 规则被整体替换 |
| RL-07 | 已存在同名 + `mode:'append'` | 原内容保留，追加带日期的小节标题 |
| RL-08 | apply 成功后检查 | 提案文件已删除；RULES.md 索引恰一行（更新不产生重复行） |
| RL-09 | pending 有提案时渲染规则段 | pending 不出现在 section（section 只列 active 规则） |
| RL-10 | 构造超限规则库（索引 >300 行或 >40KB） | 段文本截断并带截断提示，不崩（同 memory 索引水位语义） |

**手动/集成：**

| 编号 | 步骤 | 预期 |
|------|------|------|
| RL-11 | 新会话：纠正模型一个做法并说"以后都这样" → 模型口头确认后 rule_propose → 用户说"应用" → rule_apply | 不依赖读文件，下一 step 的 system prompt 规则段即含新规则（当前会话立即生效）；重启会话后仍在 |
| RL-12 | 与 ds-instructions 并存验证：`.dsh/instructions/` 手工指令照常注入，`.dsh/rules/` 规则段照常注入 | 两通道互不读写、互不覆盖（分工：手工规范 vs 纠正沉淀） |

## 4. SQ — 会话索引（profile patch）

| 编号 | 类型 | 步骤 | 预期 |
|------|------|------|------|
| SQ-01 | 手动 | `dsh web --dump-config` 查 session-query-sqlite 行 | config 为持久 path + `openAt: first-search`（整行替换生效，未残留 `:memory:`） |
| SQ-02 | 手动 | 重启内核，确认 `<home>/.dsh/session-query/` 下尚无 db → 发起首次 history_search | 首次搜索时才建库（first-search 惰性语义）；首次可能偏慢属预期 |
| SQ-03 | 手动 | history_search 一个只有历史会话里出现过的关键词 | 命中对应会话，返回 id/日期/标题/最强命中摘要 |
| SQ-04 | 手动 | 搜索另一个项目（其他 cwd）才会话里的独有内容 | 不命中（cwd 过滤隔离生效） |
| SQ-05 | 手动 | 临时移除覆盖行回退 `openAt: never` → history_search | 报 `SESSION_QUERY_SEARCH_DISABLED`；history_read（精确读）仍可用；恢复覆盖行后热重载即恢复 |

## 5. EXP — 行为飞轮（ds-experience）

**单测（vitest，mock ctx.llm / ctx.sessionQuery）：**

| 编号 | 步骤 | 预期 |
|------|------|------|
| EXP-01 | `experience_save` 新建 episode | `<experienceDir>/<name>.md` + INDEX.md 各一行（含 task_type/outcome/date） |
| EXP-02 | 同名重复 save | 更新原文件（不产生副本），INDEX.md 保持单行 |
| EXP-03 | name 含大写/路径分隔符/空 | 拒绝 |
| EXP-04 | `experience_search` 空库 | 返回空结果 + 友好文案，不报错 |
| EXP-05 | `experience_search` 命中（选择器 mock 返回文件名） | 返回 ≤3 条，含 summary/lessons/outcome |
| EXP-06 | `history_read` 传不存在 session_id | 报错（SESSION_QUERY_SESSION_NOT_FOUND 透出为工具错误） |
| EXP-07 | `history_read` 渲染含插件注入消息/tool-result 的会话 | 转录只含真实用户消息、助手文本、工具调用；插件注入与工具结果被跳过（与 ds-memory renderTurnTranscript 同语义） |
| EXP-08 | 自动提炼判定：无工具调用的纯问答转录 | side-query 不产出 episode（或判定非任务直接跳过），水位照常推进 |
| EXP-09 | 提炼 side-query 返回非法 JSON / 超时 | ok:false、水位不推进、不抛出；下次空闲重试 |
| EXP-10 | 子 agent（delegationDepth>0）触发空闲 | 不提炼、不注入（同 ds-memory 门控） |

**手动：**

| 编号 | 步骤 | 预期 |
|------|------|------|
| EXP-11 | 新会话跑一个带工具调用的真实小任务 → 停止交互等空闲 | `.dsh/experience/` 落 1 条 episode，frontmatter 任务类型/结果与实际相符 |
| EXP-12 | EXP-11 之后继续新回合再停 | 只对新增回合提炼（水位增量），不重复生成同一 episode |
| EXP-13 | 提炼覆盖已有同名 episode | inbox 出现 notice（仅此异常场景打扰），常规新建静默 |
| EXP-14 | 断网/停掉模型路由后跑任务等空闲 | 主对话完全无感（后台静默失败） |
| EXP-15 | history_search → 对命中会话 history_read → 模型能复述"上次怎么做的" | 全链路可用，行为飞轮闭环成立 |

## 6. SP — systemPrompt 装配

| 编号 | 类型 | 步骤 | 预期 |
|------|------|------|------|
| SP-01 | 单测/手动 | 装配后 section 顺序 | 2900(内核) < 3000(experience:guide) < 3100(feedback:rules) < 3200(memory:guide) < 3300(instructions)，无冲突告警 |
| SP-02 | 手动 | 清空 `.dsh/experience/` 后新会话 | experience:guide 注入但无索引部分（同 memory 空库模式）；经验库非空后索引出现 |
| SP-03 | 手动 | 新会话问模型工具清单 | 6 个新工具在册：rule_propose / rule_apply / history_search / history_read / experience_save / experience_search |
| SP-04 | 手动 | `.dsh/rules/` 为空的新会话 → apply 一条规则 | 空库时规则段不列规则、不报错；apply 后立即出现在规则段 |

## 7. M — 挂载与全局回归

| 编号 | 类型 | 步骤 | 预期 |
|------|------|------|------|
| M-01 | 手动 | `dsh web --dump-config` | ds-feedback 与 ds-experience insert 行 + session-query-sqlite 覆盖行在册；headless 重启后同样在册 |
| M-02 | 手动 | ds-experience 行加 `enabled: false` 热重载 | section/工具/事件监听全部消失，其余插件不受影响；恢复后回归 |
| M-03 | 手动 | web profile 下改 patch 保存（live reload 重挂插件） | 插件重挂成功；多次改后无重复定时器/重复 section（ctx.effect 清理生效） |
| M-04 | 手动 | 跑若干任务后检查双通道 | `.dsh/experience/` 只含 episode；`.dsh/memory/` 无任务轨迹类条目；memory 提取绝不写 experience 目录，反之亦然（双通道分离硬约束） |
| M-05 | 手动 | 四插件全量 `npx vitest run` + build | 全绿；`git status` 仅预期文件变更（含新增 `.dsh/experience/` 与 `.dsh/rules/`，git 跟踪决策与 `.dsh/memory` 保持一致） |

## 8. 用例 ↔ 计划章节对照

| 计划章节 | 用例组 |
|----------|--------|
| §1 知识飞轮（ds-memory 提示词） | KM-01~04 |
| §2 反馈飞轮（ds-feedback propose/apply） | RL-01~12 |
| §3.A 会话索引 patch | SQ-01~05 |
| §3.B ds-experience（工具/提炼/指导段） | EXP-01~15、SP-01~04 |
| §4 实施顺序每步的门禁 | 各组单测先行，手动用例按 §4 顺序放行 |
| §5 验证清单 | M-01、SP-03、EXP-11、SQ-03、RL-11（一一对应） |

## 9. 执行记录（2026-08-30 实施当日）

**自动化工序（全部通过）：**

| 项 | 结果 |
|----|------|
| KM-01 | ✅ 新增断言组（memoryTypes.test.ts）：指导段含四段标签、WHAT_NOT_TO_SAVE 不再含无差别「调试修复配方」、容器规则/提取提示同步 |
| KM-02 | ✅ ds-memory 全量 71 测试通过（build + vitest） |
| RL-01~10 | ✅ ruleStore.test.ts + tools.test.ts 共 20 测试通过（含路径逃逸、mode 二选一、索引单行、pending 不进 section、超限截断、空库模式） |
| EXP-01~10 | ✅ experienceStore/experienceTools/historyTools/extractExperience/index 五个测试文件共 35 测试通过（mock ctx.llm / ctx.sessionQuery；含子 agent 门控、防抖、水位增量、非法 JSON 重试语义） |
| M-05（build/vitest 部分） | ✅ ds-feedback 0 lint 告警、ds-experience 0 告警；三插件 build 全过 |
| M-01（web） | ✅ `dsh --profile web --dump-config`：ds-feedback / ds-experience insert 行 + session-query-sqlite 覆盖行在册 |
| M-01（headless） | ✅ `dsh --profile headless --dump-config` 三行同样在册 |
| SQ-01 | ✅ dump 显示 `path: C:/Users/Kaplc/.dsh/session-query/index.sqlite` + `openAt: first-search`，无 `:memory:` 残留 |
| SP-01（静态） | ✅ 段序 2900 < 3000(experience:guide) < 3100(feedback:rules) < 3200(memory:guide) < 3300(instructions) |
| 运行时冒烟 | ✅ `dsh --profile headless "<极小任务>"` 全插件加载启动并正常回答 |

**待真实会话完成的手动用例**（需要交互式内核会话与真实 LLM 行为）：KM-03~05、RL-11~12、SQ-02~05、EXP-11~15、SP-02~04、M-02~04、M-05 的 git 跟踪部分。建议首个真实会话直接跑一个小任务验证 EXP-11（`.dsh/experience/` 落盘）与 SQ-03（history_search 首搜建库）。
