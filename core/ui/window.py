"""
UIWindow — 可拖拽窗口
=====================
类似 Unity 的 EditorWindow 或 UE 的 Window。
支持标题栏拖拽、关闭按钮。

声明式: 视觉子元素（标题栏、文字、关闭按钮、边框）由 JSON 的 children 显式提供。
约定子控件 id: _title_bar, _title_text, _close_btn, _close_icon,
_border_top/bottom/left/right
"""

from ursina import Vec2, mouse
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UIWindow(UIWidget):
    """可拖拽窗口 - 声明式

    Usage (JSON):
        {"type": "UIWindow", "id": "win", ..., "children": [
            {"type": "UIWidget", "id": "_title_bar", ...},
            {"type": "UIText", "id": "_title_text", "text": "Properties", ...},
            {"type": "UIWidget", "id": "_close_btn", ...},
            {"type": "UIText", "id": "_close_icon", "text": "×", ...},
            {"type": "UIWidget", "id": "_border_top", ...},
            ...
        ]}
    """

    def __init__(
        self,
        title: str = 'Window',
        closable: bool = True,
        draggable: bool = True,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.3, 0.35),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=ui_theme.window.background, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._title = title
        self._closable = closable
        self._draggable = draggable
        self._is_dragging = False
        self._drag_offset = Vec2(0, 0)
        self._on_close_cb: Optional[Callable] = None

        # 稍后在 _on_children_built 中由 JSON 子控件填充
        self._title_bar = None
        self._title_text = None
        self._close_btn = None
        self._close_icon = None
        self._border = None
        self._content_top = 0.5 - 0.04 - 0.01  # 默认标题栏高 0.04
        self._content_bottom = -0.5 + 0.01

    def _on_children_built(self):
        """由布局加载器在 JSON 子控件构建完成后调用"""
        self._title_bar = self._find_child('_title_bar')
        self._title_text = self._find_child('_title_text')
        self._close_btn = self._find_child('_close_btn')
        self._close_icon = self._find_child('_close_icon')

        # 设置标题文本
        if self._title_text is not None and hasattr(self._title_text, '_text_entity'):
            self._title_text._text_entity.text = self._title

        # 计算内容区域
        if self._title_bar is not None:
            title_h = abs(self._title_bar.scale_y) if hasattr(self._title_bar, 'scale_y') else 0.04
            self._content_top = 0.5 - title_h - 0.01

        # 记录边框引用
        for b_id in ('_border_top', '_border_bottom', '_border_left', '_border_right'):
            b = self._find_child(b_id)
            if b is not None:
                self._border = b

    def input(self, key):
        if not self._draggable:
            return

        if key == 'left mouse down':
            if self._title_bar is not None and self._title_bar.hovered:
                self._is_dragging = True
                self._drag_offset = Vec2(
                    mouse.position.x - self.x,
                    mouse.position.y - self.y,
                )

        elif key == 'left mouse up':
            if self._is_dragging:
                self._is_dragging = False

        if key == 'left mouse down' and self._closable:
            if self._close_btn is not None and self._close_btn.hovered:
                self.close()

    def update(self):
        if self._is_dragging:
            self.x = mouse.position.x - self._drag_offset.x
            self.y = mouse.position.y - self._drag_offset.y

    def close(self):
        self.enabled = False
        if self._on_close_cb:
            self._on_close_cb()

    def on_close(self, callback: Callable):
        self._on_close_cb = callback
        return self

    @property
    def content_top(self) -> float:
        return self._content_top

    @property
    def content_bottom(self) -> float:
        return self._content_bottom

    @property
    def title(self) -> str:
        return self._title

    def set_title(self, value: str):
        self._title = value
        if self._title_text is not None and hasattr(self._title_text, '_text_entity'):
            self._title_text._text_entity.text = value
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
