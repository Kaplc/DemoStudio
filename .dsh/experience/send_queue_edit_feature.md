---
name: send_queue_edit_feature
task_type: feature
outcome: success
date: 2026-09-21
prefix: [src/components/AgentPanel.tsx, src/components/agent/InputBox.tsx, tests/agentQueueEdit.test.tsx, tests/e2e/agent/send-queue-edit.spec.ts, doc/editor/integration/agent_panel_system.md]
---
## Summary

给 agent 面板队列发送条目补「撤回重新编辑」：铅笔按钮把排队消息取回输入框（文本并入草稿/图片放回草稿/接管作废/聚焦置尾），vitest 7 例 + e2e 4 例 + 回滚验证全过

## Lessons

① e2e 断言时机坑：队列按钮只在 running && 输入框非空时渲染（isEmpty 门控），发完消息立即断言按钮可见必挂——先 fill 排队文本再断言/点击。② vitest 文件级 hoisted mock 单例的 vi.fn 调用计数跨用例累积，按次数断言前必须 beforeEach mockClear（症状：期望 1 实得 5）。③ React 18 类型下 useRef<T>(null) 的 current 只读，回调 ref 要把实例同步到外部 ref 时声明必须写 useRef<T | null>(null)（MutableRefObject）。④ pwsh Set-Content -Encoding UTF8 会引入 BOM 且 playwright 照跑不报错——批量改文件后按 memory:edit_tool_strips_utf8_bom 检查字节头剥离。⑤ 回滚验证用 no-op onClick 一行禁用 handler，主链路用例精确变红才证明判别器非 vacuous。⑥ 全仓 tsc 门禁被并行流半成品打破时（e2e 迁移期间 projects/*/e2e 大量 TS 报错），判定标准是错误文件与本次改动域求交集，别去修别人的半成品。

## Effective Path

src/components/AgentPanel.tsx（handleEditQueuedSend + composerInputRef）+ src/components/agent/InputBox.tsx（inputRef）+ tests/agentQueueEdit.test.tsx + tests/e2e/agent/send-queue-edit.spec.ts + doc/editor/integration/agent_panel_system.md §20
