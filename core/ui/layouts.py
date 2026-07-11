"""
布局容器 — 自动排列子控件
=========================
包含:
    UIHorizontalLayout — 水平布局组 (类似 Unity Horizontal Layout Group)
    UIVerticalLayout   — 垂直布局组 (类似 Unity Vertical Layout Group)
    UIGridLayout       — 网格布局组 (类似 Unity Grid Layout Group)
"""

from ursina import color
from core.ui.widget import UIWidget, Anchor

from typing import List


# ═══════════════════════════════════════════════
# UIHorizontalLayout
# ═══════════════════════════════════════════════

class UIHorizontalLayout(UIWidget):
    """水平布局容器 — 自动将子控件沿水平方向均匀排列

    Usage:
        layout = UIHorizontalLayout(size=(0.5, 0.06), spacing=0.01)
        btn1 = UIButton(text='A', parent=layout)
        btn2 = UIButton(text='B', parent=layout)
        layout.rebuild()
    """

    def __init__(
        self,
        spacing: float = 0.01,
        padding: float = 0.01,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.4, 0.06),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self._spacing = spacing
        self._padding = padding
        self._layout_children: List[UIWidget] = []

    def rebuild(self):
        if not self._layout_children:
            return
        n = len(self._layout_children)
        total_spacing = self._spacing * (n - 1)
        total_padding = self._padding * 2
        avail_w = self._size.x - total_padding - total_spacing
        child_w = avail_w / n if n > 0 else 0
        child_h = self._size.y - self._padding * 2

        start_x = -self._size.x / 2 + self._padding + child_w / 2
        for i, child in enumerate(self._layout_children):
            child.x = start_x + i * (child_w + self._spacing)
            child.y = 0
            child.scale_x = child_w * 0.9
            child.scale_y = child_h * 0.9

    def add(self, widget: UIWidget):
        widget.parent = self
        self._layout_children.append(widget)
        return self

    def remove(self, widget: UIWidget):
        if widget in self._layout_children:
            self._layout_children.remove(widget)
        return self

    def clear(self):
        for w in self._layout_children:
            w.destroy()
        self._layout_children.clear()

    def on_enable(self):
        self.rebuild()

    def destroy(self):
        from ursina import destroy as _destroy
        self.clear()
        _destroy(self)


# ═══════════════════════════════════════════════
# UIVerticalLayout
# ═══════════════════════════════════════════════

class UIVerticalLayout(UIWidget):
    """垂直布局容器 — 自动将子控件沿垂直方向均匀排列

    Usage:
        layout = UIVerticalLayout(size=(0.2, 0.3), spacing=0.008)
        btn1 = UIButton(text='Top', parent=layout)
        btn2 = UIButton(text='Bottom', parent=layout)
        layout.rebuild()
    """

    def __init__(
        self,
        spacing: float = 0.008,
        padding: float = 0.01,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.2, 0.25),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self._spacing = spacing
        self._padding = padding
        self._layout_children: List[UIWidget] = []

    def rebuild(self):
        if not self._layout_children:
            return
        n = len(self._layout_children)
        total_spacing = self._spacing * (n - 1)
        total_padding = self._padding * 2
        avail_h = self._size.y - total_padding - total_spacing
        child_h = avail_h / n if n > 0 else 0
        child_w = self._size.x - self._padding * 2

        start_y = self._size.y / 2 - self._padding - child_h / 2
        for i, child in enumerate(self._layout_children):
            child.y = start_y - i * (child_h + self._spacing)
            child.x = 0
            child.scale_y = child_h * 0.9
            child.scale_x = child_w

    def add(self, widget: UIWidget):
        widget.parent = self
        self._layout_children.append(widget)
        return self

    def remove(self, widget: UIWidget):
        if widget in self._layout_children:
            self._layout_children.remove(widget)
        return self

    def clear(self):
        for w in self._layout_children:
            w.destroy()
        self._layout_children.clear()

    def on_enable(self):
        self.rebuild()

    def destroy(self):
        from ursina import destroy as _destroy
        self.clear()
        _destroy(self)


# ═══════════════════════════════════════════════
# UIGridLayout
# ═══════════════════════════════════════════════

class UIGridLayout(UIWidget):
    """网格布局容器 — 自动将子控件按行列均匀排列

    Usage:
        grid = UIGridLayout(cols=3, spacing=0.008, size=(0.3, 0.3))
        for i in range(6):
            btn = UIButton(text=str(i), parent=grid)
        grid.rebuild()
    """

    def __init__(
        self,
        cols: int = 3,
        spacing: float = 0.008,
        padding: float = 0.01,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.3, 0.3),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self._cols = cols
        self._spacing = spacing
        self._padding = padding
        self._layout_children: List[UIWidget] = []

    @property
    def cols(self) -> int:
        return self._cols

    @cols.setter
    def cols(self, value: int):
        self._cols = max(1, value)
        self.rebuild()

    def rebuild(self):
        if not self._layout_children or self._cols <= 0:
            return
        n = len(self._layout_children)
        rows = (n + self._cols - 1) // self._cols

        cell_w = (self._size.x - self._padding * 2 - self._spacing * (self._cols - 1)) / self._cols
        cell_h = (self._size.y - self._padding * 2 - self._spacing * (rows - 1)) / rows

        start_x = -self._size.x / 2 + self._padding + cell_w / 2
        start_y = self._size.y / 2 - self._padding - cell_h / 2

        for i, child in enumerate(self._layout_children):
            col = i % self._cols
            row = i // self._cols
            child.x = start_x + col * (cell_w + self._spacing)
            child.y = start_y - row * (cell_h + self._spacing)
            child.scale_x = cell_w * 0.9
            child.scale_y = cell_h * 0.9

    def add(self, widget: UIWidget):
        widget.parent = self
        self._layout_children.append(widget)
        return self

    def remove(self, widget: UIWidget):
        if widget in self._layout_children:
            self._layout_children.remove(widget)
        return self

    def clear(self):
        for w in self._layout_children:
            w.destroy()
        self._layout_children.clear()

    def destroy(self):
        from ursina import destroy as _destroy
        self.clear()
        _destroy(self)
