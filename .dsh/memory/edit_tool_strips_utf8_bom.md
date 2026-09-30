---
name: edit_tool_strips_utf8_bom
description: edit/write 工具会抹 UTF-8 BOM 且 write 产物恒为 LF 行尾——PS 拼接脚本 here-string 模式必须归一化行尾再匹配；检查流程与样本注意事项
type: project
prefix: [electron/main.ts, scripts/capture-dsh-fixtures.mjs]
---

**Problem:** 用 edit/write 改完文件后，`git diff` 首行凭空出现 BOM 差异（`﻿/**` → `/**`），像是自己动了文件头。

**Cause:** edit 工具重写文件时按**无 BOM 的 UTF-8** 落盘；若源文件原本带 BOM，改后头部 3 字节从 `EF BB BF` 变为 `2F 2A 2A`（`/**`），diff 凭空多出首行差异。⚠️ 样本清单已过期（2026-09-18 复核：`WarmCurrentGameMode.ts`/`holoHudModel.ts`/`HoloHudScript/HologramPanelScript/PlanetInfoScript`/`WarmCurrentGameInstance.ts`/两个 holo widget html+json 共 10 个 warm 文件，HEAD 与工作区**均无 BOM**——旧清单里的 BOM 样本已被后续会话清掉，不要再按旧清单预防性补 BOM，那会反过来制造噪声）。

**Solution:** 改完文件后用 Node 字节级对比 HEAD（PS 管道/cmd 重定向会重编码，不可靠；`$_ -match "\x{FEFF}"` 在 PS5.1 还是非法正则，别用）：
`head = execSync('git show HEAD:' + path)`（Node execSync 返回原始 Buffer）→ 头 3 字节 `EF BB BF` 对比工作文件 → 仅当 HEAD 有、工作区无时补回：
`$b=[System.IO.File]::ReadAllBytes($p); if(-not($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)){[System.IO.File]::WriteAllBytes($p, [byte[]](0xEF,0xBB,0xBF) + $b)}`
纯噪声、无语义影响，但保持 diff 干净。

**Applicable:** 任何编辑本仓源文件的任务；已确认 BOM 文件集中在 `projects/warm-current/` 与 `src/engine/`（未做全仓统计，4 个目录的小样本里命中 4 个文件）。

## write 脚本拼接的 LF 行尾坑

**Problem:** 一次性拼接脚本（write 落盘的 .ps1）里 here-string 精确匹配 main.ts 内容全部 0 命中（计数断言拦截），但同脚本的行级哨兵按行切分却能通过。

**Cause:** write 工具产物恒为 **LF** 行尾，脚本里的 here-string 模式因此是 LF；而目标文件（main.ts 等）是 **CRLF**。`String.Contains`/`[regex]::Matches` 是字面匹配，`\n` 匹配不上 `\r\n`。行级哨兵因先按 CRLF split 成无 CR 的行数组，不受影响——造成"哨兵过、替换挂"的迷惑组合。

**Solution:** 拼接脚本里所有 here-string 模式与插桩文本，使用前统一归一化：`($s -replace "\`r\`n", "\`n") -replace "\`n", $nl`（$nl 为目标文件实测行尾，用 `ReadAllText` 后 `Contains("\`r\`n")` 判定）。计数断言放在归一化之后。

**Applicable:** 一切"脚本批量改写 CRLF 源文件"的场景（行级 splice、批量替换）；edit 工具单点编辑不受影响（它按文件原行尾写回）。

