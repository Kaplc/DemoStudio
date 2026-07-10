"""
UIWidget — 基础 UI 控件类
========================
所有 UI 控件的基类，提供：

- **锚点系统** (Anchor): 类似 Unity RectTransform，快速定位到父级九宫格位置
- **偏移量** (offset): 相对锚点的微调
- **填充拉伸** (stretch): 使用 stretch_left/right/top/bottom 自动响应父级 resize
- **事件** (on_click, on_hover, on_enable, on_disable)
- **链式 API**: widget.set_position(...).set_size(...).set_color(...)

坐标系 (同 Ursina camera.ui):
    (-0.5, 0.5) 左上 ────── (0.5, 0.5) 右上
         │                         │
         │        (0,0) 中心        │
         │                         │
    (-0.5,-0.5) 左下 ────── (0.5,-0.5) 右下

Usage:
    from core.ui.widget import UIWidget, Anchor

    # 在屏幕中心创建一个按钮
    btn = UIWidget(anchor=Anchor.CENTER, size=(0.2, 0.06))

    # 在左上角创建一个标签
    lbl = UIWidget(anchor=Anchor.TOP_LEFT, offset=(0.02, -0.02), size=(0.3, 0.04))
"""

from ursina import Entity, Vec2, Vec3, camera, color
from core.ui.theme import ui_theme, UITheme

from typing import Optional, Callable


# ──────────────────────────────────────────────
# 锚点预设 (九宫格定位)
# ──────────────────────────────────────────────

class Anchor:
    """锚点常量 — 对应父级归一化坐标的 9 个定位点
    
    每个值是 (x, y) 元组，表示在父级空间中的锚定位置。
    """
    TOP_LEFT      = (-0.5,  0.5)
    TOP_CENTER    = ( 0.0,  0.5)
    TOP_RIGHT     = ( 0.5,  0.5)
    MIDDLE_LEFT   = (-0.5,  0.0)
    CENTER        = ( 0.0,  0.0)
    MIDDLE_RIGHT  = ( 0.5,  0.0)
    BOTTOM_LEFT   = (-0.5, -0.5)
    BOTTOM_CENTER = ( 0.0, -0.5)
    BOTTOM_RIGHT  = ( 0.5, -0.5)


# ──────────────────────────────────────────────
# 基础 UI 控件
# ──────────────────────────────────────────────

class UIWidget(Entity):
    """所有 UI 控件的基类
    
    Parameters
    ----------
    parent : Entity, optional
        父级实体，默认 camera.ui
    anchor : tuple, optional
        锚点位置，默认 Anchor.CENTER
    offset : tuple, optional
        相对锚点的偏移量 (x, y)，默认 (0, 0)
    size : tuple, optional
        控件尺寸 (x, y)，归一化坐标，默认 (0.1, 0.1)
    pivot : tuple, optional
        轴心点，默认等于 anchor
    theme : UITheme, optional
        自定义主题，默认使用全局 ui_theme
    model : str, optional
        模型，默认 'quad'
    **kwargs
        传递给 Entity 的额外参数
    """

    # Class-level theme override
    theme: Optional[UITheme] = None

    def __init__(
        self,
        parent=None,
        anchor: tuple = Anchor.CENTER,
        offset: tuple = (0, 0),
        size: tuple = (0.1, 0.1),
        pivot: tuple = None,
        theme: Optional[UITheme] = None,
        model: str = 'quad',
        **kwargs,
    ):
        if parent is None:
            from ursina import camera
            parent = camera.ui

        self._anchor = Vec2(*anchor)
        self._offset = Vec2(*offset)
        self._size = Vec2(*size)
        self._stretch_left = None
        self._stretch_right = None
        self._stretch_top = None
        self._stretch_bottom = None
        self._theme = theme

        # 如果没有指定 pivot，默认与 anchor 一致 (定位点即轴心)
        if pivot is None:
            pivot = anchor

        # 计算实际位置: 锚点 + 偏移
        pos = (self._anchor.x + self._offset.x,
               self._anchor.y + self._offset.y)

        # 提取其他 Entity 参数，避免 scale 被覆盖
        scale = kwargs.pop('scale', None)

        super().__init__(
            parent=parent,
            model=model,
            origin=pivot,
            position=(pos[0], pos[1], 0),
            scale=(size[0], size[1], 1) if scale is None else scale,
            **kwargs,
        )

        self._click_handler: Optional[Callable] = None
        self._hover_handler: Optional[Callable] = None
        self._unhover_handler: Optional[Callable] = None
        self._enabled = True

    # ─── 主题 ───

    @property
    def ui_theme(self) -> UITheme:
        return self._theme if self._theme is not None else ui_theme

    # ─── 定位 ───

    @property
    def ui_anchor(self) -> Vec2:
        return self._anchor

    @ui_anchor.setter
    def ui_anchor(self, value: tuple):
        self._anchor = Vec2(*value)
        self._update_position()

    @property
    def ui_offset(self) -> Vec2:
        return self._offset

    @ui_offset.setter
    def ui_offset(self, value: tuple):
        self._offset = Vec2(*value)
        self._update_position()

    @property
    def ui_size(self) -> Vec2:
        return self._size

    @ui_size.setter
    def ui_size(self, value: tuple):
        self._size = Vec2(*value)
        self.scale = (value[0], value[1], self.scale_z or 1)

    def _update_position(self):
        """根据 anchor + offset 更新位置"""
        self.x = self._anchor.x + self._offset.x
        self.y = self._anchor.y + self._offset.y

    # ─── 填充拉伸 (类似 Unity 的 stretch) ───

    def set_stretch(
        self,
        left: float = None,
        right: float = None,
        top: float = None,
        bottom: float = None,
    ):
        """设置填充拉伸，widget 会随父级缩放而自动调整
        
        Parameters
        ----------
        left, right, top, bottom : float
            距离父级对应边的偏移量 (归一化坐标)
        """
        self._stretch_left = left
        self._stretch_right = right
        self._stretch_top = top
        self._stretch_bottom = bottom
        self._apply_stretch()
        return self

    def _apply_stretch(self):
        """根据拉伸约束计算位置和大小"""
        # 简化实现：水平填充
        if self._stretch_left is not None and self._stretch_right is not None:
            cx = (self._stretch_left + self._stretch_right) / 2
            w = abs(self._stretch_right - self._stretch_left)
            self.x = cx
            self.scale_x = w
        # 垂直填充
        if self._stretch_bottom is not None and self._stretch_top is not None:
            cy = (self._stretch_bottom + self._stretch_top) / 2
            h = abs(self._stretch_top - self._stretch_bottom)
            self.y = cy
            self.scale_y = h

    # ─── 显示/隐藏 ───

    def show(self):
        """显示控件"""
        self.enabled = True
        return self

    def hide(self):
        """隐藏控件"""
        self.enabled = False
        return self

    def toggle_visible(self):
        """切换可见性"""
        self.enabled = not self.enabled
        return self

    # ─── 启用/禁用 ───

    @property
    def ui_enabled(self) -> bool:
        return self._enabled

    @ui_enabled.setter
    def ui_enabled(self, value: bool):
        self._enabled = value
        # 对于普通 UIWidget，禁用时降低透明度
        if not value:
            self.color = color.rgba(
                self.color.r * 255, self.color.g * 255,
                self.color.b * 255, 80,
            )
        else:
            self.color = color.rgba(
                self.color.r * 255, self.color.g * 255,
                self.color.b * 255, 255,
            )

    # ─── 事件绑定 ───

    def on_click(self, callback: Callable):
        """绑定点击事件"""
        self._click_handler = callback
        return self

    def on_hover(self, callback: Callable):
        """绑定悬停进入事件"""
        self._hover_handler = callback
        return self

    def on_unhover(self, callback: Callable):
        """绑定悬停离开事件"""
        self._unhover_handler = callback
        return self

    # ─── 链式配置 ───

    def set_position(self, x: float, y: float):
        """直接设置位置 (覆盖锚点)"""
        self.position = (x, y, self.z)
        return self

    def set_size(self, w: float, h: float):
        """设置尺寸"""
        self.ui_size = (w, h)
        return self

    def set_color(self, c):
        """设置颜色"""
        self.color = c
        return self

    def set_alpha(self, a: float):
        """设置透明度"""
        self.alpha = a
        return self

    def set_parent(self, parent):
        """重新设置父级"""
        self.parent = parent
        return self

    # ─── 工具方法 ───

    def center_on_parent(self):
        """居中到父级"""
        self.ui_anchor = Anchor.CENTER
        self._offset = Vec2(0, 0)
        return self

    def fit_to_children(self, padding: float = 0.01):
        """自动调整大小以包裹所有子控件"""
        if not self.children:
            return self
        min_x = min(c.x - c.scale_x / 2 for c in self.children if hasattr(c, 'x'))
        max_x = max(c.x + c.scale_x / 2 for c in self.children if hasattr(c, 'x'))
        min_y = min(c.y - c.scale_y / 2 for c in self.children if hasattr(c, 'y'))
        max_y = max(c.y + c.scale_y / 2 for c in self.children if hasattr(c, 'y'))
        w = (max_x - min_x) + padding * 2
        h = (max_y - min_y) + padding * 2
        self.ui_size = (w, h)
        return self

    # ─── 销毁 ───

    def destroy(self):
        """销毁控件及其子控件"""
        for child in self.children:
            if hasattr(child, 'destroy'):
                child.destroy()
        super().destroy()

    def __repr__(self):
        return f'<{self.__class__.__name__} anchor={self._anchor} size={self._size}>'
