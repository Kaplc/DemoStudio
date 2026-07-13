@echo off
cd /d "%~dp0"

echo ============================================
echo   DemoStudio Editor - Game Launcher
echo ============================================
echo.

REM ─── 如果虚拟环境已存在，直接启动编辑器 ───
if exist ".venv\Scripts\python.exe" goto :run_editor

echo [Setup] 未检测到虚拟环境，正在自动创建...
echo.

REM ─── 1. 优先检测 py -3.12 ───
where py >nul 2>nul
if errorlevel 1 goto :check_python
py -3.12 -c "import sys" >nul 2>nul
if not errorlevel 1 goto :create_venv_py312

:check_python
REM ─── 2. 检测 python 命令是否指向 3.12 ───
python --version 2>&1 | findstr "3.12" >nul
if not errorlevel 1 goto :create_venv_python

REM ─── 3. 尝试用 winget 自动安装 Python 3.12 ───
where winget >nul 2>nul
if errorlevel 1 goto :manual_install
echo [Setup] 正在下载安装 Python 3.12（首次需要联网，自动安装 ing）...
echo.
winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
if not errorlevel 1 goto :create_venv_py312

:manual_install
REM ─── 4. 都失败 → 提示手动安装 ───
echo.
echo [ERROR] 未检测到 Python 3.12，且自动安装失败。
echo.
echo 请手动下载安装:
echo   https://www.python.org/downloads/release/python-31210/
echo.
echo 安装后重新运行本程序即可。
pause
exit /b 1

:create_venv_py312
echo [Setup] 使用: py -3.12
py -3.12 -m venv .venv
if %errorlevel% neq 0 goto :venv_failed
goto :install_deps

:create_venv_python
echo [Setup] 使用: python
python -m venv .venv
if %errorlevel% neq 0 goto :venv_failed
goto :install_deps

:install_deps
echo [Setup] 虚拟环境创建成功，正在安装项目依赖...
echo.
.venv\Scripts\python.exe -m pip install --upgrade pip -q
.venv\Scripts\python.exe -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 依赖安装失败！请检查网络连接后手动运行:
    echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)
echo.
echo [Setup] 依赖安装完成，正在启动编辑器...
echo.
goto :run_editor

:venv_failed
echo [ERROR] 创建虚拟环境失败！
pause
exit /b 1

:run_editor
.venv\Scripts\python.exe editor\editor_app.py
if errorlevel 1 (
    echo.
    echo Editor exited with error, press any key to close...
    pause >nul
)
