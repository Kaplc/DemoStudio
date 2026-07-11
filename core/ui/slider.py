"""
UISlider — 滑动条控件
=====================
可拖动的滑块。声明式: _track, _fill, _thumb, _label 由 JSON children 显式提供。
"""

from ursina import color, mouse
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor

from typing import Optional, Callable


class UISlider(UIWidget):
    """滑动条控件 - 声明式

    约定子控件 id: _track(轨道), _fill(填充), _thumb(滑块), _label(数值标签)
    """

    def __init__(
        self,
        min_value: float = 0,
        max_value: float = 100,
        default_value: float = 0,
        step: float = 1,
        show_label: bool = True,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.25, 0.03),
        **kwargs,
    ):
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=size, color=color.clear, **kwargs,
        )
        self.unlit = True

        self._min = min_value
        self._max = max_value
        self._step = step
        self._value = default_value
        self._on_change_cb: Optional[Callable] = None
        self._is_dragging = False

        # 稍后在 _on_children_built 中填充
        self._track = None
        self._fill = None
        self._thumb = None
        self._label = None

    def _on_children_built(self):
        self._track = self._find_child('_track')
        self._fill = self._find_child('_fill')
        self._thumb = self._find_child('_thumb')
        self._label = self._find_child('_label')
        if self._thumb is not None:
            self._thumb.collider = 'box'
        self._update_visual()

    @property
    def _norm_value(self) -> float:
        if self._max <= self._min:
            return 0
        return (self._value - self._min) / (self._max - self._min)

    @property
    def _thumb_x(self) -> float:
        return -0.45 + self._norm_value * 0.9

    @property
    def value(self) -> float:
        return self._value

    @value.setter
    def value(self, v: float):
        self._value = max(self._min, min(self._max, v))
        if self._step > 0:
            self._value = round(self._value / self._step) * self._step
        self._update_visual()

    def set_value(self, v: float):
        self.value = v
        return self

    def _update_visual(self):
        if self._fill is None or self._thumb is None:
            return
        nv = self._norm_value
        fill_w = nv * 0.9 or 0.01
        self._fill.scale_x = fill_w
        self._fill.x = -0.45 + fill_w / 2
        self._thumb.x = self._thumb_x
        if self._label is not None and hasattr(self._label, '_text_entity'):
            self._label._text_entity.text = str(int(self._value))

    def input(self, key):
        if key == 'left mouse down' and self._thumb is not None and self._thumb.hovered:
            self._is_dragging = True
            self._thumb.color = ui_theme.slider.thumb_hover
        elif key == 'left mouse up':
            if self._is_dragging:
                self._is_dragging = False
                if self._thumb is not None:
                    self._thumb.color = ui_theme.slider.thumb

    def update(self):
        if self._is_dragging:
            mx, my = mouse.position
            parent_pos = self.world_position
            local_mx = mx - parent_pos.x
            t = (local_mx + 0.45) / 0.9
            t = max(0, min(1, t))
            v = self._min + t * (self._max - self._min)
            if self._step > 0:
                v = round(v / self._step) * self._step
            v = max(self._min, min(self._max, v))
            if abs(v - self._value) > 0.001:
                self._value = v
                self._update_visual()
                if self._on_change_cb:
                    self._on_change_cb(self._value)

    def on_value_changed(self, callback: Callable[[float], None]):
        self._on_change_cb = callback
        return self

    def destroy(self):
        from ursina import destroy as _destroy
        _destroy(self)
