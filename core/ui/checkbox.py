"""
UICheckbox — 复选框控件
=======================
带文字标签的经典复选框，勾选/取消勾选。
声明式: _box, _border, _check, _text_entity 由 JSON children 显式提供。
"""

from ursina import color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UICheckbox(UIWidget):
    """复选框控件 - 声明式

    约定子控件 id: _box(勾选框), _border(边框), _check(对勾文字), _text(标签文字)
    """

    def __init__(
        self,
        text: str = '',
        default_value: bool = False,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.18, 0.035),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._value = default_value
        self._on_change_cb: Optional[Callable] = None
        self._text = text

        # 稍后在 _on_children_built 中由 JSON 子控件填充
        self._box = None
        self._border = None
        self._check = None
        self._text_entity = None

    def _on_children_built(self):
        """由布局加载器在 JSON 子控件构建完成后调用"""
        self._box = self._find_child('_box')
        self._border = self._find_child('_border')
        self._check = self._find_child('_check')
        self._text_entity = self._find_child('_text')

        # 设置勾选状态
        self._update_visual()

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
        if self._box is not None:
            self._box.color = ui_theme.toggle.on if self._value else ui_theme.toggle.off
        if self._check is not None and hasattr(self._check, '_text_entity'):
            self._check._text_entity.visible = self._value
            self._check._text_entity.text = '✔' if self._value else ''

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
        _destroy(self._text_entity)
        _destroy(self)
