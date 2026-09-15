---
name: toolcard_summary_multi_params
task_type: feature/ui-fix
outcome: success
date: 2026-09-15
prefix: [src/components/agent/ToolCard.tsx, tests/toolCardDiff.test.tsx, tests/e2e/agent/tool-card-diff.spec.ts]
---
## Summary

编辑器 agent 面板工具卡片头部摘要只显示第一个字符串参数（grep 卡片只见 include=*.ts 漏 pattern），改为全部单行短字符串参数 key=value 全展示，vitest+e2e 同步加锁。

## Lessons

1. 根因：summary memo 只取第一个字符串参数值，多参数工具（grep {include, pattern}）头部漏显后续参数；修法是收集全部"单行且≤60字符"的字符串，≥2 个时按入参序拼 key=value（整行 120 截断），单个仍只显值——保住 read/glob/write 头部外观，write content/长 old_string（多行或超长）不进摘要。2. 踩坑：摘要的 JSON 回退是紧凑 JSON.stringify(obj)（无缩进），测试断言写成 '"screenX": 960' 带空格直接挂，应为 '"screenX":960'。3. 回归锁复用现成合成历史 e2e 装置（tests/e2e/agent/tool-card-diff.spec.ts 的 stubAgentPage），加 GREP_EVENTS 即可在真实面板页面断言头部文案，跑法 npx playwright test -c tests/e2e/playwright.config.ts agent/tool-card-diff。4. 根 eslint（v10 flat config）在本仓不可用，静态检查用 npx oxlint 兜底（0 配置可跑）。

## Effective Path

src/components/agent/ToolCard.tsx（summary memo）+ tests/toolCardDiff.test.tsx + tests/e2e/agent/tool-card-diff.spec.ts
