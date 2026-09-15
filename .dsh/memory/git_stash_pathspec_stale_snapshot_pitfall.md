---
name: git_stash_pathspec_stale_snapshot_pitfall
description: 本仓存在海量未提交工作区，git stash push -- pathspec 产出陈旧快照且 pop 报 kept——基线对照别用 stash，工作区即权威
type: project
prefix: [playwright.e2e.config.ts, package.json]
---

# git stash pathspec 在海量未提交工作区会产出陈旧快照

**Problem:** 2026-09-15 warm 相机改版验证时用 `git stash push -- <paths>` + 跑基线 + `git stash pop` 对照既有红，pop 结束报 "The stash entry is kept"（exit 1）；事后发现 stash 里存的 GameMode 是 84KB 旧版（无当次改动），与 stash 时工作区真实内容（153KB 含改动）完全不符——stash 快照是陈旧的。

**Cause:** 本仓 warm 项目相对 HEAD 有约 7 万行未提交改动（大量历史会话的工作不落 commit）；`git stash push` 带 pathspec 在此状态下的快照内容不可信（可能只收了 index 附近的小 diff），pop 又因无法干净应用而保留条目，造成"工作区到底恢复没有"的迷惑状态。

**Solution:** 本仓验证"失败是否基线"**不要用 stash 往返**：① 以经验/文档记录的基线红清单对照（见 experience:fix_inspector_getproperties_key_case 的 warm e2e 6 红清单，会漂移需带日期）；② 按改动代码的 import 链推理失败域是否与改动有交集；③ 万一已 stash 且 pop 异常，**工作区即权威**——用改动标记点（关键符号 Select-String）+ `npx tsc --noEmit` + e2e 绿灯三重核验工作区完整性，确认后 `git stash drop` 丢弃陈旧条目。附带坑：stash push/pop 往返会二次抹掉带 BOM 文件的 UTF-8 BOM（见 memory:edit_tool_strips_utf8_bom），核验时一并补回。

**Applicable:** DemoStudio 仓库任何"想临时还原工作区对照基线"的场景；e2e/vitest 门禁判定（playwright.e2e.config.ts / package.json 上下文）。
