---
name: edit_tool_strips_utf8_bom
description: edit/write 重写文件会抹掉 UTF-8 BOM，导致本仓带 BOM 源文件 diff 首行出现噪音（含补回命令）
type: project
prefix: src/engine || projects/warm-current
---

**Problem:** 用 edit/write 改完文件后，`git diff` 首行凭空出现 BOM 差异（`﻿/**` → `/**`），像是自己动了文件头。

**Cause:** 本仓存在带 UTF-8 BOM 的源文件（实测样本：`projects/warm-current/gameplay/base/WarmCurrentGameMode.ts`、`projects/warm-current/gameplay/core/helpers.ts`、`src/engine/rendering/CanvasUIComponent.ts`、`src/engine/rendering/SpriteComponent.ts`），而 edit 工具重写文件时按**无 BOM 的 UTF-8** 落盘。对照实验：带 BOM 文件复制后只改一处注释，前 3 字节从 `EF BB BF` 变为 `2F 2A 2A`（`/**`）。

**Solution:** 改过含 BOM 的文件后 `git diff` 扫一眼首行；有 BOM 差异就用 .NET 补回（先读前 3 字节判重，防重复写入）：
`$b=[System.IO.File]::ReadAllBytes($p); if(-not($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)){[System.IO.File]::WriteAllBytes($p, [byte[]](0xEF,0xBB,0xBF) + $b)}`
纯噪声、无语义影响，但保持 diff 干净（也避免对编码敏感的消费方踩坑）。

**Applicable:** 任何编辑本仓源文件的任务；已确认 BOM 文件集中在 `projects/warm-current/` 与 `src/engine/`（未做全仓统计，4 个目录的小样本里命中 4 个文件）。

