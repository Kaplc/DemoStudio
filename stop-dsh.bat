@echo off
echo ============================================
echo   DSH Agent 停止脚本
echo ============================================
echo.

REM 查找监听 3080 端口的进程
set "PID="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr ":3080" ^| findstr "LISTENING"') do (
    set "PID=%%a"
)

if "%PID%"=="" (
    echo [INFO] 未检测到 DSH agent（端口 3080 无监听）
    pause
    exit /b 0
)

echo [DSH] 找到 agent 进程 PID=%PID%，正在终止进程树...
taskkill /PID %PID% /T /F >nul 2>nul

REM 清理 watchdog
set "STATE_DIR=%~dp0cache\dsh-runtime"
if exist "%STATE_DIR%\owner.json" (
    echo [DSH] 清理 owner.json
    del /f /q "%STATE_DIR%\owner.json" >nul 2>nul
)

REM 验证
timeout /t 1 /nobreak >nul
set "CHECK="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr ":3080" ^| findstr "LISTENING"') do (
    set "CHECK=%%a"
)
if "%CHECK%"=="" (
    echo [DSH] agent 已停止，端口 3080 已释放
) else (
    echo [WARN] 端口 3080 仍被占用（PID=%CHECK%），可能需要手动终止
)
echo.
pause
