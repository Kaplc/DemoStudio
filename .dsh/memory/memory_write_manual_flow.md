---
name: memory_write_manual_flow
description: memory_write 已改为返回写入指引不落盘：agent 手动写文件→同步索引→全库过时检查三步（2026-09-09）
type: project
prefix: harness/ds-memory
---
规则：memory_write 工具**不直接落盘**（2026-09-09 用户要求改为返回提示词）——工具只做参数校验（name/type/prefix 表达式合法性）与按 name/description 查重，然后返回写入指引（`memoryTypes.ts` 的 `buildManualWritePrompt`）；由 agent 用 write/edit 手动完成三步：① 写记忆文件（frontmatter + 条目格式）② 同步 MEMORY.md 索引行 ③ **全库检查过时记忆并顺便更新/清理**。三步做完才算保存完成。content 参数已从工具 schema 移除（正文由 agent 落盘时直接写）。

**Why:** 工具落盘的固定模板（renderMemoryFile + upsertIndexLine）跟不上记忆格式演进（prefix 表达式、多条目文件等），且用户希望写完顺便整备全库；工具保留校验+查重做确定性兜底，写入自由度交给 agent。

**How to apply:** 调用 memory_write 后按返回的指引逐字执行三步；指引里已有查重结论（deduped_by=update 时用 edit 改已有文件）。memoryStore 的 writeMemory/upsertIndexLine 函数保留（测试与脚本可用）但工具链路不再调用。系统提示 SAVE_FLOW_TEXT 已同步说明此流程。
