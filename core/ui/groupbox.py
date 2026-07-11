"""
UIGroupBox — 带标题的分组框
============================
类似 Unity 的 GroupBox 或 UE 的 Group Widget。
标题显示在边框顶部。
"""

from ursina import color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor


class UIGroupBox(UIWidget):
    """带标题的分组框 - 声明式
    约定子控件 id: _border, _title_bg, _title_text
    """

    def __init__(
        self,
        title: str = 'Group',
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.25, 0.15),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True
        self._title = title

        # 稍后在 _on_children_built 中填充
        self._border = None
        self._title_bg = None
        self._title_text = None

    def _on_children_built(self):
        self._border = self._find_child('_border')
        self._title_bg = self._find_child('_title_bg')
        self._title_text = self._find_child('_title_text')

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value
        if self._title_text is not None and hasattr(self._title_text, '_text_entity'):
            self._title_text._text_entity.text = value

    def set_title(self, value: str):
        self.title = value
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
