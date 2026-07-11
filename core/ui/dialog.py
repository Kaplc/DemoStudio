"""
UIDialog — 模态对话框
=====================
预制了确认/取消按钮的对话框。
声明式: _overlay, _message, _confirm_btn, _cancel_btn 由 JSON children 显式提供。
"""

from ursina import camera
from core.ui.theme import ui_theme
from core.ui.widget import Anchor, compensated_text_scale
from core.ui.window import UIWindow

from typing import Optional, Callable


class UIDialog(UIWindow):
    """模态对话框 - 声明式

    约定子控件 id: _overlay(遮罩), _message(消息文字), _confirm_btn, _cancel_btn
    """

    def __init__(
        self,
        message: str = '',
        confirm_text: str = 'OK',
        cancel_text: str = None,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        size: tuple = (0.35, 0.2),
        **kwargs,
    ):
        super().__init__(
            title=kwargs.pop('title', 'Dialog'),
            closable=False,
            draggable=False,
            parent=parent, anchor=anchor, offset=(0, 0),
            size=size,
            **kwargs,
        )

        self._message = message
        self._confirm_text = confirm_text
        self._cancel_text = cancel_text
        self._confirm_cb: Optional[Callable] = None
        self._cancel_cb: Optional[Callable] = None

        # 稍后在 _on_children_built 中填充
        self._overlay = None
        self._message_text = None
        self._confirm_btn = None
        self._cancel_btn = None

    def _on_children_built(self):
        super()._on_children_built()
        self._overlay = self._find_child('_overlay')
        self._message_text = self._find_child('_message')
        self._confirm_btn = self._find_child('_confirm_btn')
        self._cancel_btn = self._find_child('_cancel_btn')

        # 设置按钮点击回调
        if self._confirm_btn is not None and hasattr(self._confirm_btn, '_click_callback'):
            self._confirm_btn._click_callback = self._on_confirm_clicked
        if self._cancel_btn is not None and hasattr(self._cancel_btn, '_click_callback'):
            self._cancel_btn._click_callback = self._on_cancel_clicked
            self._cancel_btn._click_callback = self._on_cancel_clicked

    def _on_confirm_clicked(self):
        self.close()
        if self._confirm_cb:
            self._confirm_cb()

    def _on_cancel_clicked(self):
        self.close()
        if self._cancel_cb:
            self._cancel_cb()

    def on_confirm(self, callback: Callable):
        self._confirm_cb = callback
        return self

    def on_cancel(self, callback: Callable):
        self._cancel_cb = callback
        return self

    @property
    def message(self) -> str:
        return self._message

    def set_message(self, value: str):
        self._message = value
        self._message_text.text = value
        return self

    def close(self):
        from ursina import destroy as _destroy
        _destroy(self._overlay)
        self.enabled = False

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self._overlay)
        _destroy(self._message_text)
        _destroy(self._confirm_btn)
        if self._cancel_btn:
            _destroy(self._cancel_btn)
        _destroy(self)
