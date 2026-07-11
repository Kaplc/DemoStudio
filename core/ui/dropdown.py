"""
UIDropdown — 下拉菜单控件
=========================
类似 Unity 的 Dropdown 或 UE 的 ComboBox。
点击展开选项列表，点击选项后关闭。
"""

from ursina import Entity, Button, color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UIDropdown(UIWidget):
    """下拉菜单控件 - 声明式
    约定子控件 id: _label(选中文字), _arrow(箭头)
    下拉项动态创建 (运行时数据)
    """

    def __init__(
        self,
        items: list = None,
        default_index: int = -1,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.2, 0.04),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=ui_theme.surface, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._items = items or ['Item 1', 'Item 2']
        self._selected_index = default_index if 0 <= default_index < len(self._items) else -1
        self._is_open = False
        self._on_selected_cb: Optional[Callable] = None

        # 稍后在 _on_children_built 中填充
        self._label = None
        self._arrow = None

        self._dropdown_root = Entity(parent=parent, enabled=False)
        self._dropdown_items = []
        self._dropdown_bg = None

    def _on_children_built(self):
        self._label = self._find_child('_label')
        self._arrow = self._find_child('_arrow')
        self._update_label_text()

    def _update_label_text(self):
        if self._label is None or not hasattr(self._label, '_text_entity'):
            return
        selected_text = self._items[self._selected_index] if self._selected_index >= 0 else 'Select...'
        self._label._text_entity.text = selected_text

        self._dropdown_root = Entity(parent=parent, enabled=False)
        self._dropdown_items = []
        self._dropdown_bg = None

    def input(self, key):
        if key == 'left mouse down':
            if self.hovered:
                self._toggle()
            elif self._is_open:
                hit_item = False
                for item_entity, idx, _ in self._dropdown_items:
                    if hasattr(item_entity, 'hovered') and item_entity.hovered:
                        self._select(idx)
                        hit_item = True
                        break
                if not hit_item:
                    self._close()

    def _toggle(self):
        if self._is_open:
            self._close()
        else:
            self._open()

    def _open(self):
        self._is_open = True
        self._rebuild_dropdown()
        self._dropdown_root.enabled = True

    def _close(self):
        self._is_open = False
        self._dropdown_root.enabled = False

    def _rebuild_dropdown(self):
        for ent, _, _ in self._dropdown_items:
            ent.destroy()
        if self._dropdown_bg:
            self._dropdown_bg.destroy()
        self._dropdown_items.clear()

        n = len(self._items)
        item_h = 0.035
        total_h = n * item_h + 0.01

        self._dropdown_bg = Entity(
            parent=self._dropdown_root,
            model='quad',
            scale=(self._size.x, total_h, 1),
            position=(0, -self._size.y / 2 - total_h / 2 + 0.005, 0.01),
            color=color.rgba(30, 35, 60, 240),
        )

        for i, item in enumerate(self._items):
            y_pos = -self._size.y / 2 - 0.005 - i * item_h - item_h / 2
            is_selected = (i == self._selected_index)
            item_btn = Button(
                parent=self._dropdown_root,
                text=item,
                position=(0, y_pos, 0.02),
                scale=(self._size.x, item_h),
                color=ui_theme.accent if is_selected else color.rgba(40, 50, 80, 240),
                highlight_color=ui_theme.accent_hover,
                origin=(0, 0),
            )
            self._dropdown_items.append((item_btn, i, item))

        self._arrow.text = '▲'

    def _select(self, idx: int):
        self._selected_index = idx
        item = self._items[idx] if 0 <= idx < len(self._items) else ''
        self._label.text = item
        self._close()
        if self._on_selected_cb:
            self._on_selected_cb(idx, item)

    @property
    def selected_index(self) -> int:
        return self._selected_index

    @property
    def selected_item(self) -> str:
        if 0 <= self._selected_index < len(self._items):
            return self._items[self._selected_index]
        return ''

    def set_items(self, items: list):
        self._items = items
        self._selected_index = -1
        self._label.text = 'Select...'
        return self

    def on_selected(self, callback: Callable[[int, str], None]):
        self._on_selected_cb = callback
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self._label)
        _destroy(self._arrow)
        for ent, _, _ in self._dropdown_items:
            _destroy(ent)
        if self._dropdown_bg:
            _destroy(self._dropdown_bg)
        _destroy(self._dropdown_root)
        _destroy(self)
