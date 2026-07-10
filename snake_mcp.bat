@echo off
cd /d "%~dp0"
echo ============================================
echo   贪吃蛇 MCP 服务器
echo ============================================
echo.
echo 请确保已先双击 snake_game.bat 启动游戏窗口！
echo.
.venv\Scripts\python.exe projects\snake\snake_mcp_server.py
if errorlevel 1 (
    echo.
    echo MCP 服务器出错，按任意键关闭...
    pause >nul
)
