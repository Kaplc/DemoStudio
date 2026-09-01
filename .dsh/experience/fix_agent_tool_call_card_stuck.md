---
name: fix_agent_tool_call_card_stuck
task_type: debug
outcome: partial
date: 2026-09-02
---
## Summary

调查编辑器 agent 消息卡片不显示 toolCall 卡片（记忆工具不显示卡片、结论输出时上一张卡片卡住）：追踪 MessageBubble→renderNodes→StepProcess→ToolCard→drainDisplayQueue 渲染链路，先修复 renderNodes 中 tool 消息收集条件（cur.tool 为 undefined 时静默跳过导致工具调用丢失），后转向队列消费顺序，定位到 handleToolResult 在 tool 消息落地前 findIndex 返回 -1 的竞态。

## Lessons

排查 UI 渲染问题应沿渲染链路自上而下 grep：MessageBubble → renderNodes → StepProcess → ToolCard，先确认 tool 消息是否被收集进 step；`cur.role === 'tool' && cur.tool` 这类条件会静默丢弃 tool 字段缺失的消息，收集 step 时应允许无 tool 消息跳过但不中断循环；竞态排查要确认事件顺序——tool 消息先入队列，handleToolResult 到达时消息可能还没写入 messages，findIndex 返回 -1 导致状态更新丢失；用户澄清'最后的结论输出时上一个卡片卡住'把方向从渲染逻辑转到队列消费顺序，遇到模糊反馈应追问具体场景而非继续猜。

## Effective Path

src/components/AgentPanel.tsx（renderNodes + drainDisplayQueue/handleToolResult）
