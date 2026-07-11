"""
core.ui — UI 控件模块
====================
基于 Ursina Engine 渲染的 UI 系统，参考 Unity/UE 设计。

包含控件:
    基础控件:
        UIWidget    — 所有 UI 控件的基类 (widget.py)
        UIImage     — 图像/图标显示 (image.py)
        UIText      — 文字标签 (label.py)
        UIButton    — 按钮 (button.py)
        UIToggle    — 开关按钮 (toggle.py)
        UICheckbox  — 复选框 (checkbox.py)
        UISlider    — 滑动条 (slider.py)
        UIProgressBar — 进度条 (progressbar.py)
        UIInputField — 文本输入框 (inputfield.py)
        UIDropdown  — 下拉菜单 (dropdown.py)
        UISeparator — 分割线 (separator.py)

    容器与布局:
        UIPanel         — 带标题栏的面板容器 (panel.py)
        UIScrollView    — 可滚动视口 (scrollview.py)
        UIGroupBox      — 带标题的分组框 (groupbox.py)
        UIHorizontalLayout — 水平布局 (layouts.py)
        UIVerticalLayout   — 垂直布局 (layouts.py)
        UIGridLayout    — 网格布局 (layouts.py)
        UIWindow        — 可拖拽窗口 (window.py)
        UIDialog        — 模态对话框 (dialog.py)

    主题系统:
        UITheme     — 主题定义类 (theme.py)
        ui_theme    — 全局主题实例
        set_theme() — 切换主题

    锚点系统:
        Anchor      — 九宫格锚点常量 (widget.py)

用法:
    from core.ui import UIButton, Anchor, ui_theme

    btn = UIButton(text='Click', anchor=Anchor.CENTER, size=(0.2, 0.06))
    btn.on_click(lambda: print('clicked!'))
"""

# ─── 主题 ───
from core.ui.theme import UITheme, ui_theme, set_theme, theme_color, DARK_THEME, LIGHT_THEME, HUD_THEME

# ─── 基础 ───
from core.ui.widget import UIWidget, Anchor

# ─── 基础控件 ───
from core.ui.image import UIImage
from core.ui.label import UIText
from core.ui.button import UIButton
from core.ui.toggle import UIToggle
from core.ui.checkbox import UICheckbox
from core.ui.slider import UISlider
from core.ui.progressbar import UIProgressBar
from core.ui.inputfield import UIInputField
from core.ui.dropdown import UIDropdown
from core.ui.separator import UISeparator

# ─── 容器 ───
from core.ui.panel import UIPanel
from core.ui.scrollview import UIScrollView
from core.ui.groupbox import UIGroupBox
from core.ui.layouts import UIHorizontalLayout, UIVerticalLayout, UIGridLayout
from core.ui.window import UIWindow
from core.ui.dialog import UIDialog
from core.ui.canvas_plane import UICanvasPlane

# ─── 便捷别名 ───
from core.ui.label import UIText as UILabel


__all__ = [
    # 主题
    'UITheme', 'ui_theme', 'set_theme', 'theme_color', 'DARK_THEME', 'LIGHT_THEME', 'HUD_THEME',
    # 基础
    'UIWidget', 'Anchor',
    # 控件
    'UIImage', 'UIText', 'UILabel', 'UIButton', 'UIToggle', 'UICheckbox',
    'UISlider', 'UIProgressBar', 'UIInputField', 'UIDropdown', 'UISeparator',
    # 容器
    'UIPanel', 'UIScrollView', 'UIGroupBox',
    'UIHorizontalLayout', 'UIVerticalLayout', 'UIGridLayout',
    'UIWindow', 'UIDialog', 'UICanvasPlane',
]
