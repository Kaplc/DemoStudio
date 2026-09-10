---
name: cdp_auto_port_discovery
task_type: feature
outcome: success
date: 2026-09-10
prefix: harness/ds-editor-tools
---
## Summary

将 ds-editor-tools 的 CDP 连接从固定 9222 端口改为三级自动发现：先试 9222 → 读 DevToolsActivePort 文件 → 扫描 9223-9232 端口范围

## Lessons

Electron 的 --remote-debugging-port=0 会随机分配端口，实际端口写入 userData/DevToolsActivePort 文件（第一行是端口号，第二行是 WebSocket URL）。当 9222 被幽灵 socket 占用时（上次进程没干净退出），Electron 会降级到随机端口。探测端口是否活着不要用裸 TCP，直接请求 /json/version（CDP 标准端点）更可靠。Windows 下 PowerShell 调 node.exe 有 StandardErrorEncoding/StandardOutputEncoding 兼容问题，用 Start-Process + RedirectStandardOutput 绕过。

## Effective Path

harness/ds-editor-tools/src/cdpBridge.ts
