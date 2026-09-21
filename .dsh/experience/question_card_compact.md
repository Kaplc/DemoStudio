---
name: question_card_compact
task_type: feature/ui-compaction
outcome: success
date: 2026-09-21
prefix: [src/styles/editor.css, tests/e2e/agent/question-card-compact.spec.ts, doc/editor/integration/agent_panel_system.md]
---
## Summary

紧凑化 agent 面板提问卡片（纯 CSS：窄卡 780→560 + 收紧内距字号 + 选项区限高滚动），配 e2e 紧凑度回归锁与文档 §6.1 同步。

## Lessons

1. 这类"面板占画面太多"纯 CSS 可解：组件/类名零改动，只收 editor.css 对应区块——宽度降档 + 内距/字号/行距全线收紧 + 容器 max-height 限高滚动，视觉层级保持。2. e2e 响应形状坑：AgentService.respond 浏览器模式 POST /api/respond，期望响应体**顶层** {accepted:true}；套成 RPC result 信封 {result:{value:{accepted}}} 会让 answerQuestion 恒 false、卡片不消失（面板出"回答提交失败"系统行）。3. 行高预算断言要打在**单行选项**上：带 description 的选项天然两行（label 18 + desc 16 + 内距 8 + 边框 2 ≈ 45px），预算写 32px 必挂。4. e2e 让 QuestionCard 现身的最短路径：复用 notice spec 的 MockWebSocket+fetch stub 三件套，把 question/requested 帧直投**当前会话** sessionId（handleMuxFrame 当前会话分支直进 pendingQuestions），无需切会话 adopt。5. 根 package.json 的 lint script（eslint src --ext）与新版 eslint 不兼容 exit 2（既有问题，与改动无关）；门禁按 memory:root_lint_script_broken 以 tsc --noEmit（0 错）+ playwright 为准。

## Effective Path

src/styles/editor.css（.question-card 区块）；tests/e2e/agent/question-card-compact.spec.ts；doc/editor/integration/agent_panel_system.md §6.1
