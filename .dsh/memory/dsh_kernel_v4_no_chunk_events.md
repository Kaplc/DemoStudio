---
name: dsh_kernel_v4_no_chunk_events
description: 内核 0.1.7-rc.2 无 chunk 会话事件：正文/推理回退 + 真流式恢复（瞬态帧旁路 seq 闸，2026-09-29 晚补全）
type: project
prefix: [src/editor/AgentService.ts, doc/editor/integration/agent_panel_system.md, tests/assistantMessageTextFallback.test.ts]
---

# 内核 0.1.7-rc.2 无 chunk 会话事件，实时正文从 assistant/message 回退

**Problem:** 2026-09-29（内核升级 0.1.7-rc.2 当天）用户报告 agent 面板"没有显示最终输出，要刷新才显示"：回合结束只有思考卡与注入卡，结论正文不上屏。

**Cause:** 内核 0.1.7-rc.2 起 chunk 增量不再产出 `assistant/chunk` **会话事件**（v4 会话格式 `session.v4.jsonl.zstd` 事件表中已无此类型），流式 delta 只走进程内 `agent/assistant-stream` 瞬态帧，客户端要经 `session.follow`（typert 流，需 `assistantStream: true` 显式订阅）才有。编辑器走 mux `session/event`（只广播持久事件）→ 实时正文只剩持久化的 `assistant/message`（落盘顺序 assistant/message 先于 step/end）；编辑器实时路径此前只认 text-delta → flush 恒 content=0。思考卡仍出现是因为 reasoning 早有回退、正文没有。

**Solution:** 两步。①（2026-09-29 早）assistant/message 回退：`handleSessionEvent` 该分支 `extractText` 非空且 `assistantBuf` 为空时并入缓冲 + `scheduleContentEmit()`（reasoning 侧同构更早已有）；流式内核下缓冲已有全文，回退 no-op 不双份。判别器 `tests/assistantMessageTextFallback.test.ts`。②（2026-09-29 晚）真流式恢复——桥 `electron/main.ts handleMuxFollowValue` 翻译 assistant-stream 帧时曾标 `seq: meta.cursor`：cursor 与渲染层 `_lastSeq` 由同一批持久事件锁步恒相等，`consumeSessionEvent` 的 `seq <= _lastSeq` 闸把每个瞬态帧 100% 吞掉（症状=思考卡从不流式、回合边界一次性弹出，日志指纹=「live 卡创建 N 字符」与 flush「reasoning=N字符」恒等）。修法：瞬态帧改带 `transient: true`（无 seq），渲染层旁路 seq 闸直入 handleSessionEvent（不推进 `_lastSeq`、switchHoldback 窗口内直接丢弃、`*BufLastSeq` 只在 `typeof event.seq === 'number'` 时写入——水位被瞬态值污染会让 seedPendingTurn 的 adopt 退化成拼接采纳）。**WebUI 契约**（dsh-agent runtime-types.d.ts AssistantStreamFrame）：瞬态帧 `{start|chunk|end, attemptId, revision, chunk: 原始StreamChunk}`——chunk 就是 `reasoning-delta`/`text-delta` 原词表无需展开；连续性靠与 seq 无关的密集 revision，瞬态是呈现数据不作回放来源。测试：`tests/muxTransientChunkStream.test.ts` + e2e `tests/e2e/agent/live-reasoning-stream.spec.ts`（回滚双红）。详录 doc §25/§26。

**Applicable:** AgentService 会话事件消费（handleSessionEvent / loadHistory fold）；一切"实时收不到、刷新后有"类症状先查内核事件契约是否变更；解码会话文件注意 v4 文件名 `session.v4.jsonl.zstd`。
