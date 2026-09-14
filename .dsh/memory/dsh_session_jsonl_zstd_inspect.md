---
name: dsh_session_jsonl_zstd_inspect
description: 会话文件 session.jsonl.zstd 是多帧 zstd 追加、需按帧魔数切分解压；事件行含 source.plugin 可溯源注入消息的来源插件
type: project
prefix: [harness/ds-reminder/src/index.ts, harness/ds-memory/src/index.ts]
---

**Problem:** 需要溯源"某条注入消息（提醒/联想/steer）到底是谁注入的、会话里真实事件序列是什么"——console 日志只有 `[Trace][msg-list] +hist` 行（文本截断、无 source 字段），编辑器面板看不到原始事件。
**Cause:** 会话事件落盘在 `~/.dsh/sessions/--<cwd 编码>--/session-<id>/session.jsonl.zstd`，是**多帧 zstd 追加**文件：`zlib.zstdDecompressSync` 只解出第一帧（仅 session 头一行），整文件直接解压会误判为"没有任何事件"。
**Solution:** 用 node `zlib.zstdDecompressSync` 按帧魔数 `28 B5 2F FD` 切分逐帧解压后拼合（参考实现写临时 .cjs 跑，PowerShell 内联正则会转义翻车）；每行一个事件 JSON（`type`/`seq`/`time`/`data`），注入消息的来源看 `data.message.source.plugin`（`@demostudio/ds-*`）+ `role`。压缩实现在 `@deepseek-ai/dsh-session-persistence-jsonl`（直接用 node:zlib 的 zstd* 函数，无第三方依赖）。
**Applicable:** 排查"消息重复/注入来源/会话真实事件序列"类问题（实例：2026-09-14 回合末提醒双发溯源）；先用 console 日志 `+hist` 行定位时间点，再到会话文件核对 source。
