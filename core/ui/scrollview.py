"""
UIScrollView — 可滚动内容视口
=============================
在固定大小的视口中显示可滚动的内容区域。
类似 Unity 的 ScrollView 或 UE 的 ScrollBox。
"""

from ursina import color, mouse
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor


class UIScrollView(UIWidget):
    """可滚动内容视口 - 声明式
    约定子控件 id: _mask, _content, _scroll_bg, _scroll_thumb, _border
    """

    def __init__(
        self,
        scroll_speed: float = 0.001,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.3, 0.4),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=ui_theme.surface, **kwargs,
        )
        self.unlit = True

        self._scroll_speed = scroll_speed
        self._scroll_y = 0.0

        # 稍后在 _on_children_built 中填充
        self._mask = None
        self._content = None
        self._scroll_bg = None
        self._scroll_thumb = None
        self._border = None

    def _on_children_built(self):
        self._mask = self._find_child('_mask')
        self._content = self._find_child('_content')
        self._scroll_bg = self._find_child('_scroll_bg')
        self._scroll_thumb = self._find_child('_scroll_thumb')
        self._border = self._find_child('_border')

    @property
    def content(self):
        return self._content

    def scroll_to(self, y: float):
        self._scroll_y = y
        if self._content is not None:
            self._content.y = y
            self._content.y = min(0.5, max(-0.5, self._content.y))
        self._update_scrollbar()

    def _update_scrollbar(self):
        if self._scroll_thumb is None:
            return
        if self._content is not None:
            t = (self._content.y + 0.5) / 1.0
        else:
            t = 0.5
        self._scroll_thumb.y = -0.5 + t * 0.8 + 0.1

    def update(self):
        if not self.enabled:
            return
        mx, my = mouse.position
        wx, wy = self.world_position
        hw, hh = self.scale_x / 2, self.scale_y / 2
        if abs(mx - wx) < hw and abs(my - wy) < hh:
            scroll = mouse.scroll_y * self._scroll_speed * 100
            if scroll != 0 and self._content is not None:
                self._scroll_y += scroll
                self._scroll_y = max(-0.8, min(0.8, self._scroll_y))
                self._content.y = self._scroll_y
                self._update_scrollbar()

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
