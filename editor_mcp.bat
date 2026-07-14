@echo off
cd /d "%~dp0"
echo ============================================
echo   DemoStudio Editor MCP Server (Node.js)
echo ============================================
echo.
echo 请确保编辑器已在运行！（执行 editor.bat）
echo.
echo 此服务器通过 HTTP:9877 连接编辑器
echo.
node editor/mcp-server.mjs
if errorlevel 1 (
    echo.
    echo MCP Server 出错，按任意键关闭...
    pause >nul
)
