---
name: agent_panel_f5_refresh
task_type: feature
outcome: success
date: 2026-09-16
prefix: [src/components/AgentPanel.tsx, e2e/agent/f5-refresh.spec.ts]
---
## Summary

给 agent 界面（独立窗口 agent.html / 内嵌面板）加 F5 刷新：AgentPanel 组件层 window keydown 兜底（裸 F5 接管，defaultPrevented/修饰键让路），e2e 4 例全绿并回滚验证判别器有效；踩到两个键盘事件派发机制坑已沉淀 memory:e2e_synthetic_key_event_pitfalls。

## Lessons

有效路径：①定位快——主编辑器 F5 在 KeyboardShortcuts.ts（location.reload），独立 agent 窗口入口 agent-main.tsx 无任何快捷键注册，内嵌面板又会被 INPUT 守卫吞键，结论"放 AgentPanel 共用组件层一处覆盖两窗口"是唯一同时修全三种形态的落点；②e2e 判别器设计先想"无特性时什么也会发生"——headless Chromium 的 F5 无默认刷新，但防环境漂移仍用 sessionStorage 记 defaultPrevented 终值（机制坑见 memory:e2e_synthetic_key_event_pitfalls）；③改完必做回滚验证（禁用 handler → 用例变红）才证明断言非 vacuous，本次第一轮回滚改错（把 defaultPrevented 检查提前=无操作）空欢喜一场，回滚必须真禁用；④并行会话信号：AgentPanel.tsx 中途 +3 行连续两次 "file changed since read"——重读确认自己锚点区域未被波及后立即重试，勿放大改动域（经验:warm_holo_close_keep_camera lesson6 同款）；⑤pwsh 的 > 重定向写文件是 UTF-16 LE，查 git blob 原始字节要用 node execSync Buffer，别被 FF FE 开头骗成"BOM 被抹"。

## Effective Path

src/components/AgentPanel.tsx（挂载期 F5 useEffect）；e2e/agent/f5-refresh.spec.ts（4 用例 + 判别器）；doc/editor/integration/agent_panel_system.md §15
