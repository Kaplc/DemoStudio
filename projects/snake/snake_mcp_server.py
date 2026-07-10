"""
贪吃蛇 FastMCP 服务器
通过 IPC 文件与运行中的游戏通信，提供工具供 AI 调用

用法:
  python snake_mcp_server.py

在 VS Code 的 mcp.json 中注册:
  "snake-game": {
    "command": "E:\\DemoStudio\\.venv\\Scripts\\python.exe",
    "args": ["projects/snake/snake_mcp_server.py"],
    "cwd": "E:\\DemoStudio"
  }
"""
import sys
import os
from pathlib import Path

# ensure root and projects/snake/ are importable
_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_root))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastmcp import FastMCP
import snake_shared
from core.logger import get_logger

logger = get_logger('mcp')

# 创建 MCP 服务器实例
mcp = FastMCP(
    "贪吃蛇游戏控制器",
)


@mcp.tool(name="get_state", description="获取游戏当前状态：分数、蛇位置、食物位置、游戏是否结束等")
def get_state() -> dict:
    """获取游戏当前完整状态"""
    state = snake_shared.read_state()
    if state is None:
        return {
            "status": "error",
            "message": "游戏未运行。请先双击 snake_game.bat 启动游戏窗口。"
        }
    # 移除 body 大数组避免消息过长，单独提供摘要
    body = state.get("body", [])
    head = state.get("head", "?")
    length = state.get("snake_length", 0)
    state_display = {
        "status": "running",
        "score": state.get("score", 0),
        "snake_length": length,
        "head_position": head,
        "body_preview": body[:5],
        "body_count": len(body),
        "food_position": state.get("food"),
        "direction": state.get("direction"),
        "game_over": state.get("game_over", False),
        "grid_size": state.get("grid_size", 20),
    }
    return state_display


@mcp.tool(name="get_body", description="获取蛇身的完整坐标列表")
def get_body() -> dict:
    """获取蛇身的完整坐标"""
    state = snake_shared.read_state()
    if state is None:
        return {"status": "error", "message": "游戏未运行"}
    return {
        "status": "running",
        "body": state.get("body", []),
        "head": state.get("head"),
        "snake_length": state.get("snake_length", 0),
    }


@mcp.tool(name="get_grid", description="获取整个网格的状态 (0=空地, 1=蛇身, 2=蛇头, 3=食物)")
def get_grid() -> dict:
    """获取网格地图"""
    state = snake_shared.read_state()
    if state is None:
        return {"status": "error", "message": "游戏未运行"}

    grid_size = state.get("grid_size", 20)
    half = grid_size // 2

    # 初始化网格
    grid = [[0] * grid_size for _ in range(grid_size)]

    # 标记蛇身
    body = state.get("body", [])
    for x, z in body:
        gx = x + half
        gz = z + half
        if 0 <= gx < grid_size and 0 <= gz < grid_size:
            grid[gz][gx] = 1

    # 标记蛇头
    head = state.get("head")
    if head:
        hx, hz = head
        ghx = hx + half
        ghz = hz + half
        if 0 <= ghx < grid_size and 0 <= ghz < grid_size:
            grid[ghz][ghx] = 2

    # 标记食物
    food = state.get("food")
    if food:
        fx, fz = food
        gfx = fx + half
        gfz = fz + half
        if 0 <= gfx < grid_size and 0 <= gfz < grid_size:
            grid[gfz][gfx] = 3

    return {
        "status": "running",
        "grid": grid,
        "grid_size": grid_size,
        "legend": {"0": "空地", "1": "蛇身", "2": "蛇头", "3": "食物"},
    }


@mcp.tool(name="set_direction", description="设置蛇的移动方向 (up/down/left/right)")
def set_direction(direction: str) -> dict:
    """切换蛇的前进方向"""
    valid = ["up", "down", "left", "right"]
    if direction not in valid:
        return {
            "status": "error",
            "message": f"无效方向 '{direction}'，可用: {', '.join(valid)}"
        }
    snake_shared.write_command("set_direction", direction=direction)
    return {"status": "ok", "direction": direction, "message": f"方向已切换为 {direction}"}


@mcp.tool(name="restart", description="重新开始游戏")
def restart() -> dict:
    """重启游戏"""
    snake_shared.write_command("restart")
    return {"status": "ok", "message": "游戏已重新开始"}


@mcp.tool(name="set_speed", description="设置游戏速度 (0.05~0.50, 越小越快)")
def set_speed(speed: float) -> dict:
    """调整游戏移动间隔"""
    speed = max(0.05, min(0.50, speed))
    snake_shared.write_command("set_speed", speed=speed)
    speed_label = "极快" if speed <= 0.08 else ("快" if speed <= 0.12 else (
        "中" if speed <= 0.2 else "慢"))
    return {
        "status": "ok",
        "speed": speed,
        "label": speed_label,
        "message": f"速度已调整为 {speed_label} ({speed:.2f})",
    }


@mcp.tool(name="get_log", description="获取最近的游戏事件日志")
def get_log(limit: int = 20) -> dict:
    """读取游戏日志"""
    lines = snake_shared.read_log(limit=limit)
    return {
        "status": "ok",
        "count": len(lines),
        "logs": lines,
        "log_file": str(snake_shared.LOG_FILE),
    }


@mcp.tool(name="help", description="显示所有可用工具及其说明")
def help() -> str:
    """返回帮助信息"""
    return """贪吃蛇游戏控制器 - 可用工具:

1. get_state        - 获取游戏状态 (分数、蛇位置、食物等)
2. get_body         - 获取蛇身完整坐标列表
3. get_grid         - 获取 20x20 网格地图
4. set_direction    - 设置蛇方向 (up/down/left/right)
5. restart          - 重新开始游戏
6. set_speed        - 调整速度 (0.05~0.50, 越快值越小)
7. get_log          - 获取最近游戏事件日志
8. help             - 显示此帮助

使用示例: 调用 set_direction(direction="right") 让蛇向右转
"""


if __name__ == "__main__":
    logger.info("=" * 50)
    logger.info("Snake MCP Server started")
    logger.info("IPC 目录: {}", snake_shared.IPC_DIR)
    logger.info("=" * 50)
    logger.info("State file: snake_state.json")
    logger.info("Command file: snake_ipc.json")
    logger.info("Log file: snake_log.txt")
    logger.info("=" * 50)
    logger.info("Tip: run snake_game.bat first to start the game window")
    logger.info("=" * 50)
    mcp.run(transport="stdio")
