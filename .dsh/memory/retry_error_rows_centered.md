---
name: retry_error_rows_centered
description: 用户定案 2026-09-18：retry（N 次重试）与 turn-error 状态行用系统消息同款居中弱化样式，不再用全宽事件卡；turn-max-tokens 仍是事件卡（范围外）
type: project
prefix: [src/components/AgentPanel.tsx, tests/agentStatusRows.test.tsx, tests/e2e/agent/status-rows-centered.spec.ts]
---

# 重试 / 回合错误状态行居中样式定案（2026-09-18）

**规则：** AgentPanel 消息流里 retry（"N 次重试"）与 turn-error（如 "Connection error."）两条状态行渲染为系统消息同款居中弱化样式（`.message.message--system` + `.message__body`，与 MessageBubble 系统消息同一套类），不再用全宽 `agent-event-card`；retry 分支不要求 `msg.retries` 存在（content 恒有值，缺明细也应居中）。样式复用零新增 CSS，原 `--retry`/`--error` icon 配色规则已删。

**Why:** 用户 2026-09-18 截图圈定"这两个消息改成和会话恢复那个系统消息一样在中间就行"——弱状态提示不配占整行卡片。细节见 doc/editor/integration/agent_panel_system.md §17。

**How to apply:** 改 `AgentPanel.tsx` renderNode 的 retry/turn-error 分支或 `.message--system` 样式前先读 §17；**turn-max-tokens（上下文截断）仍是事件卡**，用户只圈了重试/错误两条，别顺手扩大范围。回归锁：tests/agentStatusRows.test.tsx（含 max-tokens 范围外回归锁）+ tests/e2e/agent/status-rows-centered.spec.ts。

