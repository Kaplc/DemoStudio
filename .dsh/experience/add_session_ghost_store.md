---
name: add_session_ghost_store
task_type: bugfix
outcome: success
date: 2026-09-21
prefix: [src/editor/sessionGhostStore.ts, src/editor/AgentService.ts, src/components/AgentPanel.tsx, src/components/agent/VirtualList.tsx, tests/e2e/agent/ghost-switch.spec.ts]
---
## Summary

（四轮更新）虚拟会话数据层+快速路径；半截段续写修复"切思考中会话卡住"；上翻加载视口锚定（totalHeight 增量补偿收敛）修复"列表跳变"

## Lessons

1. 用户实测回归"上翻加载后列表跳变、不从停止处开始"。第一版 key 锚定方案实测失效，铁证靠 dataset.debug（锚定 effect 各分支往容器 dataset.anchorDebug 写状态，e2e 断言失败信息带出）：`cleared idx=-1 anchorKey=…-77 items0=…-53 n=1`——锚 key 在 items 里消失。2. 深层机制：AgentPanel 的 renderNodes 把连续 assistant/tool 消息聚合成 step 节点（key=组内首条消息 id）——prepend 改变聚合边界后旧 item key 直接消失，**key 锚定在"聚合型虚拟列表"上根本不成立**；换 totalHeight 增量补偿收敛（每次测量增长把增量补进 scrollTop，400ms 无增长/2s 超时/wheel 终止），不依赖 key。3. mock 分页数据全是 assistant 时 turnStartIndices（以 user 消息为轮界）返回空 → previousHistoryStart=null → 走 RPC 分支——mock 造数据要了解被测轮窗口机制的分界定义。4. Playwright getByText 前缀匹配多元素撞 strict mode，重复文本断言用 .first()。5. spec 的 INIT_SCRIPT 是外层模板串，页面侧代码里再写反引号模板串会提前闭合外层串报 SyntaxError Missing semicolon——页面侧只用普通拼接。6. 编辑器黑屏（React 崩溃）先看 page-errors.log 附件（ReferenceError 直接指出未定义变量），比猜快。
