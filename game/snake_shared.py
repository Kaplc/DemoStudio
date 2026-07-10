"""
贪吃蛇游戏 - 共享状态与 IPC 通信模块
用于在游戏进程和 MCP 服务器之间交换数据
"""
import json
import os
import time
from pathlib import Path
from collections import deque

from core.logger import get_logger
logger = get_logger('ipc')

# ── 文件路径 ──
IPC_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
CMD_FILE = IPC_DIR / "snake_ipc.json"       # MCP → 游戏 (命令)
STATE_FILE = IPC_DIR / "snake_state.json"   # 游戏 → MCP (状态)
LOG_FILE = IPC_DIR / "snake_log.txt"        # 游戏日志


# ── 写入命令 (MCP 侧调用) ──
def write_command(cmd: str, **params):
    """写入命令供游戏读取"""
    data = {"cmd": cmd, "params": params, "timestamp": time.time()}
    with open(CMD_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return data


# ── 读取命令 (游戏侧调用，消费后清空) ──
def read_command():
    """读取并消费最新命令"""
    if not CMD_FILE.exists():
        return None
    try:
        with open(CMD_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        # 清空命令文件 (消费)
        with open(CMD_FILE, "w", encoding="utf-8") as f:
            json.dump({"cmd": "none", "params": {}, "timestamp": 0}, f)
        return data
    except (json.JSONDecodeError, OSError):
        return None


# ── 写入游戏状态 (游戏侧调用) ──
def write_state(**fields):
    """写入当前游戏状态"""
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    state.update(fields)
    state["timestamp"] = time.time()
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    return state


# ── 读取游戏状态 (MCP 侧调用) ──
def read_state():
    """读取当前游戏状态"""
    if not STATE_FILE.exists():
        return None
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# ── 追加日志 (游戏侧调用) ──
def append_log(msg: str):
    """追加一行日志（同时写入 IPC 文件和 loguru）"""
    try:
        ts = time.strftime("%H:%M:%S")
        line = f"[{ts}] {msg}\n"
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    logger.info("{}", msg)


# ── 读取日志 (MCP 侧调用) ──
def read_log(limit: int = 50):
    """读取最近 N 行日志"""
    if not LOG_FILE.exists():
        return []
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
        return [l.strip() for l in lines[-limit:]]
    except OSError:
        return []


# ── 清空 IPC 文件 (游戏启动时调用) ──
def reset_ipc():
    """清空所有 IPC 文件"""
    for f in [CMD_FILE, STATE_FILE, LOG_FILE]:
        try:
            if f.exists():
                f.unlink()
        except OSError:
            pass
    # 写入初始命令文件
    write_command("none")
