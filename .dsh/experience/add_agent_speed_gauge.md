---
name: add_agent_speed_gauge
task_type: feature
outcome: success
date: 2026-09-21
prefix: [src/components/agent/tokenSpeed.ts, src/components/agent/SpeedGauge.tsx, tests/e2e/agent/speed-gauge.spec.ts]
---
## Summary

（二轮更新）agent 面板输入框右下角汽车时速表：实时速度 delta 差分滚动窗口估算驱动弹簧指针；平均速度展示经两轮反馈（指针/读数不一致→整体移除）已删，只留实时

## Lessons

① DSH WebUI 没有实时速度表——它的 tok/s 全部来自 sessionStats 投影回合结算均值（stats 条 = decodeTokens/decodeMs），实时指针是编辑器侧扩展，tooltip 标注"估算"。② 实时速度数据源 = reasoning.delta/content.delta（60ms 节流全量）按长度差分取追加量（CJK≈1 token/字、其余≈1/4），5s 滚动窗口；采样要放在面板 handleLive* 早退之前（显示队列忙碌丢弃上屏时仍要计入速度），turnEnd 必须 reset 防跨回合串算。③ 最大踩坑：合成 assistant/chunk 帧发累计全量文本 → 服务端 assistantBuf += chunk.text 二次方膨胀 → 读数飙 10 倍+；text-delta 是增量（规则见 memory:dsh_text_delta_is_increment），靠临时插桩 dump observe 输入的长度序列（等差 vs 二次方）一次定位。④ e2e 驱动实时链路的可复用装置：addInitScript 里 FakeWebSocket 只对 /api/events.mux 立即 open 并登记实例，页面暴露 window.__pushMuxFrame 直接喂 mux 帧，配合 localStorage 会话映射走 recovering 路径——无需真 DSH、无副作用测「mux 帧→节流→面板」全管线。⑤ 仪表盘类 UI 的直觉契约：**主读数必须与指针一致**。初版"空闲回落显示会话平均"被用户当 bug 报（指针 0 数字 43），先改成主读数恒实时+平均降级小字，用户随即干脆要求移除平均展示——辅助口径要么明确标注要么不展示，别让次要数据冒充主读数；移除时要连数据管道一起回退（SessionInfo.stats/averageTokPerSecond/测试断言），doc §18 标注"别再加回来"。⑥ 并行会话环境：AgentService/editor.css/AgentPanel 都可能被并行 agent 改（本轮 listSessions 已被改成 single-flight 包裹），edit 撞 "file changed since read" 就重读锚点区重试；tsc/vitest 验收按自己触达文件过滤比对基线。

## Effective Path

src/components/agent/tokenSpeed.ts + SpeedGauge.tsx（新）；AgentPanel（delta 采样/300ms 心跳）+ InputBox 接线；tests/e2e/agent/speed-gauge.spec.ts（伪 WS 注入）。注意 sessionStats 透传与 averageTokPerSecond 已随平均展示移除而回退
