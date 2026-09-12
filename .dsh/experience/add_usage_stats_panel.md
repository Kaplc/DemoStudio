---
name: add_usage_stats_panel
task_type: feature
outcome: success
date: 2026-09-10
prefix: [src/components/agent/UsageStatsPanel.tsx, src/components/AgentPanel.tsx]
---
## Summary

给 agent 面板头部「更多」下拉菜单加 Token 消耗统计弹窗（统计行+17周热力图+近7/30日趋势图）：数据走 session.list 行内投影零日志加载，纯函数聚合层 + 条件渲染面板组件，vitest 32 分支 + e2e 2 条 + 双截图实机验证全过。

## Lessons

有效路径：① 用量/统计类需求先查 DSH 投影再考虑拉历史——session.list 每行自带 projections.values.tokenUsage（dsh-token-meter 四桶累计）与 sessionStats（dsh-session-stats 墙钟），278+ 会话一次 RPC 全拿到，POST http://127.0.0.1:3080/api/session.list 可现场验证形状；② 口径决策已入 doc §11：会话用量按 updatedAt 活跃日归属（投影无逐事件时间分布，逐事件分桶需全量拉历史不可承受），连续天数今天未活跃宽限跳一天。踩坑：③ vitest 3 的 vi.fn 是单函数签名泛型 vi.fn<() => T>，旧版 TArgs,TReturn 双参数直接编译错；④ e2e 的 Node fetch 探测 Vite /api 代理首访预热可超 3s（整套用例被 skip 还以为是环境问题）——5s 超时+2 次重试；且 PowerShell Invoke-WebRequest 探 localhost:5173 会假超时而 Node fetch 同 URL 200，别用 PS 结果误判代理故障；⑤ 统计行两个格子可能合法同值（单日峰值=累计），getByText 会多元素匹配报错，按 closest('.usage-stats-cell') 作用域断言；⑥ 面板必须条件渲染（每次打开重拉数据），勿改成常驻 visible prop。
