@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   DSH Agent 重启脚本
echo   (停止旧 agent → 清理状态 → 重新拉起内核)
echo ============================================
echo.

REM ─── 1. 停止旧 agent（复用 stop 逻辑：杀 3080 进程树） ───
set "PID="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr ":3080" ^| findstr "LISTENING"') do (
    set "PID=%%a"
)

if "%PID%"=="" (
    echo [INFO] 未检测到运行中的 DSH agent（端口 3080 无监听），跳过停止
) else (
    echo [DSH] 找到 agent 进程 PID=%PID%，正在终止进程树...
    taskkill /PID %PID% /T /F >nul 2>nul
)

REM ─── 2. 清理 watchdog 所有权状态 ───
set "STATE_DIR=%~dp0cache\dsh-runtime"
if exist "%STATE_DIR%\owner.json" (
    echo [DSH] 清理 owner.json
    del /f /q "%STATE_DIR%\owner.json" >nul 2>nul
)

REM ─── 3. 确认端口释放 ───
timeout /t 1 /nobreak >nul
set "CHECK="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr ":3080" ^| findstr "LISTENING"') do (
    set "CHECK=%%a"
)
if not "%CHECK%"=="" (
    echo [WARN] 端口 3080 仍被占用（PID=%CHECK%），可能残留进程，重启可能失败
    echo.
)
echo.

REM ─── 4. 探测系统 Node.js（与 electron/main.ts getSystemNodePath 一致） ───
set "NODE_PATH="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_PATH set "NODE_PATH=%%i"
if "%NODE_PATH%"=="" (
    echo [ERROR] 未检测到系统 Node.js（where node 无结果）
    echo        请先安装 Node.js: https://nodejs.org/
    pause
    exit /b 1
)
echo [DSH] 使用系统 Node.js: %NODE_PATH%

REM ─── 5. 探测全局 DSH CLI（与 electron/main.ts getDshCliPath 一致） ───
set "NPM_ROOT="
for /f "delims=" %%i in ('npm root -g 2^>nul') do if not defined NPM_ROOT set "NPM_ROOT=%%i"
set "CLI_PATH=%NPM_ROOT%\@deepseek-ai\dsh\lib\bin.js"
if not exist "%CLI_PATH%" (
    echo [ERROR] 未找到全局 DSH CLI: %CLI_PATH%
    echo        请先安装: npm i -g @deepseek-ai/dsh
    pause
    exit /b 1
)
echo [DSH] DSH CLI: %CLI_PATH%

REM ─── 6. 准备日志文件并拉起内核（复用 scripts/dsh-agent-launcher.cmd） ───
set "LAUNCHER=%~dp0scripts\dsh-agent-launcher.cmd"
set "DSH_CWD=%~dp0harness\dsh-source"
set "LOG_FILE=%~dp0logs\dsh-agent.log"
if not exist "%~dp0logs" mkdir "%~dp0logs"
type nul > "%LOG_FILE%" 2>nul

if not exist "%LAUNCHER%" (
    echo [ERROR] launcher 脚本不存在: %LAUNCHER%
    pause
    exit /b 1
)

echo [DSH] 启动 DSH 内核 (web profile, port 3080)...
call "%LAUNCHER%" "%NODE_PATH%" "%CLI_PATH%" "%DSH_CWD%" "%LOG_FILE%" development 9877

REM ─── 7. 等待就绪（最多 30 秒，与 DSH_SPAWN_READY_TIMEOUT_MS 一致） ───
echo [DSH] 等待内核就绪...
set "READY="
for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    set "READY="
    for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr ":3080" ^| findstr "LISTENING"') do set "READY=%%a"
    if not "!READY!"=="" goto :ready
)
echo [ERROR] agent 在 30 秒内未就绪（端口 3080 无响应）
echo        查看日志: logs\dsh-agent.log
pause
exit /b 1

:ready
echo.
echo [DSH] ✅ 内核运行中: http://127.0.0.1:3080 (agentPid=%READY%)
echo       日志: logs\dsh-agent.log
echo.
pause
endlocal
