# assistant/chunk text-delta 是增量，content.delta 才是全量（2026-09-19 实证）

**Problem:** 时速表 e2e 注入合成 `assistant/chunk` 帧时每帧发累计全量文本，面板速度读数飙到数百 tok/s（预期 ~50），文本缓冲 2 秒膨胀到 ~5200 字符。

**Cause:** DSH 线上契约：`assistant/chunk` 的 `chunk.text`（text-delta / reasoning-delta）是**增量**，服务端 `AgentService.handleSessionEvent` 做 `assistantBuf += chunk.text`；每帧发全量 → 缓冲按 Σ16·k(k+1)/2 二次方膨胀（16→48→96→160…）。而服务端下发的 `content.delta` / `reasoning.delta` 才是 60ms 节流后的**全量**缓冲文本。

**Solution:** 测试注入只发增量（`chunk: { type: 'text-delta', text: piece }`）；消费侧需要全量时用 `content.delta` 的 text。判别方法：dump 每次到达文本的长度序列，增量=等差、全量=二次方。

**Applicable:** 一切合成 mux `session/event` 帧的 e2e/探针（speed-gauge.spec.ts 模式）；`src/editor/AgentService.ts` 缓冲/节流链路改动；任何按 content.delta 差分估算的客户端统计。
