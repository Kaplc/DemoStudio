---
name: retry_error_rows_centered
task_type: feature/ui-fix
outcome: success
date: 2026-09-16
prefix: [src/components/AgentPanel.tsx, tests/agentStatusRows.test.tsx, tests/e2e/agent/status-rows-centered.spec.ts]
---
## Summary

把 agent 面板的 retry（N 次重试）与 turn-error（Connection error.）状态行从全宽事件卡改为系统消息同款居中样式，单测+e2e 双回归锁并回滚验证

## Lessons

①截图定位先辨 UI：先 grep 文案字符串（"次重试"/"推理 N 段"只在 DemoStudio AgentPanel 命中），DSH WebUI bundle 无这些中文串，别改错仓库。②断言"与 X 同款"最稳的写法是对照组：e2e 里用面板自带的内置系统消息（恢复路径必 prepend 的「对话已恢复」）取 computedStyle 基准，断言新行 text-align/color 与基准相等，比硬编码 RGB 抗样式演进。③回滚验证用「临时还原旧渲染→4红1绿（范围外回归锁保持绿）→恢复修复→全绿」闭环，红绿名单同时验证了判别器有效与范围锁不误伤。④防御分支顺手统一：retry 渲染分支原来要求 msg.retries 存在，缺明细会退回左对齐气泡——收敛为只判 role，单测补一条防回退。⑤变死代码的 CSS 配色规则（--retry/--error）当轮删除并留注释锚点，避免后人以为还有卡片在用。

## Effective Path

src/components/AgentPanel.tsx（renderNode retry/turn-error 分支）；tests/agentStatusRows.test.tsx；tests/e2e/agent/status-rows-centered.spec.ts（stubAgentPage 复用 tool-card-diff 模式）
