@echo off
cd /d "%~dp0"

echo ============================================
echo   DemoStudio Editor - Electron Desktop
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

REM ─── 检测 npm ───
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未检测到 npm。
    pause
    exit /b 1
)

echo [Setup] Node.js 已就绪
for /f "tokens=*" %%i in ('node -v') do echo         版本: %%i
echo.

REM ─── 检查 node_modules 是否存在 ───
if not exist "node_modules" (
    echo [Setup] 未检测到 node_modules，正在安装依赖...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install 失败！请检查网络连接后手动运行:
        echo   npm install
        pause
        exit /b 1
    )
    echo.
    echo [Setup] 依赖安装完成
    echo.
)

echo [Launch] 正在启动 Electron 编辑器...
echo.
echo   ※ Vite 开发服务器将自动启动
echo   ※ Electron 窗口将在 Vite 就绪后打开
echo.

npm run electron:dev
if errorlevel 1 (
    echo.
    echo Electron 编辑器已退出，按任意键关闭...
    pause >nul
)
