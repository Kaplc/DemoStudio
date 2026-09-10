---
name: merge_switch_session_history_rpcs
task_type: feature/performance-optimization
outcome: success
date: 2026-09-10
---
## Summary

把编辑器切会话的三次 session.history RPC（seq 基线前跳 + 未闭合回合探测 + 尾页加载）合并为一次：尾页 fold 原子立基线、页内 scanUnclosedTurn 判运行态、switchHoldback 暂存窗口事件防双路径重复消费，单测 8/8 通过，文档同步 §4.6。

## Lessons

有效路径：① 合并的依据是 loadHistory 已有的「fold 结束原子推进 _lastSeq」语义（连接恢复路径从不预立基线照常工作），refreshSeqBaseline 在切会话路径属冗余；② 关键风险点是 setSession 清基线到 fold 立起之间的 RPC 往返窗口，mux 仍在推流——用 switchHoldback 数组暂存事件、fold 后按 seq 门限重放（≤基线被去重丢弃），比「事后补基线」或「丢弃事件」都安全；③ 未闭合回合探测改成页内纯函数 scanUnclosedTurn 后可直接 vitest 全分支覆盖。踩坑：① 编辑 AgentPanel.tsx 时撞 file-changed-since-read（并行修改者在改同一文件，重读再改即可）；② 根项目 npm run lint 必失败（eslint 未安装无配置，已存记忆 root_lint_script_broken），用 npx tsc --noEmit + npx vitest run 当门禁；③ 全量单测有 3 个存量失败（warmCurrentShipCap/warmCurrentFleetMaint/planetShellScale），用 git stash 推走自己的改动复跑验证「无我改动也失败」再下结论，避免误判；④ memory_write 本会话持续报 value is not lossless JSON（老坑复发），按半自动约定手动三步落盘。

## Effective Path

src/editor/AgentService.ts:2204 switchSession / :230 scanUnclosedTurn / :2086 loadHistoryPage → src/components/AgentPanel.tsx:1422 handleSwitchSession；doc/editor/integration/agent_panel_system.md §4.6
