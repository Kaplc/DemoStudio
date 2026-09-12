---
name: ds_memory_no_auto_search
description: ds-memory 检索三通道 + prefix 文件数组联想（具体文件精确匹配，2026-09-12 改版）
type: project
prefix: [harness/ds-memory/src/associate.ts, harness/ds-memory/src/memoryTypes.ts]
---
ds-memory 检索机制现状（三通道）：
1. **索引常驻**：MEMORY.md（目录）注入 system prompt，仅给 agent 看有哪些记忆；
2. **按需检索**：memory_search 无 LLM、纯文件读取，agent 自觉调用；
3. **prefix 文件联想**：记忆 frontmatter 声明 `prefix:`（**具体文件路径数组**），会话中读到列表中任一文件时联想器在 agent/pre-step 把该记忆**全文**自动注入（同会话同条只注入一次；单次 32K 字符预算；仅主 agent；source.form='recall' 被 history_read 过滤）。零 LLM：tools/pre-execute 登记 file_path → tools/result 确认成功 → 精确匹配。

**prefix 文件数组（2026-09-12 改版，替代旧目录前缀/&&·|| 表达式）**：
- `prefix: [src/engine/foo.ts, doc/engine/bar.md]` — 文件路径数组，读到列表中**任一文件**即触发（OR 语义）；
- 单文件可省略方括号写作 `prefix: src/engine/foo.ts`；
- **只按具体文件精确匹配**：目录条目不命中其下文件，`&&`/`||` 表达式与 `/` 全局均已废弃（`parsePrefixExpr`/`evalPrefixGroups`/AND 累计已删除）；旧 frontmatter 里的目录值解析为单项数组但永远匹配不到文件（不报错、静默失效）；
- 实现：解析 `parseTriggerFileList`（memoryTypes.ts），匹配 `matchTriggerFiles`（associate.ts）；memory_write 的 prefix 参数为字符串数组（hold 语义保留，空数组等同 hold）。

**Why:** 早前"每消息 LLM side-query 自动检索"因太重被用户移除；2026-09-09 用户要求 &&/|| 组合触发；2026-09-12 用户改弦"按目录来太粗"，改为具体文件数组精确匹配，原匹配方法废弃。

**How to apply:** 排查"记忆为何没被自动想起"：(a) frontmatter prefix 是否为具体文件路径（目录值已不触发；旧目录型 prefix 需改写为文件数组）；(b) 本会话是否已注入过（去重）；(c) 配置 enableAutoAssociate + memoryDir 可推导项目根。改动联想行为在 `harness/ds-memory/src/associate.ts`。**带 prefix 的记忆正文必须精炼**（整篇加载进上下文）。注意：该插件目录用 npm 管理（package-lock.json），不要用 pnpm 装依赖（pnpm 会搬走 node_modules 且 esbuild build-script 策略报错）。
