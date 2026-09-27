---
name: dsh_slash_command_execute_rpc_only
description: DSH 斜杠命令只能经显式 commands.execute RPC 执行（后端不解析用户消息）；编辑器面板 slash 菜单纯展示导致 /xxx 被当普通消息发送
type: project
prefix: [src/components/agent/slash-command/types.ts, src/components/agent/slash-command/builtin-commands.ts, src/components/agent/InputBox.tsx]
---

# DSH 斜杠命令只能经显式 commands.execute RPC 执行（2026-09-27 诊断并已修复）

**规则：** DSH 斜杠命令的唯一执行通道是显式 `commands.execute` RPC——后端 `parseCommand` 全仓只在 `CommandRuntime.execute`（@Remote，dsh-commands 包）内被调用，**后端不会解析用户消息里的 `/xxx`**，带 `/` 前缀的文本按普通消息直达模型。官方 DSH WebUI 的执行链：conversation InputMachine.onEnter（/ 开头草稿 → adjudicate）→ 轮询 trigger source 的 matchEnter → ui-commands 按 session 命令目录（`commands.list` RPC，CommandDirectory 按 session 缓存；子代理会话返回空目录）解析 → bare 命令 consumeVia+runDetached → `remote.commands.execute(sessionId, line)`，生命周期落 command/run+command/done 事件；目录查无此命令 matchEnter 返回 undefined → default-sink 当普通消息发（有意兜底）。

**Why:** 2026-09-27 用户在编辑器面板输 `/compact` 回车被当普通消息发送。根因：编辑器面板 slash 菜单是**纯展示**——builtin-commands.ts 硬编码命令列表（仅 name+description），useSlashCommand.selectCommand 选中只回填 `/name ` 文本进输入框，submit 走普通 send；`slash-command/types.ts` 注释"文本发给 DSH 由后端执行"是错误假设。

**How to apply:** **已修复（2026-09-27，doc/editor/integration/agent_panel_system.md §23）**：`AgentPanel.handleSend` 顶部拦截 `/` 开头草稿 → `AgentService.resolveSlashSubmission`（目录裁决 → commands/execute；未命中回退普通消息；RPC 失败拒绝降级为消息）。wire 要点：typert remote 端点（`commands/list`/`commands/execute`）不在 host-apiproxy UNARY_ROUTES 表，走 TypertGatewayService 的 `/api` 拦截器——payload 必须是 `{ args: { agentId, line } }` 包装（字段名 agentId 非 sessionId），execute 返回 undefined = admission miss。命令菜单候选已改为拉 `commands.list` 真实目录（失败回退硬编码清单）。带图片附件的 `/` 文本不拦截（按普通消息）。

**复发判别器（2026-09-28 实测）：** 拦截"静默失效"（handleSend 入口日志后直接"正常发送消息"、无"未命中"日志）最常见根因是**编辑器渲染页面跑旧模块**——vite dev 页面 HMR 断连（dev server 重启/页面久开）后源码更新不生效，**内核重启不会刷新页面代码**（内核与渲染页是两个进程两层代码：新内核工具立即在册 ≠ 新前端逻辑生效）。判别器：日志栈帧行号 vs 源码行号漂移（本例 handleSend 日志在 1152，源码在 1506，差 354 行）。处置：刷新编辑器页面（F5/Ctrl+R）或重启编辑器进程，再试 /。

