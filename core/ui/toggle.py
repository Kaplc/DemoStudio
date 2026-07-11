"""
UIToggle — 开关按钮 (Toggle)
============================
点击切换 on/off 状态。声明式: _bg, _thumb, _text 由 JSON children 显式提供。
"""

from ursina import color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UIToggle(UIWidget):
    """开关按钮 (Toggle) - 声明式

    约定子控件 id: _bg(背景), _thumb(滑块), _text(标签文字)
    """

    def __init__(
        self,
        text: str = '',
        default_value: bool = False,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.15, 0.04),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._value = default_value
        self._text = text
        self._on_change_cb: Optional[Callable] = None

        # 稍后在 _on_children_built 中填充
        self._bg = None
        self._thumb = None
        self._text_entity = None

    def _on_children_built(self):
        self._bg = self._find_child('_bg')
        self._thumb = self._find_child('_thumb')
        self._text_entity = self._find_child('_text')
        self._update_visual()
        self._setup_hover()

    def _setup_hover(self):
        def _on_enter():
            if self.hovered and self._bg is not None:
                self._bg.color = ui_theme.toggle.hover
        def _on_exit():
            if self._bg is not None:
                self._bg.color = ui_theme.toggle.on if self._value else ui_theme.toggle.off
        self.on_mouse_enter = _on_enter
        self.on_mouse_exit = _on_exit

    def input(self, key):
        if key == 'left mouse down' and self.hovered:
            self.toggle()

    @property
    def value(self) -> bool:
        return self._value

    @value.setter
    def value(self, v: bool):
        self._value = v
        self._update_visual()

    def toggle(self):
        self._value = not self._value
        self._update_visual()
        if self._on_change_cb:
            self._on_change_cb(self._value)

    def _update_visual(self):
        if self._bg is not None:
            self._bg.color = ui_theme.toggle.on if self._value else ui_theme.toggle.off
        if self._thumb is not None:
            self._thumb.x = 0.03 if self._value else -0.03

    def on_value_changed(self, callback: Callable[[bool], None]):
        self._on_change_cb = callback
        return self

    @property
    def text(self) -> str:
        return self._text

    def set_text(self, value: str):
        self._text = value
        if self._text_entity is not None and hasattr(self._text_entity, '_text_entity'):
            self._text_entity._text_entity.text = value
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
