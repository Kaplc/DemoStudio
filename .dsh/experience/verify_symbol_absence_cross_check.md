---
name: verify_symbol_absence_cross_check
task_type: verification
outcome: success
date: 2026-09-29
---
## Summary

「某符号/引用已不存在」类核验不能只信本仓 grep 工具的 path 圈定结果，需 include 全仓或 Select-String 交叉复查

## Lessons

本仓 grep 工具按 path 圈目录会静默漏报（tests/ 目录三次实锤假阴性：tutorial 残留 21 处报 0、warmCurrentCoreTemp 漏 checkDefeat、SettingsPanel 零命中）。有效核验链：①grep path 圈定先行；②「零命中」结论必须用 include 全仓搜索或 pwsh Select-String 交叉复查后才可采信；③改动后跑 tsc --noEmit 作残留死引用的最终兜底（两轮 tsc 报的正是 grep 漏掉的 tests 引用）。参见 memory:grep_path_scope_false_negative。
