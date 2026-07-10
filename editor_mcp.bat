@echo off
cd /d "%~dp0"
echo ============================================
echo   DemoStudio Editor MCP Server
echo ============================================
echo.
echo Make sure editor.bat is running first!
echo.
.venv\Scripts\python.exe editor\editor_mcp_server.py
if errorlevel 1 (
    echo.
    echo MCP Server exited with error, press any key to close...
    pause >nul
)
