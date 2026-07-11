"""
UIInputField — 文本输入框
=========================
类似 Unity 的 InputField 或 UE 的 TextBox。
支持 placeholder、最大字符数、密码模式。
"""

from ursina import color, time
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UIInputField(UIWidget):
    """文本输入框 - 声明式

    约定子控件 id: _display(文字), _cursor(光标), _underline(底线)
    """

    def __init__(
        self,
        placeholder: str = '',
        default_text: str = '',
        max_length: int = 0,
        password_mode: bool = False,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.3, 0.04),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=ui_theme.input.normal, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._text = default_text
        self._placeholder = placeholder
        self._max_length = max_length
        self._password_mode = password_mode
        self._is_focused = False
        self._cursor_visible = True
        self._cursor_timer = 0
        self._on_submit_cb: Optional[Callable] = None
        self._on_change_cb: Optional[Callable] = None

        # 稍后在 _on_children_built 中填充
        self._display = None
        self._cursor = None
        self._underline = None

    def _on_children_built(self):
        self._display = self._find_child('_display')
        self._cursor = self._find_child('_cursor')
        self._underline = self._find_child('_underline')
        self._update_display()

        def _focus():
            self._is_focused = True
            self.color = ui_theme.input.focused
            if self._underline is not None:
                self._underline.color = ui_theme.accent
            self._cursor_visible = True
            self._cursor_timer = 0

        def _unfocus():
            self._is_focused = False
            self.color = ui_theme.input.normal
            if self._underline is not None:
                self._underline.color = ui_theme.border
            if self._cursor is not None:
                self._cursor.visible = False

        self.on_mouse_enter = lambda: None
        self.on_mouse_exit = lambda: None
        self._on_focus = _focus
        self._on_blur = _unfocus

    def input(self, key):
        if key == 'left mouse down':
            if self.hovered:
                self._on_focus()
            elif self._is_focused:
                self._on_blur()
            return

        if not self._is_focused:
            return

        if key == 'backspace':
            if self._text:
                self._text = self._text[:-1]
                self._update_display()
        elif key == 'enter':
            if self._on_submit_cb:
                self._on_submit_cb(self._text)
        elif key.startswith(' '):
            pass
        elif len(key) == 1:
            if self._max_length <= 0 or len(self._text) < self._max_length:
                self._text += key
                self._update_display()

    def update(self):
        if self._is_focused:
            self._cursor_timer += time.dt
            if self._cursor_timer > 0.5:
                self._cursor_visible = not self._cursor_visible
                self._cursor_timer = 0
            if self._cursor is not None:
                self._cursor.visible = self._cursor_visible

    def _update_display(self):
        if self._display is None or not hasattr(self._display, '_text_entity'):
            return
        if self._text:
            display = '*' * len(self._text) if self._password_mode else self._text
            self._display._text_entity.text = display
            self._display._text_entity.color = ui_theme.input.text
        else:
            self._display._text_entity.text = self._placeholder
            self._display._text_entity.color = ui_theme.input.placeholder

        text_width = len(self._text) * 0.03 * ui_theme.font_size
        if self._cursor is not None:
            self._cursor.x = -0.45 + text_width

        if self._on_change_cb:
            self._on_change_cb(self._text)

    @property
    def text(self) -> str:
        return self._text

    @text.setter
    def text(self, value: str):
        self._text = value
        self._update_display()

    def set_text(self, value: str):
        self.text = value
        return self

    def on_submit(self, callback: Callable[[str], None]):
        self._on_submit_cb = callback
        return self

    def on_text_changed(self, callback: Callable[[str], None]):
        self._on_change_cb = callback
        return self

    def clear(self):
        self._text = ''
        self._update_display()
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
