---
name: agent_panel_ui_compact_preference
description: 用户多次要求 agent 面板 UI 紧凑低占面（气泡/状态行/提问卡片），面板新 UI 默认紧凑设计、避免全宽大卡片
type: feedback
prefix: [src/styles/editor.css, src/components/AgentPanel.tsx]
---

# agent 面板 UI 默认紧凑低占面（2026-09-13 起多轮同类纠正）

**规则：** agent 面板新增/修改 UI（交互卡片、气泡、状态行、浮层）默认按紧凑低占面出稿：窄卡（不用全宽等宽）、小内距小字号、限高滚动代替无限撑高；弱状态提示用居中/徽标等弱化形态，不配整行大卡片。

**Why:** 用户连续多轮同类反馈：跨会话气泡三轮迭代收敛为单行紧凑 + 8s 收起成徽标（2026-09-14）；retry/回合错误行改系统消息同款居中弱化样式，"弱状态提示不配占整行卡片"（2026-09-18）；提问卡片 780px 全宽被要求窄化为 560px，"占的画面太多了"（2026-09-20）。

**How to apply:** 在 AgentPanel / editor.css 做面板 UI 设计或评审时主动按紧凑预算实现，别等用户打回；再遇"占画面太多"类反馈优先压缩尺寸/限高，而不是加折叠功能。各控件的具体定案分散在 retry_error_rows_centered、add_session_notice_bubble 记忆与 experience:question_card_compact 中，不复述。

