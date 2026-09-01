---
name: remove_llm_retrieval_add_manager_panels
task_type: refactor/feature
outcome: success
date: 2026-09-02
---
## Summary

将 ds-memory 和 ds-experience 插件的检索从 LLM side-query 改为纯文件读取（只注入 MEMORY.md/INDEX.md 索引，agent 自主调工具传文件名读文件），并在编辑器 Agent UI 右上角添加记忆/经验管理面板（查看/编辑/复制路径）。

## Lessons

改造前先 grep 确认所有 LLM 依赖面（ctx.llm、llm.stream、inject、selectMemories 引用）避免遗漏；systemPrompt.section 传函数是 lazy provider，每次 LLM 请求都会重新执行，所以索引注入天然最新、无需额外事件监听；工具参数从 query 改为 names 后，整个 AI 选择器文件（selectMemories.ts）可删除；每步改完跑 tsc/oxlint/build 验证，并 memory_write 记录决策原因。编辑器面板需要新增 listDirFiles IPC（preload + main.ts 各加一处），用通用 FileManager 组件同时支撑记忆/经验两个入口，复用 readTextFile/writeTextFile 做编辑保存。

## Effective Path

harness/ds-memory/src/{index,tools,selectMemories}.ts、harness/ds-experience/src/{index,experienceTools}.ts、electron/{preload,main}.ts、src/components/agent/FileManager.tsx
