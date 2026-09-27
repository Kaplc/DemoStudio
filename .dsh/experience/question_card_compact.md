---
name: question_card_compact
task_type: feature/ui-compaction
outcome: success
date: 2026-09-27
prefix: [src/styles/editor.css, tests/e2e/agent/question-card-compact.spec.ts, doc/editor/integration/agent_panel_system.md]
---
## Summary

agent 面板提问卡片样式治理：2026-09-20 紧凑化（内距/字号/限高滚动），2026-09-27 宽度按用户新决策从 560 窄卡改回与输入框可见面等宽，紧凑化其余保留；e2e 宽度契约同步改为与 .composer__card 等宽断言

## Lessons

1. 宽度契约两变：780（等宽旧版）→ 560 窄卡（2026-09-20"占画面太多"）→ 回等宽 `calc(min(780px,100%)-48px)`（2026-09-27 用户圈截图"和输入框一样"）。输入框可见面 = composer 外层 max-width min(780px,100%) 减 24px×2 侧边距；对齐"可见面"要对 composer 的 padding 做减法，别照抄 .approval-card（它 min(780px,100%-48px) 实为对齐外层 780，宽出可见面 48px，注释与数学不符但用户未圈故未动）。改宽度决策前查 memory:agent_panel_ui_compact_preference 是否有更新定案。2. e2e 响应形状坑：AgentService.respond 浏览器模式 POST /api/respond，期望响应体顶层 {accepted:true}；套成 RPC result 信封 {result:{value:{accepted}}} 会让 answerQuestion 恒 false、卡片不消失（面板出"回答提交失败"系统行）。3. 行高预算断言要打在单行选项上：带 description 的选项天然两行（label 18 + desc 16 + 内距 8 + 边框 2 ≈ 45px）。4. e2e 让 QuestionCard 现身最短路径：MockWebSocket+fetch stub 三件套，question/requested 帧直投当前会话 sessionId。5. 根 package.json lint script 与新版 eslint 不兼容 exit 2（既有问题）；门禁按 memory:root_lint_script_broken 以 tsc --noEmit + playwright 为准。6. 【新坑】playwright 从仓库根目录跑 `npx playwright test tests/e2e/agent/xxx.spec.ts` 报 No tests found：config 在 tests/e2e/（testDir '.'），位置参数是正则、匹配 Windows 反斜杠绝对路径，正斜杠路径永不命中——必须 workdir=tests/e2e 且用文件名片段 `npx playwright test question-card-compact`。

## Effective Path

src/styles/editor.css（.question-card 区块 width）；tests/e2e/agent/question-card-compact.spec.ts（等宽断言）；doc/editor/integration/agent_panel_system.md §6.1；跑法：workdir tests/e2e + npx playwright test question-card-compact
