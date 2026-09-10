---
name: diagnose_history_session_load_slow
task_type: debug/diagnosis
outcome: success
date: 2026-09-10
---
## Summary

诊断编辑器 agent 面板点击历史会话加载慢：沿"客户端点击链路 → DSH 服务端 history handler → 持久化存储"三层追因，确认是冷会话全量物化 + 单次点击 3 次 RPC 叠加。

## Lessons

有效路径：① 先 history_search 查旧会话避免重复调研（本次命中的就是当前会话，需自行排查）；② 客户端从 AgentPanel.handleSwitchSession → AgentService.switchSession/loadHistoryPage 逐个 await 链读；③ 服务端代码在 harness checkout 的 @deepseek-ai/dsh node_modules 里（不是编辑器仓库），沿 rpc 方法名 grep 'session.history' 找到 handler → historySourceFor → dsh-session-persistence inspect；④ 会话数据实际存在 C:\Users\Kaplc\.dsh\sessions（单会话一个 session.jsonl.zstd 压缩流，无法只读尾部），用 Get-ChildItem 递归统计大小即可量化。踩坑：.dsh 目录下没有 sessions（在用户主目录）；zstd CLI 未安装无法直接解压测耗时；服务端有 DEFAULT_MAX_MESSAGES=50 兜底，不带 maxMessages 请求返回的不是全量，但 detached 会话每次请求仍要全量解压+解析整个日志再分页（preparations 缓存可复用但首次全价）。

## Effective Path

src/components/AgentPanel.tsx:1418 handleSwitchSession → src/editor/AgentService.ts:2170 switchSession / :2061 loadHistoryPage / :436 refreshSeqBaseline / :496 resumePendingTurnIfNeeded → dsh-host-apiproxy lib/index.js historySourceFor/paginate
