---
name: dsh_tool_result_diffs_wire
description: DSH write/edit 差异在 result meta.diffs（computeHunkDiffs）；陷阱：write 新建文件 before===null 时 meta.diffs 为空数组，编辑器须入参派生兜底
type: project
prefix: [src/components/agent/toolDiff.ts, src/editor/AgentService.ts]
---

**Problem:** 想在编辑器 agent 面板的工具卡片上渲染 diff（红绿行 + 行号），却不知道差异数据从哪来——`tool/call` 事件只有 `name` + 原始 `arguments` 字符串，没有视图对象；`tool/result` 的正文只有一句 "has been edited successfully"。

**Cause:** DSH 的差异不在事件正文里，而在 **result 的 meta**：`tool/result` 事件 `data.meta.diffs = [{ path, oldText, newText }]`（由 `@deepseek-ai/dsh-tool-fs` 的 `computeHunkDiffs` 产出：`structuredPatch(context:3)` 每个 hunk 拼成 old/new 两段文本）。关键陷阱三条：① **hunk 丢了 `oldStart/newStart`**，绝对行号在事件里根本不存在，只能自己读文件锚定；② 调用进行中（尚无 result）没有 diffs，DSH WebUI 用工具声明的 `presentCall` 视图（`{card:'diff', diffs:[{path, oldText: args.old_string, newText: args.new_string}]}`）兜底；③ **write 新建文件（`before === null`）时 `presentResult` 直接给 `meta.diffs: []`**（dsh-tool-fs 不为全新文件产 hunk，2026-09-13 核实）——权威路拿不到数据，会被误判为"没有差异"。

**Solution:** 编辑器侧两步取数：实时/历史两处 `tool/result` 分支都调 `AgentService.extractDiffsFromMeta(d.meta)`（防御式收窄，形状不符/空数组返回 undefined）；有权威 hunk 用权威，否则由 `toolDiff.deriveDiffsFromArgs(name, args)` 从入参派生（`edit` → old_string/new_string，`write` → content 全 add）——运行中是意图，**settled success 无权威 hunk 是兜底**（陷阱③场景，2026-09-13 起 ToolCard 已实现：仅 failure 才退通用卡片）。要看 hunk 真实形状时，DSH 会话日志 `~/.dsh/sessions/--E-DemoStudio--/*/session.jsonl.zstd` 可直接用 `node:zlib` 的 `zstdDecompressSync` 逐帧解（多帧拼接，`zstdDecompressSync` 只解第一帧且不报错——按 magic `28 B5 2F FD` 扫描循环解）。

**Applicable:** `src/editor/AgentService.ts`（tool/result 两个分支：`handleSessionEvent` 与 `loadHistory` fold）、`src/components/agent/toolDiff.ts`（面板 diff 渲染数据层）；任何"从 DSH 事件里取结构化展示数据"的需求，先查 result `meta` 而不是事件正文。

