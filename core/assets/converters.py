"""
converters — 类型转换工具集
===========================
将 JSON 中的字符串值转换为 Ursina UI 系统的实际对象。
支持颜色、锚点、向量等类型的解析。

核心能力:
    - parse_color(str) → color 对象
    - parse_anchor(str/tuple) → Vec2 锚点
    - parse_vec2(list/str) → Vec2
    - resolve_theme_color(str) → 从主题中查色
"""

import re
from ursina import Vec2, color as ursina_color
from core.ui.theme import ui_theme
from core.logger import get_logger

logger = get_logger('assets.converters')


# ──────────────────────────────────────────────
# 锚点映射表 (JSON 字符串 ↔ Vec2)
# ──────────────────────────────────────────────

class AnchorMap:
    """锚点名称与坐标映射 (同 core.ui.widget.Anchor)"""
    MAP = {
        'TOP_LEFT':      (-0.5,  0.5),
        'TOP_CENTER':    ( 0.0,  0.5),
        'TOP_RIGHT':     ( 0.5,  0.5),
        'MIDDLE_LEFT':   (-0.5,  0.0),
        'CENTER':        ( 0.0,  0.0),
        'MIDDLE_RIGHT':  ( 0.5,  0.0),
        'BOTTOM_LEFT':   (-0.5, -0.5),
        'BOTTOM_CENTER': ( 0.0, -0.5),
        'BOTTOM_RIGHT':  ( 0.5, -0.5),

        # 简写别名
        'TL': (-0.5,  0.5),
        'TC': ( 0.0,  0.5),
        'TR': ( 0.5,  0.5),
        'ML': (-0.5,  0.0),
        'C':  ( 0.0,  0.0),
        'MR': ( 0.5,  0.0),
        'BL': (-0.5, -0.5),
        'BC': ( 0.0, -0.5),
        'BR': ( 0.5, -0.5),
    }

    @classmethod
    def resolve(cls, value) -> tuple:
        """将锚点名称或元组解析为 (x, y) 坐标元组"""
        if isinstance(value, (list, tuple)):
            if len(value) >= 2:
                return (float(value[0]), float(value[1]))
            raise ValueError(f'锚点元组需要至少2个元素: {value}')
        if isinstance(value, str):
            key = value.upper().strip()
            if key in cls.MAP:
                return cls.MAP[key]
            # 尝试解析 "(-0.5, 0.5)" 格式
            match = re.match(r'^\(?\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)?$', value)
            if match:
                return (float(match.group(1)), float(match.group(2)))
            raise ValueError(f'未知的锚点名称: {value}')
        raise TypeError(f'不支持的锚点类型: {type(value)}')


# ──────────────────────────────────────────────
# 颜色解析
# ──────────────────────────────────────────────

_HEX_COLOR_RE = re.compile(r'^#?([0-9a-fA-F]{3,8})$')
_RGBA_RE = re.compile(
    r'^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$'
)


def parse_color(value, fallback=None):
    """将颜色值解析为 Ursina color 对象

    支持:
        - 十六进制: '#ff0000', '#ff000088', '#e94560'
        - 函数式:   'rgba(255, 0, 0, 0.5)', 'rgb(255,0,0)'
        - 名称:     'red', 'white', 'blue' 等 Ursina 内置色
        - 主题引用:  '$primary', '$accent' 等 (以 $ 开头)
        - 主题色链:  '$button.normal' (以 $ 开头的链式路径)
        - None:     返回 fallback 或白色
    """
    if value is None:
        return fallback or ursina_color.white

    # 主题颜色引用
    if isinstance(value, str) and value.startswith('$'):
        result = resolve_theme_color(value[1:])
        if result is not None:
            return result
        logger.warning('主题颜色 "{}" 未找到, 使用 fallback', value)
        return fallback or ursina_color.white

    # Ursina 内置颜色名称
    if isinstance(value, str) and hasattr(ursina_color, value.lower()):
        return getattr(ursina_color, value.lower())

    if isinstance(value, str):
        value = value.strip()

        # 十六进制
        if value.startswith('#'):
            try:
                return ursina_color.hex(value)
            except Exception:
                pass

        # rgba/rgb 函数式
        match = _RGBA_RE.match(value)
        if match:
            r, g, b = int(match.group(1)), int(match.group(2)), int(match.group(3))
            a = float(match.group(4)) if match.group(4) else 1.0
            return ursina_color.rgba(r, g, b, int(a * 255))

    # 如果已经是 color 对象
    if hasattr(value, 'r') and hasattr(value, 'g') and hasattr(value, 'b'):
        return value

    # 数字列表: [255, 0, 0] 或 [255, 0, 0, 128]
    if isinstance(value, (list, tuple)):
        if len(value) >= 3:
            r, g, b = int(value[0]), int(value[1]), int(value[2])
            a = int(value[3]) if len(value) > 3 else 255
            return ursina_color.rgba(r, g, b, a)

    logger.warning('无法解析颜色: "{}", 使用 fallback', value)
    return fallback or ursina_color.white


def resolve_theme_color(path: str):
    """从主题中解析颜色路径

    支持点号链式访问: 'button.normal', 'window.title_bar'
    也支持顶层属性: 'background', 'accent', 'text'

    Examples:
        resolve_theme_color('accent')        → 主题强调色
        resolve_theme_color('button.normal') → 按钮普通色
        resolve_theme_color('window.title_bar') → 窗口标题栏色
    """
    if not path:
        return None

    parts = path.split('.')
    obj = ui_theme

    for part in parts:
        if hasattr(obj, part):
            obj = getattr(obj, part)
        else:
            return None

    # 检查最终值是否是颜色
    if hasattr(obj, 'r') and hasattr(obj, 'g') and hasattr(obj, 'b'):
        return obj
    return None


# ──────────────────────────────────────────────
# 向量解析
# ──────────────────────────────────────────────

def parse_vec2(value, default=None) -> Vec2:
    """将值解析为 Vec2

    支持:
        - 列表: [0.5, 0.5]
        - 字符串: '0.5, 0.5'
        - 数字: 5 → Vec2(5, 5)
    """
    if value is None:
        return Vec2(*default) if default else Vec2(0, 0)

    if isinstance(value, Vec2):
        return value

    if isinstance(value, (int, float)):
        return Vec2(value, value)

    if isinstance(value, (list, tuple)):
        if len(value) >= 2:
            return Vec2(float(value[0]), float(value[1]))
        return Vec2(float(value[0]), float(value[0]))

    if isinstance(value, str):
        parts = value.strip('()[] ').split(',')
        if len(parts) >= 2:
            return Vec2(float(parts[0]), float(parts[1]))
        return Vec2(float(parts[0]), float(parts[0]))

    return Vec2(*default) if default else Vec2(0, 0)


# ──────────────────────────────────────────────
# 锚点解析 (返回 Vec2)
# ──────────────────────────────────────────────

def parse_anchor(value) -> Vec2:
    """解析锚点值为 Vec2"""
    xy = AnchorMap.resolve(value)
    return Vec2(*xy)
