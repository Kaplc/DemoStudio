# check-lint.ps1 — Stop hook: 检查修改文件的 lint 错误
# stdin 接收 hook JSON，stdout 返回 JSON（systemMessage / continue）

$ErrorActionPreference = 'Continue'

# 运行 eslint，捕获输出
$output = & npx eslint src --ext .ts,.tsx --format compact 2>&1 | Out-String
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    # 无错误
    Write-Output '{"continue": true}'
    exit 0
}

# 有错误，截断避免过长
if ($output.Length -gt 2000) {
    $output = $output.Substring(0, 2000) + "`n... (truncated)"
}

$msg = "Lint 检查发现错误，请在回复前修复：`n``````n$output``````"
$msg = $msg -replace '"', '\"' -replace "`n", '\n' -replace "`r", ''

Write-Output "{`"systemMessage`": `"$msg`", `"continue`": true}"
exit 0
