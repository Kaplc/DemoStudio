@echo off
cd /d "%~dp0"

echo ============================================
echo   DemoStudio - Harness 插件手动编译
echo ============================================
echo.

REM ─── 检测 Node.js ───
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未检测到 Node.js，请先安装:
    echo   https://nodejs.org/
    pause
    exit /b 1
)

REM ─── 根依赖检查（脚本使用根目录 node_modules 下的 tsc 编译） ───
if not exist "node_modules\typescript" (
    echo [ERROR] 未检测到根目录依赖，请先运行 editor.bat 或手动执行:
    echo   npm install --registry=https://registry.npmmirror.com
    pause
    exit /b 1
)

REM ─── 编译插件（依赖自动安装 + src 更新时增量编译，详见 scripts/build-harness-plugins.mjs） ───
node "%~dp0scripts\build-harness-plugins.mjs"
set "EXITCODE=%ERRORLEVEL%"
echo.
if %EXITCODE% neq 0 (
    echo [ERROR] 插件编译失败，请检查上方错误信息
) else (
    echo [OK] 插件编译完成
)
pause
exit /b %EXITCODE%
