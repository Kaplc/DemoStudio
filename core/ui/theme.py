"""
UI 主题系统 — 定义全局色彩、字体、间距等样式变量
=================================================
参考 Unity/UE 的 Style/Theme 系统设计，支持：
- 暗色/亮色主题切换
- 控件状态色 (normal / hover / pressed / disabled)
- 全局缩放与间距配置
- 主题继承与覆盖

Usage:
    from core.ui.theme import ui_theme, UITheme

    # 使用默认主题
    btn_color = ui_theme.button.normal

    # 创建自定义主题
    custom = UITheme(background=color.hex('#2d2d2d'), ...)
"""

from ursina import color


# ──────────────────────────────────────────────
# 控件专属样式类
# ──────────────────────────────────────────────

class _ButtonStyle:
    """按钮样式"""

    def __init__(self, **kwargs):
        self.normal: color = kwargs.get('normal', color.hex('#4a6fa5'))
        self.hover: color = kwargs.get('hover', color.hex('#5a8fd5'))
        self.pressed: color = kwargs.get('pressed', color.hex('#3a5f95'))
        self.disabled: color = kwargs.get('disabled', color.hex('#555555'))
        self.text: color = kwargs.get('text', color.white)
        self.text_disabled: color = kwargs.get('text_disabled', color.hex('#888888'))
        self.outline: color = kwargs.get('outline', color.hex('#2a4f85'))


class _InputStyle:
    """输入框样式"""

    def __init__(self, **kwargs):
        self.normal: color = kwargs.get('normal', color.hex('#1e2a3a'))
        self.focused: color = kwargs.get('focused', color.hex('#1e3050'))
        self.text: color = kwargs.get('text', color.hex('#e0e0e0'))
        self.placeholder: color = kwargs.get('placeholder', color.hex('#667788'))
        self.caret: color = kwargs.get('caret', color.hex('#e94560'))
        self.selection: color = kwargs.get('selection', color.rgba(74, 111, 165, 120))


class _SliderStyle:
    """滑块样式"""

    def __init__(self, **kwargs):
        self.track: color = kwargs.get('track', color.hex('#2a2a3a'))
        self.fill: color = kwargs.get('fill', color.hex('#4a6fa5'))
        self.thumb: color = kwargs.get('thumb', color.hex('#6a9fd5'))
        self.thumb_hover: color = kwargs.get('thumb_hover', color.hex('#8abff5'))


class _ToggleStyle:
    """开关/复选框样式"""

    def __init__(self, **kwargs):
        self.off: color = kwargs.get('off', color.hex('#3a3a4a'))
        self.on: color = kwargs.get('on', color.hex('#4a9f6a'))
        self.hover: color = kwargs.get('hover', color.hex('#4a5a6a'))
        self.checkmark: color = kwargs.get('checkmark', color.white)
        self.text: color = kwargs.get('text', color.hex('#e0e0e0'))


class _WindowStyle:
    """窗口/面板样式"""

    def __init__(self, **kwargs):
        self.title_bar: color = kwargs.get('title_bar', color.hex('#1a1a2e'))
        self.title_text: color = kwargs.get('title_text', color.hex('#e94560'))
        self.background: color = kwargs.get('background', color.hex('#16213e'))
        self.border: color = kwargs.get('border', color.hex('#2a2a4a'))
        self.close_btn: color = kwargs.get('close_btn', color.hex('#e94560'))


class _ScrollStyle:
    """滚动条样式"""

    def __init__(self, **kwargs):
        self.track: color = kwargs.get('track', color.rgba(30, 30, 50, 80))
        self.thumb: color = kwargs.get('thumb', color.rgba(60, 70, 100, 160))
        self.thumb_hover: color = kwargs.get('thumb_hover', color.rgba(80, 90, 120, 200))


# ──────────────────────────────────────────────
# 主题主类
# ──────────────────────────────────────────────

class UITheme:
    """完整 UI 主题定义
    
    包含所有控件的颜色样式与全局配置。
    可复制后修改部分属性来创建派生主题。
    """

    def __init__(self, **kwargs):
        # ─── 全局 ───
        self.font: str = kwargs.get('font', '')
        self.font_size: float = kwargs.get('font_size', 0.8)
        self.corner_radius: float = kwargs.get('corner_radius', 0.05)
        self.spacing: float = kwargs.get('spacing', 0.01)
        self.padding: float = kwargs.get('padding', 0.015)
        self.global_scale: float = kwargs.get('global_scale', 1.0)

        # ─── 基础色板 ───
        self.background: color = kwargs.get('background', color.hex('#1a1a2e'))       # 窗口/面板背景
        self.surface: color = kwargs.get('surface', color.hex('#16213e'))             # 控件表面
        self.surface_light: color = kwargs.get('surface_light', color.hex('#1e2a4a'))  # 浅色表面
        self.text: color = kwargs.get('text', color.hex('#e0e0e0'))                   # 主文字
        self.text_dim: color = kwargs.get('text_dim', color.hex('#8899aa'))           # 辅助文字
        self.accent: color = kwargs.get('accent', color.hex('#e94560'))               # 强调色
        self.accent_hover: color = kwargs.get('accent_hover', color.hex('#ff6b81'))   # 强调悬停
        self.success: color = kwargs.get('success', color.hex('#44ff88'))             # 成功
        self.warning: color = kwargs.get('warning', color.hex('#ffaa44'))             # 警告
        self.error: color = kwargs.get('error', color.hex('#ff5555'))                 # 错误
        self.info: color = kwargs.get('info', color.hex('#55bbff'))                   # 信息
        self.border: color = kwargs.get('border', color.hex('#2a2a4a'))               # 边框
        self.transparent: color = kwargs.get('transparent', color.rgba(0, 0, 0, 0))

        # ─── 控件样式 ───
        self.button = _ButtonStyle(**kwargs.get('button', {}))
        self.input = _InputStyle(**kwargs.get('input', {}))
        self.slider = _SliderStyle(**kwargs.get('slider', {}))
        self.toggle = _ToggleStyle(**kwargs.get('toggle', {}))
        self.window = _WindowStyle(**kwargs.get('window', {}))
        self.scroll = _ScrollStyle(**kwargs.get('scroll', {}))

    def copy(self) -> 'UITheme':
        """创建当前主题的副本 (可安全修改)"""
        return UITheme(
            font=self.font,
            font_size=self.font_size,
            corner_radius=self.corner_radius,
            spacing=self.spacing,
            padding=self.padding,
            global_scale=self.global_scale,
            background=self.background,
            surface=self.surface,
            surface_light=self.surface_light,
            text=self.text,
            text_dim=self.text_dim,
            accent=self.accent,
            accent_hover=self.accent_hover,
            success=self.success,
            warning=self.warning,
            error=self.error,
            info=self.info,
            border=self.border,
            transparent=self.transparent,
        )


# ──────────────────────────────────────────────
# 预设主题
# ──────────────────────────────────────────────

#: 暗色主题 (默认，适合编辑器)
DARK_THEME = UITheme()

#: 亮色主题 (适合游戏内 UI)
LIGHT_THEME = UITheme(
    background=color.hex('#f0f0f0'),
    surface=color.hex('#ffffff'),
    surface_light=color.hex('#e8e8e8'),
    text=color.hex('#222222'),
    text_dim=color.hex('#666666'),
    accent=color.hex('#e94560'),
    accent_hover=color.hex('#ff6b81'),
    border=color.hex('#cccccc'),
    button=_ButtonStyle(
        normal=color.hex('#e0e0e0'),
        hover=color.hex('#d0d0d0'),
        pressed=color.hex('#c0c0c0'),
        disabled=color.hex('#aaaaaa'),
        text=color.hex('#222222'),
        text_disabled=color.hex('#888888'),
        outline=color.hex('#bbbbbb'),
    ),
    input=_InputStyle(
        normal=color.hex('#ffffff'),
        focused=color.hex('#f5f5ff'),
        text=color.hex('#222222'),
        placeholder=color.hex('#999999'),
        caret=color.hex('#e94560'),
    ),
    slider=_SliderStyle(
        track=color.hex('#dddddd'),
        fill=color.hex('#4a6fa5'),
        thumb=color.hex('#3a5f95'),
        thumb_hover=color.hex('#2a4f85'),
    ),
    toggle=_ToggleStyle(
        off=color.hex('#cccccc'),
        on=color.hex('#4a9f6a'),
        hover=color.hex('#bbbbbb'),
        checkmark=color.hex('#222222'),
        text=color.hex('#222222'),
    ),
    window=_WindowStyle(
        title_bar=color.hex('#e0e0e0'),
        title_text=color.hex('#222222'),
        background=color.hex('#ffffff'),
        border=color.hex('#cccccc'),
        close_btn=color.hex('#e94560'),
    ),
    scroll=_ScrollStyle(
        track=color.rgba(200, 200, 200, 80),
        thumb=color.rgba(160, 160, 160, 160),
        thumb_hover=color.rgba(140, 140, 140, 200),
    ),
)

#: 游戏内 HUD 半透明主题
HUD_THEME = UITheme(
    background=color.rgba(10, 10, 30, 160),
    surface=color.rgba(20, 25, 50, 180),
    surface_light=color.rgba(30, 35, 60, 200),
    border=color.rgba(40, 50, 80, 100),
)


#: 当前激活的主题 (可全局切换)
ui_theme: UITheme = DARK_THEME


def set_theme(theme: UITheme):
    """全局切换主题"""
    global ui_theme
    ui_theme = theme


# ─── 便捷色值映射 (兼容旧代码) ───
def theme_color(key: str, fallback=None):
    """通过点分路径获取主题颜色, e.g. 'button.normal'"""
    parts = key.split('.')
    obj = ui_theme
    for p in parts:
        obj = getattr(obj, p, None)
        if obj is None:
            return fallback if fallback else color.hex('#ff00ff')
    return obj
