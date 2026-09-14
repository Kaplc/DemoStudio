---
name: write_new_file_diff_fallback
task_type: debug/feature
outcome: success
date: 2026-09-14
prefix: [src/components/agent/ToolCard.tsx]
---
## Summary

write 工具新建文件的卡片退回原始 JSON：DSH 对 before===null 发 meta.diffs 空数组，ToolCard 改为 settled 无权威 hunk 也入参派生（仅 failure 退通用视图），vitest+e2e 同步加锁。

## Lessons

1. 症状是"write settled 卡片回退通用 JSON"时别急着改渲染层：先 grep DSH 打包产物 dsh-tool-fs 的 `presentationMeta` 两处调用点（write:647 / edit:796），确认权威数据源头就不发——write 对 `before===null` 故意给 `meta.diffs: []`，`extractDiffsFromMeta` 对空数组返回 undefined，于是 settled 走了通用卡片；运行中反而因入参派生一直有 diff。
2. 修法在取值层不动纯函数层：ToolCard 的 diffs memo 把"仅 running/pending 派生"放宽为"仅 failure 不派生"，一行语义反转即覆盖 write 新建文件与旧会话回放 edit 两个场景。
3. 旧回归锁 `tests/toolCardDiff.test.tsx` 的「成功但无 diffs → 通用视图」用例编码的正是被推翻的旧行为——改行为必须同步改锁（更新为派生断言 + 新增 write 新建文件用例），e2e 用合成 `meta.diffs: []` 忠实还原 DSH 线上形状。
4. 本仓 e2e 跑法：`npx playwright test -c tests/e2e/playwright.config.ts agent/tool-card-diff`（根 playwright.e2e.config.ts 的 testDir 是 ./e2e，跑不到 tests/e2e/ 下用例）；vitest 全量会撞并行会话的在途失败（atmosphere/ship_hull），先隔离跑失败文件 + git status 区分归属再定性。规则见 memory:agent_tool_card_diff_ui_decisions、memory:dsh_tool_result_diffs_wire。
