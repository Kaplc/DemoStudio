"""
UIButton — 交互按钮控件
=======================
支持三种视觉状态: Normal / Hover / Pressed

文字设计:
  - UIButton 自身只负责点击交互和背景色状态
  - 文字由 JSON 或 API 中显式创建的 UIText 子控件提供
  - .text() / .set_text() 等便捷方法自动查找第一个 UIText 子控件
"""

from ursina import color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UIButton(UIWidget):
    """交互按钮控件

    文字需通过子控件 UIText 显式添加, 不在构造时自动创建。

    Usage:
        btn = UIButton(anchor=Anchor.CENTER, size=(0.2, 0.06))
        btn.on_click(lambda: print('clicked!'))
    """

    def __init__(
        self,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.18, 0.05),
        **kwargs,
    ):
        # text/font_size/text_color 不再自动创建 Text 子控件
        # 需在 JSON 或 API 中通过显式的 UIText 子控件提供
        kwargs.pop('text', None)
        kwargs.pop('font_size', None)
        kwargs.pop('text_color', None)

        color_normal = kwargs.pop('color', None)
        theme = kwargs.pop('theme', None)
        bg_color = color_normal or (theme.button.normal if theme else ui_theme.button.normal)

        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=bg_color, theme=theme, **kwargs,
        )
        self._nocolor = bg_color
        self._hovercolor = kwargs.pop('highlight_color', None) or (
            theme.button.hover if theme else ui_theme.button.hover
        )
        self._pressedcolor = kwargs.pop('pressed_color', None) or (
            theme.button.pressed if theme else ui_theme.button.pressed
        )

        self.unlit = True
        self.collider = 'box'
        self._is_hovered = False
        self._is_pressed = False

        self._setup_events()

    def _find_text_child(self):
        """查找第一个 UIText 子控件"""
        for child in self.children:
            if hasattr(child, '_text_entity') and child._text_entity is not None:
                return child
        return None

    @property
    def text(self) -> str:
        child = self._find_text_child()
        return getattr(child, 'text', '') if child else ''

    @text.setter
    def text(self, value: str):
        child = self._find_text_child()
        if child:
            child.text = value

    def set_text(self, value: str):
        self.text = value
        return self

    @property
    def text_color(self):
        child = self._find_text_child()
        if child and hasattr(child, '_text_entity'):
            return child._text_entity.color
        return color.white

    @text_color.setter
    def text_color(self, c):
        child = self._find_text_child()
        if child and hasattr(child, '_text_entity'):
            child._text_entity.color = c

    def set_text_color(self, c):
        self.text_color = c
        return self

    @property
    def normal_color(self):
        return self._nocolor

    @normal_color.setter
    def normal_color(self, c):
        self._nocolor = c
        if not self._is_hovered:
            self.color = c

    def set_normal_color(self, c):
        self.normal_color = c
        return self

    # ─── 事件绑定（覆盖 UIWidget 避免倍 Ursina mouse.input 重复触发）───

    def on_click(self, callback=None):
        """绑定点击事件（纯设置器，UIButton 通过 input(key) 触发）"""
        if callback is not None:
            self._click_handler = callback
            return self

    def on_hover(self, callback=None):
        """绑定悬停进入事件（纯设置器，通过 on_mouse_enter 触发）"""
        if callback is not None:
            self._hover_handler = callback
            return self

    def on_unhover(self, callback=None):
        """绑定悬停离开事件（纯设置器，通过 on_mouse_exit 触发）"""
        if callback is not None:
            self._unhover_handler = callback
            return self

    def _setup_events(self):
        def _on_mouse_enter():
            if not self._enabled:
                return
            self._is_hovered = True
            self.color = self._hovercolor
            if self._hover_handler:
                self._hover_handler()

        def _on_mouse_exit():
            self._is_hovered = False
            self._is_pressed = False
            self.color = self._nocolor
            if self._unhover_handler:
                self._unhover_handler()

        def _on_click():
            if not self._enabled:
                return
            if self._click_handler:
                self._click_handler()

        self.on_mouse_enter = _on_mouse_enter
        self.on_mouse_exit = _on_mouse_exit
        self._click_callback = _on_click

    def input(self, key):
        if key == 'left mouse down' and self.hovered:
            self._is_pressed = True
            self.color = self._pressedcolor
        elif key == 'left mouse up' and self._is_pressed:
            self._is_pressed = False
            if self.hovered:
                self.color = self._hovercolor
                if self._click_callback:
                    self._click_callback()
            else:
                self.color = self._nocolor

    def set_enabled(self, enabled: bool):
        self._enabled = enabled
        if enabled:
            self.color = self._nocolor
        else:
            self.color = self.ui_theme.button.disabled if hasattr(self, 'ui_theme') else color.hex('#555555')
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
