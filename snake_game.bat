@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe projects\snake\snake_game.py
if errorlevel 1 (
    echo.
    echo 游戏已退出，按任意键关闭...
    pause >nul
)
