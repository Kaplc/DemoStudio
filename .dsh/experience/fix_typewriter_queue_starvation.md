---
name: fix_typewriter_queue_starvation
task_type: debug/performance-fix
outcome: success
date: 2026-09-02
---
## Summary

修复编辑器 agent 窗口打字机比 DSH WebUI 慢的问题：定位到 drainDisplayQueue 严格串行消费（activeDisplayRef 非 null 时队列停住），结论要等前面所有 reasoning/tool 段打字完才显示；改为队列积压时跳过打字机直接上屏，只有最后一项走打字机动画，并将加速倍率从 2^(n/2) 提升到 2^n，编译通过。

## Lessons

打字机串行队列的瓶颈在 activeDisplayRef 未清空时队列完全暂停，每段都等上一段打完；有效路径是队列积压时非最后一项直接上屏、仅最后一段保留打字机效果；实现时注意队列项 id 与消息 id 不是同一个（用 a-skip-${Date.now()} 生成新 id）；adoptId 的 live 推理卡片在积压场景下跳过采纳是可接受的折中。

## Effective Path

src/components/AgentPanel.tsx drainDisplayQueue + useTypewriter 加速倍率
