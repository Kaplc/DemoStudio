@echo off
cd /d "%~dp0"

REM ─── 独立开屏窗口：第一有效行即拉起，后续每一步推送真实进度（scripts/splash.ps1 + splash-update.mjs） ───
REM 状态文件按实例命名（%RANDOM%），经 DEMOSTUDIO_SPLASH_STATE 环境变量传给 Electron 主进程接力
set "SPLASH_STATE=%~dp0cache\splash\state_%RANDOM%%RANDOM%.json"
start "DemoStudio Splash" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\splash.ps1" -StateFile "%SPLASH_STATE%"
set "DEMOSTUDIO_SPLASH_STATE=%SPLASH_STATE%"
call :splash 3 "检查运行环境..."

echo ============================================
echo   DemoStudio Editor - Electron Desktop
echo ============================================
echo.

REM ─── 国内镜像源（加速依赖下载） ───
set "NPM_REGISTRY=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

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
call :splash 8 "运行环境就绪"

REM ─── 检查 node_modules 是否存在 ───
call :splash 10 "检查项目依赖完整性..."
if not exist "node_modules" (
    echo [Setup] 未检测到 node_modules，正在安装依赖（使用国内镜像源）...
    echo.
    call :splash 14 "安装项目依赖（首次较慢）..."
    call npm install --registry=%NPM_REGISTRY% --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install 失败！请检查网络连接后手动运行:
        echo   npm install --registry=https://registry.npmmirror.com
        pause
        exit /b 1
    )
    echo.
    echo [Setup] 依赖安装完成
    echo.
) else (
    REM ─── 依赖完整性自动检查（缺失时用国内源自动补装） ───
    node scripts/check-deps.mjs --check
    if errorlevel 1 (
        echo.
        echo [Setup] 检测到依赖不完整，正在自动修复（使用国内镜像源）...
        echo.
        call :splash 14 "修复项目依赖..."
        node scripts/check-deps.mjs --install
        if errorlevel 1 (
            echo.
            echo [ERROR] 依赖自动修复失败！请检查网络连接后手动运行:
            echo   npm install --registry=https://registry.npmmirror.com
            pause
            exit /b 1
        )
        echo.
        echo [Setup] 依赖修复完成
        echo.
    )
)
call :splash 24 "项目依赖就绪"

REM ─── 检查 DSH 源代码是否存在 ───
set "DSH_NEED_BUILD=0"
if not exist "harness\dsh-source\.git" (
    echo [DSH] 检测到 harness\dsh-source 不存在，正在从 GitHub 克隆...
    echo.
    call :splash 26 "克隆 DSH 引擎源码..."
    
    REM 检查 Git 是否可用
    where git >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] 未检测到 Git，请先安装:
        echo   https://git-scm.com/
        pause
        exit /b 1
    )
    
    if exist "harness\dsh-source" (
        echo [DSH] 检测到残留目录，先清理...
        rmdir /s /q "harness\dsh-source"
    )
    git clone https://github.com/deepseek-ai/deepseek-harness.git harness\dsh-source
    if errorlevel 1 (
        echo.
        echo [ERROR] DSH 克隆失败！请检查网络连接后重试。
        echo   手动克隆: git clone https://github.com/deepseek-ai/deepseek-harness.git harness\dsh-source
        pause
        exit /b 1
    )
    echo.
    echo [DSH] 克隆完成
    echo.
    call :splash 34 "DSH 源码就绪"
    set "DSH_NEED_BUILD=1"
)

REM ─── 检查 DSH 是否需要构建（CLI 不存在或首次克隆） ───
if not exist "harness\dsh-source\apps\cli\lib\bin.js" set "DSH_NEED_BUILD=1"
if "%DSH_NEED_BUILD%"=="1" (
    echo [DSH] 检测到 DSH 未构建，正在自动构建...
    echo.
    call :splash 36 "准备 DSH 构建环境..."
    
    REM 检查 pnpm 是否可用，不存在则自动安装
    call :splash 38 "检查 pnpm..."
    where pnpm >nul 2>nul
    if errorlevel 1 (
        echo [DSH] 未检测到 pnpm，正在自动安装...
        echo.
        call :splash 40 "安装 pnpm（首次）..."
        call npm install -g pnpm --registry=%NPM_REGISTRY% --no-audit --no-fund
        if errorlevel 1 (
            echo.
            echo [ERROR] pnpm 安装失败！请手动运行:
            echo   npm install -g pnpm
            pause
            exit /b 1
        )
        echo.
        echo [DSH] pnpm 安装完成
        echo.
    )
    call :splash 44 "构建环境就绪"
    
    REM 进入 DSH 源码目录
    pushd harness\dsh-source
    
    REM 安装依赖（如果 node_modules 不存在）
    if not exist "node_modules" (
        echo [DSH] 正在安装依赖（使用国内镜像源）...
        echo.
        call :splash 46 "安装 DSH 依赖..."
        call pnpm install --registry=%NPM_REGISTRY%
        if errorlevel 1 (
            echo.
            echo [ERROR] DSH 依赖安装失败！请检查网络连接后重试。
            popd
            pause
            exit /b 1
        )
        echo.
        echo [DSH] 依赖安装完成
        echo.
        call :splash 50 "DSH 依赖就绪"
    )
    
    REM 构建项目
    echo [DSH] 正在构建项目...
    echo.
    call :splash 52 "构建 DSH CLI（首次较慢）..."
    call pnpm run build
    if errorlevel 1 (
        echo.
        echo [ERROR] DSH 构建失败！请查看错误信息。
        echo   如需手动构建，请进入 harness\dsh-source 目录运行: pnpm run build
        popd
        pause
        exit /b 1
    )
    echo.
    echo [DSH] 构建完成
    echo.
    call :splash 62 "DSH 就绪"
    
    REM 返回原目录
    popd
)

REM ─── DSH 复用检测已下沉到 Electron main 进程（探测 :3080 → 认领幸存 agent） ───
REM 旧 DSH_SKIP 环境变量机制由 main.ts 的 bootstrapDSH() 通用探测取代，此处不再设置

echo [Launch] 正在启动 Electron 编辑器...
echo.
echo   ※ Vite 开发服务器将自动启动
echo   ※ Electron 窗口将在 Vite 就绪后打开
echo   ※ 支持多实例：可重复双击本文件启动多个编辑器
echo     （Vite 端口 5173+ / MCP 端口 9877+ 自动递增分配；DSH agent 多实例共享）
echo.

call :splash 64 "启动开发服务器..."
npm run electron:dev
if errorlevel 1 (
    echo.
    echo Electron 编辑器已退出，按任意键关闭...
    pause >nul
)
exit /b 0

:splash
REM ─── 推送真实启动进度到独立开屏窗口（静默失败，绝不阻塞启动流程） ───
node scripts\splash-update.mjs %1 %2 >nul 2>nul
exit /b
