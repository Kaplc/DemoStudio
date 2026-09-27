---
name: diagnose_first_message_thinking_card_missing
task_type: debug/diagnosis
outcome: success
date: 2026-09-28
prefix: [src/components/AgentPanel.tsx, src/components/agent/tokenSpeed.ts]
---
## Summary

诊断"新会话首条消息思考链卡不出现但时速表正常"：日志取证 + 数据层特性反推，定位 handleNewSession 异步窗口孤儿 ref 静默吞 delta

## Lessons

有效路径：① 先辨 UI 归属再动手——"正在思考"卡在 DemoStudio 编辑器 AgentPanel（grep 中文串即知），不在 DSH WebUI bundle；② 排查流式渲染问题直接读 logs/console_*.log 的 [Trace] 管线（live 卡创建/放弃/原地采纳/消费显示队列/消息入队），对照回合时间线看"该有日志的地方有没有日志"；③ 关键反推：时速表（tokenSpeed.ts）是 5s 滚动窗口 + 300ms 心跳，**读数在跳 ⇔ 5 秒内必有 delta**——"速度有数但卡不出现"排除了"没数据"，剩下两条无日志路径：显示队列忙碌早退（本例可证队列空闲，排除）与 stale liveAssistantIdRef 的 else 分支按 id 更新（匹配不到=静默 no-op），唯一自洽；④ 根因是时序不是单点：clearDisplayQueue 在 createSession RPC **前**清了 ref，RPC 窗口内旧会话 delta 重建卡并重新武装 ref，RPC 返回后整表 setMessages 把卡丢掉——修法是"整表替换的落点处再作废一次 ref"，只在入口清一次防不住异步窗口；⑤ 对照组验证：相邻另一个新会话（创建窗口恰好没 delta）首条消息 6 秒正常建卡，证明非"首条消息特有路径"而是竞态窗口命中与否。规则沉淀见 memory:react_stale_ref_guard_pitfall（2026-09-27 段）。坑：AgentPanel.tsx 被并行会话实时编辑（本会话内 2372→2390 行两次漂移），引用行号必须配函数名锚点。

## Effective Path

logs/console_2026-09-26_214114.log（13876-13941 时序 + 14035 对照组）；src/components/AgentPanel.tsx handleNewSession/handleSwitchSession 空历史分支（修点）、handleLiveReasoning else 分支（吞 delta 点）、reasoning.delta case 采样先于 handleLive
