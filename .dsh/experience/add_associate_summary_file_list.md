---
name: add_associate_summary_file_list
task_type: feature
outcome: success
date: 2026-09-10
prefix: harness/ds-memory || harness/ds-experience || src/components/agent
---
## Summary

把 ds-memory/ds-experience 联想注入卡片的摘要从"自动联想记忆 N 条"改为首行条数+每行一个文件名（buildAssociateSummary），并改 ContextCard 的 __summary CSS 允许 pre-line 折行展示。

## Lessons

1. 提示渲染链：插件 source.summary → AgentService.describeContextSource（原样透传）→ ContextCard 折叠行 __summary span；旧 CSS nowrap+ellipsis+overflow hidden 会把 \n 压平并截断——多行摘要必须配 white-space: pre-line + overflow-wrap: anywhere（不用 word-break: break-all，避免英文单词中间硬断）。2. ds-memory 与 ds-experience 的 associate.ts 完全同构，改注入行为必须两侧同步+两侧测试同步，否则卡片样式漂移。3. 验证梯度：vitest（纯函数全分支）→ node -e import 两边 dist 直接调产物确认真实输出（编译错误/旧 dist 当场暴露）→ 运行中 agent 生效需重启（junction 随进程启动载入）。4. edit 撞 ReplaceFileW EIO (Win32 1175) 不只发生在同文件连续 edit，首次 edit 也可能撞（文件被读句柄/杀软占用），原样重试即可。

## Effective Path

harness/ds-memory/src/associate.ts + harness/ds-experience/src/associate.ts（buildAssociateSummary）；src/styles/editor.css（.agent-context-card__summary pre-line）
