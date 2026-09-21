---
name: react_stale_ref_guard_pitfall
description: React 函数式更新排队期守卫读滞后镜像 → 重复 UI 元素竞态（含 2026-09-21 flush 原地采纳语义）
type: project
prefix: [src/components/AgentPanel.tsx, src/components/agent/liveCardGuard.ts]
---

# React 函数式更新排队期守卫读滞后镜像 → 重复 UI 元素竞态

**Problem:** 2026-09-16 用户报告：切走再切回一个正在输出思考内容的会话，出现两张内容相同的思考卡，且半截段永久残留。修复落在 `src/components/AgentPanel.tsx` 的 `handleLiveReasoning`/`handleLiveContent` + 新纯函数 `src/components/agent/liveCardGuard.ts`（appendLiveCard）。

**Cause:** 两层。① 守卫读 `messagesRef`（useEffect 提交后才同步的滞后镜像）：切换/恢复把历史窗口（尾为 pendingPartial 半截段）setMessages 整表入队后、effect 同步前，reasoning.delta 穿过旧守卫，live 卡被追加排进历史窗口之后（React 函数式更新按入队顺序链接）→ 同文本两卡；flush 抵达时列表尾已是 live 卡，`replacingPartial` 判定失效，半截段永久残留。② 整表替换丢弃了替换前的 live 卡但 `liveAssistantIdRef` 未作废，后续 delta 按 id 原地更新找不到卡片，文本被静默吞掉。

**Solution:** 创建类判定必须放进 `setMessages` updater 用新鲜 `cur` 复查（裁决抽成纯函数 appendLiveCard：尾为半截段返回原引用=拦截，组件据此作废 ref；updater 内 ref 写值必须是幂等常量，StrictMode 双调用安全）。整表替换 setMessages 后必须作废所有指向列表内对象/身份的 ref。回归判别器：`tests/agentLiveCardRace.test.tsx` 的"竞态窗口判别器"用例——`resolveSwitch` 后 `await Promise.resolve()`（让续体先入队）再同步 emit delta，使历史入队与 delta 同宏任务；回滚验证确认旧代码下该用例红（两个同文本 reasoning 块）。通用规则：**任何"基于列表尾部状态"的守卫都不能读滞后镜像，要么放进 updater 用 cur，要么用同步维护的专用标记**。

**Applicable:** AgentPanel 消息管线（live 卡/半截段/flush 替换）；一切 React 列表守卫在 setMessages 与 effect 之间存在竞态窗口的场景。

**2026-09-20 更新（处置语义变更，竞态原则不变）：** 半截段守卫的处置已从"丢弃增量等 flush"改为"**原地续写**"（`handleLiveReasoning`/`handleLiveContent` 的续写分支：尾为 pendingPartial 时节流全量增量直接写进半截段 + streaming:true，理由是丢弃会让纯思考长回合切换后 UI 冻结到 flush，见 doc/editor/integration/agent_panel_system.md §19.2）。updater 内新鲜复查原则原样适用（续写分支同样用 cur 复查尾），appendLiveCard 仍守 live 创建路径，判别器 tests/agentLiveCardRace.test.tsx 回归通过。

**2026-09-21 更新（flush 侧配套语义，§22）：** 切回后 flush 抵达时对半截段**原地采纳免重放**（用户症状"下面那个思考卡很卡"= 旧 replacingPartial 清空半截段后按打字机 30~200 字/秒重放整段已上屏前缀 20-120s）。要点：① 半截段判定用**从尾向前扫描**而非只看末位——`ready{restored}` 恢复路径的 `pushSystem('会话已恢复')` 会把半截段顶离尾部，只认尾会让半截段永久残留成"两个思考卡片"；② a-skip 快速路径（queueLength>0 免回放直接 append）在存在半截段时必须让路，否则半截段残留 + 全文追加 = 同文两截；③ adopting 时 live 文本已含半截段全部内容，残留半截段一并移除；④ 同一 drain 链内 messagesRef 未重同步，陈旧预判多判时按"补全量"收敛，不会丢文本。判别器 tests/agentPartialAdopt.test.tsx（回滚验证双红：重放例 + 双卡例）。

