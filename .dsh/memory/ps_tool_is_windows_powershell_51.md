---
name: ps_tool_is_windows_powershell_51
description: pwsh 工具实际是 Windows PowerShell 5.1 而非 pwsh 7：三元运算符/??/?. 等 PS7 语法直接 ParserError（整个脚本不执行）
type: project
---

# pwsh 工具实际是 Windows PowerShell 5.1

**Problem:** 2026-09-22 e2e 迁移任务中用 `$hasBom ? $utf8bom : $utf8` 三元运算符写批处理脚本，报 `Unexpected token '?'` ParserError；工具名与说明写的是 `pwsh -Command`（暗示 PowerShell 7+），实际版本 `$PSVersionTable.PSVersion` = **5.1.19041**（Windows PowerShell）。

**Cause:** DeepSeek Harness 的 pwsh 工具在本机落到 Windows PowerShell 5.1 而非 PowerShell 7；PS7 独有语法（三元 `? :`、`??`、`?.`、链式运算符）在 5.1 解析器直接失败。**ParserError 在执行前抛出——整个脚本一行都不会跑**（不存在"前半段已执行"的副作用），重发修正版即可。

**Solution:** 写批处理脚本只用 PS5.1 兼容语法：`if (...) { $a = $x } else { $a = $y }` 代替三元；用 `New-Object System.Text.UTF8Encoding($false)` 代替 `[System.Text.UTF8Encoding]::new()`（PS5 也不支持 `::new()`）；拿不准时先跑 `$PSVersionTable.PSVersion.ToString()`。报 ParserError 后检查整个脚本是否有 PS7 语法残留，逐个替换后重发。

**Applicable:** 所有经 pwsh 工具执行的多行 PowerShell 脚本；BOM 感知文件批处理、注册表/进程操作等复杂脚本场景。
