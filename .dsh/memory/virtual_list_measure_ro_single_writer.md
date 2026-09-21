---
name: virtual_list_measure_ro_single_writer
description: VirtualList 高度缓存 RO 单一写入者规则：measureRef 禁止静默预写/提交期 setState——前者吞贴底跟随、后者打破 prepend 视口锚定
type: project
prefix: [src/components/agent/VirtualList.tsx]
---

# VirtualList 高度测量：RO 单一写入者（2026-09-21 定案）

**规则：** `src/components/agent/VirtualList.tsx` 的高度缓存 `heightCacheRef` 唯一写入者是 itemRO（observe 首次通知 + 后续尺寸变化）。`measureRef` 只做 `data-vl-key` 登记 + `observe`，**既不预写缓存，也不在里面 setState/bump**。

**Why:** ① 预写缓存 → RO 首次通知值相等被吞（changed=false 不 bump）→ offsets 不重算，贴底 rAF 读估算 spacer——高节点（edit/write 自动展开 diff 过程区 600px+ vs 估算 100px）落地后停在与真实底差几百 px 处，工具执行期事件静默无触发追平 = 用户报告的"edit 工具不跟到最新"（2026-09-21）。② 在 measureRef 里提交期同步 bump heightVersion（曾作为①的修法实现过）实测**打破 prepend 视口锚定**（ghost-switch 用例 4 scrollTop 塌回 0），且微观机制未定案——提交期 setState 与补偿记账的提交序竞态。挂载首测改走 RO 异步通知后两条用例同时绿。

**How to apply:** 改 VirtualList 测量/贴底/锚定逻辑前先读 doc/editor/integration/agent_panel_system.md §19.2 末"挂载首测与贴底跟随"段；任何"首测高度直接生效"类优化都必须同时过 `tests/virtualListMeasure.test.tsx` + `tests/e2e/agent/tool-card-scroll-follow.spec.ts` + ghost-switch 全量（锚定用例是②的回归锁）。
