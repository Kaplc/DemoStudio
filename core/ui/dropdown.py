"""
UIDropdown — 下拉菜单控件
=========================
点击展开选项列表，点击选项或外部关闭。
在 JSON 中声明为 UIDropdown，子控件 UIText(id='_label') 为显示文字。
"""

from ursina import Entity, Button, color, camera, destroy, mouse
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UIDropdown(UIWidget):
    """下拉菜单控件 - 声明式"""

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
        _color = kwargs.pop('color', ui_theme.surface)
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=_color, **kwargs,
        )
        self.unlit = True
        self.collider = 'box'

        self._items = items or ['Item 1', 'Item 2']
        self._selected_index = default_index if 0 <= default_index < len(self._items) else -1
        self._is_open = False
        self._on_selected_cb: Optional[Callable] = None
        self._label = None
        self._popup_root = Entity(parent=camera.ui, enabled=False)
        self._popup_buttons = []

    def _on_children_built(self):
        self._label = self._find_child('_label')

    def refresh(self):
        super().refresh()
        self.collider = 'box'

    def input(self, key):
        if key == 'left mouse down':
            # 通过 mouse.hovered_entity 检测
            if mouse.hovered_entity is self:
                self._toggle()
            elif self._is_open:
                # 检查是否点到弹窗项
                for btn, idx in self._popup_buttons:
                    if mouse.hovered_entity is btn:
                        self._select(idx)
                        return
                self._close()

    def _toggle(self):
        if self._is_open:
            self._close()
        else:
            self._open()

    def _open(self):
        self._is_open = True
        self._build_popup()
        self._popup_root.enabled = True

    def _close(self):
        self._is_open = False
        self._popup_root.enabled = False

    def _build_popup(self):
        # 清理旧弹窗
        for btn, _ in self._popup_buttons:
            destroy(btn)
        self._popup_buttons.clear()

        n = len(self._items)
        item_h = 0.035
        total_h = n * item_h + 0.01

        # 计算本控件在 camera.ui 下的位置
        pos = self.getPos(camera.ui)
        px = pos.x
        py = pos.y - abs(self.scale_y) / 2

        self._popup_root.position = (px, py, -0.01)

        for i, item_text in enumerate(self._items):
            y_off = -item_h / 2 - i * item_h
            is_sel = (i == self._selected_index)
            btn = Button(
                parent=self._popup_root,
                text=item_text,
                position=(0, y_off, -0.01),
                scale=(self._size.x, item_h),
                color=ui_theme.accent if is_sel else color.rgba(40, 45, 60, 240),
                highlight_color=color.rgba(60, 70, 100, 240),
                origin=(0, 0),
            )
            self._popup_buttons.append((btn, i))

    def _select(self, idx: int):
        self._selected_index = idx
        item = self._items[idx] if 0 <= idx < len(self._items) else ''
        if self._label is not None and hasattr(self._label, '_text_entity'):
            self._label._text_entity.text = item
        self._close()
        if self._on_selected_cb:
            self._on_selected_cb(idx, item)

    @property
    def selected_index(self) -> int: return self._selected_index

    @property
    def selected_item(self) -> str:
        return self._items[self._selected_index] if 0 <= self._selected_index < len(self._items) else ''

    def set_items(self, items: list):
        self._items = items
        self._selected_index = -1
        return self

    def on_selected(self, callback: Callable[[int, str], None]):
        self._on_selected_cb = callback
        return self

    def destroy(self):
        for btn, _ in self._popup_buttons:
            destroy(btn)
        destroy(self._popup_root)
        destroy(self)
