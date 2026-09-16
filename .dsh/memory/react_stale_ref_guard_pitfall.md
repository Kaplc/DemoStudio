---
name: react_stale_ref_guard_pitfall
description: React 面板双思考卡竞态根因：函数式更新排队期间守卫读了滞后的 messagesRef 镜像；守卫判定必须放进 updater 用新鲜 cur，整表替换后作废指向列表内容的 ref
type: project
prefix: [src/components/AgentPanel.tsx, src/components/agent/liveCardGuard.ts]
---

# React 函数式更新排队期守卫读滞后镜像 → 重复 UI 元素竞态

**Problem:** 2026-09-16 用户报告：切走再切回一个正在输出思考内容的会话，出现两张内容相同的思考卡，且半截段永久残留。修复落在 `src/components/AgentPanel.tsx` 的 `handleLiveReasoning`/`handleLiveContent` + 新纯函数 `src/components/agent/liveCardGuard.ts`（appendLiveCard）。

**Cause:** 两层。① 守卫读 `messagesRef`（useEffect 提交后才同步的滞后镜像）：切换/恢复把历史窗口（尾为 pendingPartial 半截段）setMessages 整表入队后、effect 同步前，reasoning.delta 穿过旧守卫，live 卡被追加排进历史窗口之后（React 函数式更新按入队顺序链接）→ 同文本两卡；flush 抵达时列表尾已是 live 卡，`replacingPartial` 判定失效，半截段永久残留。② 整表替换丢弃了替换前的 live 卡但 `liveAssistantIdRef` 未作废，后续 delta 按 id 原地更新找不到卡片，文本被静默吞掉。

**Solution:** 创建类判定必须放进 `setMessages` updater 用新鲜 `cur` 复查（裁决抽成纯函数 appendLiveCard：尾为半截段返回原引用=拦截，组件据此作废 ref；updater 内 ref 写值必须是幂等常量，StrictMode 双调用安全）。整表替换 setMessages 后必须作废所有指向列表内对象/身份的 ref。回归判别器：`tests/agentLiveCardRace.test.tsx` 的"竞态窗口判别器"用例——`resolveSwitch` 后 `await Promise.resolve()`（让续体先入队）再同步 emit delta，使历史入队与 delta 同宏任务；回滚验证确认旧代码下该用例红（两个同文本 reasoning 块）。通用规则：**任何"基于列表尾部状态"的守卫都不能读滞后镜像，要么放进 updater 用 cur，要么用同步维护的专用标记**。

**Applicable:** AgentPanel 消息管线（live 卡/半截段/flush 替换）；一切 React 列表守卫在 setMessages 与 effect 之间存在竞态窗口的场景。

