---
name: agentservice_stub_surface_sync
description: 给 AgentService 增加公开方法时，5 个挂载 AgentPanel 的测试桩必须同步补方法，否则 useState 初始化器抛 TypeError 全套件红
type: project
prefix: [src/editor/AgentService.ts, tests/agentStatusRows.test.tsx, src/components/AgentPanel.tsx]
---

**Problem:** 2026-09-30 给 AgentService 加 `getHealthScores/loadHealthScores/listGradientProposals/readGradientLedger` 四个公开方法后，AgentPanel 挂载类测试套件 5 个文件 21 例集体红（TypeError），与改动逻辑无关。

**Cause:** `AgentPanel` 的 `useState(() => agentService.getHealthScores())` 初始化器在挂载即调用新方法；5 个测试文件（agentStatusRows/agentPartialAdopt/agentLiveCardRace/agentQueueEdit/agentSlashCommandPanel）用 hoisted `svc` 字面量桩 mock 整个 agentService 单例——桩上没有的方法是 undefined，初始化器抛 TypeError 整树崩。事件分支里调用的 `loadHealthScores` 同理（connected/sessionsUpdated/turnEnd 三处）。

**Solution:** 给 AgentService 增加公开方法时，同步在 5 个 hoisted 桩里补对应方法（挂载期即调用的方法必须给，事件分支调用的也建议给）。锚点：各桩都有 `getSessionStatuses: vi.fn(() => ({}))` 行，在其后插 4 行即可。判定是否与本次改动相关：失败套件是否都挂载 AgentPanel × 是否调了新方法。

**Applicable:** 一切 AgentService 公开方法增改；AgentPanel 挂载类测试桩的维护。同构坑：SessionSidebar 等被 AgentPanel 下发 props 的子组件加 prop 时，`sessionSidebarGrouping.test.tsx` 的 props 需同步（可选 prop 则免）。

