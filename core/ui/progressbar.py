"""
UIProgressBar — 进度条控件
==========================
只读进度条。声明式: _bg, _fill, _label 由 JSON children 显式提供。
"""

from ursina import color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor


class UIProgressBar(UIWidget):
    """进度条控件 - 声明式

    约定子控件 id: _bg(背景), _fill(填充), _label(数值标签)
    """

    def __init__(
        self,
        value: float = 0.0,
        max_value: float = 1.0,
        show_label: bool = True,
        label_format: str = '{:.0%}',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.25, 0.03),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True

        self._value = value
        self._max_value = max_value
        self._label_format = label_format

        # 稍后在 _on_children_built 中填充
        self._bg = None
        self._fill = None
        self._label = None

    def _on_children_built(self):
        self._bg = self._find_child('_bg')
        self._fill = self._find_child('_fill')
        self._label = self._find_child('_label')
        self._update_visual()

    @property
    def _norm(self) -> float:
        if self._max_value <= 0:
            return 0
        return max(0, min(1, self._value / self._max_value))

    @property
    def value(self) -> float:
        return self._value

    @value.setter
    def value(self, v: float):
        self._value = max(0, v)
        self._update_visual()

    def set_progress(self, v: float):
        self.value = v
        return self

    def set_max(self, m: float):
        self._max_value = m
        self._update_visual()
        return self

    def _format_value(self):
        try:
            return self._label_format.format(self._norm)
        except (ValueError, TypeError):
            return f'{self._value:.1f}/{self._max_value:.1f}'

    def _update_visual(self):
        n = self._norm
        if self._fill is not None:
            self._fill.scale_x = n if n > 0.01 else 0.01
            self._fill.x = -0.5 + self._fill.scale_x / 2
        if self._label is not None and hasattr(self._label, '_text_entity'):
            self._label._text_entity.text = self._format_value()

    def set_fill_color(self, c):
        if self._fill is not None:
            self._fill.color = c
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
