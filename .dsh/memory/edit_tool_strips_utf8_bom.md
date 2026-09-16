---
name: edit_tool_strips_utf8_bom
description: edit/write 会抹 UTF-8 BOM 的检查流程仍有效，但样本清单已过期（2026-09-18 复核：WarmCurrentGameMode.ts 等 10 个 warm 文件 HEAD 与工作区均无 BOM）
type: project
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, projects/warm-current/gameplay/core/helpers.ts, src/engine/rendering/CanvasUIComponent.ts]
---

**Problem:** 用 edit/write 改完文件后，`git diff` 首行凭空出现 BOM 差异（`﻿/**` → `/**`），像是自己动了文件头。

**Cause:** edit 工具重写文件时按**无 BOM 的 UTF-8** 落盘；若源文件原本带 BOM，改后头部 3 字节从 `EF BB BF` 变为 `2F 2A 2A`（`/**`），diff 凭空多出首行差异。⚠️ 样本清单已过期（2026-09-18 复核：`WarmCurrentGameMode.ts`/`holoHudModel.ts`/`HoloHudScript/HologramPanelScript/PlanetInfoScript`/`WarmCurrentGameInstance.ts`/两个 holo widget html+json 共 10 个 warm 文件，HEAD 与工作区**均无 BOM**——旧清单里的 BOM 样本已被后续会话清掉，不要再按旧清单预防性补 BOM，那会反过来制造噪声）。

**Solution:** 改完文件后用 Node 字节级对比 HEAD（PS 管道/cmd 重定向会重编码，不可靠；`$_ -match "\x{FEFF}"` 在 PS5.1 还是非法正则，别用）：
`head = execSync('git show HEAD:' + path)`（Node execSync 返回原始 Buffer）→ 头 3 字节 `EF BB BF` 对比工作文件 → 仅当 HEAD 有、工作区无时补回：
`$b=[System.IO.File]::ReadAllBytes($p); if(-not($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)){[System.IO.File]::WriteAllBytes($p, [byte[]](0xEF,0xBB,0xBF) + $b)}`
纯噪声、无语义影响，但保持 diff 干净。

**Applicable:** 任何编辑本仓源文件的任务；已确认 BOM 文件集中在 `projects/warm-current/` 与 `src/engine/`（未做全仓统计，4 个目录的小样本里命中 4 个文件）。

