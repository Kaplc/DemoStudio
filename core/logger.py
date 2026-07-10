"""
高性能日志配置模块 (loguru)
- 按组件分离日志文件: editor / game / mcp
- 日志目录: 项目根目录 /logs/
- 自动轮转、压缩、清理
"""
import sys
from pathlib import Path
from loguru import logger as _base_logger

# ── 日志目录 (项目根目录 /logs/) ──
LOG_DIR = Path(__file__).resolve().parent.parent / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ── 移除默认 handler ──
_base_logger.remove()

# ── 格式定义 ──
_CONSOLE_FMT = (
    "<green>{time:HH:mm:ss}</green> | "
    "<level>{level:<7}</level> | "
    "<cyan>{extra[component]:>8}</cyan> | "
    "<level>{message}</level>"
)

_FILE_FMT = (
    "{time:YYYY-MM-DD HH:mm:ss.SSS} | "
    "{level:<7} | "
    "{extra[component]:>8} | "
    "{name:>12}:{function:>16}:{line:<4} | "
    "{message}"
)


def _component_filter(component: str):
    """返回一个 filter 函数，只放行指定 component 的日志"""
    def filter_fn(record):
        return record["extra"].get("component") == component
    return filter_fn


def _not_component_filter(*excluded: str):
    """返回一个 filter 函数，排除指定 component 的日志"""
    def filter_fn(record):
        return record["extra"].get("component") not in excluded
    return filter_fn


# ── 控制台输出 (彩色, 所有组件) ──
_base_logger.add(
    sys.stderr,
    format=_CONSOLE_FMT,
    level="DEBUG",
    colorize=True,
)

# ── 编辑器日志 ──
_base_logger.add(
    str(LOG_DIR / 'editor_{time:YYYY-MM-DD}.log'),
    format=_FILE_FMT,
    level="DEBUG",
    rotation="10 MB",
    retention="7 days",
    compression="gz",
    encoding="utf-8",
    filter=_component_filter('editor'),
)

# ── 游戏日志 (game + ipc) ──
_base_logger.add(
    str(LOG_DIR / 'game_{time:YYYY-MM-DD}.log'),
    format=_FILE_FMT,
    level="DEBUG",
    rotation="10 MB",
    retention="7 days",
    compression="gz",
    encoding="utf-8",
    filter=lambda r: r["extra"].get("component") in ('game', 'ipc'),
)

# ── MCP 服务器日志 ──
_base_logger.add(
    str(LOG_DIR / 'mcp_{time:YYYY-MM-DD}.log'),
    format=_FILE_FMT,
    level="DEBUG",
    rotation="10 MB",
    retention="7 days",
    compression="gz",
    encoding="utf-8",
    filter=_component_filter('mcp'),
)

# ── 错误日志 (独立文件, 保留更久) ──
_base_logger.add(
    str(LOG_DIR / 'error_{time:YYYY-MM-DD}.log'),
    format=_FILE_FMT,
    level="ERROR",
    rotation="10 MB",
    retention="30 days",
    compression="gz",
    encoding="utf-8",
)


# ── 导出 ──

def get_logger(name: str = 'root'):
    """获取带组件名的 logger 实例

    Args:
        name: 组件名称 — 'editor' / 'game' / 'mcp' / 'ipc'
              同名日志会自动路由到对应的日志文件
    """
    return _base_logger.bind(component=name)


# 可直接 import 使用的默认 logger
logger = get_logger('root')
