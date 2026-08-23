@echo off
cd /d "%~dp0"

echo ============================================
echo   DSH Source - DeepSeek Harness
echo ============================================
echo.

REM ─── 自动 clone dsh-source ───
if not exist "harness\dsh-source\.git" (
    echo [Clone] harness\dsh-source 不存在，正在从 GitHub 克隆...
    echo.
    if exist "harness\dsh-source" (
        echo [Clone] 检测到残留目录，先清理...
        rmdir /s /q "harness\dsh-source"
    )
    git clone https://github.com/deepseek-ai/deepseek-harness.git harness\dsh-source
    if errorlevel 1 (
        echo.
        echo [ERROR] 克隆失败！请检查网络连接后重试。
        echo   手动克隆: git clone https://github.com/deepseek-ai/deepseek-harness.git harness\dsh-source
        pause
        exit /b 1
    )
    echo.
    echo [Clone] 克隆完成
    echo.
)

cd /d "%~dp0harness\dsh-source"

echo ============================================
echo   DSH Source - DeepSeek Harness
echo ============================================
echo.

REM ─── 国内镜像源（加速依赖下载） ───
set "NPM_REGISTRY=https://registry.npmmirror.com"

REM ─── 检测 Node.js ───
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未检测到 Node.js，请先安装:
    echo   https://nodejs.org/
    echo   DSH 要求 Node.js ^22.19.0 或 ^24.0.0
    pause
    exit /b 1
)

REM ─── 检测 pnpm ───
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未检测到 pnpm，请先安装:
    echo   npm install -g pnpm
    pause
    exit /b 1
)

echo [Setup] Node.js 已就绪
for /f "tokens=*" %%i in ('node -v') do echo         版本: %%i
echo [Setup] pnpm 已就绪
for /f "tokens=*" %%i in ('pnpm -v') do echo         版本: %%i
echo.

REM ─── 检查 node_modules 是否存在 ───
if not exist "node_modules" (
    echo [Setup] 未检测到 node_modules，正在安装依赖（使用国内镜像源）...
    echo.
    call pnpm install --registry=%NPM_REGISTRY% --ignore-engines
    if errorlevel 1 (
        echo.
        echo [ERROR] pnpm install 失败！请检查网络连接后手动运行:
        echo   pnpm install --registry=https://registry.npmmirror.com
        pause
        exit /b 1
    )
    echo.
    echo [Setup] 依赖安装完成
    echo.
) else (
    echo [Setup] node_modules 已存在，跳过安装
    echo.
)

REM ─── 检查是否需要构建 ───
if not exist "apps\web\dist" (
    echo [Build] 首次运行，正在构建项目...
    echo.
    call pnpm run build
    if errorlevel 1 (
        echo.
        echo [ERROR] 构建失败！请查看错误信息
        pause
        exit /b 1
    )
    echo.
    echo [Build] 构建完成
    echo.
) else (
    echo [Build] 已有构建产物，跳过构建（如需重新构建请手动运行 pnpm run build）
    echo.
)

echo [Launch] 正在启动 DSH Web UI...
echo.
echo   ※ Web UI 将在 http://127.0.0.1:3080 启动
echo   ※ 按 Ctrl+C 停止服务
echo.

pnpm dsh web
if errorlevel 1 (
    echo.
    echo [ERROR] DSH 启动失败！
    echo   如需重新构建，请先运行: pnpm run build
    pause
    exit /b 1
)

pause
