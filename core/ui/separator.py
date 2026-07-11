"""
UISeparator — 分割线控件
========================
用于在布局中分隔不同区域。
"""

from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor


class UISeparator(UIWidget):
    """分割线控件

    Usage:
        sep = UISeparator(size=(0.3, 0.002))
    """

    def __init__(
        self,
        direction: str = 'horizontal',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = None,
        **kwargs,
    ):
        if size is None:
            size = (0.25, 0.003) if direction == 'horizontal' else (0.003, 0.25)
        color_sep = kwargs.pop('color', None) or ui_theme.border
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color_sep, **kwargs,
        )
        self.unlit = True
