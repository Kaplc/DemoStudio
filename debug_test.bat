@echo off
cd /d "%~dp0"
echo ============================================
echo   Ursina 贪吃蛇 - 调试诊断工具
echo ============================================
echo.

if "%1"=="--render" goto render

.venv\Scripts\python.exe game\debug_test.py
if errorlevel 1 (
    echo.
    echo 诊断工具出错，按任意键关闭...
    pause >nul
)
goto end

:render
echo [启动渲染测试窗口...]
echo 将打开 Ursina 窗口，请观察是否能看到各种颜色的方块
echo.
.venv\Scripts\python.exe game\debug_render_test.py
if errorlevel 1 (
    echo.
    echo 渲染测试出错，按任意键关闭...
    pause >nul
)

:end
