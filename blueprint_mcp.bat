@echo off
cd /d "%~dp0"
echo ============================================
echo   DemoStudio Blueprint MCP Server (Node.js)
echo ============================================
echo.
echo 请确保编辑器已在运行！（执行 editor.bat）
echo.
echo 此服务器提供蓝图资产结构化编辑工具，
echo 通过 HTTP:9877 /api/blueprint 往返连接编辑器。
echo.
node editor/blueprint-mcp-server.mjs
if errorlevel 1 (
    echo.
    echo MCP Server 出错，按任意键关闭...
    pause >nul
)
