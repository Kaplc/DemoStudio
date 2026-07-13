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
from core.logger import get_logger

from typing import List

logger = get_logger('ui.layout')


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
        # 从 kwargs 提取 color，若未提供则默认透明
        _color = kwargs.pop('color', color.clear)
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=_color, **kwargs,
        )
        self._spacing = spacing
        self._padding = padding
        self._layout_children: List[UIWidget] = []

    def rebuild(self):
        # 从 JSON 构建的子控件是 Entity children，补充到 _layout_children
        if not self._layout_children:
            for c in self.children:
                if isinstance(c, UIWidget):
                    self._layout_children.append(c)
            logger.info('UIHorizontalLayout.rebuild: 从 self.children 收集了 {} 个控件', len(self._layout_children))
        if not self._layout_children:
            return
        n = len(self._layout_children)
        total_spacing = self._spacing * (n - 1)
        total_padding = self._padding * 2
        avail_w = self._size.x - total_padding - total_spacing
        child_w = max(avail_w / n, 0.001) if n > 0 else 0
        child_h = self._size.y - self._padding * 2

        # 补偿容器自身的非均匀缩放（UIWidget 的父级缩放补偿）
        psx = max(abs(self.scale_x), 0.001)
        psy = max(abs(self.scale_y), 0.001)

        start_x = self._padding + child_w / 2  # 从左边缘开始排列
        for i, child in enumerate(self._layout_children):
            child.x = (start_x + i * (child_w + self._spacing)) / psx
            child.y = 0
            child.scale_x = (child_w * 0.9) / psx
            child.scale_y = (child_h * 0.9) / psy
            # 若子控件有文字实体，同步更新其缩放补偿
            self._refresh_child_text(child)
            # 缩放改变后，重置 collider 以匹配新大小（若有）
            if hasattr(child, 'collider') and child.collider:
                child.collider = 'box'
        logger.info('UIHorizontalLayout.rebuild: 排列了 {} 个子控件 (spacing={}, child_w={:.4f}, start_x={:.4f}, psx={:.4f})', n, self._spacing, child_w, start_x, psx)
        for i, child in enumerate(self._layout_children):
            logger.info('  [{}] {}: x={:.4f} y={:.4f} sx={:.4f} sy={:.4f}',
                i, getattr(child, '_widget_id', type(child).__name__),
                child.x, child.y, child.scale_x, child.scale_y)

    @staticmethod
    def _refresh_child_text(child):
        """若子控件有文字实体，同步更新其缩放补偿

        支持两种情况:
        - child 自身就是 UIText (有 _text_entity)
        - child 内部有 UIText 子控件 (如 UIButton → UIText → _text_entity)
        """
        # 情况 1: child 自身就是 UIText
        text_entity = getattr(child, '_text_entity', None)
        if text_entity is not None:
            fs = getattr(child, '_resolved_font_size', None)
            if fs:
                from core.ui.widget import compensated_text_scale
                text_entity.scale = compensated_text_scale(fs, child)
            return
        # 情况 2: 遍历子控件查找 UIText
        for c in child.children:
            te = getattr(c, '_text_entity', None)
            if te is not None:
                fs = getattr(c, '_resolved_font_size', None)
                if fs:
                    from core.ui.widget import compensated_text_scale
                    te.scale = compensated_text_scale(fs, c)

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

    def refresh(self):
        """窗口 resize 后：刷新自身布局 + 重新排列子控件"""
        super().refresh()
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
        # 从 kwargs 提取 color，若未提供则默认透明
        _color = kwargs.pop('color', color.clear)
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=_color, **kwargs,
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
            # 若子控件有文字实体，同步更新其缩放补偿
            UIHorizontalLayout._refresh_child_text(child)

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

    def refresh(self):
        """窗口 resize 后：刷新自身布局 + 重新排列子控件"""
        super().refresh()
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
