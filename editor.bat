@echo off
cd /d "%~dp0"

echo ============================================
echo   DemoStudio Editor - Electron Desktop
echo ============================================
echo.

REM ─── 国内镜像源（加速依赖下载） ───
set "NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/"
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
echo   ※ DSH agent 在后台自动构建（编辑器不受影响）
echo   ※ 支持多实例：可重复双击本文件启动多个编辑器
echo     （Vite 端口 5173+ / MCP 端口 9877+ 自动递增分配；DSH agent 多实例共享）
echo.

REM ─── 确保 DSH 已安装（npm 全局） ───
where dsh >nul 2>nul
if %errorlevel% neq 0 (
    echo [DSH] 未检测到 DSH，正在从 npm 安装...
    call npm install -g @deepseek-ai/dsh --registry=%NPM_REGISTRY% --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo [WARN] DSH 安装失败，agent 功能不可用，编辑器仍可正常启动。
    ) else (
        for /f "tokens=*" %%v in ('dsh --version') do echo [DSH] 安装完成: v%%v
    )
    echo.
) else (
    for /f "tokens=*" %%v in ('dsh --version') do echo [DSH] 已就绪: v%%v
    echo.
)

echo [Launch] 启动开发服务器与 Electron...
npm run electron:dev

REM Electron 退出后 Vite dev server 可能残留几秒，强制清理确保 bat 窗口立即关闭
taskkill /F /IM electron.exe >nul 2>nul
taskkill /F /IM vite.exe >nul 2>nul
exit /b 0
