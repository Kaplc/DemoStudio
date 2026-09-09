---
name: ds_memory_no_auto_search
description: ds-memory 检索三通道 + prefix 表达式（&&/|| 组合触发，2026-09-09）
type: project
prefix: harness/ds-memory
---
ds-memory 检索机制现状（三通道）：
1. **索引常驻**：MEMORY.md（目录）注入 system prompt，仅给 agent 看有哪些记忆；
2. **按需检索**：memory_search 无 LLM、纯文件读取，agent 自觉调用；
3. **prefix 自动联想**：记忆 frontmatter 声明 `prefix:`，会话中读到匹配文件时联想器在 agent/pre-step 把该记忆**全文**自动注入（同会话同条只注入一次；单次 32K 字符预算；仅主 agent；source.form='recall' 被 history_read 过滤）。零 LLM：tools/pre-execute 登记 file_path → tools/result 确认成功 → 段级前缀匹配。

**prefix 表达式（2026-09-09 新增，代码风格运算符）**：
- `prefix: a || b` — OR，任一路径命中即触发；
- `prefix: a && b` — AND，会话内全部前缀读过才触发（进度按 WeakMap<Agent, Map<file, 剩余DNF组>> 跨读取累计，顺序不限）；
- 混用 `&&` 优先级高于 `||`（`a && b || c` = (a且b) 或 c）；单值与 `prefix: /`（全局）完全向后兼容。
- 实现：解析 `parsePrefixExpr`（memoryTypes.ts，DNF：OR 组的 AND 项列表），求值 `evalPrefixGroups` + 会话累计 `andProgress`（associate.ts）。

**Why:** 早前"每消息 LLM side-query 自动检索"因太重被用户移除；2026-09-09 用户要求多路径组合触发并指定"直接就用代码的 && 和 ||"，不做数组语法。

**How to apply:** 排查"记忆为何没被自动想起"：(a) frontmatter prefix 表达式写法（运算符是双字符 `&&`/`||`，段级匹配 src/engine 不命中 src/engine2）；(b) AND 记忆需会话内把所有前缀都读过一次；(c) 本会话是否已注入过（去重）；(d) 配置 enableAutoAssociate + memoryDir 可推导项目根。改动联想行为在 `harness/ds-memory/src/associate.ts`。**带 prefix 的记忆正文必须精炼**（整篇加载进上下文）。注意：该插件目录用 npm 管理（package-lock.json），不要用 pnpm 装依赖（pnpm 会搬走 node_modules 且 esbuild build-script 策略报错）。
