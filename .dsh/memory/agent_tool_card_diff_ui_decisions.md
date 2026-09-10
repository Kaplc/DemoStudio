---
name: agent_tool_card_diff_ui_decisions
description: agent 面板 write/edit 工具卡片的 diff 视图三条用户决策：默认自动展开、长 diff 不折叠、行号 ctx 白/del 红带-/add 绿带+
type: project
prefix: src/components/agent || doc/editor
---

**规则（2026-09-10 用户三轮反馈敲定，改这块别再改回去）：** agent 面板 write/edit 工具卡片的 diff 视图必须 ① **默认自动展开**（`useState(() => isDiffToolName(tool.name))`，点击头部仍可收起）；② **不折叠**——长 diff 全量渲染，不要「… 其余 N 行」折叠按钮（DSH WebUI 默认折到 16 行，本项目按用户要求去掉）；③ **行号列配色**：ctx 白（`--dsw-alias-label-primary`）、del 红（`--dsw-alias-state-error-primary` 且行号带 `-` 前缀）、add 绿（`--dsw-alias-state-success-primary` 且带 `+` 前缀），del/add 行另有红/绿底色。

**Why:** 用户参考的是带行号 gutter + 红绿行 + 符号前缀的 diff 风格（并非 DSH WebUI 的 DiffBlock——那个没有行号、且默认折 16 行）；卡片存在的意义就是"不用点开就能看清这次改了什么"。

**How to apply:** 改 `src/components/agent/ToolCard.tsx` / `toolDiff.ts` / `.tool-diff*` 样式前先读这三条；`tests/toolCardDiff.test.tsx`（收起/再展开、30 行全量渲染）与 `tests/e2e/agent/tool-card-diff.spec.ts`（computedStyle 精确 RGB 断言）是这三条决策的回归锁，改动要同步更新测试而不是绕过。

