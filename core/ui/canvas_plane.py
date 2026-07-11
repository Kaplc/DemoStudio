"""
UICanvasPlane — 嵌套画布平面 (Plane)
=====================================
在 UIWidget 树中作为"画布平面"占位: 自身是 UIWidget (rect/plane),
内部 children 是独立子画布的内容, 通过 plane 的 enabled 控制整体显隐。

设计理念:
  - 一个 JSON 资产可以嵌入多个 UICanvasPlane 节点 (像 layer 一样)
  - 每个 plane 是普通 UIWidget (有自己 transform/anchor/size/color)
  - 它的 children 就是该子画布的所有控件
  - plane 可以注册到一个轻量 stub 给 CanvasManager 管理 (显隐/动画)

Usage (在 JSON 中):
    {
        "type": "UICanvas",
        "id": "topbar_plane",
        "anchor": "TOP_CENTER",
        "offset": [0, -0.03],
        "size": [1.0, 0.05],
        "color": "$toolbar_bg",      # plane 自身的背景色 (可见)
        "alpha": 0.0,                  # 设为透明让 plane 不可见, 只作为容器
        "children": [                  # 子画布内容 (直接挂在 plane 下)
            { "type": "UIText", "id": "menu_file", ... },
            ...
        ]
    }
"""

from ursina import Entity, color
from core.ui.theme import ui_theme
from core.ui.widget import UIWidget, Anchor
from typing import Optional, Any


class UICanvasPlane(UIWidget):
    """画布平面 — 自身是 UIWidget, children 就是子画布内容

    支持:
      - 通过 enabled 控制整组显隐
      - 通过 canvas_manager 接入统一管理
    """

    def __init__(
        self,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (1.0, 1.0),
        canvas_name: str = 'inline_canvas',
        canvas_manager=None,
        **kwargs,
    ):
        bg_color = kwargs.pop('color', color.clear)
        if bg_color is None:
            bg_color = color.clear

        # ─── 关键设计 ───
        # plane 自身是个 1x1 大小、不可见的分组节点 (只用于 hot-area / 显隐分组)
        # 子节点用全局 camera.ui 坐标 (±0.5), plane 不缩放子节点
        super().__init__(
            parent=parent, anchor=anchor, offset=offset,
            size=(1.0, 1.0),        # 强制 1x1, 子节点使用全局坐标
            color=color.clear,      # 强制透明
            **kwargs,
        )
        self.unlit = True

        # 但保留用户提供的 size 供 hotspot / hit-test 使用
        self._user_size = size
        self._user_color = bg_color

        # 如果用户希望 plane 可见且有背景, 用 overlay 模式 (透明 quad)
        if bg_color is not color.clear and bg_color.a > 0:
            from ursina import Entity
            self._bg_overlay = Entity(
                parent=self,
                model='quad',
                origin=(0, 0),
                position=(offset[0], offset[1], 0),  # 相对 plane 中心
                scale=(size[0], size[1], 1),
                color=bg_color,
            )
        else:
            self._bg_overlay = None

        self._canvas_name = canvas_name
        self._canvas_manager = canvas_manager
        self._stub = None  # _CanvasStub 轻量代理

        # 接入 manager
        if self._canvas_manager is not None:
            self._stub = _CanvasStub(self)
            self._canvas_manager.register(self._canvas_name, self._stub)

    def show_canvas(self, animated: bool = False):
        if self._stub is not None:
            self._stub.show(animated=animated)
        else:
            self.enabled = True

    def hide_canvas(self, animated: bool = False):
        if self._stub is not None:
            self._stub.hide(animated=animated)
        else:
            self.enabled = False

    def destroy(self):
        if self._stub is not None and self._canvas_manager is not None:
            try:
                self._canvas_manager.unregister(self._canvas_name)
            except Exception:
                pass
            self._stub = None
        from ursina import destroy as _destroy
        _destroy(self)


class _CanvasStub:
    """轻量 UICanvas 代理 — 把 UICanvasPlane 包装成 CanvasManager 可识别的画布

    满足 CanvasManager 调用的接口: show/hide/is_shown/widget_count/state/update_animation
    """

    def __init__(self, plane: UICanvasPlane):
        self._plane = plane
        self._name = plane._canvas_name
        self._shown = True
        from core.canvas.canvas import CanvasState
        self._state = CanvasState.SHOWN
        self._z_offset = 0.0

    @property
    def name(self):
        return self._name

    @property
    def state(self):
        return self._state

    @property
    def is_shown(self):
        return self._shown

    @property
    def widget_count(self):
        return len(self._plane.children) if self._plane and self._plane.children else 0

    def show(self, animated: bool = False):
        # 让 plane 自身可见 (作为可选 hotspot)
        self._plane.enabled = True
        # 让所有内联 children 可见
        for child in getattr(self._plane, '_inline_children', []):
            if child is not None:
                child.enabled = True
        self._shown = True
        from core.canvas.canvas import CanvasState
        self._state = CanvasState.SHOWN

    def hide(self, animated: bool = False):
        # 隐藏所有内联 children
        for child in getattr(self._plane, '_inline_children', []):
            if child is not None:
                child.enabled = False
        # plane 自身仍存在但也不可见
        self._plane.enabled = False
        self._shown = False
        from core.canvas.canvas import CanvasState
        self._state = CanvasState.HIDDEN

    def update_animation(self):
        pass

    def get_widget(self, widget_id: str):
        return self._find_widget(self._plane, widget_id)

    def get_widgets_by_type(self, widget_type: str):
        return [c for c in self._plane.children
                if c.__class__.__name__ == widget_type] if self._plane else []

    def _find_widget(self, root, widget_id: str):
        if root is None:
            return None
        if getattr(root, '_widget_id', None) == widget_id:
            return root
        for ch in root.children:
            r = self._find_widget(ch, widget_id)
            if r is not None:
                return r
        return None

    def destroy(self):
        self._plane = None
