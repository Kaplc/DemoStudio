@echo off
cd /d "%~dp0"
echo ============================================
echo   DemoStudio Editor - Game Launcher
echo ============================================
echo.
.venv\Scripts\python.exe editor\editor_app.py
if errorlevel 1 (
    echo.
    echo Editor exited with error, press any key to close...
    pause >nul
)
