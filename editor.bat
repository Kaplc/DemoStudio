@echo off
cd /d "%~dp0"

REM ─── 检查管理员权限，如果没有则请求提升 ───
net session >nul 2>nul
if %errorlevel% neq 0 (
    echo [Info] 需要管理员权限来同步 presets...
    echo [Info] 正在请求管理员权限...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================
echo   DemoStudio Editor - Electron Desktop (管理员模式)
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

REM ─── 检查 node_modules 是否存在 ───
if not exist "node_modules" (
    echo [Setup] 未检测到 node_modules，正在安装依赖（使用国内镜像源）...
    echo.
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

REM ─── 检查 DSH 源代码是否存在 ───
set "DSH_NEED_BUILD=0"
if not exist "harness\dsh-source\.git" (
    echo [DSH] 检测到 harness\dsh-source 不存在，正在从 GitHub 克隆...
    echo.
    
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
    set "DSH_NEED_BUILD=1"
)

REM ─── 检查 DSH 是否需要构建（CLI 不存在或首次克隆） ───
if not exist "harness\dsh-source\apps\cli\lib\bin.js" set "DSH_NEED_BUILD=1"
if "%DSH_NEED_BUILD%"=="1" (
    echo [DSH] 检测到 DSH 未构建，正在自动构建...
    echo.

    REM 检查 pnpm 是否可用，不存在则自动安装
    where pnpm >nul 2>nul
    if errorlevel 1 (
        echo [DSH] 未检测到 pnpm，正在自动安装...
        echo.
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
    
    REM 进入 DSH 源码目录
    pushd harness\dsh-source
    
    REM 安装依赖（如果 node_modules 不存在）
    if not exist "node_modules" (
        echo [DSH] 正在安装依赖（使用国内镜像源）...
        echo.
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
    )
    
    REM 构建项目
    echo [DSH] 正在构建项目...
    echo.
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
    
    REM 返回原目录
    popd
)

REM ─── DSH 复用检测已下沉到 Electron main 进程（探测 :3080 → 认领幸存 agent） ───
REM 旧 DSH_SKIP 环境变量机制由 main.ts 的 bootstrapDSH() 通用探测取代，此处不再设置

REM ─── 同步本地 Presets 到系统目录 ───
set "LOCAL_PRESETS=%~dp0.dsh\presets"
set "SYSTEM_PRESETS=%USERPROFILE%\.dsh\.agent-presets"

if exist "%LOCAL_PRESETS%" (
    echo [Sync] 检测到本地 presets 目录，正在同步到系统目录...
    echo       源: %LOCAL_PRESETS%
    echo       目标: %SYSTEM_PRESETS%
    echo.

    REM 创建系统 presets 目录（如果不存在）
    if not exist "%SYSTEM_PRESETS%" (
        mkdir "%SYSTEM_PRESETS%"
    )

    REM 遍历本地 presets 目录下的每个子目录
    for /d %%D in ("%LOCAL_PRESETS%\*") do (
        set "PRESET_NAME=%%~nxD"
        setlocal enabledelayedexpansion
        echo       同步预设: !PRESET_NAME!

        REM 删除系统目录中的旧版本（如果存在）
        if exist "%SYSTEM_PRESETS%\!PRESET_NAME!" (
            rmdir /s /q "%SYSTEM_PRESETS%\!PRESET_NAME!"
        )

        REM 复制整个 preset 目录
        xcopy "%%D" "%SYSTEM_PRESETS%\!PRESET_NAME!\" /E /I /Q /Y >nul
        if errorlevel 1 (
            echo         [WARN] 预设 !PRESET_NAME! 同步失败
        ) else (
            echo         [OK] 预设 !PRESET_NAME! 已同步
        )
        endlocal
    )

    echo.
    echo [Sync] Presets 同步完成
    echo.
) else (
    echo [Sync] 未检测到本地 presets 目录，跳过同步
    echo.
)

REM ─── 创建 DSH 补丁文件（用于加载系统目录中的 presets） ───
set "PATCH_FILE=%USERPROFILE%\.dsh\cordis.patch.yml"
if not exist "%USERPROFILE%\.dsh" mkdir "%USERPROFILE%\.dsh"
if not exist "%PATCH_FILE%" (
    echo [Sync] 创建 DSH 补丁文件...
    (
        echo # DemoStudio 自定义配置补丁
        echo # 由 editor.bat 自动生成
        echo.
        echo - id: agent-presets
        echo   name: '@deepseek-ai/dsh-agent-presets'
        echo   config:
        echo     default: standard
    ) > "%PATCH_FILE%"
    echo       [OK] 补丁文件已创建: %PATCH_FILE%
    echo.
)

echo [Launch] 正在启动 Electron 编辑器...
echo.
echo   ※ Vite 开发服务器将自动启动
echo   ※ Electron 窗口将在 Vite 就绪后打开
echo   ※ 支持多实例：可重复双击本文件启动多个编辑器
echo     （Vite 端口 5173+ / MCP 端口 9877+ 自动递增分配；DSH agent 多实例共享）
echo.

echo [Launch] 启动开发服务器与 Electron...
npm run electron:dev
if errorlevel 1 (
    echo.
    echo Electron 编辑器已退出，按任意键关闭...
    pause >nul
)
exit /b 0
