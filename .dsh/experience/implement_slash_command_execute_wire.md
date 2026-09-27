---
name: implement_slash_command_execute_wire
task_type: feature
outcome: success
date: 2026-09-28
prefix: [src/editor/AgentService.ts, src/components/AgentPanel.tsx, src/components/agent/slash-command/builtin-commands.ts]
---
## Summary

（二轮更新）编辑器面板斜杠命令执行链路：handleSend 拦截 → resolveSlashSubmission 目录裁决 → commands/execute RPC；二轮补 images 必填字段与页面旧模块缓存判别器

## Lessons

有效路径：① DSH :3080 有两套 RPC 协议共用 /api 前缀——unary 路由（session.prompt 等，点号 method、裸 payload、sessionId 字段，schema 在 dsh-host-apiproxy fetch/handler.js 的 UNARY_ROUTES 表）与 typert remote 端点（namespace/method 斜杠形式、payload 必须恰好一个 args 字段、agentId 字段）；commands/list、commands.execute 只在后者，套错协议 404。② server 侧分发机制：TypertGatewayService（dsh-api-gateway）向 /api 通道注册 intercept（claimsEndpoint 认领 2 段式端点），createSharedFetchHandler 让拦截器优先于 unary fallback——新增"面板要调 host 服务"时先分辨目标在哪张表。③ Electron IPC 桥（main.ts dsh-rpc）原样透传 method/payload，斜杠 method 与 {args} 信封无需改桥，只需加可选 timeoutMs（压缩类命令 120s）。④ 渲染零成本复用：command/run+command/done+compaction/* 事件 AgentService/AgentPanel 早已解析渲染（pushSystem 系统行），执行侧只需发 RPC。⑤ 测试：AgentService 层 fetch 桩断言信封形状（url/method/payload.args）；面板层 hoisted mock + 点发送按钮绕开斜杠菜单 Enter 拦截（菜单开着时 Enter 被 selectCommand 吃掉回填文本）；e2e 用 stub 的 setTimeout 回推 mux command/run 帧验证系统行渲染；回滚探针（if (false && …) 禁用拦截）下命中例红/未命中回退例绿=判别器非 vacuous。⑥ （2026-09-28 实机补坑）commands/execute 的 args 是**三字段**：agentId/line/images——images 必填（typert strict 校验按 descriptor 逐字段查，缺字段报 "args fields do not match the descriptor: missing images"，实机才暴露；单测桩不校验抓不到）；无图提交传空数组。教训：typert 端点的必选参数以 dsh-commands/lib/typert.host.js 的 parameters 表为准逐个核对，别只凭成功过的调用样例定信封形状。⑦ 前端旧模块缓存变体：拦截"静默失效"（无"未命中"日志直接走发送）+ 日志栈帧行号与源码对不上 = 页面跑旧模块（vite HMR 断连），刷新页面即愈，别急着改代码（判别器详见 memory:dsh_slash_command_execute_rpc_only 2026-09-28 段）。

## Effective Path

src/components/AgentPanel.tsx（handleSend 拦截）+ src/editor/AgentService.ts（listCommands/executeCommand/resolveSlashSubmission）+ tests/agentSlashCommandResolve.test.ts + tests/e2e/agent/slash-command-execute.spec.ts
