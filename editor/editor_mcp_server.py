"""
Editor MCP Server — FastMCP
================================
Controls the DemoStudio Editor via IPC file communication.
Send commands to the editor console while the editor is running.

Usage:
  python editor_mcp_server.py

Register in VS Code .vscode/mcp.json:
  "editor-control": {
    "command": "E:\\DemoStudio\\.venv\\Scripts\\python.exe",
    "args": ["editor\\editor_mcp_server.py"],
    "cwd": "E:\\DemoStudio"
  }
"""
import sys
import os
from pathlib import Path

# ensure root is importable
_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))

from fastmcp import FastMCP
from core.console import send_editor_command
from core.logger import get_logger

logger = get_logger('mcp')

# Create MCP server instance
mcp = FastMCP("DemoStudio Editor Controller")


def _safe_send(cmd: str, **params) -> dict:
    """Send a command to the editor and return result dict"""
    ok = send_editor_command(cmd, **params)
    if ok:
        return {"status": "ok", "command": cmd, "message": f"Command '{cmd}' sent to editor"}
    else:
        return {"status": "error", "command": cmd, "message": "Failed to write IPC file. Is the editor running?"}


@mcp.tool(name="start_game", description="Launch the snake game from the editor")
def start_game() -> dict:
    """Start the snake game via editor"""
    return _safe_send("start_game")


@mcp.tool(name="stop_game", description="Stop the running snake game")
def stop_game() -> dict:
    """Stop the snake game via editor"""
    return _safe_send("stop_game")


@mcp.tool(name="toggle_game", description="Toggle the snake game on/off")
def toggle_game() -> dict:
    """Toggle game start/stop"""
    return _safe_send("toggle_game")


@mcp.tool(name="send_command", description="Send an arbitrary console command to the editor")
def send_command(command: str) -> dict:
    """Send any registered console command to the editor

    Args:
        command: Console command string (e.g. 'help', 'clear', 'echo hello', 'status')
    """
    return _safe_send(command)


@mcp.tool(name="get_info", description="Get information about available editor commands")
def get_info() -> dict:
    """Return help info about editor capabilities"""
    return {
        "status": "ok",
        "editor_commands": [
            "start_game  - Launch the snake game",
            "stop_game   - Stop the running game",
            "toggle_game - Toggle game on/off",
            "help        - List all console commands",
            "clear       - Clear console output",
            "status      - Show editor status",
            "echo <text> - Print text to console",
            "exit        - Close the editor",
        ],
        "ipc_file": "projects/snake/editor_ipc.json",
        "note": "The editor must be running (editor.bat) for IPC commands to work.",
    }


@mcp.tool(name="help", description="Show all available tools for controlling the editor")
def help() -> str:
    """Return help message"""
    return """DemoStudio Editor Controller — Available tools:

1. start_game       - Launch the snake game
2. stop_game        - Stop the running game
3. toggle_game      - Start/stop the game
4. send_command     - Send any console command to the editor
5. get_info         - List available editor console commands
6. help             - Show this help

Usage: Call a tool directly. The editor must be running (editor.bat).
Example: send_command(command="echo Hello from MCP!")
"""


if __name__ == "__main__":
    logger.info("=" * 50)
    logger.info("DemoStudio Editor MCP Server started")
    logger.info("IPC file: projects/snake/editor_ipc.json")
    logger.info("=" * 50)
    logger.info("Make sure editor.bat is running first!")
    logger.info("=" * 50)
    mcp.run(transport="stdio")
