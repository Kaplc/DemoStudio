---
name: diagnose_slash_command_sent_as_message
task_type: debug/diagnosis
outcome: success
date: 2026-09-27
prefix: [src/components/agent/slash-command/useSlashCommand.ts, src/components/agent/slash-command/builtin-commands.ts]
---
## Summary

诊断"面板输入 /compact 回车后被当普通消息发送"：确认编辑器面板 slash 菜单纯展示（选中只回填文本），而 DSH 后端只在 commands.execute RPC 内解析命令、不会解析用户消息；官方 DSH WebUI 靠 matchEnter 认领→commands.execute RPC 执行。

## Lessons

有效路径：① DSH npm 包结构——lib/ 只有 bootstrap，真实代码全在 node_modules/@deepseek-ai/dsh-* 子包，按包名（dsh-client-ui-commands/dsh-client-ui-input-trigger/dsh-client-ui-conversation/dsh-commands/dsh-command-compact）直接读 lib/client.js；② 权威链路：conversation InputMachine.onEnter 对 / 开头草稿走 adjudicate → 轮询 source.matchEnter → ui-commands 按 session 命令目录（commands.list RPC，CommandDirectory 缓存）解析 → bare 命令 runDetached→remote.commands.execute；目录无此命令返回 undefined → default-sink 当普通消息发（这是官方的有意兜底）；③ 关键反证：grep dsh-web-frontend/dist 无 matchEnter + 面板截图特征（时速表/上下文注入行）→ 用户用的是编辑器自有面板而非 DSH 官方前端，别在 dsh 包里找编辑器 UI 的 bug；④ parseCommand 全仓只在 CommandRuntime.execute 内被调用——"后端会解析消息里的命令"是 types.ts 注释里的错误假设，验证一个假设是否成立要 grep 它的唯一调用点。
